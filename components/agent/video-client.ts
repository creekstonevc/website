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
    keepalive: action === "close",
  });
  if (!response.ok) throw new Error("Video connection unavailable. Text chat is still open.");
  return response.json();
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
  private heartbeat?: ReturnType<typeof setInterval>;
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
      this.heartbeat = setInterval(() => { void this.api("heartbeat").catch(() => this.fail("Video session ended. Reconnect to continue.")); }, 15000);
      const pc = this.pc = new RTCPeerConnection({ iceServers: opened.iceServers, bundlePolicy: "max-bundle", iceTransportPolicy: "all" });
      this.statsTimer = setInterval(() => { void this.reportStats(); }, 3000);
      const stream = new MediaStream(); this.video.srcObject = stream;
      pc.addTransceiver("video", { direction: "recvonly" }).setCodecPreferences(codecs);
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = event => {
        stream.addTrack(event.track);
        void this.play();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") this.fail("Video connection lost. Text chat is still open.");
        if (pc.connectionState === "connected") void this.markReady();
      };
      if (this.video.requestVideoFrameCallback) {
        this.frameCallback = this.video.requestVideoFrameCallback(() => { this.sawFrame = true; void this.markReady(); });
      } else this.video.addEventListener("loadeddata", this.onFrame, { once: true });
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); this.controller.signal.removeEventListener("abort", aborted); };
        const check = () => { if (pc.iceGatheringState === "complete") { done(); resolve(); } };
        const aborted = () => { done(); reject(new Error("Cancelled")); };
        const timer = setTimeout(() => { done(); reject(new Error("Could not establish media connectivity. Text chat is still open.")); }, 15000);
        pc.addEventListener("icegatheringstatechange", check);
        this.controller.signal.addEventListener("abort", aborted, { once: true }); check();
      });
      if (this.closed) return;
      const answer = await this.api("offer", { sdp: pc.localDescription?.sdp });
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      this.firstFrameTimer = setTimeout(() => {
        if (!this.sawFrame) this.state("blocked", "No video frame yet · tap Play video or reconnect");
      }, 20000);
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Video connection timed out. Text chat is still open.");
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
    try { await this.api("ready"); if (this.closed) return; this.ready = true; clearTimeout(this.firstFrameTimer); this.state("connected", "Live avatar · AI-generated video and voice"); }
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
  private fail(message: string) { this.state("error", message); this.close(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false; this.controller.abort(); this.voiceController?.abort();
    clearInterval(this.heartbeat); clearInterval(this.statsTimer); clearTimeout(this.firstFrameTimer);
    this.video.removeEventListener("loadeddata", this.onFrame);
    if (this.frameCallback !== undefined) this.video.cancelVideoFrameCallback(this.frameCallback);
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.ontrack = null; this.pc.close(); }
    this.video.pause(); this.video.srcObject = null;
    if (this.voiceId) void fetch("/api/agent/voice/cancel", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: this.voiceId, sessionKey: this.sessionKey }), keepalive: true }).catch(() => {});
    if (this.id) void request("close", this.sessionKey, { videoId: this.id }).catch(() => {});
  }
}
