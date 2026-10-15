import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export const MIZZEN_AUDIO_ERROR_CODES = Object.freeze([
  "invalid_json", "invalid_message", "stream_mismatch", "invalid_limits", "invalid_ack", "invalid_end", "provider_error",
  "socket_error", "socket_closed", "socket_not_open", "socket_backpressure", "socket_send_failed", "queue_overflow",
  "incomplete_sample", "ready_timeout", "end_timeout", "close_timeout", "ack_timeout", "sample_limit", "local_cancel",
]);

// Mizzen v1: 40 ms PCM packets, real-time pacing and an eight-packet ACK window.
// The adapter accepts unaligned provider chunks; only complete samples go out.
export class MizzenAudio {
  constructor(url, key, { socketFactory = (url, options) => new WebSocket(url, options), tickMs = 40, now = Date.now, onProgress } = {}) {
    this.now = now; this.onProgress = onProgress; this.drainers = [];
    this.id = randomUUID(); this.queue = Buffer.alloc(0); this.inflight = new Map();
    this.seq = 0; this.samples = 0; this.ready = false; this.ending = false; this.ended = false;
    this.closed = false; this.lastActivity = now(); this.lastSent = now(); this.tickMs = tickMs;
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
        this.report("ready");
      } else if (data.type === "audio.ack") {
        const expected = this.inflight.get(data.seq);
        if (!expected || data.received_samples !== expected.samples) { this.fail("invalid_ack"); return; }
        this.inflight.delete(data.seq); this.lastAckAt = this.now();
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
      this.lastActivity = this.now();
    });
    this.socket.on("error", () => this.fail("socket_error"));
    this.socket.on("close", (code) => {
      if (this.closed) return;
      const socketCloseCode = Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : null;
      if (!this.ended) this.fail("socket_closed", { socketCloseCode });
      else { this.closed = true; clearInterval(this.timer); this.report("closed", { socketCloseCode }); this.resolve(); }
    });
    this.timer = setInterval(() => this.pump(), Math.min(tickMs, 20)); this.timer.unref?.();
  }
  report(stage, extra = {}) {
    this.onProgress?.({ stage, streamId: this.id, at: this.now(), samples: this.samples, ...extra });
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
    const now = this.now();
    if (!this.ready && now - this.lastActivity > 10000) { this.fail("ready_timeout"); return; }
    if (this.endSent && now - this.endSentAt > 25000) { this.fail(this.ended ? "close_timeout" : "end_timeout"); return; }
    if ([...this.inflight.values()].some((item) => now - item.at > 10000)) { this.fail("ack_timeout"); return; }
    if (!this.ready || this.endSent) return;
    if (!this.queue.length && !this.inflight.size) {
      for (const waiter of this.drainers.splice(0)) waiter.resolve();
      // One 40ms zero-PCM packet every 15s, never inserted into queued speech.
      if (!this.ending && now - this.lastSent >= 15000) this.queue = Buffer.alloc(1920);
    }
    if (this.ending && this.queue.length % 2) { this.fail("incomplete_sample"); return; }
    if (this.inflight.size >= this.window || now < this.nextSendAt) return;
    if (this.queue.length >= this.packetBytes || (this.ending || this.drainers.length) && this.queue.length > 0) {
      const bytes = this.queue.subarray(0, Math.min(this.packetBytes, this.queue.length));
      const count = bytes.length / 2;
      if (this.samples + count > 7920000) { this.fail("sample_limit"); return; }
      if (!this.send({ type: "audio.chunk", stream_id: this.id, seq: this.seq, sample_offset: this.samples,
        sample_count: count, data: bytes.toString("base64") })) return;
      this.samples += count; this.inflight.set(this.seq++, { samples: this.samples, at: now });
      if (!this.reportedFirstPcm && this.firstQueuedSample !== undefined && this.samples > this.firstQueuedSample) {
        this.reportedFirstPcm = true; this.report("first_pcm_sent");
      }
      for (const waiter of this.drainers) {
        for (const [flag, boundary, stage] of [["speechSent", waiter.speechEnd, "speech_tail_sent"], ["tailSent", waiter.tailEnd, "silence_tail_sent"]]) {
          if (waiter.onProgress && !waiter[flag] && this.samples >= boundary) {
            waiter[flag] = true;
            waiter.onProgress({ stage, at: now, samples: this.samples, seq: this.seq - 1 });
          }
        }
      }
      this.queue = this.queue.subarray(bytes.length);
      this.nextSendAt = now + count / 24 * (this.tickMs / 40);
      this.lastActivity = now;
      this.lastSent = now;
    } else if (this.ending && !this.inflight.size) {
      this.endSent = true; this.endSentAt = now; this.lastActivity = now;
      if (!this.send({ type: "audio.end", stream_id: this.id, total_samples: this.samples })) return;
      this.report("end_sent", { afterLastAckMs: this.lastAckAt == null ? null : now - this.lastAckAt });
    }
  }
  fail(reason, extra = {}, stage = "interrupted") {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer);
    // Snapshot before discarding PCM. Never log raw WS errors/reasons, messages,
    // audio, URLs or credentials: only fixed reason codes and numeric counters.
    const at = this.now();
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
