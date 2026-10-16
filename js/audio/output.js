// Web Audio output for emulator sample streams.

export class AudioOut {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.volume = 0.8;
    this.muted = false;
    this.sampleRate = 48000;
  }

  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch {
      this.ctx = new AudioContext();
    }
    this.sampleRate = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'emu-feeder', { outputChannelCount: [2] });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain).connect(this.ctx.destination);
    this.applyGain();
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  push(samples) {
    if (this.node && samples.length) this.node.port.postMessage(samples, [samples.buffer]);
  }

  setVolume(v) { this.volume = v; this.applyGain(); }
  setMuted(m) { this.muted = m; this.applyGain(); }
  applyGain() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume; }
}
