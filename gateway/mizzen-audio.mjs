import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// Mizzen v1: 40 ms PCM packets, real-time pacing and an eight-packet ACK window.
// The adapter accepts unaligned provider chunks; only complete samples go out.
export class MizzenAudio {
  constructor(url, key, { socketFactory = (url, options) => new WebSocket(url, options), tickMs = 40 } = {}) {
    this.id = randomUUID(); this.queue = Buffer.alloc(0); this.inflight = new Map();
    this.seq = 0; this.samples = 0; this.ready = false; this.ending = false; this.ended = false;
    this.closed = false; this.lastActivity = Date.now(); this.lastSent = 0; this.tickMs = tickMs;
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
    this.socket = socketFactory(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000, maxPayload: 16384 });
    this.socket.on("open", () => this.send({ type: "audio.start", protocol_version: 1, stream_id: this.id,
      format: "pcm_s16le", sample_rate: 24000, channels: 1 }));
    this.socket.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.stream_id !== this.id) throw new Error("stream mismatch");
        if (data.type === "audio.ready" && !this.ready) {
          if (!Number.isInteger(data.max_chunk_samples) || data.max_chunk_samples < 1 ||
              !Number.isInteger(data.max_inflight_chunks) || data.max_inflight_chunks < 1) throw new Error("invalid limits");
          this.packetBytes = Math.min(960, data.max_chunk_samples) * 2;
          this.window = Math.min(8, data.max_inflight_chunks); this.ready = true;
        } else if (data.type === "audio.ack") {
          const expected = this.inflight.get(data.seq);
          if (!expected || data.received_samples !== expected.samples) throw new Error("invalid ack");
          this.inflight.delete(data.seq);
        } else if (data.type === "audio.input_ended") {
          if (!this.endSent || data.total_samples !== undefined && data.total_samples !== this.samples) throw new Error("invalid end");
          this.ended = true;
        } else if (data.type === "error") throw new Error("provider error");
        this.lastActivity = Date.now();
      } catch { this.fail(); }
    });
    this.socket.on("error", () => this.fail());
    this.socket.on("close", () => {
      if (this.closed) return;
      if (!this.ended) this.fail();
      else { this.closed = true; clearInterval(this.timer); this.resolve(); }
    });
    this.timer = setInterval(() => this.pump(), Math.min(tickMs, 20)); this.timer.unref?.();
  }
  send(data) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 65536) { this.fail(); return; }
    this.socket.send(JSON.stringify(data));
  }
  push(bytes) {
    if (this.closed || this.ending) return;
    if (this.queue.length + bytes.length > 24000 * 2 * 120) { this.fail(); return; }
    this.queue = Buffer.concat([this.queue, bytes]);
  }
  finish() { this.ending = true; return this.done; }
  pump() {
    if (this.closed) return;
    const now = Date.now();
    if ((!this.ready && now - this.lastActivity > 10000) || now - this.lastActivity > 25000 ||
      [...this.inflight.values()].some((item) => now - item.at > 10000)) { this.fail(); return; }
    if (!this.ready || this.endSent) return;
    if (this.ending && this.queue.length % 2) { this.fail(); return; }
    if (this.inflight.size >= this.window || now < this.nextSendAt) return;
    if (this.queue.length >= this.packetBytes || this.ending && this.queue.length > 0) {
      const bytes = this.queue.subarray(0, Math.min(this.packetBytes, this.queue.length));
      const count = bytes.length / 2;
      if (this.samples + count > 7920000) { this.fail(); return; }
      this.send({ type: "audio.chunk", stream_id: this.id, seq: this.seq, sample_offset: this.samples,
        sample_count: count, data: bytes.toString("base64") });
      this.samples += count; this.inflight.set(this.seq++, { samples: this.samples, at: now });
      this.queue = this.queue.subarray(bytes.length);
      this.nextSendAt = now + count / 24 * (this.tickMs / 40);
      this.lastActivity = now;
    } else if (this.ending && !this.inflight.size) {
      this.endSent = true; this.lastActivity = now;
      this.send({ type: "audio.end", stream_id: this.id, total_samples: this.samples });
    }
  }
  fail() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); this.queue = Buffer.alloc(0);
    this.socket.terminate(); this.reject(new Error("Video audio input interrupted"));
  }
  cancel() { this.fail(); }
}
