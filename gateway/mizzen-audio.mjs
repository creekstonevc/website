import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

export const MIZZEN_AUDIO_ERROR_CODES = Object.freeze([
  "invalid_json", "invalid_message", "stream_mismatch", "invalid_limits", "invalid_ack", "invalid_end", "provider_error",
  "socket_error", "socket_closed", "socket_not_open", "socket_backpressure", "socket_send_failed", "queue_overflow",
  "incomplete_sample", "ready_timeout", "end_timeout", "close_timeout", "ack_timeout", "sample_limit", "local_cancel",
]);

// Mizzen v1: 40 ms PCM packets, real-time pacing and an eight-packet ACK window.
// The adapter accepts unaligned provider chunks; only complete samples go out.
export class MizzenAudio {
  constructor(url, key, { socketFactory = (url, options) => new WebSocket(url, options), tickMs = 40, now = Date.now,
    monotonicNow = now === Date.now ? () => performance.now() : now, onProgress } = {}) {
    // Keep externally correlated log timestamps on the wall clock. Scheduling,
    // ACK ages and timeouts must not follow NTP/manual wall-clock adjustments.
    this.now = now; this.clock = monotonicNow; this.onProgress = onProgress; this.drainers = [];
    this.id = randomUUID(); this.queue = Buffer.alloc(0); this.inflight = new Map();
    this.seq = 0; this.samples = 0; this.ready = false; this.ending = false; this.ended = false;
    this.closed = false; this.lastActivity = monotonicNow(); this.lastSentAt = this.lastActivity;
    this.lastSent = now(); this.lastPacketMs = 0; this.tickMs = tickMs;
    this.pacingRebasedMs = 0; this.underrunMs = 0; this.maxSendGapMs = 0; this.maxLatenessMs = 0;
    this.ackCount = 0; this.ackTotalMs = 0; this.maxAckMs = 0;
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
    this.socket = socketFactory(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000, maxPayload: 16384 });
    this.socket.on("open", () => this.send({ type: "audio.start", protocol_version: 1, stream_id: this.id,
      format: "pcm_s16le", sample_rate: 24000, channels: 1 }));
    this.socket.on("message", (raw) => {
      if (this.closed) return;
      let data;
      try { data = JSON.parse(raw.toString()); }
      catch { this.fail("invalid_json"); return; }
      if (!data || typeof data !== "object" || Array.isArray(data)) { this.fail("invalid_message"); return; }
      if (data.stream_id !== this.id) { this.fail("stream_mismatch"); return; }
      if (data.type === "audio.ready" && !this.ready) {
        if (!Number.isInteger(data.max_chunk_samples) || data.max_chunk_samples < 1 ||
            !Number.isInteger(data.max_inflight_chunks) || data.max_inflight_chunks < 1) { this.fail("invalid_limits"); return; }
        this.packetBytes = Math.min(960, data.max_chunk_samples) * 2;
        this.window = Math.min(8, data.max_inflight_chunks); this.ready = true;
        // Smaller negotiated chunks need more frequent checks to keep up.
        const interval = Math.max(1, Math.min(10, this.packetBytes / 48 * (tickMs / 40) / 4));
        if (interval < Math.max(1, Math.min(tickMs / 4, 10))) {
          clearInterval(this.timer);
          this.timer = setInterval(() => this.pump(), interval); this.timer.unref?.();
        }
        this.report("ready");
      } else if (data.type === "audio.ack") {
        const expected = this.inflight.get(data.seq);
        if (!expected || data.received_samples !== expected.samples) { this.fail("invalid_ack"); return; }
        this.inflight.delete(data.seq); this.lastAckAt = this.clock();
        const ackMs = this.lastAckAt - expected.at;
        this.ackCount++; this.ackTotalMs += ackMs; this.maxAckMs = Math.max(this.maxAckMs, ackMs);
        for (const waiter of this.drainers) {
          if (waiter.onProgress && !waiter.acked && data.received_samples >= waiter.tailEnd) {
            waiter.acked = true;
            waiter.onProgress({ stage: "tail_acked", at: this.now(), samples: data.received_samples, seq: data.seq });
          }
        }
      } else if (data.type === "audio.input_ended") {
        if (!this.endSent || data.total_samples !== undefined && data.total_samples !== this.samples) { this.fail("invalid_end"); return; }
        this.ended = true; this.report("input_ended");
      } else if (data.type === "error") { this.fail("provider_error"); return; }
      this.lastActivity = this.clock();
    });
    this.socket.on("error", () => this.fail("socket_error"));
    this.socket.on("close", (code) => {
      if (this.closed) return;
      const socketCloseCode = Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : null;
      if (!this.ended) this.fail("socket_closed", { socketCloseCode });
      else { this.closed = true; clearInterval(this.timer); this.report("closed", { socketCloseCode }); this.resolve(); }
    });
    // Poll faster than the 20ms catch-up floor so jitter does not repeatedly
    // skip its narrow send windows. This is a wake-up cadence, not packet size.
    this.timer = setInterval(() => this.pump(), Math.max(1, Math.min(tickMs / 4, 10))); this.timer.unref?.();
  }
  report(stage, extra = {}) {
    this.onProgress?.({ stage, streamId: this.id, at: this.now(), samples: this.samples, ...extra });
  }
  reportPacing(now) {
    if (this.pacingStartedAt === undefined || now - this.lastPacingReportAt < 5000) return;
    this.lastPacingReportAt = now;
    // Numeric, cumulative counters only; these describe INPUT, not playback.
    this.report("pacing", {
      elapsedMs: now - this.pacingStartedAt, sentAudioMs: this.samples / 24,
      scheduleLagMs: this.nextSendAt === undefined ? 0 : Math.max(0, now - this.nextSendAt),
      pacingRebasedMs: this.pacingRebasedMs,
      underrunMs: this.underrunMs + (this.underrunAt === undefined ? 0 : now - this.underrunAt),
      maxSendGapMs: this.maxSendGapMs, maxLatenessMs: this.maxLatenessMs,
      queuedMs: this.queue.length / 48, inflightChunks: this.inflight.size,
      meanAckMs: this.ackCount ? this.ackTotalMs / this.ackCount : null, maxAckMs: this.ackCount ? this.maxAckMs : null,
    });
  }
  send(data) {
    if (this.closed) return false;
    if (this.socket.readyState !== WebSocket.OPEN) { this.fail("socket_not_open"); return false; }
    if (this.socket.bufferedAmount > 65536) { this.fail("socket_backpressure"); return false; }
    try {
      this.socket.send(JSON.stringify(data), error => { if (error) this.fail("socket_send_failed"); });
      return !this.closed;
    } catch { this.fail("socket_send_failed"); return false; }
  }
  push(bytes) {
    if (this.closed || this.ending) return;
    if (this.queue.length + bytes.length > 24000 * 2 * 120) { this.fail("queue_overflow", { incomingSamples: Math.floor(bytes.length / 2) }); return; }
    if (bytes.length && this.firstQueuedSample === undefined) this.firstQueuedSample = this.samples + this.queue.length / 2;
    this.queue = Buffer.concat([this.queue, bytes]);
  }
  finish() { this.ending = true; this.pump(); return this.done; }
  // Soft interruption: discard only PCM that has NOT left this process. ACKs
  // still account for every transmitted sample; never cancel the video session.
  interrupt() {
    if (this.closed || this.interrupting) return this.done;
    this.interrupting = true;
    const discardedSamples = Math.floor(this.queue.length / 2);
    this.queue = Buffer.alloc(0); this.ending = true;
    for (const waiter of this.drainers.splice(0)) waiter.resolve();
    // If interrupted before the first speech packet, end a valid silent input
    // instead of depending on undocumented zero-sample stream semantics.
    if (!this.samples && !this.endSent) this.queue = Buffer.alloc(1920);
    this.report("soft_interrupt", { discardedSamples });
    this.pump(); return this.done;
  }
  // Drain PCM first; finish() then ends this utterance's input WebSocket, not
  // the video session. The next utterance must use a new socket and stream_id.
  drain({ tailMs = 0, onProgress } = {}) {
    if (this.closed || this.ending) return Promise.reject(new Error("Video audio input closed"));
    if (this.queue.length % 2) { this.fail("incomplete_sample"); return this.done; }
    if (!Number.isInteger(tailMs) || tailMs < 0 || tailMs > 1000) return Promise.reject(new Error("Invalid audio tail"));
    const speechEnd = this.samples + this.queue.length / 2;
    const tailEnd = speechEnd + tailMs * 24;
    this.push(Buffer.alloc(tailMs * 48));
    if (this.closed) return this.done;
    onProgress?.({ stage: "tail_queued", at: this.now(), speechEnd, tailEnd, tailMs });
    const speechSent = this.samples >= speechEnd;
    if (speechSent) onProgress?.({ stage: "speech_tail_sent", at: this.lastSent, samples: this.samples, seq: this.seq - 1 });
    return new Promise((resolve, reject) => {
      this.drainers.push({ resolve, reject, speechEnd, tailEnd, onProgress, speechSent, tailSent: false });
      this.pump();
    });
  }
  pump() {
    if (this.closed) return;
    const now = this.clock();
    if (!this.ready && now - this.lastActivity > 10000) { this.fail("ready_timeout"); return; }
    if (this.endSent && now - this.endSentAt > 25000) { this.fail(this.ended ? "close_timeout" : "end_timeout"); return; }
    if ([...this.inflight.values()].some((item) => now - item.at > 10000)) { this.fail("ack_timeout"); return; }
    if (!this.ready || this.endSent) return;
    this.reportPacing(now);
    if (!this.queue.length && !this.inflight.size) {
      for (const waiter of this.drainers.splice(0)) waiter.resolve();
      // One 40ms zero-PCM packet every 15s, never inserted into queued speech.
      if (!this.ending && now - this.lastSentAt >= 15000) this.queue = Buffer.alloc(1920);
    }
    if (this.ending && this.queue.length % 2) { this.fail("incomplete_sample"); return; }
    if (this.queue.length >= this.packetBytes || (this.ending || this.drainers.length) && this.queue.length > 0) {
      if (this.inflight.size >= this.window) return;
      if (this.nextSendAt === undefined) {
        if (this.underrunAt !== undefined) { this.underrunMs += now - this.underrunAt; this.underrunAt = undefined; }
        this.pacingOriginAt = Math.max(now, this.lastSentAt + this.lastPacketMs);
        this.pacingOriginSample = this.samples; this.nextSendAt = this.pacingOriginAt;
      }
      if (now < this.nextSendAt || now < this.lastSentAt + this.lastPacketMs / 2) return;
      const lateness = now - this.nextSendAt;
      this.maxLatenessMs = Math.max(this.maxLatenessMs, lateness);
      // Recover ordinary timer jitter, but never bank seconds of catch-up after
      // a blocked event loop/ACK window. Retain at most one second of debt so
      // ordinary 100-200ms GC/OS pauses can recover instead of becoming drift;
      // one packet per pump, with a >=half-packet inter-send gap (<=2x rate).
      const maxDebtMs = 25 * this.tickMs;
      if (lateness > maxDebtMs) {
        const shift = lateness - maxDebtMs;
        this.pacingOriginAt += shift; this.pacingRebasedMs += shift;
      }
      const bytes = this.queue.subarray(0, Math.min(this.packetBytes, this.queue.length));
      const count = bytes.length / 2;
      if (this.samples + count > 7920000) { this.fail("sample_limit"); return; }
      if (!this.send({ type: "audio.chunk", stream_id: this.id, seq: this.seq, sample_offset: this.samples,
        sample_count: count, data: bytes.toString("base64") })) return;
      // The process can be preempted inside pump/send. A fresh timestamp after
      // the write enforces the next minimum gap against the actual send, not a
      // stale callback-entry timestamp. Initial/restarted audio anchors here.
      const sentAt = this.clock();
      if (this.samples === this.pacingOriginSample) this.pacingOriginAt = Math.max(this.pacingOriginAt, sentAt);
      this.maxLatenessMs = Math.max(this.maxLatenessMs, sentAt - this.nextSendAt);
      if (this.pacingStartedAt === undefined) { this.pacingStartedAt = sentAt; this.lastPacingReportAt = sentAt; }
      else this.maxSendGapMs = Math.max(this.maxSendGapMs, sentAt - this.lastSentAt);
      this.samples += count; this.inflight.set(this.seq++, { samples: this.samples, at: sentAt });
      if (!this.reportedFirstPcm && this.firstQueuedSample !== undefined && this.samples > this.firstQueuedSample) {
        this.reportedFirstPcm = true; this.report("first_pcm_sent");
      }
      for (const waiter of this.drainers) {
        for (const [flag, boundary, stage] of [["speechSent", waiter.speechEnd, "speech_tail_sent"], ["tailSent", waiter.tailEnd, "silence_tail_sent"]]) {
          if (waiter.onProgress && !waiter[flag] && this.samples >= boundary) {
            waiter[flag] = true;
            waiter.onProgress({ stage, at: this.now(), samples: this.samples, seq: this.seq - 1 });
          }
        }
      }
      this.queue = this.queue.subarray(bytes.length);
      // Absolute sample clock: a late callback must not shift every later one.
      this.nextSendAt = this.pacingOriginAt + (this.samples - this.pacingOriginSample) / 24 * (this.tickMs / 40);
      this.lastActivity = sentAt;
      this.lastPacketMs = count / 24 * (this.tickMs / 40);
      this.lastSentAt = sentAt; this.lastSent = this.now();
    } else if (this.ending && !this.inflight.size) {
      // Catch-up cannot shorten the final packet's duration before audio.end.
      if (now < this.lastSentAt + this.lastPacketMs) return;
      this.endSent = true; this.endSentAt = now; this.lastActivity = now;
      if (!this.send({ type: "audio.end", stream_id: this.id, total_samples: this.samples })) return;
      this.report("end_sent", { afterLastAckMs: this.lastAckAt == null ? null : now - this.lastAckAt });
    } else if (!this.ending && this.nextSendAt !== undefined && now >= Math.max(this.nextSendAt, this.lastSentAt + this.lastPacketMs)) {
      // A real TTS gap is not scheduling debt. Do not reset just because the
      // queue emptied after a send: PCM may still arrive before its deadline.
      this.underrunAt = Math.max(this.nextSendAt, this.lastSentAt + this.lastPacketMs);
      this.nextSendAt = undefined;
    }
  }
  fail(reason, extra = {}, stage = "interrupted") {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer);
    // Snapshot before discarding PCM. Never log raw WS errors/reasons, messages,
    // audio, URLs or credentials: only fixed reason codes and numeric counters.
    const at = this.clock();
    const phase = !this.ready ? "waiting_ready" : this.ended ? "waiting_close" : this.endSent ? "waiting_end"
      : this.ending && !this.queue.length ? "waiting_ack" : "streaming";
    this.report(stage, {
      reason, phase, queuedSamples: Math.floor(this.queue.length / 2), queuedMs: this.queue.length / 48,
      inflightChunks: this.inflight.size,
      oldestAckAgeMs: this.inflight.size ? Math.max(0, ...[...this.inflight.values()].map(item => at - item.at)) : null,
      socketBufferedBytes: Number.isFinite(this.socket.bufferedAmount) ? this.socket.bufferedAmount : null,
      socketState: this.socket.readyState, ...extra,
    });
    this.queue = Buffer.alloc(0);
    const error = Object.assign(new Error(`Video audio input ${stage}`), { code: reason });
    for (const waiter of this.drainers.splice(0)) waiter.reject(error);
    this.socket.terminate(); this.reject(error);
  }
  cancel() { this.fail("local_cancel", {}, "cancelled"); }
}
