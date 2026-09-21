import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import WebSocket from "ws";
import { GatewayError, prepareSpeechText } from "./core.mjs";

// BytePlus V3 binary protocol. Authenticated sockets never leave the gateway.
export function encodeVoiceFrame(event, payload = {}, sessionId = "") {
  const integer = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const body = Buffer.from(JSON.stringify(payload));
  const id = Buffer.from(sessionId);
  return Buffer.concat([Buffer.from([0x11, 0x14, 0x10, 0]), integer(event),
    ...(id.length ? [integer(id.length), id] : []), integer(body.length), body]);
}

export function decodeVoiceFrame(raw) {
  const b = Buffer.from(raw);
  if (b.length < 8 || b[0] >> 4 !== 1) throw new Error("Invalid voice frame");
  const type = b[1] >> 4, flags = b[1] & 15;
  let offset = (b[0] & 15) * 4;
  const integer = () => { if (offset + 4 > b.length) throw new Error("Truncated voice frame");
    const value = b.readUInt32BE(offset); offset += 4; return value; };
  const bytes = (length) => { if (offset + length > b.length) throw new Error("Truncated voice payload");
    const value = b.subarray(offset, offset + length); offset += length; return value; };
  if (type === 15) throw new Error(`Voice provider error ${integer()}`);
  if (flags & 1) integer(); // Optional sequence number.
  const event = flags & 4 ? integer() : 0;
  if (event >= 50) bytes(integer()); // connection_id or session_id
  let data = bytes(integer());
  if ((b[2] & 15) === 1) data = gunzipSync(data, { maxOutputLength: 2 * 1024 * 1024 });
  else if ((b[2] & 15) !== 0) throw new Error("Unsupported voice compression");
  return { event, audio: type === 11 ? data : null,
    payload: (b[2] >> 4) === 1 && data.length ? JSON.parse(data.toString()) : {} };
}

// Keep incomplete Markdown constructs across LLM deltas. Never read code,
// links, HTML, attachment markers or filesystem paths aloud.
export class SpeechSegments {
  pending = ""; text = ""; mode = ""; count = 0;
  constructor(emit, limit = 8000) { this.emit = emit; this.limit = limit; }
  push(delta, final = false) {
    this.pending += delta;
    while (this.pending.length) {
      if (this.mode) {
        const end = this.mode;
        if (!final && end.startsWith(this.pending) && this.pending.length < end.length) break;
        if (this.pending.startsWith(end)) { this.pending = this.pending.slice(end.length); this.mode = end === "]" ? "link-target" : ""; }
        else if (end === "link-target") {
          this.mode = this.pending[0] === "(" ? ")" : "";
          if (this.mode) this.pending = this.pending.slice(1);
        }
        else this.pending = this.pending.slice(1);
        continue;
      }
      const markers = ["```", "~~~", "{{attachment://", "`", "<", "["];
      if (!final && markers.some((s) => s.startsWith(this.pending) && s.length > this.pending.length)) break;
      const start = markers.find((s) => this.pending.startsWith(s));
      if (start) {
        this.flush();
        this.pending = this.pending.slice(start.length);
        this.mode = ({ "{{attachment://": "}}", "<": ">", "[": "]" })[start] || start;
        continue;
      }
      // Markdown link target follows the suppressed label; plain URLs/paths
      // remain buffered until whitespace, so punctuation cannot leak fragments.
      if (!final && this.pending === ".") break;
      const char = this.pending[0];
      this.pending = this.pending.slice(1);
      this.text += char;
      const path = /(?:https?:\/\/|attachment:\/\/|sandbox:\/|\/workspace\/|file:\/\/)[^\s]*$/.test(this.text);
      if (!path && (/[。！？!?；;\n]/.test(char) || char === "." && (!this.pending || /^\s/.test(this.pending)))) this.flush();
      else if (!path && this.text.length >= 80 && /[，,、\s]/.test(char)) this.flush();
      if (this.text.length > 16000) { this.text = ""; this.count = this.limit; }
    }
    if (final) this.flush();
  }
  flush() {
    const clean = prepareSpeechText(this.text.replace(/(?:https?:\/\/|attachment:\/\/|sandbox:\/|\/workspace\/|file:\/\/)[^\s]*/g, " "));
    this.text = "";
    const remaining = this.limit - this.count;
    if (clean && remaining > 0) { const value = clean.slice(0, remaining); this.count += value.length; this.emit(value); }
  }
}

export class BytePlusLiveVoice {
  queue = []; ready = false; ending = false; closed = false; totalBytes = 0;
  constructor(config, emit, { socketFactory = (url, options) => new WebSocket(url, options) } = {}) {
    this.config = config; this.emit = emit; this.id = randomUUID();
    this.segments = new SpeechSegments((text) => this.enqueue(text), config.maxTtsCharacters);
    this.socketFactory = socketFactory;
  }
  push(text) { if (!this.closed) this.segments.push(text); }
  enqueue(text) {
    this.queue.push(text);
    if (!this.socket) this.connect();
    this.drain();
  }
  connect() {
    this.emit("status", { phase: "connecting" });
    this.startedAt = Date.now();
    try { this.socket = this.socketFactory(this.config.bytePlusLiveUrl ||
      "wss://voice.ap-southeast-1.bytepluses.com/api/v3/tts/bidirection", {
      headers: { "X-Api-Key": this.config.bytePlusApiKey,
        "X-Api-Resource-Id": this.config.bytePlusResourceId, "X-Api-Connect-Id": randomUUID() },
      handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024,
    }); } catch { this.fail("voice_unavailable"); return; }
    this.timer = setTimeout(() => this.fail("voice_timeout"), 120000);
    this.timer.unref?.();
    this.socket.on("open", () => this.send(1));
    this.socket.on("message", (raw) => {
      if (this.closed) return;
      try {
        const frame = decodeVoiceFrame(raw);
        if ([51, 153].includes(frame.event)) return this.fail("voice_unavailable");
        if (frame.event === 50) this.send(100, { user: { uid: this.id }, namespace: "BidirectionalTTS",
          req_params: { speaker: this.config.bytePlusSpeakerId, audio_params: { format: "pcm", sample_rate: 24000 },
            additions: JSON.stringify({ disable_markdown_filter: true }) } }, this.id);
        if (frame.event === 150) { this.ready = true; this.drain(); }
        if (frame.audio?.length) {
          this.totalBytes += frame.audio.length;
          if (this.totalBytes > 24 * 1024 * 1024) return this.fail("voice_limit");
          if (!this.firstAudioAt) {
            this.firstAudioAt = Date.now();
            this.emit("status", { phase: "streaming", firstAudioMs: this.firstAudioAt - this.startedAt });
          }
          this.emit("audio", { data: frame.audio.toString("base64") });
        }
        if (frame.event === 152) { this.emit("done", {}); this.close(); }
      } catch { this.fail("voice_protocol_error"); }
    });
    this.socket.on("error", () => this.fail("voice_unavailable"));
    this.socket.on("close", () => { if (!this.closed) this.fail("voice_interrupted"); });
  }
  send(event, payload, id) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 256 * 1024) return this.fail("voice_backpressure");
    this.socket.send(encodeVoiceFrame(event, payload, id));
  }
  drain() {
    if (!this.ready || this.closed) return;
    for (const text of this.queue.splice(0)) this.send(200, { namespace: "BidirectionalTTS", req_params: { text } }, this.id);
    if (this.ending && !this.finishSent) { this.finishSent = true; this.send(102, {}, this.id); }
  }
  finish() {
    if (this.closed) return;
    this.segments.push("", true); this.ending = true;
    if (!this.socket) { this.emit("done", {}); this.close(); }
    else this.drain();
  }
  fail(code) { if (!this.closed) { this.emit("error", { code }); this.close(); } }
  cancel() { if (this.ready && !this.finishSent) this.send(101, {}, this.id); this.close(); }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.queue = [];
    if (this.socket?.readyState === WebSocket.OPEN) { this.socket.close();
      const socket = this.socket; const timer = setTimeout(() => socket.terminate(), 1000); timer.unref?.(); }
    else if (this.socket) this.socket.terminate();
  }
}

export function createLiveVoiceRegistry(config, makeVoice = (emit) => new BytePlusLiveVoice(config, emit)) {
  const sessions = new Map();
  const owners = new Map();
  const starts = new Map();
  return {
    open(id, owner, response) {
      if (!/^[a-f0-9-]{36}$/.test(id || "")) throw new GatewayError(400, "invalid_voice", "Invalid voice session");
      if (sessions.has(id)) throw new GatewayError(409, "voice_busy", "Voice session already exists");
      const now = Date.now();
      for (const [key, entry] of starts) if (now - entry.time > 60000) starts.delete(key);
      const rate = starts.get(owner) || { time: now, count: 0 };
      if (++rate.count > 12 || sessions.size >= 32 || starts.size >= 1024) throw new GatewayError(429, "voice_busy", "Voice channel is busy");
      starts.set(owner, rate);
      owners.get(owner)?.end();
      let voice;
      const entry = { owner, claimed: false, closed: false,
        end: () => {
          if (entry.closed) return; entry.closed = true;
          clearTimeout(entry.timer); clearInterval(entry.heartbeat); voice?.cancel();
          sessions.delete(id); if (owners.get(owner) === entry) owners.delete(owner);
          if (!response.destroyed) response.end();
        },
        emit: (event, data) => {
          if (entry.closed || response.destroyed) return;
          if (response.writableLength > 512 * 1024) { entry.end(); return; }
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (event === "error" || event === "done") entry.end();
        },
      };
      voice = makeVoice(entry.emit);
      entry.voice = voice;
      sessions.set(id, entry); owners.set(owner, entry);
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store",
        "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
      response.flushHeaders();
      entry.emit("ready", { sampleRate: 24000, format: "pcm_s16le", channels: 1 });
      entry.timer = setTimeout(() => { entry.emit("error", { code: "voice_timeout" }); }, 330000);
      entry.heartbeat = setInterval(() => { if (!response.destroyed) response.write(": heartbeat\n\n"); }, 15000);
      entry.timer.unref?.(); entry.heartbeat.unref?.();
      response.on("close", entry.end);
    },
    claim(id, owner) {
      const entry = sessions.get(id);
      if (!entry || entry.owner !== owner || entry.claimed) return null;
      entry.claimed = true;
      return { push: (text) => entry.voice.push(text), finish: () => entry.voice.finish(),
        cancel: () => { entry.emit("done", {}); entry.end(); } };
    },
    cancel(id, owner) { const entry = sessions.get(id); if (entry?.owner === owner) { entry.emit("done", {}); entry.end(); } },
    close() { for (const entry of sessions.values()) entry.end(); },
  };
}
