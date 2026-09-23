export type VideoPhase = "idle" | "checking" | "preview" | "connecting" | "connected" | "blocked" | "error";
export type VideoState = { phase: VideoPhase; message: string; feeding?: boolean; expiresAt?: number; sessionId?: string };

// No synthetic zeroes: omit the report if required browser counters are unavailable.
export function playbackStats(report: RTCStatsReport) {
  const rows: Record<string, unknown>[] = [];
  report.forEach(row => rows.push(row));
  const inbound = rows.filter(row => row.type === 'inbound-rtp');
  const video = inbound.filter(row => (row.kind ?? row.mediaType) === 'video');
  const audio = inbound.filter(row => (row.kind ?? row.mediaType) === 'audio');
  const sum = (items: Record<string, unknown>[], key: string, integer = false, signed = false) => {
    if (!items.length || items.some(row => typeof row[key] !== 'number' || !Number.isFinite(row[key]) ||
      (!signed && (row[key] as number) < 0) || (integer && !Number.isSafeInteger(row[key])))) return null;
    return items.reduce((total, row) => total + (row[key] as number), 0);
  };
  const frames_decoded = sum(video, 'framesDecoded', true), frames_dropped = sum(video, 'framesDropped', true);
  const packets_lost = sum(inbound, 'packetsLost', true, true);
  if (frames_decoded === null || frames_dropped === null || packets_lost === null) return null;
  const transport = rows.find(row => row.type === 'transport' && row.id === video[0]?.transportId);
  const pair = rows.find(row => row.type === 'candidate-pair' && row.id === transport?.selectedCandidatePairId);
  const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return { frames_decoded, frames_dropped, packets_lost,
    freeze_count: sum(video, 'freezeCount', true), freeze_seconds: sum(video, 'totalFreezesDuration'),
    jitter_seconds: seconds(video[0]?.jitter), rtt_seconds: seconds(pair?.currentRoundTripTime),
    concealed_samples: sum(audio, 'concealedSamples', true) };
}

async function request(action: string, sessionKey: string, body: Record<string, unknown> = {}, signal?: AbortSignal) {
  const response = await fetch(`/api/agent/video/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, sessionKey }), signal,
    keepalive: action === "close" || action === "diagnostics",
  });
  if (!response.ok) throw new Error("Video connection unavailable. Text chat is still open.");
  return response.json();
}

export function iceCandidateCounts(sdp = '') {
  const counts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const type = line.match(/\styp (host|srflx|prflx|relay)(?:\s|$)/)?.[1] as keyof typeof counts | undefined;
    if (type) counts[type]++;
  }
  return counts;
}

export function waitForIceGathering(pc: RTCPeerConnection, signal: AbortSignal, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); signal.removeEventListener('abort', aborted); };
    const check = () => { if (pc.iceGatheringState === 'complete') { done(); resolve(); } };
    const aborted = () => { done(); reject(new Error('Cancelled')); };
    const timer = setTimeout(() => {
      done(); reject(new Error('ICE gathering timed out. Video network preparation did not finish. Try another network or reconnect; text chat is still available.'));
    }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
}

export function videoCodecs(codecs: RTCRtpCodec[]) {
  return codecs.filter(codec => codec.mimeType.toLowerCase() === "video/h264" &&
    /(?:^|;)\s*profile-level-id=42e01f(?:;|$)/i.test(codec.sdpFmtpLine || "") &&
    /(?:^|;)\s*packetization-mode=1(?:;|$)/.test(codec.sdpFmtpLine || ""));
}

export class AvatarConnection {
  private controller = new AbortController();
  private pc?: RTCPeerConnection;
  private id = "";
  private closed = false;
  private ready = false;
  private markingReady = false;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private heartbeatPending = false;
  private startedAt = Date.now();
  private stage = 'open';
  private offerSent = false;
  private iceStartedAt?: number;
  private iceFinishedAt?: number;
  private iceErrorCodes = new Set<number>();
  private statsTimer?: ReturnType<typeof setInterval>;
  private reportingStats = false;
  private upstreamSessionId?: string;
  private firstFrameTimer?: ReturnType<typeof setTimeout>;
  private frameCallback?: number;
  private voiceController?: AbortController;
  private voiceId = "";
  private feeding = false;
  private sawFrame = false;
  private expiresAt?: number;
  private sessionKey: string;
  private video: HTMLVideoElement;
  private update: (state: VideoState) => void;
  constructor(sessionKey: string, video: HTMLVideoElement, update: (state: VideoState) => void) {
    this.sessionKey = sessionKey; this.video = video; this.update = update;
  }

  private state(phase: VideoPhase, message: string) {
    if (!this.closed) this.update({ phase, message, feeding: this.feeding, expiresAt: this.expiresAt, sessionId: this.upstreamSessionId });
  }
  private async api(action: string, body: Record<string, unknown> = {}) {
    return request(action, this.sessionKey, { videoId: this.id, ...body },
      AbortSignal.any([this.controller.signal, AbortSignal.timeout(action === "open" ? 80000 : 20000)]));
  }
  private diagnostics(stage: string, reason = 'none') {
    return { stage, reason, elapsedMs: Math.max(0, Date.now() - this.startedAt),
      candidates: iceCandidateCounts(this.pc?.localDescription?.sdp),
      gathering: this.pc?.iceGatheringState ?? 'new', connection: this.pc?.connectionState ?? 'new', offerSent: this.offerSent,
      iceElapsedMs: this.iceStartedAt === undefined ? 0 : Math.max(0, (this.iceFinishedAt ?? Date.now()) - this.iceStartedAt),
      iceErrorCodes: [...this.iceErrorCodes] };
  }
  private trace(stage: string, reason = 'none') {
    if (!this.id || this.closed) return;
    void request('diagnostics', this.sessionKey, { videoId: this.id, diagnostics: this.diagnostics(stage, reason) },
      AbortSignal.timeout(5000)).catch(() => {});
  }
  private scheduleHeartbeat() {
    if (!this.closed) this.heartbeat = setTimeout(() => { void this.sendHeartbeat(); }, 15000);
  }
  private async sendHeartbeat() {
    if (this.closed || this.heartbeatPending) return;
    this.heartbeatPending = true;
    try { await this.api('heartbeat'); }
    catch {
      if (!this.closed && !this.controller.signal.aborted) this.fail('Video heartbeat failed. Reconnect to continue; text chat is still available.', 'heartbeat_failed');
    } finally {
      this.heartbeatPending = false;
      this.scheduleHeartbeat();
    }
  }
  async connect() {
    try {
      this.state("checking", "Checking video availability…");
      const capabilities = await this.api("capabilities");
      if (!capabilities.enabled) { this.state("preview", "Static preview · waiting for video credentials"); return; }
      if (!globalThis.RTCPeerConnection || !globalThis.RTCRtpReceiver) throw new Error("This browser cannot receive the video stream. Text chat is still open.");
      const codecs = videoCodecs(RTCRtpReceiver.getCapabilities("video")?.codecs || []);
      if (!codecs.length) throw new Error("This browser does not support the required H.264 profile. Text chat is still open.");
      this.state("connecting", "Preparing Yihao’s video channel · this can take a minute");
      const opened = await this.api("open");
      this.id = opened.videoId;
      this.upstreamSessionId = opened.sessionId;
      if (Number.isFinite(opened.expiresAt) && Number.isFinite(opened.serverNow)) this.expiresAt = Date.now() + Math.max(0, opened.expiresAt - opened.serverNow);
      if (this.closed) { void request("close", this.sessionKey, { videoId: this.id }).catch(() => {}); return; }
      this.scheduleHeartbeat();
      const pc = this.pc = new RTCPeerConnection({ iceServers: opened.iceServers, bundlePolicy: "max-bundle", iceTransportPolicy: "all" });
      pc.onicecandidateerror = event => {
        if (this.iceErrorCodes.size < 8 && Number.isInteger(event.errorCode)) this.iceErrorCodes.add(event.errorCode);
      };
      this.statsTimer = setInterval(() => { void this.reportStats(); }, 3000);
      const stream = new MediaStream(); this.video.srcObject = stream;
      pc.addTransceiver("video", { direction: "recvonly" }).setCodecPreferences(codecs);
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = event => {
        stream.addTrack(event.track);
        void this.play();
      };
      pc.onconnectionstatechange = () => {
        this.trace('connection');
        if (pc.connectionState === "failed" || pc.connectionState === "closed") this.fail("Video connection lost. Text chat is still open.", 'connection_failed');
        if (pc.connectionState === "connected") void this.markReady();
      };
      if (this.video.requestVideoFrameCallback) {
        this.frameCallback = this.video.requestVideoFrameCallback(() => { this.sawFrame = true; void this.markReady(); });
      } else this.video.addEventListener("loadeddata", this.onFrame, { once: true });
      this.stage = 'ice';
      this.state('connecting', 'Preparing network connection (ICE)…');
      this.iceStartedAt = Date.now();
      await pc.setLocalDescription(await pc.createOffer());
      this.trace('ice_started');
      await waitForIceGathering(pc, this.controller.signal);
      this.iceFinishedAt = Date.now();
      this.trace('ice_complete');
      if (this.closed) return;
      this.stage = 'offer'; this.offerSent = true;
      this.trace('offer_sent');
      this.state('connecting', 'Network ready · connecting video…');
      const answer = await this.api("offer", { sdp: pc.localDescription?.sdp });
      this.stage = 'answer';
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      this.trace('answer_applied');
      this.firstFrameTimer = setTimeout(() => {
        if (!this.sawFrame) { this.trace('first_frame_timeout'); this.state("blocked", "No video frame yet · tap Play video or reconnect"); }
      }, 20000);
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Video connection timed out. Text chat is still open.",
        this.stage === 'ice' && error instanceof Error && error.message.startsWith('ICE gathering timed out') ? 'ice_timeout' : `${this.stage}_failed`);
    }
  }
  private onFrame = () => { this.sawFrame = true; void this.markReady(); };
  private async reportStats() {
    if (this.closed || this.reportingStats || this.pc?.connectionState !== 'connected') return;
    this.reportingStats = true;
    try {
      const stats = playbackStats(await this.pc.getStats());
      if (!this.closed && stats) await this.api('stats', { stats });
    } catch { /* Optional telemetry must never interrupt video or chat. */ }
    finally { this.reportingStats = false; }
  }
  private async markReady() {
    if (this.closed || this.ready || this.markingReady || !this.sawFrame || this.pc?.connectionState !== "connected") return;
    this.markingReady = true;
    try { await this.api("ready"); if (this.closed) return; this.ready = true; this.trace('ready'); clearTimeout(this.firstFrameTimer); this.state("connected", "Live avatar · AI-generated video and voice"); }
    catch { this.fail("Video could not become ready. Text chat is still open."); }
  }
  async play() {
    try { await this.video.play(); if (this.ready) this.state("connected", "Live avatar · AI-generated video and voice"); }
    catch { this.state("blocked", "Tap Play video to enable video and sound"); }
  }
  async startReply(ticket?: string): Promise<string | undefined> {
    if (!this.ready || this.closed || this.feeding) return undefined;
    const id = crypto.randomUUID(), controller = this.voiceController = new AbortController();
    this.voiceId = id; this.feeding = true;
    const openingTimeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/agent/voice/stream", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sessionKey: this.sessionKey, videoId: this.id, ...(ticket ? { ticket } : {}) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(330000)]) });
      if (!response.ok || !response.body) throw new Error("voice");
      this.state("connected", "Voice channel ready · waiting for Yihao’s words");
      void this.readVoice(response.body, controller);
      return id;
    } catch { if (!this.closed) this.fail("Video audio unavailable. This reply will continue as text."); return undefined; }
    finally { clearTimeout(openingTimeout); }
  }
  private async readVoice(body: ReadableStream<Uint8Array>, controller: AbortController) {
    const reader = body.getReader(), decoder = new TextDecoder(); let pending = "", completed = false;
    try {
      while (!controller.signal.aborted) {
        const chunk = await reader.read(); if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        if (pending.length > 65536) throw new Error("oversize");
        let end;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          if (/^event: error$/m.test(frame)) throw new Error("voice");
          if (/^event: done$/m.test(frame)) completed = true;
        }
      }
      if (!completed && !this.closed) throw new Error("interrupted");
      this.feeding = false; this.voiceId = "";
      this.state("connected", "Live avatar · AI-generated video and voice");
    } catch { if (!this.closed) this.fail("Video audio interrupted. Your text conversation is preserved."); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private fail(message: string, reason = 'media_failed') { if (this.closed) return; this.state("error", message); this.close(reason); }
  close(reason = 'client_closed') {
    if (this.closed) return;
    const diagnostics = this.diagnostics('closed', reason);
    this.closed = true; this.ready = false; this.controller.abort(); this.voiceController?.abort();
    clearTimeout(this.heartbeat); clearInterval(this.statsTimer); clearTimeout(this.firstFrameTimer);
    this.video.removeEventListener("loadeddata", this.onFrame);
    if (this.frameCallback !== undefined) this.video.cancelVideoFrameCallback(this.frameCallback);
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.onicecandidateerror = null; this.pc.ontrack = null; this.pc.close(); }
    this.video.pause(); this.video.srcObject = null;
    if (this.voiceId) void fetch("/api/agent/voice/cancel", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: this.voiceId, sessionKey: this.sessionKey }), keepalive: true }).catch(() => {});
    if (this.id) void request("close", this.sessionKey, { videoId: this.id, diagnostics }).catch(() => {});
  }
}
