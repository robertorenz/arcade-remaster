// Zilog Z80 CPU core.
// Bus interface: { read(addr), write(addr, v), in(port), out(port, v) }
// step() executes one instruction (or accepts an interrupt) and returns T-states used.

const FC = 0x01, FN = 0x02, FPV = 0x04, FX = 0x08, FH = 0x10, FY = 0x20, FZ = 0x40, FS = 0x80;

const SZ = new Uint8Array(256);
const SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
  SZ[i] = (i & 0x80) | (i === 0 ? FZ : 0) | (i & (FX | FY));
  SZP[i] = SZ[i] | ((p & 1) ? 0 : FPV);
}

const CC_MAIN = [
  4,10,7,6,4,4,7,4, 4,11,7,6,4,4,7,4,
  8,10,7,6,4,4,7,4, 12,11,7,6,4,4,7,4,
  7,10,16,6,4,4,7,4, 7,11,16,6,4,4,7,4,
  7,10,13,6,11,11,10,4, 7,11,13,6,4,4,7,4,
];

export class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.a = 0xff; this.f = 0xff;
    this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0xffff; this.iy = 0xffff; this.sp = 0xffff; this.pc = 0;
    this.i = 0; this.r = 0;
    this.iff1 = 0; this.iff2 = 0; this.im = 0;
    this.halted = false;
    this.eiDelay = false;
    this.nmiPending = false;
    this.irqLine = false;
    this.irqVector = 0xff;
    this.idx = 0;
  }

  nmi() { this.nmiPending = true; }
  setIrq(state, vector = 0xff) { this.irqLine = state; this.irqVector = vector; this.irqHold = false; }
  // assert an interrupt that stays pending until the CPU acknowledges it
  holdIrq(vector = 0xff) { this.irqLine = true; this.irqVector = vector; this.irqHold = true; }

  // ---- helpers -------------------------------------------------------------
  rd(a) { return this.bus.read(a & 0xffff); }
  wr(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  fetch() { const v = this.bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetchOp() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); return this.fetch(); }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr16(a, v) { this.wr(a, v & 0xff); this.wr(a + 1, v >> 8); }
  push(v) { this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v & 0xff); }
  pop() { const v = this.rd(this.sp) | (this.rd(this.sp + 1) << 8); this.sp = (this.sp + 2) & 0xffff; return v; }

  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }
  set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }

  // HL / IX / IY depending on the active prefix
  getHX() { return this.idx === 0 ? this.hl : this.idx === 1 ? this.ix : this.iy; }
  setHX(v) { v &= 0xffff; if (this.idx === 0) this.hl = v; else if (this.idx === 1) this.ix = v; else this.iy = v; }

  getRP(p) {
    switch (p) { case 0: return this.bc; case 1: return this.de; case 2: return this.getHX(); default: return this.sp; }
  }
  setRP(p, v) {
    v &= 0xffff;
    switch (p) { case 0: this.bc = v; break; case 1: this.de = v; break; case 2: this.setHX(v); break; default: this.sp = v; }
  }
  getRP2(p) { return p === 3 ? this.af : this.getRP(p); }
  setRP2(p, v) { if (p === 3) this.af = v & 0xffff; else this.setRP(p, v); }

  // 8-bit register (r != 6), honouring IXH/IXL/IYH/IYL under a prefix
  getR(r) {
    switch (r) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.idx === 0 ? this.h : this.idx === 1 ? this.ix >> 8 : this.iy >> 8;
      case 5: return this.idx === 0 ? this.l : this.idx === 1 ? this.ix & 0xff : this.iy & 0xff;
      default: return this.a;
    }
  }
  setR(r, v) {
    v &= 0xff;
    switch (r) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: if (this.idx === 0) this.h = v; else if (this.idx === 1) this.ix = (this.ix & 0xff) | (v << 8); else this.iy = (this.iy & 0xff) | (v << 8); break;
      case 5: if (this.idx === 0) this.l = v; else if (this.idx === 1) this.ix = (this.ix & 0xff00) | v; else this.iy = (this.iy & 0xff00) | v; break;
      default: this.a = v;
    }
  }
  // plain register access ignoring the prefix (used with (IX+d) operands)
  getRPlain(r) { const s = this.idx; this.idx = 0; const v = this.getR(r); this.idx = s; return v; }
  setRPlain(r, v) { const s = this.idx; this.idx = 0; this.setR(r, v); this.idx = s; }

  // address of the (HL) / (IX+d) operand; fetches displacement under a prefix
  memAddr() {
    if (this.idx === 0) return this.hl;
    let d = this.fetch(); if (d & 0x80) d -= 256;
    return ((this.idx === 1 ? this.ix : this.iy) + d) & 0xffff;
  }

  cond(y) {
    switch (y) {
      case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
      case 2: return !(this.f & FC); case 3: return !!(this.f & FC);
      case 4: return !(this.f & FPV); case 5: return !!(this.f & FPV);
      case 6: return !(this.f & FS); default: return !!(this.f & FS);
    }
  }

  // ---- ALU -----------------------------------------------------------------
  add8(v, c) {
    const a = this.a, r = a + v + c;
    this.f = SZ[r & 0xff] | ((r >> 8) & 1) | ((a ^ v ^ r) & FH) | ((((a ^ ~v) & (a ^ r)) & 0x80) >> 5);
    this.a = r & 0xff;
  }
  sub8(v, c) {
    const a = this.a, r = a - v - c;
    this.f = SZ[r & 0xff] | ((r >> 8) & 1) | FN | ((a ^ v ^ r) & FH) | ((((a ^ v) & (a ^ r)) & 0x80) >> 5);
    this.a = r & 0xff;
  }
  cp8(v) {
    const a = this.a, r = a - v;
    this.f = (SZ[r & 0xff] & ~(FX | FY)) | (v & (FX | FY)) | ((r >> 8) & 1) | FN | ((a ^ v ^ r) & FH) | ((((a ^ v) & (a ^ r)) & 0x80) >> 5);
  }
  alu(y, v) {
    switch (y) {
      case 0: this.add8(v, 0); break;
      case 1: this.add8(v, this.f & FC); break;
      case 2: this.sub8(v, 0); break;
      case 3: this.sub8(v, this.f & FC); break;
      case 4: this.a &= v; this.f = SZP[this.a] | FH; break;
      case 5: this.a ^= v; this.f = SZP[this.a]; break;
      case 6: this.a |= v; this.f = SZP[this.a]; break;
      default: this.cp8(v);
    }
  }
  inc8(v) {
    const r = (v + 1) & 0xff;
    this.f = (this.f & FC) | SZ[r] | (r === 0x80 ? FPV : 0) | ((r & 0x0f) === 0 ? FH : 0);
    return r;
  }
  dec8(v) {
    const r = (v - 1) & 0xff;
    this.f = (this.f & FC) | FN | SZ[r] | (v === 0x80 ? FPV : 0) | ((v & 0x0f) === 0 ? FH : 0);
    return r;
  }
  add16(a, b) {
    const r = a + b;
    this.f = (this.f & (FS | FZ | FPV)) | ((r >> 16) & 1) | (((a ^ b ^ r) >> 8) & FH) | ((r >> 8) & (FX | FY));
    return r & 0xffff;
  }
  adc16(v) {
    const hl = this.hl, r = hl + v + (this.f & FC);
    this.f = ((r >> 8) & FS) | ((r & 0xffff) === 0 ? FZ : 0) | ((r >> 16) & 1) | (((hl ^ v ^ r) >> 8) & FH) |
      ((((hl ^ ~v) & (hl ^ r)) & 0x8000) >> 13) | ((r >> 8) & (FX | FY));
    this.hl = r & 0xffff;
  }
  sbc16(v) {
    const hl = this.hl, r = hl - v - (this.f & FC);
    this.f = FN | ((r >> 8) & FS) | ((r & 0xffff) === 0 ? FZ : 0) | ((r >> 16) & 1) | (((hl ^ v ^ r) >> 8) & FH) |
      ((((hl ^ v) & (hl ^ r)) & 0x8000) >> 13) | ((r >> 8) & (FX | FY));
    this.hl = r & 0xffff;
  }
  rot(y, v) {
    let r, c;
    switch (y) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; r = ((v << 1) | (this.f & FC)) & 0xff; break;
      case 3: c = v & 1; r = (v >> 1) | ((this.f & FC) << 7); break;
      case 4: c = v >> 7; r = (v << 1) & 0xff; break;
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;
      default: c = v & 1; r = v >> 1;
    }
    this.f = SZP[r] | c;
    return r;
  }
  bit(y, v, xy) {
    const r = v & (1 << y);
    this.f = (this.f & FC) | FH | (r ? 0 : FZ | FPV) | (r & FS) | (xy & (FX | FY));
  }

  // ---- execution ----------------------------------------------------------
  step() {
    if (this.nmiPending) {
      this.nmiPending = false;
      this.halted = false;
      this.iff1 = 0;
      this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
      this.push(this.pc);
      this.pc = 0x66;
      return 11;
    }
    if (this.irqLine && this.iff1 && !this.eiDelay) {
      this.halted = false;
      this.iff1 = this.iff2 = 0;
      if (this.irqHold) this.irqLine = false;   // HOLD_LINE semantics: released on acknowledge
      this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
      this.push(this.pc);
      if (this.im === 2) { this.pc = this.rd16((this.i << 8) | (this.irqVector & 0xfe)); return 19; }
      if (this.im === 0 && (this.irqVector & 0xc7) === 0xc7) { this.pc = this.irqVector & 0x38; return 13; }
      this.pc = 0x38;
      return 13;
    }
    this.eiDelay = false;
    if (this.halted) { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); return 4; }

    this.idx = 0;
    let cyc = 0;
    let op = this.fetchOp();
    while (op === 0xdd || op === 0xfd) {
      this.idx = op === 0xdd ? 1 : 2;
      cyc += 4;
      op = this.fetchOp();
    }
    if (op === 0xcb) return cyc + (this.idx ? this.execIndexCB() : this.execCB());
    if (op === 0xed) { this.idx = 0; return cyc + this.execED(); }
    return cyc + this.execMain(op);
  }

  execMain(op) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    switch (x) {
      case 0:
        switch (z) {
          case 0:
            switch (y) {
              case 0: return 4;
              case 1: {
                let t = this.a; this.a = this.a_; this.a_ = t;
                t = this.f; this.f = this.f_; this.f_ = t;
                return 4;
              }
              case 2: {
                let d = this.fetch(); if (d & 0x80) d -= 256;
                this.b = (this.b - 1) & 0xff;
                if (this.b) { this.pc = (this.pc + d) & 0xffff; return 13; }
                return 8;
              }
              case 3: {
                let d = this.fetch(); if (d & 0x80) d -= 256;
                this.pc = (this.pc + d) & 0xffff; return 12;
              }
              default: {
                let d = this.fetch(); if (d & 0x80) d -= 256;
                if (this.cond(y - 4)) { this.pc = (this.pc + d) & 0xffff; return 12; }
                return 7;
              }
            }
          case 1:
            if (q === 0) { this.setRP(p, this.fetch16()); return 10; }
            this.setHX(this.add16(this.getHX(), this.getRP(p))); return 11;
          case 2:
            if (q === 0) {
              switch (p) {
                case 0: this.wr(this.bc, this.a); return 7;
                case 1: this.wr(this.de, this.a); return 7;
                case 2: this.wr16(this.fetch16(), this.getHX()); return 16;
                default: this.wr(this.fetch16(), this.a); return 13;
              }
            }
            switch (p) {
              case 0: this.a = this.rd(this.bc); return 7;
              case 1: this.a = this.rd(this.de); return 7;
              case 2: this.setHX(this.rd16(this.fetch16())); return 16;
              default: this.a = this.rd(this.fetch16()); return 13;
            }
          case 3:
            this.setRP(p, this.getRP(p) + (q ? -1 : 1)); return 6;
          case 4:
            if (y === 6) { const a = this.memAddr(); this.wr(a, this.inc8(this.rd(a))); return this.idx ? 19 : 11; }
            this.setR(y, this.inc8(this.getR(y))); return 4;
          case 5:
            if (y === 6) { const a = this.memAddr(); this.wr(a, this.dec8(this.rd(a))); return this.idx ? 19 : 11; }
            this.setR(y, this.dec8(this.getR(y))); return 4;
          case 6:
            if (y === 6) { const a = this.memAddr(); this.wr(a, this.fetch()); return this.idx ? 15 : 10; }
            this.setR(y, this.fetch()); return 7;
          default: {
            const a = this.a, f = this.f;
            switch (y) {
              case 0: { const c = a >> 7; this.a = ((a << 1) | c) & 0xff; this.f = (f & (FS | FZ | FPV)) | (this.a & (FX | FY)) | c; break; }
              case 1: { const c = a & 1; this.a = (a >> 1) | (c << 7); this.f = (f & (FS | FZ | FPV)) | (this.a & (FX | FY)) | c; break; }
              case 2: { const c = a >> 7; this.a = ((a << 1) | (f & FC)) & 0xff; this.f = (f & (FS | FZ | FPV)) | (this.a & (FX | FY)) | c; break; }
              case 3: { const c = a & 1; this.a = (a >> 1) | ((f & FC) << 7); this.f = (f & (FS | FZ | FPV)) | (this.a & (FX | FY)) | c; break; }
              case 4: {
                let d = 0, c = 0;
                if ((f & FH) || (a & 0x0f) > 9) d = 6;
                if ((f & FC) || a > 0x99) { d |= 0x60; c = 1; }
                const r = ((f & FN) ? a - d : a + d) & 0xff;
                this.f = SZP[r] | ((a ^ r) & FH) | (f & FN) | c;
                this.a = r; break;
              }
              case 5: this.a = a ^ 0xff; this.f = (f & (FS | FZ | FPV | FC)) | FH | FN | (this.a & (FX | FY)); break;
              case 6: this.f = (f & (FS | FZ | FPV)) | FC | (a & (FX | FY)); break;
              default: this.f = ((f & (FS | FZ | FPV)) | ((f & FC) ? FH : FC) | (a & (FX | FY))); break;
            }
            return 4;
          }
        }
      case 1:
        if (op === 0x76) { this.halted = true; return 4; }
        if (z === 6) { const a = this.memAddr(); this.setRPlain(y, this.rd(a)); return this.idx ? 15 : 7; }
        if (y === 6) { const a = this.memAddr(); this.wr(a, this.getRPlain(z)); return this.idx ? 15 : 7; }
        this.setR(y, this.getR(z)); return 4;
      case 2:
        if (z === 6) { this.alu(y, this.rd(this.memAddr())); return this.idx ? 15 : 7; }
        this.alu(y, this.getR(z)); return 4;
      default:
        switch (z) {
          case 0:
            if (this.cond(y)) { this.pc = this.pop(); return 11; }
            return 5;
          case 1:
            if (q === 0) { this.setRP2(p, this.pop()); return 10; }
            switch (p) {
              case 0: this.pc = this.pop(); return 10;
              case 1: {
                let t;
                t = this.b; this.b = this.b_; this.b_ = t; t = this.c; this.c = this.c_; this.c_ = t;
                t = this.d; this.d = this.d_; this.d_ = t; t = this.e; this.e = this.e_; this.e_ = t;
                t = this.h; this.h = this.h_; this.h_ = t; t = this.l; this.l = this.l_; this.l_ = t;
                return 4;
              }
              case 2: this.pc = this.getHX(); return 4;
              default: this.sp = this.getHX(); return 6;
            }
          case 2: {
            const a = this.fetch16();
            if (this.cond(y)) this.pc = a;
            return 10;
          }
          case 3:
            switch (y) {
              case 0: this.pc = this.fetch16(); return 10;
              case 2: { const n = this.fetch(); this.bus.out((this.a << 8) | n, this.a); return 11; }
              case 3: { const n = this.fetch(); this.a = this.bus.in((this.a << 8) | n) & 0xff; return 11; }
              case 4: {
                const v = this.rd16(this.sp); this.wr16(this.sp, this.getHX()); this.setHX(v); return 19;
              }
              case 5: { const t = this.de; this.de = this.hl; this.hl = t; return 4; }
              case 6: this.iff1 = this.iff2 = 0; return 4;
              case 7: this.iff1 = this.iff2 = 1; this.eiDelay = true; return 4;
              default: return 4;
            }
          case 4: {
            const a = this.fetch16();
            if (this.cond(y)) { this.push(this.pc); this.pc = a; return 17; }
            return 10;
          }
          case 5:
            if (q === 0) { this.push(this.getRP2(p)); return 11; }
            { const a = this.fetch16(); this.push(this.pc); this.pc = a; return 17; }
          case 6:
            this.alu(y, this.fetch()); return 7;
          default:
            this.push(this.pc); this.pc = y * 8; return 11;
        }
    }
  }

  execCB() {
    const op = this.fetchOp();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    if (z === 6) {
      const a = this.hl, v = this.rd(a);
      switch (x) {
        case 0: this.wr(a, this.rot(y, v)); return 15;
        case 1: this.bit(y, v, a >> 8); return 12;
        case 2: this.wr(a, v & ~(1 << y)); return 15;
        default: this.wr(a, v | (1 << y)); return 15;
      }
    }
    const v = this.getR(z);
    switch (x) {
      case 0: this.setR(z, this.rot(y, v)); break;
      case 1: this.bit(y, v, v); break;
      case 2: this.setR(z, v & ~(1 << y)); break;
      default: this.setR(z, v | (1 << y)); break;
    }
    return 8;
  }

  execIndexCB() {
    let d = this.fetch(); if (d & 0x80) d -= 256;
    const a = ((this.idx === 1 ? this.ix : this.iy) + d) & 0xffff;
    const op = this.fetch();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const v = this.rd(a);
    let r;
    switch (x) {
      case 0: r = this.rot(y, v); break;
      case 1: this.bit(y, v, a >> 8); return 16;
      case 2: r = v & ~(1 << y); break;
      default: r = v | (1 << y); break;
    }
    this.wr(a, r);
    if (z !== 6) this.setRPlain(z, r);
    return 19;
  }

  execED() {
    const op = this.fetchOp();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: {
          const v = this.bus.in(this.bc) & 0xff;
          if (y !== 6) this.setR(y, v);
          this.f = (this.f & FC) | SZP[v];
          return 12;
        }
        case 1: this.bus.out(this.bc, y === 6 ? 0 : this.getR(y)); return 12;
        case 2: if (q === 0) this.sbc16(this.getRP(p)); else this.adc16(this.getRP(p)); return 15;
        case 3: {
          const a = this.fetch16();
          if (q === 0) this.wr16(a, this.getRP(p)); else this.setRP(p, this.rd16(a));
          return 20;
        }
        case 4: { const v = this.a; this.a = 0; this.sub8(v, 0); return 8; }
        case 5: this.iff1 = this.iff2; this.pc = this.pop(); return 14;
        case 6: this.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return 8;
        default:
          switch (y) {
            case 0: this.i = this.a; return 9;
            case 1: this.r = this.a; return 9;
            case 2: this.a = this.i; this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FPV : 0); return 9;
            case 3: this.a = this.r; this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FPV : 0); return 9;
            case 4: {
              const m = this.rd(this.hl);
              this.wr(this.hl, ((this.a << 4) | (m >> 4)) & 0xff);
              this.a = (this.a & 0xf0) | (m & 0x0f);
              this.f = (this.f & FC) | SZP[this.a];
              return 18;
            }
            case 5: {
              const m = this.rd(this.hl);
              this.wr(this.hl, ((m << 4) | (this.a & 0x0f)) & 0xff);
              this.a = (this.a & 0xf0) | (m >> 4);
              this.f = (this.f & FC) | SZP[this.a];
              return 18;
            }
            default: return 8;
          }
      }
    }
    if (x === 2 && z <= 3 && y >= 4) {
      const dec = y & 1, rep = y & 2;
      const step = dec ? -1 : 1;
      switch (z) {
        case 0: { // LDI/LDD/LDIR/LDDR
          const v = this.rd(this.hl);
          this.wr(this.de, v);
          this.hl = (this.hl + step) & 0xffff;
          this.de = (this.de + step) & 0xffff;
          this.bc = (this.bc - 1) & 0xffff;
          const n = v + this.a;
          this.f = (this.f & (FS | FZ | FC)) | (this.bc ? FPV : 0) | (n & FX) | ((n << 4) & FY);
          if (rep && this.bc) { this.pc = (this.pc - 2) & 0xffff; return 21; }
          return 16;
        }
        case 1: { // CPI/CPD/CPIR/CPDR
          const v = this.rd(this.hl);
          const r = (this.a - v) & 0xff;
          const hf = (this.a ^ v ^ r) & FH;
          this.hl = (this.hl + step) & 0xffff;
          this.bc = (this.bc - 1) & 0xffff;
          const n = r - (hf ? 1 : 0);
          this.f = (this.f & FC) | FN | (SZ[r] & ~(FX | FY)) | hf | (this.bc ? FPV : 0) | (n & FX) | ((n << 4) & FY);
          if (rep && this.bc && r !== 0) { this.pc = (this.pc - 2) & 0xffff; return 21; }
          return 16;
        }
        case 2: { // INI/IND/INIR/INDR
          const v = this.bus.in(this.bc) & 0xff;
          this.wr(this.hl, v);
          this.hl = (this.hl + step) & 0xffff;
          this.b = (this.b - 1) & 0xff;
          this.f = SZ[this.b] | FN;
          if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
          return 16;
        }
        default: { // OUTI/OUTD/OTIR/OTDR
          const v = this.rd(this.hl);
          this.b = (this.b - 1) & 0xff;
          this.bus.out(this.bc, v);
          this.hl = (this.hl + step) & 0xffff;
          this.f = SZ[this.b] | FN;
          if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
          return 16;
        }
      }
    }
    return 8;
  }
}
