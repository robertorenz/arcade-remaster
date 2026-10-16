// Motorola 6809 / 6809E CPU core.
// bus: { read(a), write(a,v) }   step() returns cycles; `extraCycles` may be added by the bus (e.g. blitter stalls).

const C = 1, V = 2, Z = 4, N = 8, I = 16, H = 32, F = 64, E = 128;

const BASE = new Uint8Array([
  /*0*/ 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 6,
  /*1*/ 0, 0, 2, 4, 2, 2, 5, 9, 2, 2, 3, 2, 3, 2, 8, 6,
  /*2*/ 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  /*3*/ 4, 4, 4, 4, 5, 5, 5, 5, 2, 5, 3, 6, 20, 11, 2, 19,
  /*4*/ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /*5*/ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /*6*/ 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 6,
  /*7*/ 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 4, 7,
  /*8*/ 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 4, 7, 3, 2,
  /*9*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5,
  /*A*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5,
  /*B*/ 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 7, 8, 6, 6,
  /*C*/ 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 3, 2,
  /*D*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
  /*E*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
  /*F*/ 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6,
]);

export class M6809 {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.a = 0; this.b = 0; this.x = 0; this.y = 0; this.u = 0; this.s = 0; this.dp = 0;
    this.cc = I | F;
    this.irqLine = false; this.firqLine = false; this.nmiPending = false; this.nmiArmed = false;
    this.cwai = false; this.sync = false;
    this.extraCycles = 0;
    this.pc = this.rd16(0xfffe);
  }

  setIrq(s) { this.irqLine = !!s; }
  setFirq(s) { this.firqLine = !!s; }
  nmi() { this.nmiPending = true; }

  rd(a) { return this.bus.read(a & 0xffff); }
  wr(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  rd16(a) { return (this.rd(a) << 8) | this.rd(a + 1); }
  wr16(a, v) { this.wr(a, v >> 8); this.wr(a + 1, v); }
  fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const v = this.rd16(this.pc); this.pc = (this.pc + 2) & 0xffff; return v; }

  get d() { return (this.a << 8) | this.b; }
  set d(v) { this.a = (v >> 8) & 0xff; this.b = v & 0xff; }

  pushS(v) { this.s = (this.s - 1) & 0xffff; this.wr(this.s, v); }
  pullS() { const v = this.rd(this.s); this.s = (this.s + 1) & 0xffff; return v; }
  pushU(v) { this.u = (this.u - 1) & 0xffff; this.wr(this.u, v); }
  pullU() { const v = this.rd(this.u); this.u = (this.u + 1) & 0xffff; return v; }
  pushS16(v) { this.pushS(v & 0xff); this.pushS(v >> 8); }
  pullS16() { const hi = this.pullS(); return (hi << 8) | this.pullS(); }

  // ---- flags --------------------------------------------------------------
  nz8(v) { this.cc = (this.cc & ~(N | Z)) | (v & 0x80 ? N : 0) | ((v & 0xff) ? 0 : Z); }
  nz16(v) { this.cc = (this.cc & ~(N | Z)) | (v & 0x8000 ? N : 0) | ((v & 0xffff) ? 0 : Z); }
  ld8(v) { this.nz8(v); this.cc &= ~V; return v; }
  ld16(v) { this.nz16(v); this.cc &= ~V; return v; }

  add8(a, m, c) {
    const r = a + m + c;
    this.cc = (this.cc & ~(H | N | Z | V | C)) |
      (((a ^ m ^ r) & 0x10) ? H : 0) | (r & 0x80 ? N : 0) | ((r & 0xff) ? 0 : Z) |
      ((~(a ^ m) & (a ^ r) & 0x80) ? V : 0) | (r & 0x100 ? C : 0);
    return r & 0xff;
  }
  sub8(a, m, c) {
    const r = a - m - c;
    this.cc = (this.cc & ~(N | Z | V | C)) | (r & 0x80 ? N : 0) | ((r & 0xff) ? 0 : Z) |
      (((a ^ m) & (a ^ r) & 0x80) ? V : 0) | (r & 0x100 ? C : 0);
    return r & 0xff;
  }
  add16(a, m) {
    const r = a + m;
    this.cc = (this.cc & ~(N | Z | V | C)) | (r & 0x8000 ? N : 0) | ((r & 0xffff) ? 0 : Z) |
      ((~(a ^ m) & (a ^ r) & 0x8000) ? V : 0) | (r & 0x10000 ? C : 0);
    return r & 0xffff;
  }
  sub16(a, m) {
    const r = a - m;
    this.cc = (this.cc & ~(N | Z | V | C)) | (r & 0x8000 ? N : 0) | ((r & 0xffff) ? 0 : Z) |
      (((a ^ m) & (a ^ r) & 0x8000) ? V : 0) | (r & 0x10000 ? C : 0);
    return r & 0xffff;
  }

  // read-modify-write ops: 0 NEG 3 COM 4 LSR 6 ROR 7 ASR 8 ASL 9 ROL A DEC C INC D TST F CLR
  rmw(op, v) {
    let r, cc = this.cc;
    switch (op) {
      case 0x0: r = (-v) & 0xff; cc = (cc & ~(N | Z | V | C)) | (r & 0x80 ? N : 0) | (r ? C : Z) | (v === 0x80 ? V : 0); break;
      case 0x3: r = (~v) & 0xff; cc = (cc & ~(N | Z | V)) | C | (r & 0x80 ? N : 0) | (r ? 0 : Z); break;
      case 0x4: r = v >> 1; cc = (cc & ~(N | Z | C)) | (v & 1 ? C : 0) | (r ? 0 : Z); break;
      case 0x6: r = (v >> 1) | ((cc & C) << 7); cc = (cc & ~(N | Z | C)) | (v & 1 ? C : 0) | (r & 0x80 ? N : 0) | (r ? 0 : Z); break;
      case 0x7: r = (v >> 1) | (v & 0x80); cc = (cc & ~(N | Z | C)) | (v & 1 ? C : 0) | (r & 0x80 ? N : 0) | (r ? 0 : Z); break;
      case 0x8: r = (v << 1) & 0xff; cc = (cc & ~(N | Z | V | C)) | (v & 0x80 ? C : 0) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (((v ^ (v << 1)) & 0x80) ? V : 0); break;
      case 0x9: r = ((v << 1) | (cc & C)) & 0xff; cc = (cc & ~(N | Z | V | C)) | (v & 0x80 ? C : 0) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (((v ^ (v << 1)) & 0x80) ? V : 0); break;
      case 0xa: r = (v - 1) & 0xff; cc = (cc & ~(N | Z | V)) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (v === 0x80 ? V : 0); break;
      case 0xc: r = (v + 1) & 0xff; cc = (cc & ~(N | Z | V)) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (v === 0x7f ? V : 0); break;
      case 0xd: r = v; cc = (cc & ~(N | Z | V)) | (v & 0x80 ? N : 0) | (v ? 0 : Z); break;
      case 0xf: r = 0; cc = (cc & ~(N | V | C)) | Z; break;
      default: r = v;
    }
    this.cc = cc;
    return r;
  }

  cond(c) {
    const cc = this.cc;
    const n = !!(cc & N), v = !!(cc & V), z = !!(cc & Z), cy = !!(cc & C);
    switch (c) {
      case 0x0: return true; case 0x1: return false;
      case 0x2: return !(cy || z); case 0x3: return cy || z;
      case 0x4: return !cy; case 0x5: return cy;
      case 0x6: return !z; case 0x7: return z;
      case 0x8: return !v; case 0x9: return v;
      case 0xa: return !n; case 0xb: return n;
      case 0xc: return n === v; case 0xd: return n !== v;
      case 0xe: return !z && n === v; default: return z || n !== v;
    }
  }

  // ---- registers by index (TFR/EXG) ------------------------------------------
  getReg(r) {
    switch (r) {
      case 0: return this.d; case 1: return this.x; case 2: return this.y; case 3: return this.u;
      case 4: return this.s; case 5: return this.pc; case 8: return this.a; case 9: return this.b;
      case 10: return this.cc; case 11: return this.dp; default: return 0xff;
    }
  }
  setReg(r, v) {
    switch (r) {
      case 0: this.d = v & 0xffff; break; case 1: this.x = v & 0xffff; break; case 2: this.y = v & 0xffff; break;
      case 3: this.u = v & 0xffff; break; case 4: this.s = v & 0xffff; break; case 5: this.pc = v & 0xffff; break;
      case 8: this.a = v & 0xff; break; case 9: this.b = v & 0xff; break; case 10: this.cc = v & 0xff; break;
      case 11: this.dp = v & 0xff; break;
    }
  }

  // ---- addressing -----------------------------------------------------------------
  direct() { return (this.dp << 8) | this.fetch(); }

  idxReg(n) { return n === 0 ? this.x : n === 1 ? this.y : n === 2 ? this.u : this.s; }
  setIdxReg(n, v) { v &= 0xffff; if (n === 0) this.x = v; else if (n === 1) this.y = v; else if (n === 2) this.u = v; else this.s = v; }

  indexed() {
    const pb = this.fetch();
    const rn = (pb >> 5) & 3;
    let ea, cyc = 0;
    if (!(pb & 0x80)) {
      let off = pb & 0x1f; if (off & 0x10) off -= 32;
      this.idxCycles = 1;
      return (this.idxReg(rn) + off) & 0xffff;
    }
    const r = this.idxReg(rn);
    switch (pb & 0x0f) {
      case 0x0: ea = r; this.setIdxReg(rn, r + 1); cyc = 2; break;
      case 0x1: ea = r; this.setIdxReg(rn, r + 2); cyc = 3; break;
      case 0x2: this.setIdxReg(rn, r - 1); ea = (r - 1) & 0xffff; cyc = 2; break;
      case 0x3: this.setIdxReg(rn, r - 2); ea = (r - 2) & 0xffff; cyc = 3; break;
      case 0x4: ea = r; break;
      case 0x5: ea = (r + ((this.b << 24) >> 24)) & 0xffff; cyc = 1; break;
      case 0x6: ea = (r + ((this.a << 24) >> 24)) & 0xffff; cyc = 1; break;
      case 0x8: ea = (r + ((this.fetch() << 24) >> 24)) & 0xffff; cyc = 1; break;
      case 0x9: ea = (r + this.fetch16()) & 0xffff; cyc = 4; break;
      case 0xb: ea = (r + this.d) & 0xffff; cyc = 4; break;
      case 0xc: { const o = (this.fetch() << 24) >> 24; ea = (this.pc + o) & 0xffff; cyc = 1; break; }
      case 0xd: { const o = this.fetch16(); ea = (this.pc + o) & 0xffff; cyc = 5; break; }
      case 0xf: ea = this.fetch16(); cyc = 2; break;
      default: ea = r; break;
    }
    if (pb & 0x10) { ea = this.rd16(ea); cyc += 3; }
    this.idxCycles = cyc;
    return ea;
  }

  // effective address for column (hi nibble & 3): 1 direct, 2 indexed, 3 extended
  ea(mode) {
    if (mode === 1) return this.direct();
    if (mode === 2) return this.indexed();
    return this.fetch16();
  }

  // ---- interrupts -------------------------------------------------------------------
  pushAll() {
    this.pushS16(this.pc); this.pushS16(this.u); this.pushS16(this.y); this.pushS16(this.x);
    this.pushS(this.dp); this.pushS(this.b); this.pushS(this.a); this.pushS(this.cc);
  }

  step() {
    this.extraCycles = 0;
    if (this.nmiPending && this.nmiArmed) {
      this.nmiPending = false;
      if (!this.cwai) { this.cc |= E; this.pushAll(); }
      this.cwai = false; this.sync = false;
      this.cc |= I | F;
      this.pc = this.rd16(0xfffc);
      return 19;
    }
    if (this.firqLine && !(this.cc & F)) {
      this.sync = false;
      if (this.cwai) { this.cwai = false; }
      else { this.cc &= ~E; this.pushS16(this.pc); this.pushS(this.cc); }
      this.cc |= I | F;
      this.pc = this.rd16(0xfff6);
      return 10;
    }
    if (this.irqLine && !(this.cc & I)) {
      this.sync = false;
      if (this.cwai) { this.cwai = false; }
      else { this.cc |= E; this.pushAll(); }
      this.cc |= I;
      this.pc = this.rd16(0xfff8);
      return 19;
    }
    if (this.cwai || this.sync) {
      if (this.sync && (this.irqLine || this.firqLine)) this.sync = false;
      return 4;
    }
    const op = this.fetch();
    let cyc;
    if (op === 0x10) cyc = this.page2(this.fetch());
    else if (op === 0x11) cyc = this.page3(this.fetch());
    else cyc = this.exec(op);
    return cyc + this.extraCycles;
  }

  // ---- page 0 ---------------------------------------------------------------------------
  exec(op) {
    const hi = op >> 4, lo = op & 0x0f;
    let cyc = BASE[op];
    this.idxCycles = 0;
    switch (hi) {
      case 0x0: case 0x6: case 0x7: {
        const a = hi === 0 ? this.direct() : hi === 6 ? this.indexed() : this.fetch16();
        if (lo === 0xe) { this.pc = a; return cyc + this.idxCycles; }
        const r = this.rmw(lo, lo === 0xf ? 0 : this.rd(a));
        if (lo !== 0xd) this.wr(a, r);
        return cyc + this.idxCycles;
      }
      case 0x4: this.a = this.rmw(lo, this.a); return cyc;
      case 0x5: this.b = this.rmw(lo, this.b); return cyc;
      case 0x2: {
        const off = (this.fetch() << 24) >> 24;
        if (this.cond(lo)) this.pc = (this.pc + off) & 0xffff;
        return cyc;
      }
      case 0x1: return this.exec1(op, cyc);
      case 0x3: return this.exec3(op, cyc);
      default: return this.execAlu(op, cyc);
    }
  }

  exec1(op, cyc) {
    switch (op) {
      case 0x12: return cyc;
      case 0x13: this.sync = true; return cyc;
      case 0x16: { const o = this.fetch16(); this.pc = (this.pc + o) & 0xffff; return cyc; }
      case 0x17: { const o = this.fetch16(); this.pushS16(this.pc); this.pc = (this.pc + o) & 0xffff; return cyc; }
      case 0x19: {
        const a = this.a, msn = a & 0xf0, lsn = a & 0x0f;
        let cf = 0;
        if (lsn > 9 || (this.cc & H)) cf |= 0x06;
        if (msn > 0x80 && lsn > 9) cf |= 0x60;
        if (msn > 0x90 || (this.cc & C)) cf |= 0x60;
        const t = a + cf;
        this.a = t & 0xff;
        this.cc = (this.cc & ~(N | Z | V)) | (this.a & 0x80 ? N : 0) | (this.a ? 0 : Z) | (t & 0x100 ? C : 0) | (this.cc & C);
        return cyc;
      }
      case 0x1a: this.cc |= this.fetch(); return cyc;
      case 0x1c: this.cc &= this.fetch(); return cyc;
      case 0x1d: this.a = (this.b & 0x80) ? 0xff : 0; this.nz16(this.d); return cyc;
      case 0x1e: {
        const pb = this.fetch(), r1 = pb >> 4, r2 = pb & 15;
        const v1 = this.getReg(r1), v2 = this.getReg(r2);
        this.setReg(r1, v2); this.setReg(r2, v1);
        return cyc;
      }
      case 0x1f: { const pb = this.fetch(); this.setReg(pb & 15, this.getReg(pb >> 4)); return cyc; }
      default: return 2;
    }
  }

  exec3(op, cyc) {
    switch (op) {
      case 0x30: this.x = this.indexed(); this.cc = (this.cc & ~Z) | (this.x ? 0 : Z); return cyc + this.idxCycles;
      case 0x31: this.y = this.indexed(); this.cc = (this.cc & ~Z) | (this.y ? 0 : Z); return cyc + this.idxCycles;
      case 0x32: this.s = this.indexed(); this.nmiArmed = true; return cyc + this.idxCycles;
      case 0x33: this.u = this.indexed(); return cyc + this.idxCycles;
      case 0x34: case 0x36: {
        const pb = this.fetch(), useS = op === 0x34;
        const push8 = v => { cyc++; if (useS) this.pushS(v); else this.pushU(v); };
        const push16 = v => { push8(v & 0xff); push8(v >> 8); };
        if (pb & 0x80) push16(this.pc);
        if (pb & 0x40) push16(useS ? this.u : this.s);
        if (pb & 0x20) push16(this.y);
        if (pb & 0x10) push16(this.x);
        if (pb & 0x08) push8(this.dp);
        if (pb & 0x04) push8(this.b);
        if (pb & 0x02) push8(this.a);
        if (pb & 0x01) push8(this.cc);
        return cyc;
      }
      case 0x35: case 0x37: {
        const pb = this.fetch(), useS = op === 0x35;
        const pull8 = () => { cyc++; return useS ? this.pullS() : this.pullU(); };
        const pull16 = () => { const hi = pull8(); return (hi << 8) | pull8(); };
        if (pb & 0x01) this.cc = pull8();
        if (pb & 0x02) this.a = pull8();
        if (pb & 0x04) this.b = pull8();
        if (pb & 0x08) this.dp = pull8();
        if (pb & 0x10) this.x = pull16();
        if (pb & 0x20) this.y = pull16();
        if (pb & 0x40) { const v = pull16(); if (useS) this.u = v; else this.s = v; }
        if (pb & 0x80) this.pc = pull16();
        return cyc;
      }
      case 0x39: this.pc = this.pullS16(); return cyc;
      case 0x3a: this.x = (this.x + this.b) & 0xffff; return cyc;
      case 0x3b: {
        this.cc = this.pullS();
        if (this.cc & E) {
          this.a = this.pullS(); this.b = this.pullS(); this.dp = this.pullS();
          this.x = this.pullS16(); this.y = this.pullS16(); this.u = this.pullS16();
          cyc += 9;
        }
        this.pc = this.pullS16();
        return cyc;
      }
      case 0x3c: this.cc &= this.fetch(); this.cc |= E; this.pushAll(); this.cwai = true; return cyc;
      case 0x3d: { const r = this.a * this.b; this.d = r; this.cc = (this.cc & ~(Z | C)) | (r ? 0 : Z) | (r & 0x80 ? C : 0); return cyc; }
      case 0x3f: this.cc |= E; this.pushAll(); this.cc |= I | F; this.pc = this.rd16(0xfffa); return cyc;
      default: return 2;
    }
  }

  execAlu(op, cyc) {
    const hi = op >> 4, lo = op & 0x0f;
    const accB = hi >= 0xc;
    const mode = hi & 3;  // 0 imm, 1 direct, 2 indexed, 3 extended
    const memAddr = () => this.ea(mode);
    switch (lo) {
      case 0x3: {  // SUBD / ADDD
        const m = mode === 0 ? this.fetch16() : this.rd16(memAddr());
        this.d = accB ? this.add16(this.d, m) : this.sub16(this.d, m);
        return cyc + this.idxCycles;
      }
      case 0x7: {  // STA / STB
        if (mode === 0) return cyc;
        const a = memAddr(), v = accB ? this.b : this.a;
        this.wr(a, v); this.ld8(v);
        return cyc + this.idxCycles;
      }
      case 0xc: {  // CMPX / LDD
        const m = mode === 0 ? this.fetch16() : this.rd16(memAddr());
        if (accB) this.d = this.ld16(m); else this.sub16(this.x, m);
        return cyc + this.idxCycles;
      }
      case 0xd: {  // BSR / JSR / STD
        if (!accB) {
          if (mode === 0) { const o = (this.fetch() << 24) >> 24; this.pushS16(this.pc); this.pc = (this.pc + o) & 0xffff; }
          else { const a = memAddr(); this.pushS16(this.pc); this.pc = a; }
        } else if (mode !== 0) {
          const a = memAddr(); this.wr16(a, this.d); this.ld16(this.d);
        }
        return cyc + this.idxCycles;
      }
      case 0xe: {  // LDX / LDU
        const m = mode === 0 ? this.fetch16() : this.rd16(memAddr());
        if (accB) this.u = this.ld16(m); else this.x = this.ld16(m);
        return cyc + this.idxCycles;
      }
      case 0xf: {  // STX / STU
        if (mode === 0) return cyc;
        const a = memAddr(), v = accB ? this.u : this.x;
        this.wr16(a, v); this.ld16(v);
        return cyc + this.idxCycles;
      }
    }
    const m = mode === 0 ? this.fetch() : this.rd(memAddr());
    const r0 = accB ? this.b : this.a;
    let r;
    switch (lo) {
      case 0x0: r = this.sub8(r0, m, 0); break;
      case 0x1: this.sub8(r0, m, 0); return cyc + this.idxCycles;
      case 0x2: r = this.sub8(r0, m, this.cc & C); break;
      case 0x4: r = this.ld8(r0 & m); break;
      case 0x5: this.ld8(r0 & m); return cyc + this.idxCycles;
      case 0x6: r = this.ld8(m); break;
      case 0x8: r = this.ld8(r0 ^ m); break;
      case 0x9: r = this.add8(r0, m, this.cc & C); break;
      case 0xa: r = this.ld8(r0 | m); break;
      case 0xb: r = this.add8(r0, m, 0); break;
      default: return cyc + this.idxCycles;
    }
    if (accB) this.b = r; else this.a = r;
    return cyc + this.idxCycles;
  }

  // ---- page 2 (0x10 prefix) ---------------------------------------------------------------
  page2(op) {
    this.idxCycles = 0;
    if (op >= 0x21 && op <= 0x2f) {
      const o = this.fetch16();
      if (this.cond(op & 0x0f)) { this.pc = (this.pc + o) & 0xffff; return 6; }
      return 5;
    }
    if (op === 0x3f) { this.cc |= E; this.pushAll(); this.pc = this.rd16(0xfff4); return 20; }
    const lo = op & 0x0f, hi = op >> 4, mode = hi & 3;
    const cycTab = { 0: [5, 4], 1: [7, 6], 2: [7, 6], 3: [8, 7] };
    switch (lo) {
      case 0x3: {  // CMPD
        const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
        this.sub16(this.d, m);
        return cycTab[mode][0] + this.idxCycles;
      }
      case 0xc: {  // CMPY
        const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
        this.sub16(this.y, m);
        return cycTab[mode][0] + this.idxCycles;
      }
      case 0xe: {  // LDY / LDS
        const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
        if (hi >= 0xc) { this.s = this.ld16(m); this.nmiArmed = true; } else this.y = this.ld16(m);
        return cycTab[mode][1] + this.idxCycles;
      }
      case 0xf: {  // STY / STS
        if (mode === 0) return 4;
        const a = this.ea(mode), v = hi >= 0xc ? this.s : this.y;
        this.wr16(a, v); this.ld16(v);
        return cycTab[mode][1] + this.idxCycles;
      }
    }
    return 2;
  }

  // ---- page 3 (0x11 prefix) ---------------------------------------------------------------
  page3(op) {
    this.idxCycles = 0;
    if (op === 0x3f) { this.cc |= E; this.pushAll(); this.pc = this.rd16(0xfff2); return 20; }
    const lo = op & 0x0f, mode = (op >> 4) & 3;
    const cyc = [5, 7, 7, 8][mode];
    if (lo === 0x3 || lo === 0xc) {
      const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
      this.sub16(lo === 0x3 ? this.u : this.s, m);
      return cyc + this.idxCycles;
    }
    return 2;
  }
}
