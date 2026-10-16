// Votrax SC-01(A) speech synthesizer.
// Phoneme parameters come from the chip's internal 512-byte ROM (sc01a.bin). The digital side
// (duration counter, parameter interpolation, pitch and noise generators) runs at the chip clock;
// the analog side is a chain of switched-capacitor formant filters modelled as IIR filters.
// Output is produced at the analog sample rate (clock / 18) and box-filtered to the host rate.

const GLOTTAL = [0, -4 / 7, 7 / 7, 6 / 7, 5 / 7, 4 / 7, 3 / 7, 2 / 7, 1 / 7];

const bit = (v, n) => Number((v >> BigInt(n)) & 1n);
const bits = (v, ...ns) => ns.reduce((r, n) => (r << 1) | bit(v, n), 0);
const capsOf = (value, caps) => caps.reduce((s, c, i) => s + ((value >> i) & 1 ? c : 0), 0);

export class Votrax {
  constructor(rom, hostRate, onRequest) {
    this.phones = [];
    const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    for (let i = 0; i < 64; i++) {
      const val = dv.getBigUint64(i * 8, true);
      const inv = ~val & 0xffffffffffffffffn;
      this.phones.push({
        id: Number((val >> 56n) & 0x3fn),
        f1: bits(val, 0, 7, 14, 21), va: bits(val, 1, 8, 15, 22), f2: bits(val, 2, 9, 16, 23),
        fc: bits(val, 3, 10, 17, 24), f2q: bits(val, 4, 11, 18, 25), f3: bits(val, 5, 12, 19, 26),
        fa: bits(val, 6, 13, 20, 27),
        cld: bits(val, 34, 32, 30, 28), vd: bits(val, 35, 33, 31, 29),
        closure: bit(val, 36), duration: bits(inv, 37, 38, 39, 40, 41, 42, 43),
      });
    }
    this.hostRate = hostRate;
    this.onRequest = onRequest;
    this.inflection = 0;
    this.phone = 0x3f;
    this.cur = { fa: 0, fc: 0, va: 0, f1: 0, f2: 0, f2q: 0, f3: 0 };
    this.filt = { fa: 0, fc: 0, va: 0, f1: -1, f2: -1, f2q: -1, f3: -1 };
    this.pitch = 0; this.closure = 0; this.curClosure = true;
    this.noise = 0; this.curNoise = false;
    this.updateCounter = 0; this.phonetick = 0; this.ticks = 0x10;
    this.sampleCount = 0;
    this.ar = true;
    const h = n => new Float64Array(n);
    this.h = { v1: h(4), v2: h(4), v3: h(4), n1: h(3), n2: h(3), vn1: h(4), vn2: h(4), vn3: h(4), vn4: h(4), vn5: h(2), vn6: h(2) };
    this.setClock(720000);
    this.commitPhone();
    this.ticks = 0x10;
    this.acc = 0; this.accN = 0; this.frac = 0;
  }

  setClock(hz) {
    if (hz === this.clock) return;
    this.clock = hz;
    this.sclock = hz / 18;
    this.cclock = hz / 36;
    this.filtersCommit(true);
  }

  // ---- bus interface ---------------------------------------------------------------------
  write(phone) {
    this.phone = phone & 0x3f;
    this.commitPhone();
    this.setAr(false);
  }
  setInflection(v) { this.inflection = v & 3; }
  setAr(s) { if (s !== this.ar) { this.ar = s; this.onRequest?.(s); } }

  commitPhone() {
    this.phonetick = 0;
    this.ticks = 0;
    const p = this.phones.find(x => x.id === this.phone) || this.phones[0];
    this.rom = p;
    this.pause = this.phone === 0x03 || this.phone === 0x3e;
    if (p.cld === 0) this.curClosure = !!p.closure;
  }

  // ---- digital side ------------------------------------------------------------------------
  interp(k, target) { this.cur[k] = (this.cur[k] - (this.cur[k] >> 3) + (target << 1)) & 0xff; }

  chipUpdate() {
    const rom = this.rom, filt = this.filt;
    if (this.ticks !== 0x10) {
      this.phonetick++;
      if (this.phonetick === ((rom.duration << 2) | 1)) {
        this.phonetick = 0;
        this.ticks++;
        if (this.ticks === rom.cld) this.curClosure = !!rom.closure;
        if (this.ticks === 0x10) this.setAr(true);
      }
    }
    this.updateCounter++;
    if (this.updateCounter === 0x30) this.updateCounter = 0;
    const tick625 = !(this.updateCounter & 0xf);
    const tick208 = this.updateCounter === 0x28;
    if (tick208 && (!this.pause || !(filt.fa || filt.va))) {
      this.interp('fc', rom.fc); this.interp('f1', rom.f1); this.interp('f2', rom.f2);
      this.interp('f2q', rom.f2q); this.interp('f3', rom.f3);
    }
    if (tick625) {
      if (this.ticks >= rom.vd) this.interp('fa', rom.fa);
      if (this.ticks >= rom.cld) this.interp('va', rom.va);
    }
    if (!this.curClosure && (filt.fa || filt.va)) this.closure = 0;
    else if (this.closure !== 7 << 2) this.closure++;

    this.pitch = (this.pitch + 1) & 0xff;
    if (this.pitch === ((0xe0 ^ (this.inflection << 5) ^ (filt.f1 << 1)) + 2)) this.pitch = 0;
    if ((this.pitch & 0xf9) === 0x08) this.filtersCommit(false);

    const inp = this.curNoise && this.noise !== 0x7fff;
    this.noise = ((this.noise << 1) & 0x7ffe) | (inp ? 1 : 0);
    this.curNoise = !(((this.noise >> 14) ^ (this.noise >> 13)) & 1);
  }

  // ---- analog side ----------------------------------------------------------------------------
  filtersCommit(force) {
    const c = this.cur, f = this.filt;
    f.fa = c.fa >> 4; f.fc = c.fc >> 4; f.va = c.va >> 4;
    if (force || f.f1 !== c.f1 >> 4) {
      f.f1 = c.f1 >> 4;
      [this.f1a, this.f1b] = this.standard(11247, 11797, 949, 52067, 2280 + capsOf(f.f1, [2546, 4973, 9861, 19724]), 166272);
    }
    if (force || f.f2 !== c.f2 >> 3 || f.f2q !== c.f2q >> 4) {
      f.f2 = c.f2 >> 3; f.f2q = c.f2q >> 4;
      [this.f2a, this.f2b] = this.standard(24840, 29154, 829 + capsOf(f.f2q, [1390, 2965, 5875, 11297]), 38180, 2352 + capsOf(f.f2, [833, 1663, 3164, 6327, 12654]), 34270);
    }
    if (force || f.f3 !== c.f3 >> 4) {
      f.f3 = c.f3 >> 4;
      [this.f3a, this.f3b] = this.standard(0, 17594, 868, 18828, 8480 + capsOf(f.f3, [2226, 4485, 9056, 18111]), 50019);
    }
    if (force) {
      [this.f4a, this.f4b] = this.standard(0, 28810, 1165, 21457, 8558, 7289);
      [this.fxa, this.fxb] = this.lowpass(1122, 23131);
      [this.fna, this.fnb] = this.noiseShaper(15500, 14854, 8450, 9523, 14083);
    }
  }

  // H(s) = (1 + k0 s) / (1 + k1 s + k2 s^2), bilinear transform pre-warped at the resonance
  standard(c1t, c1b, c2t, c2b, c3, c4) {
    const cc = this.cclock;
    const k0 = c1t / (cc * c1b);
    const k1 = c4 * c2t / (cc * c1b * c3);
    const k2 = c4 * c2b / (cc * cc * c1b * c3);
    const fpeak = Math.sqrt(Math.abs(k0 * k1 - k2)) / (2 * Math.PI * k2);
    const zc = 2 * Math.PI * fpeak / Math.tan(Math.PI * fpeak / this.sclock);
    const m0 = zc * k0, m1 = zc * k1, m2 = zc * zc * k2;
    return [[1 + m0, 3 + m0, 3 - m0, 1 - m0], [1 + m1 + m2, 3 + m1 - m2, 3 - m1 - m2, 1 - m1 + m2]];
  }

  lowpass(c1t, c1b) {
    const k = c1b / (this.cclock * c1t) * (150 / 4000);
    const fpeak = 1 / (2 * Math.PI * k);
    const zc = 2 * Math.PI * fpeak / Math.tan(Math.PI * fpeak / this.sclock);
    const m = zc * k;
    return [[1, 1], [1 + m, 1 - m]];
  }

  noiseShaper(c1, c2t, c2b, c3, c4) {
    const cc = this.cclock;
    const k0 = c2t * c3 * c2b / c4;
    const k1 = c2t * (cc * c2b);
    const k2 = c1 * c2t * c3 / (cc * c4);
    const fpeak = Math.sqrt(1 / k2) / (2 * Math.PI);
    const zc = 2 * Math.PI * fpeak / Math.tan(Math.PI * fpeak / this.sclock);
    const m0 = zc * k0, m1 = zc * k1, m2 = zc * zc * k2;
    return [[m0, 0, -m0], [1 + m1 + m2, 2 - 2 * m2, 1 - m1 + m2]];
  }

  static shift(v, hist) { for (let i = hist.length - 1; i > 0; i--) hist[i] = hist[i - 1]; hist[0] = v; }
  static apply(x, y, a, b) {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += x[i] * a[i];
    for (let i = 1; i < b.length; i++) t -= y[i - 1] * b[i];
    return t / b[0];
  }

  analog() {
    const h = this.h, f = this.filt, S = Votrax.shift, A = Votrax.apply;
    let v = this.pitch >= (9 << 3) ? 0 : GLOTTAL[this.pitch >> 3];
    v = v * f.va / 15;
    S(v, h.v1);
    v = A(h.v1, h.v2, this.f1a, this.f1b); S(v, h.v2);
    v = A(h.v2, h.v3, this.f2a, this.f2b); S(v, h.v3);

    let n = 1e4 * ((this.pitch & 0x40 ? this.curNoise : false) ? 1 : -1);
    n = n * f.fa / 15;
    S(n, h.n1);
    n = A(h.n1, h.n2, this.fna, this.fnb); S(n, h.n2);

    let vn = v;   // the f2 noise-injection path is numerically unstable on the die model; omitted
    S(vn, h.vn1);
    vn = A(h.vn1, h.vn2, this.f3a, this.f3b); S(vn, h.vn2);
    vn += n * (5 + (15 ^ f.fc)) / 20;
    S(vn, h.vn3);
    vn = A(h.vn3, h.vn4, this.f4a, this.f4b); S(vn, h.vn4);
    vn = vn * (7 ^ (this.closure >> 2)) / 7;
    S(vn, h.vn5);
    vn = A(h.vn5, h.vn6, this.fxa, this.fxb); S(vn, h.vn6);
    return vn * 0.35;
  }

  // Advance by one host sample period and return that sample (box-filtered analog output).
  // Called in lockstep with the sound CPU so the A/R request edge lands at the right time.
  sample() {
    this.frac += this.sclock / this.hostRate;
    let s = 0, k = 0;
    while (this.frac >= 1) {
      this.frac -= 1;
      this.sampleCount++;
      if (this.sampleCount & 1) this.chipUpdate();
      s += this.analog(); k++;
    }
    if (k) this.last = s / k;
    return this.last || 0;
  }
}
