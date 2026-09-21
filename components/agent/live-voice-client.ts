export type LiveVoiceState = { phase: "idle" | "preparing" | "waiting" | "connecting" | "playing" | "done" | "error"; firstAudioMs?: number; error?: string };

export class LiveVoicePlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private module: Promise<void> | null = null;
  constructor(private update: (state: LiveVoiceState) => void) {}

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
    this.update({ phase: "idle" });
  }
  async dispose() { this.stop(); await this.context?.close(); this.context = null; }

  async start(sessionKey: string): Promise<string | undefined> {
    this.stop();
    const generation = this.generation;
    const current = () => generation === this.generation;
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    this.update({ phase: "preparing" });
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
        if (data.type === "playing") { firstAudioMs = Math.round(performance.now() - started); this.update({ phase: "playing", firstAudioMs }); }
        if (data.type === "ended") { this.stop(); this.update({ phase: "done", firstAudioMs }); }
        if (data.type === "error") this.fail("Audio buffer is full · use Play voice to listen again");
      };
      const id = crypto.randomUUID();
      const controller = new AbortController();
      this.controller = controller;
      connectionTimer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch("/api/agent/voice/stream", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, sessionKey }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(340000)]) });
      clearTimeout(connectionTimer);
      if (!current()) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body) throw new Error("Voice channel is unavailable · text replies still work");
      this.update({ phase: "waiting" });
      void this.consume(response.body, generation);
      return id;
    } catch (error) {
      if (current()) this.fail(error instanceof Error && error.name !== "AbortError" ? error.message : "Voice connection timed out · text replies still work");
      return;
    } finally { clearTimeout(connectionTimer); }
  }

  private fail(error: string) { this.stop(); this.update({ phase: "error", error }); }

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
          if (event === "status" && payload.phase === "connecting") this.update({ phase: "connecting" });
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
