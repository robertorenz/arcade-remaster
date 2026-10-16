// Donkey Kong audio: 8035 DAC with decay envelope, plus synthesized approximations
// of the analog (discrete) walk / jump / stomp circuits.

export class DkDiscrete {
  constructor(cpuHz, sampleRate) {
    this.sampleRate = sampleRate;
    this.cyclesPerSample = cpuHz / sampleRate;
    this.acc = 0;
    this.sum = 0; this.sumN = 0;
    this.dacValue = 0x80;
    this.dischargeBit = 0;
    this.env = 0;
    this.envDecay = Math.exp(-1 / (sampleRate * 0.12));
    this.envAttack = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.buf = new Float32Array(sampleRate);  // up to 1s queued
    this.len = 0;
    this.hpPrev = 0; this.hpOut = 0;
    this.lp = 0;
    this.hpA = Math.exp(-2 * Math.PI * 30 / sampleRate);
    this.lpA = 1 - Math.exp(-2 * Math.PI * 5000 / sampleRate);
    this.voices = [];   // discrete effect voices
    this.bits = 0;
    this.noise = 1;
  }

  dac(v) { this.dacValue = v; }
  discharge(b) { this.dischargeBit = b; }

  trigger(bit, on) {
    const was = (this.bits >> bit) & 1;
    this.bits = (this.bits & ~(1 << bit)) | (on << bit);
    // walk / jump / stomp fire on the active edge (signals are active-high writes of 1)
    if (on && !was) this.voices.push({ type: bit, t: 0, phase: 0 });
  }

  voiceSample(v, dt) {
    const t = v.t;
    let s = 0, dur;
    switch (v.type) {
      case 0: { // walk: short low thump
        dur = 0.07;
        const f = 180 - 900 * t;
        v.phase += Math.max(40, f) * dt;
        s = (v.phase % 1 < 0.5 ? 0.6 : -0.6) * Math.exp(-t * 45);
        break;
      }
      case 1: { // jump: rising chirp
        dur = 0.32;
        const f = 260 + 1300 * t;
        v.phase += f * dt;
        s = Math.sin(2 * Math.PI * v.phase) * 0.45 * Math.min(1, t * 80) * Math.exp(-t * 6);
        break;
      }
      default: { // stomp: low rumble
        dur = 0.55;
        this.noise = (this.noise * 1103515245 + 12345) & 0x7fffffff;
        const n = (this.noise / 0x3fffffff) - 1;
        v.lp = (v.lp || 0) + (n - (v.lp || 0)) * 0.05;
        v.phase += (70 - 40 * t) * dt;
        s = (v.lp * 2.2 + Math.sin(2 * Math.PI * v.phase) * 0.7) * Math.exp(-t * 7);
        break;
      }
    }
    v.t += dt;
    if (v.t > dur) v.done = true;
    return s;
  }

  clock(cycles) {
    this.sum += this.dacValue * cycles;
    this.sumN += cycles;
    this.acc += cycles;
    while (this.acc >= this.cyclesPerSample) {
      this.acc -= this.cyclesPerSample;
      this.emit(this.sum / this.sumN);
      this.sum = 0; this.sumN = 0;
    }
  }

  emit(dacAvg) {
    // envelope: P2.7 high holds full level, low lets the reference decay
    if (this.dischargeBit) this.env += (1 - this.env) * this.envAttack;
    else this.env *= this.envDecay;
    let x = ((dacAvg - 128) / 128) * this.env;
    // DC blocking high-pass then gentle low-pass
    const hp = this.hpA * (this.hpOut + x - this.hpPrev);
    this.hpPrev = x; this.hpOut = hp;
    this.lp += (hp - this.lp) * this.lpA;
    let s = this.lp * 0.5;
    if (this.voices.length) {
      const dt = 1 / this.sampleRate;
      for (const v of this.voices) s += this.voiceSample(v, dt) * 0.35;
      this.voices = this.voices.filter(v => !v.done);
    }
    if (this.len < this.buf.length) this.buf[this.len++] = Math.max(-1, Math.min(1, s));
  }

  take() {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }
}
