// AudioWorklet: mono PCM16 at 16 kHz, emitted in 100 ms frames. Never stores audio.
class AsrCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Int16Array(1600); this.index = 0;
    this.sum = 0; this.count = 0; this.position = 0; this.running = true;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.running = false;
        if (this.index) this.port.postMessage(this.frame.slice(0, this.index).buffer);
        this.port.postMessage('stopped');
      }
    };
  }
  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample; this.count++; this.position += 16000;
      if (this.position >= sampleRate) {
        this.position -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.index === this.frame.length) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Int16Array(1600); this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('asr-capture', AsrCapture);
