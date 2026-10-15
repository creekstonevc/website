import { BytePlusLiveVoice, SpeechSegments } from "./live-voice.mjs";

const PCM_BYTES_PER_MS = 48; // PCM s16le, mono, 24 kHz.
const OUTPUT_CHUNK_BYTES = 16384;
const TTS_ERRORS = new Set(["voice_unavailable", "voice_timeout", "voice_limit", "voice_protocol_error", "voice_interrupted", "voice_backpressure"]);

// Video consumes PCM in real time. Keep future speech as text, not minutes of
// pre-generated audio, and use a fresh bounded TTS session for each short batch.
export class PacedVideoTts {
  pendingText = ""; pcm = []; bufferedBytes = 0; totalBytes = 0; emittedBytes = 0;
  inputCharacters = 0; closed = false; ending = false; active = null; timer = null;
  constructor(config, emit, {
    makeTts = send => new BytePlusLiveVoice(config, send), bufferedMs,
    lowWaterMs = 5000, highWaterMs = 12000, maxBatchCharacters = 160, pollMs = 50,
    maxBufferedBytes = 4 * 1024 * 1024, maxTotalBytes = 24 * 1024 * 1024,
    setTimer = setTimeout, clearTimer = clearTimeout,
  } = {}) {
    if (typeof bufferedMs !== "function" || !Number.isFinite(lowWaterMs) || lowWaterMs < 0 ||
        !Number.isFinite(highWaterMs) || highWaterMs <= lowWaterMs ||
        !Number.isInteger(maxBatchCharacters) || maxBatchCharacters < 2 || maxBatchCharacters > 512 ||
        !Number.isInteger(pollMs) || pollMs < 1 ||
        !Number.isInteger(maxBufferedBytes) || maxBufferedBytes < 2 ||
        !Number.isInteger(maxTotalBytes) || maxTotalBytes < 2) throw new TypeError("Invalid video TTS scheduling options");
    this.emit = emit; this.makeTts = makeTts; this.bufferedMs = bufferedMs;
    this.lowWaterMs = lowWaterMs; this.highWaterMs = highWaterMs;
    this.maxBatchCharacters = maxBatchCharacters; this.pollMs = pollMs;
    this.maxBufferedBytes = maxBufferedBytes; this.maxTotalBytes = maxTotalBytes;
    this.setTimer = setTimer; this.clearTimer = clearTimer;
    const textLimit = Number.isSafeInteger(config.maxTtsCharacters) && config.maxTtsCharacters > 0
      ? Math.min(config.maxTtsCharacters, 131072) : 8000;
    this.segments = new SpeechSegments(text => {
      if (this.closed) return;
      this.pendingText += text; this.schedule();
    }, textLimit);
  }
  push(text) {
    if (this.closed || this.ending) return;
    if (typeof text !== "string") { this.fail("voice_protocol_error"); return; }
    // Bound raw markup as well as the sanitized text retained by SpeechSegments.
    if ((this.inputCharacters += text.length) > 131072) { this.fail("voice_limit"); return; }
    this.segments.push(text);
  }
  finish() {
    if (this.closed || this.ending) return;
    this.segments.push("", true); this.ending = true; this.schedule();
  }
  schedule() {
    if (this.closed || this.timer !== null) return;
    this.timer = this.setTimer(() => { this.timer = null; this.pump(); }, this.pollMs);
    this.timer?.unref?.();
  }
  queuedMs() {
    const value = this.bufferedMs();
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid audio queue measurement");
    return value;
  }
  takeBatch() {
    let end = Math.min(this.pendingText.length, this.maxBatchCharacters);
    if (end < this.pendingText.length) {
      const head = this.pendingText.slice(0, end);
      const boundaries = Array.from(head.matchAll(/[。！？!?；;\n，,、\s]/g), match => match.index + 1);
      const boundary = boundaries.at(-1) || 0;
      if (boundary >= Math.ceil(this.maxBatchCharacters / 2)) end = boundary;
      if (/[\uD800-\uDBFF]/.test(this.pendingText[end - 1])) end--;
    }
    const text = this.pendingText.slice(0, end);
    this.pendingText = this.pendingText.slice(end);
    return text;
  }
  pump() {
    if (this.closed) return;
    try {
      // Never deliver a provider-sized burst straight into the 40 ms adapter.
      // Account for synchronous downstream queue growth after every emission.
      let budget = Math.max(0, Math.floor((this.highWaterMs - this.queuedMs()) * PCM_BYTES_PER_MS / 2) * 2);
      while (!this.closed && this.pcm.length && budget >= 2) {
        const available = Math.max(0, Math.floor((this.highWaterMs - this.queuedMs()) * PCM_BYTES_PER_MS / 2) * 2);
        const chunk = this.pcm[0];
        const count = Math.min(chunk.length, OUTPUT_CHUNK_BYTES, budget, available);
        if (count < 2) break;
        const bytes = chunk.subarray(0, count);
        if (count === chunk.length) this.pcm.shift(); else this.pcm[0] = chunk.subarray(count);
        this.bufferedBytes -= count; this.emittedBytes += count; budget -= count;
        this.emit("audio", { data: bytes.toString("base64") });
      }
      if (this.closed) return;
      if (this.pcm.length) { this.schedule(); return; }
      if (this.active?.done) this.active = null;
      if (this.active) return; // Provider callbacks resume delivery; no idle poll.
      if (this.pendingText) {
        if (this.queuedMs() <= this.lowWaterMs) this.startBatch(this.takeBatch());
        else this.schedule();
      } else if (this.ending) {
        this.closed = true;
        this.emit("done", {}); // PCM was handed off, not necessarily played yet.
      }
    } catch { this.fail("voice_unavailable"); }
  }
  startBatch(text) {
    const batch = { voice: null, done: false };
    this.active = batch;
    try {
      batch.voice = this.makeTts((event, data) => {
        if (this.closed || this.active !== batch || batch.done) return;
        if (event === "audio") {
          if (typeof data?.data !== "string") { this.fail("voice_protocol_error"); return; }
          // Validate and bound before decoding to avoid retaining a giant frame.
          if (data.data.length > Math.ceil(this.maxBufferedBytes / 3) * 4) { this.fail("voice_limit"); return; }
          const padding = data.data.indexOf("=");
          if (data.data.length % 4 || /[^A-Za-z0-9+/=]/.test(data.data) ||
              padding >= 0 && (padding < data.data.length - 2 || !/^={1,2}$/.test(data.data.slice(padding)))) {
            this.fail("voice_protocol_error"); return;
          }
          const bytes = Buffer.from(data.data, "base64");
          if (bytes.length % 2) { this.fail("voice_protocol_error"); return; }
          if (this.totalBytes + bytes.length > this.maxTotalBytes || this.bufferedBytes + bytes.length > this.maxBufferedBytes) {
            this.fail("voice_limit"); return;
          }
          if (bytes.length) {
            this.totalBytes += bytes.length; this.bufferedBytes += bytes.length; this.pcm.push(bytes);
            this.schedule();
          }
        } else if (event === "done") { batch.done = true; this.schedule(); }
        else if (event === "error") this.fail(TTS_ERRORS.has(data?.code) ? data.code : "voice_unavailable");
        else if (event === "status" && this.emittedBytes === 0) this.emit(event, data);
      });
      if (this.closed || batch.done) { batch.voice?.cancel(); return; }
      batch.voice.push(text);
      if (!this.closed && !batch.done) batch.voice.finish();
    } catch { this.fail("voice_unavailable"); }
  }
  fail(code) {
    if (this.closed) return;
    this.cancel(); this.emit("error", { code });
  }
  cancel() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null; this.pendingText = ""; this.pcm = []; this.bufferedBytes = 0;
    this.segments.pending = ""; this.segments.text = "";
    const active = this.active; this.active = null;
    try { active?.voice?.cancel(); } catch { /* Teardown must not interrupt chat. */ }
  }
}
