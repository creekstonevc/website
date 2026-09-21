/* BytePlus PCM16 is mono / 24 kHz. Resample to the browser's actual rate.
 * A bounded ring avoids retaining an entire answer as separate Audio nodes. */
class CreekstonePcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(24000 * 120);
    this.written = 0; this.position = 0; this.started = false; this.ended = false;
    this.finished = false; this.announced = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === "stop") { this.finished = true; return; }
      if (data.type === "end") { this.ended = true; return; }
      if (data.type !== "audio" || this.finished) return;
      const samples = data.samples;
      if (this.written - this.position + samples.length >= this.ring.length) {
        this.finished = true; this.port.postMessage({ type: "error" }); return;
      }
      for (const sample of samples) this.ring[this.written++ % this.ring.length] = sample;
    };
  }
  process(_inputs, outputs) {
    const channel = outputs[0][0];
    if (this.finished) return false;
    if (!this.started && (this.written - this.position >= 2880 || this.ended)) this.started = true;
    for (let i = 0; i < channel.length; i++) {
      if (!this.started || this.position >= this.written - (this.ended ? 0 : 1)) {
        channel[i] = 0;
        if (this.ended && this.position >= this.written) {
          this.finished = true; this.port.postMessage({ type: "ended" }); break;
        }
        this.started = false;
        continue;
      }
      if (!this.announced) { this.announced = true; this.port.postMessage({ type: "playing" }); }
      const index = Math.floor(this.position), fraction = this.position - index;
      const left = this.ring[index % this.ring.length];
      const right = this.ring[Math.min(index + 1, this.written - 1) % this.ring.length];
      channel[i] = left + (right - left) * fraction;
      this.position += 24000 / sampleRate;
    }
    return !this.finished;
  }
}
registerProcessor("creekstone-pcm", CreekstonePcmPlayer);
