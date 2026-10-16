// General Instrument AY-3-8910 PSG.
// tick(n) advances n internal steps of 8 input clocks each; sample() returns the mean
// summed channel output (0..3) since the previous call.

const VOL = new Float32Array(16);
for (let i = 1; i < 16; i++) VOL[i] = Math.pow(10, -((15 - i) * 1.5) / 20);  // ~1.5 dB per step

export class AY8910 {
  constructor({ portARead, portBRead, portAWrite, portBWrite } = {}) {
    this.regs = new Uint8Array(16);
    this.addr = 0;
    this.portARead = portARead; this.portBRead = portBRead;
    this.portAWrite = portAWrite; this.portBWrite = portBWrite;
    this.cnt = new Int32Array(3);
    this.out = new Uint8Array(3);
    this.half = 0;
    this.noiseCnt = 0; this.rng = 1; this.noiseOut = 0;
    this.envCnt = 0; this.envStep = 15; this.envAttack = 0; this.envHold = 0; this.envAlt = 0;
    this.envHolding = 1; this.envVol = 0;
    this.acc = 0; this.accN = 0;
  }

  address(v) { this.addr = v & 0x0f; }

  write(v) {
    const r = this.addr;
    v &= 0xff;
    this.regs[r] = v;
    switch (r) {
      case 13: {
        this.envAttack = (v & 4) ? 0x0f : 0;
        if (!(v & 8)) { this.envHold = 1; this.envAlt = this.envAttack; }
        else { this.envHold = v & 1; this.envAlt = v & 2; }
        this.envStep = 15; this.envHolding = 0; this.envCnt = 0;
        this.envVol = this.envStep ^ this.envAttack;
        break;
      }
      case 14: if ((this.regs[7] & 0x40) && this.portAWrite) this.portAWrite(v); break;
      case 15: if ((this.regs[7] & 0x80) && this.portBWrite) this.portBWrite(v); break;
      case 7:
        if ((v & 0x40) && this.portAWrite) this.portAWrite(this.regs[14]);
        if ((v & 0x80) && this.portBWrite) this.portBWrite(this.regs[15]);
        break;
    }
  }

  read() {
    const r = this.addr;
    if (r === 14) return (!(this.regs[7] & 0x40) && this.portARead) ? this.portARead() : this.regs[14];
    if (r === 15) return (!(this.regs[7] & 0x80) && this.portBRead) ? this.portBRead() : this.regs[15];
    return this.regs[r];
  }

  tick(n) {
    const R = this.regs;
    const p0 = (R[0] | ((R[1] & 0x0f) << 8)) || 1;
    const p1 = (R[2] | ((R[3] & 0x0f) << 8)) || 1;
    const p2 = (R[4] | ((R[5] & 0x0f) << 8)) || 1;
    const np = (R[6] & 0x1f) || 1;
    const ep = (R[11] | (R[12] << 8)) || 1;
    const mix = R[7];
    const a0 = R[8], a1 = R[9], a2 = R[10];
    const cnt = this.cnt, out = this.out;
    let acc = 0;
    for (let s = 0; s < n; s++) {
      if (++cnt[0] >= p0) { cnt[0] = 0; out[0] ^= 1; }
      if (++cnt[1] >= p1) { cnt[1] = 0; out[1] ^= 1; }
      if (++cnt[2] >= p2) { cnt[2] = 0; out[2] ^= 1; }
      this.half ^= 1;
      if (this.half) {
        if (++this.noiseCnt >= np) {
          this.noiseCnt = 0;
          const bit = (this.rng ^ (this.rng >> 3)) & 1;
          this.rng = (this.rng >> 1) | (bit << 16);
          this.noiseOut = this.rng & 1;
        }
        if (++this.envCnt >= ep) {
          this.envCnt = 0;
          if (!this.envHolding) {
            this.envStep--;
            if (this.envStep < 0) {
              if (this.envHold) {
                if (this.envAlt) this.envAttack ^= 0x0f;
                this.envHolding = 1;
                this.envStep = 0;
              } else {
                if (this.envAlt) this.envAttack ^= 0x0f;
                this.envStep = 15;
              }
            }
            this.envVol = this.envStep ^ this.envAttack;
          }
        }
      }
      const nz = this.noiseOut;
      const ev = VOL[this.envVol];
      if ((out[0] | (mix & 1)) & (nz | ((mix >> 3) & 1))) acc += (a0 & 0x10) ? ev : VOL[a0 & 0x0f];
      if ((out[1] | ((mix >> 1) & 1)) & (nz | ((mix >> 4) & 1))) acc += (a1 & 0x10) ? ev : VOL[a1 & 0x0f];
      if ((out[2] | ((mix >> 2) & 1)) & (nz | ((mix >> 5) & 1))) acc += (a2 & 0x10) ? ev : VOL[a2 & 0x0f];
    }
    this.acc += acc;
    this.accN += n;
  }

  sample() {
    const v = this.accN ? this.acc / this.accN : 0;
    this.acc = 0; this.accN = 0;
    return v;
  }
}
