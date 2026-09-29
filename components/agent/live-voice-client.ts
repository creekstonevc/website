export type LiveVoiceState = { phase: "idle" | "preparing" | "waiting" | "connecting" | "playing" | "paused" | "done" | "error"; messageIndex?: number; firstAudioMs?: number; error?: string };
export type SpeechWord = { text: string; startSample: number; endSample: number };
export type SpeechSegment = { text: string; startSample: number; endSample: number | null };
export type SpeechPlayback = { messageIndex: number | null; sample: number; words: SpeechWord[]; segments: SpeechSegment[]; active: boolean };

// Progress stays outside React's chat state: an audio tick must not re-render
// every message, Markdown tree, or video element.
export class SpeechPlaybackStore {
  private value: SpeechPlayback = { messageIndex: null, sample: 0, words: [], segments: [], active: false };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(value: SpeechPlayback) { this.value = value; this.listeners.forEach(listener => listener()); }
  clear() { this.set({ messageIndex: null, sample: 0, words: [], segments: [], active: false }); }
}

export class LiveVoicePlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private module: Promise<void> | null = null;
  private messageIndex: number | undefined;
  private paused = false;
  constructor(private update: (state: LiveVoiceState) => void, readonly playback = new SpeechPlaybackStore()) {}

  private report(state: LiveVoiceState) { this.update({ ...state, messageIndex: this.messageIndex }); }
  pause() { if (this.node) { this.paused = true; this.node.port.postMessage({ type: "pause" }); this.report({ phase: "paused" }); } }
  async resume() {
    if (!this.node) return;
    const generation = this.generation;
    try { await this.context?.resume(); if (generation !== this.generation) return;
      this.paused = false; this.node?.port.postMessage({ type: "resume" }); this.report({ phase: "playing" }); }
    catch { if (generation === this.generation) this.fail("Playback was blocked · tap to retry"); }
  }

  async enable() {
    if (!window.AudioContext) throw new Error("Streaming audio is not supported in this browser");
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    // Called from a click/submit gesture, before any network request.
    await this.context.resume();
    if (!this.context.audioWorklet) throw new Error("Streaming audio requires a secure browser context");
    this.module ??= this.context.audioWorklet.addModule("/audio/pcm-player.js");
    await this.module;
  }

  stop() {
    this.generation++;
    this.controller?.abort(); this.controller = null;
    if (this.node) { this.node.port.onmessage = null; this.node.port.postMessage({ type: "stop" }); this.node.disconnect(); this.node = null; }
    this.playback.clear(); this.messageIndex = undefined; this.paused = false;
    this.report({ phase: "idle" });
  }
  async dispose() { this.stop(); await this.context?.close(); this.context = null; }

  async start(sessionKey: string, options: { messageIndex?: number; ticket?: string } = {}): Promise<string | undefined> {
    this.stop();
    this.messageIndex = options.messageIndex;
    this.playback.set({ messageIndex: options.messageIndex ?? null, sample: 0, words: [], segments: [], active: true });
    const generation = this.generation;
    const current = () => generation === this.generation;
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    this.report({ phase: "preparing" });
    try {
      await this.enable();
      if (!current()) return;
      const node = new AudioWorkletNode(this.context!, "creekstone-pcm", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node = node;
      node.connect(this.context!.destination);
      const started = performance.now();
      let firstAudioMs: number | undefined;
      node.port.onmessage = ({ data }) => {
        if (!current()) return;
        if (data.type === "playing") { firstAudioMs = Math.round(performance.now() - started); this.report({ phase: this.paused ? "paused" : "playing", firstAudioMs }); }
        if (data.type === "progress" && Number.isFinite(data.sample) && data.sample >= 0) {
          this.playback.set({ ...this.playback.getSnapshot(), sample: data.sample });
        }
        if (data.type === "ended") { this.stop(); this.report({ phase: "done", firstAudioMs }); }
        if (data.type === "error") this.fail("Audio buffer is full · use Play voice to listen again");
      };
      const id = crypto.randomUUID();
      const controller = new AbortController();
      this.controller = controller;
      connectionTimer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch("/api/agent/voice/stream", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, sessionKey, ticket: options.ticket }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(340000)]) });
      clearTimeout(connectionTimer);
      if (!current()) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body) throw new Error(response.status === 410 ? "Voice access expired · reload this conversation to refresh" :
        response.status === 429 ? "Voice channel is busy · retry shortly" : "Voice channel is unavailable · text replies still work");
      this.report({ phase: "waiting" });
      void this.consume(response.body, generation);
      return id;
    } catch (error) {
      if (current()) this.fail(error instanceof Error && error.name !== "AbortError" ? error.message : "Voice connection timed out · text replies still work");
      return;
    } finally { clearTimeout(connectionTimer); }
  }

  private fail(error: string) { const messageIndex = this.messageIndex; this.stop(); this.update({ phase: "error", error, messageIndex }); }

  private async consume(body: ReadableStream<Uint8Array>, generation: number) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "", done = false, oddByte: number | null = null;
    try {
      while (generation === this.generation && !done) {
        const result = await reader.read();
        if (result.done) break;
        pending += decoder.decode(result.value, { stream: true });
        if (pending.length > 4 * 1024 * 1024) throw new Error("Voice stream exceeded the buffer limit");
        const frames = pending.split(/\r?\n\r?\n/); pending = frames.pop() || "";
        for (const frame of frames) {
          if (generation !== this.generation) return;
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const raw = frame.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const payload = JSON.parse(raw);
          if (event === "ready" && (payload.format !== "pcm_s16le" || payload.sampleRate !== 24000 || payload.channels !== 1)) throw new Error("Unsupported voice format");
          if (event === "status" && payload.phase === "connecting" && !this.paused) this.report({ phase: "connecting" });
          if (event === "subtitle" && Array.isArray(payload.words)) {
            const current = this.playback.getSnapshot();
            const words = payload.words.filter((word: SpeechWord) => typeof word?.text === "string" && word.text.length <= 512 &&
              Number.isFinite(word.startSample) && Number.isFinite(word.endSample) && word.startSample >= 0 && word.endSample > word.startSample && word.endSample <= 14400000);
            this.playback.set({ ...current, words: [...current.words, ...words].slice(0, 16000) });
          }
          if (event === "segment" && typeof payload.text === "string" && payload.text.length <= 160 &&
              Number.isSafeInteger(payload.startSample) && payload.startSample >= 0 && payload.startSample <= 12582912 &&
              (payload.endSample === null || Number.isSafeInteger(payload.endSample) &&
                payload.endSample > payload.startSample && payload.endSample <= 12582912)) {
            const current = this.playback.getSnapshot();
            const segments = current.segments.slice(), last = segments.at(-1);
            if (last && last.startSample === payload.startSample && last.text === payload.text) {
              if (payload.endSample !== null && (last.endSample === null || payload.endSample >= last.endSample)) segments[segments.length - 1] = payload;
            } else if ((!last || last.endSample !== null && payload.startSample >= last.endSample) && segments.length < 8000) segments.push(payload);
            this.playback.set({ ...current, segments });
          }
          if (event === "audio") {
            const binary: string = (oddByte === null ? "" : String.fromCharCode(oddByte)) + atob(payload.data);
            oddByte = binary.length % 2 ? binary.charCodeAt(binary.length - 1) : null;
            const samples = new Float32Array(Math.floor(binary.length / 2));
            for (let i = 0; i < samples.length; i++) {
              const value = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
              samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
            }
            this.node?.port.postMessage({ type: "audio", samples }, [samples.buffer]);
          }
          if (event === "done") { done = true; this.node?.port.postMessage({ type: "end" }); }
          if (event === "error") throw new Error("Live voice was interrupted · text replies still work; use Play voice to retry");
        }
      }
      if (!done && generation === this.generation) throw new Error("Voice connection lost · text replies still work");
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : "Voice unavailable");
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
