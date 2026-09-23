export type AsrState = { phase: 'idle' | 'preparing' | 'recording' | 'finishing' | 'error'; message: string };

export class AsrCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private socket?: WebSocket;
  private closed = false;
  private held = true;
  private recorded = false;
  private completed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private finishTimer?: ReturnType<typeof setTimeout>;
  private update: (state: AsrState) => void;
  private transcript: (text: string, final: boolean) => void;
  constructor(update: (state: AsrState) => void, transcript: (text: string, final: boolean) => void) {
    this.update = update; this.transcript = transcript;
  }
  async start(sessionKey: string) {
    this.update({ phase: 'preparing', message: 'Preparing microphone… keep holding' });
    this.timer = setTimeout(() => this.fail('Microphone setup timed out. Release and try again.'), 15000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) throw new Error('unsupported');
      // Create/resume synchronously within the keyboard/pointer gesture (Safari).
      const context = this.context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed || !this.held) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      await context.audioWorklet.addModule('/asr-capture.js');
      if (this.closed || !this.held) return;
      const url = new URL('/api/agent/asr/stream', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('sessionKey', sessionKey);
      const socket = this.socket = new WebSocket(url);
      socket.onmessage = event => {
        if (this.closed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') { this.fail('Recognition unavailable. Retry or switch to Text.'); return; }
          if (data.type === 'ready' && this.held && !this.recorded) {
            clearTimeout(this.timer);
            this.recorded = true;
            const node = this.node = new AudioWorkletNode(context, 'asr-capture');
            node.port.onmessage = chunk => {
              if (this.closed) return;
              if (chunk.data === 'stopped') {
                this.stopMicrophone();
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'finish' }));
              } else if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 128000) socket.send(chunk.data);
              else this.fail('Connection is too slow. Please retry.');
            };
            context.createMediaStreamSource(stream).connect(node);
            const mute = context.createGain(); mute.gain.value = 0; node.connect(mute).connect(context.destination);
            this.update({ phase: 'recording', message: 'Listening · release to finish' });
            this.timer = setTimeout(() => this.finish(), 55000);
          } else if (data.type === 'partial' || data.type === 'final') {
            const text = typeof data.text === 'string' ? data.text.slice(0, 4000) : '';
            if (data.type === 'final') {
              this.completed = true; this.cancel();
              this.update({ phase: 'idle', message: text.trim() ? 'Hold Space to speak · release to send' : 'No speech detected. Hold Space to try again.' });
            }
            // Release the recording lock before the final result can submit a message.
            if (text || data.type === 'final') this.transcript(text, data.type === 'final');
          }
        } catch { this.fail('Recognition interrupted. Please retry.'); }
      };
      socket.onerror = () => this.fail('Recognition connection failed. Retry or switch to Text.');
      socket.onclose = () => { if (!this.closed && !this.completed) this.fail('Recognition disconnected. Your draft is preserved.'); };
    } catch (error) {
      if (!this.closed) this.fail(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access denied. Allow it in browser settings or use Text.' : 'Microphone unavailable. Check your device or use Text.');
    }
  }
  finish() {
    if (this.closed || !this.held) return;
    this.held = false; clearTimeout(this.timer);
    if (!this.recorded) { this.cancel(); this.update({ phase: 'idle', message: 'Hold Space until Listening appears.' }); return; }
    this.update({ phase: 'finishing', message: 'Finalizing your words…' });
    this.node?.port.postMessage('stop');
    this.finishTimer = setTimeout(() => this.fail('Recognition timed out. Your draft is preserved.'), 12000);
  }
  private stopMicrophone() {
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.node?.disconnect(); this.node = undefined;
    void this.context?.close().catch(() => {}); this.context = undefined;
  }
  cancel() {
    this.closed = true; this.held = false; clearTimeout(this.timer); clearTimeout(this.finishTimer);
    this.stopMicrophone();
    if (this.socket) { this.socket.onclose = null; this.socket.onerror = null; this.socket.onmessage = null; this.socket.close(); }
  }
  private fail(message: string) { if (this.closed) return; this.cancel(); this.update({ phase: 'error', message }); }
}
