// Motorola MC6803 (6801 family without internal ROM).
// 6800 instruction set + 6801 extensions (D register, MUL, ABX, PSHX/PULX, LSRD/ASLD, BRN, JSR direct),
// on-chip registers at 0x00-0x1f (ports 1/2, 16-bit timer with output compare), 128 bytes RAM at 0x80-0xff.
// bus: { read(a), write(a,v), p1Read(), p2Read(), p1Write(v), p2Write(v) }
// step() returns E-clock cycles.

const C = 0x01, V = 0x02, Z = 0x04, N = 0x08, I = 0x10, H = 0x20;

// cycle counts for 6801/6803
const CYCLES = new Uint8Array([
  /*0*/ 2, 2, 2, 2, 3, 3, 2, 2, 3, 3, 2, 2, 2, 2, 2, 2,
  /*1*/ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /*2*/ 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  /*3*/ 3, 3, 4, 4, 3, 3, 3, 3, 5, 5, 3, 10, 4, 10, 9, 12,
  /*4*/ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /*5*/ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /*6*/ 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 6,
  /*7*/ 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 6,
  /*8*/ 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 4, 6, 3, 3,
  /*9*/ 3, 3, 3, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5, 4, 4,
  /*A*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 5, 5,
  /*B*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 5, 5,
  /*C*/ 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3,
  /*D*/ 3, 3, 3, 5, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4,
  /*E*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
  /*F*/ 4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5,
]);

export class M6803 {
  constructor(bus) {
    this.bus = bus;
    this.iram = new Uint8Array(128);
    this.reset();
  }

  reset() {
    this.a = 0; this.b = 0; this.x = 0; this.sp = 0; this.cc = 0xc0 | I;
    this.ddr = [0, 0]; this.pdata = [0, 0];
    this.tcsr = 0; this.counter = 0; this.ocr = 0xffff; this.icr = 0;
    this.pendingClear = 0;
    this.irqLine = false; this.nmiPending = false; this.waiting = false;
    this.pc = this.rd16(0xfffe);
  }

  // ---- memory with on-chip resources ------------------------------------------
  rd(a) {
    a &= 0xffff;
    if (a < 0x20) return this.readReg(a);
    if (a >= 0x80 && a < 0x100) return this.iram[a - 0x80];
    return this.bus.read(a);
  }
  wr(a, v) {
    a &= 0xffff; v &= 0xff;
    if (a < 0x20) { this.writeReg(a, v); return; }
    if (a >= 0x80 && a < 0x100) { this.iram[a - 0x80] = v; return; }
    this.bus.write(a, v);
  }
  rd16(a) { return (this.rd(a) << 8) | this.rd(a + 1); }
  wr16(a, v) { this.wr(a, v >> 8); this.wr(a + 1, v & 0xff); }

  portOut(n) {
    const v = (this.pdata[n] & this.ddr[n]) | (this.ddr[n] ^ 0xff);
    if (n === 0) this.bus.p1Write(v); else this.bus.p2Write(v);
  }

  readReg(r) {
    switch (r) {
      case 0x00: return this.ddr[0];
      case 0x01: return this.ddr[1];
      case 0x02: return (this.bus.p1Read() & ~this.ddr[0]) | (this.pdata[0] & this.ddr[0]);
      case 0x03: return ((this.bus.p2Read() & ~this.ddr[1]) | (this.pdata[1] & this.ddr[1])) & 0xff;
      case 0x08: this.pendingClear = this.tcsr & 0xe0; return this.tcsr;
      case 0x09:
        if (this.pendingClear & 0x20) { this.tcsr &= ~0x20; this.pendingClear &= ~0x20; }
        this.latchLo = this.counter & 0xff;
        return this.counter >> 8;
      case 0x0a: return this.latchLo !== undefined ? this.latchLo : this.counter & 0xff;
      case 0x0b: return this.ocr >> 8;
      case 0x0c: return this.ocr & 0xff;
      case 0x0d: return this.icr >> 8;
      case 0x0e: return this.icr & 0xff;
      case 0x11: return 0x20;     // SCI: transmit data register empty
      default: return 0;
    }
  }

  writeReg(r, v) {
    switch (r) {
      case 0x00: this.ddr[0] = v; this.portOut(0); break;
      case 0x01: this.ddr[1] = v; this.portOut(1); break;
      case 0x02: this.pdata[0] = v; this.portOut(0); break;
      case 0x03: this.pdata[1] = v; this.portOut(1); break;
      case 0x08: this.tcsr = (this.tcsr & 0xe0) | (v & 0x1f); break;
      case 0x09: this.counter = 0xfff8; break;
      case 0x0b:
      case 0x0c:
        if (r === 0x0b) this.ocr = (this.ocr & 0x00ff) | (v << 8);
        else this.ocr = (this.ocr & 0xff00) | v;
        if (this.pendingClear & 0x40) { this.tcsr &= ~0x40; this.pendingClear &= ~0x40; }
        break;
      default: break;
    }
  }

  // ---- helpers --------------------------------------------------------------------
  get d() { return (this.a << 8) | this.b; }
  set d(v) { this.a = (v >> 8) & 0xff; this.b = v & 0xff; }
  fetch() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const v = this.rd16(this.pc); this.pc = (this.pc + 2) & 0xffff; return v; }
  push(v) { this.wr(this.sp, v); this.sp = (this.sp - 1) & 0xffff; }
  pull() { this.sp = (this.sp + 1) & 0xffff; return this.rd(this.sp); }
  push16(v) { this.push(v & 0xff); this.push(v >> 8); }
  pull16() { const hi = this.pull(); return (hi << 8) | this.pull(); }
  nz8(v) { this.cc = (this.cc & ~(N | Z)) | (v & 0x80 ? N : 0) | (v ? 0 : Z); }
  nz16(v) { this.cc = (this.cc & ~(N | Z)) | (v & 0x8000 ? N : 0) | (v ? 0 : Z); }

  setIrq(state) { this.irqLine = !!state; }
  nmi() { this.nmiPending = true; }

  interrupt(vector) {
    if (!this.waiting) {
      this.push16(this.pc); this.push16(this.x);
      this.push(this.a); this.push(this.b); this.push(this.cc);
    }
    this.waiting = false;
    this.cc |= I;
    this.pc = this.rd16(vector);
    return 12;
  }

  // ---- ALU ------------------------------------------------------------------------
  add8(a, m, c) {
    const r = a + m + c;
    let cc = this.cc & ~(H | N | Z | V | C);
    if (((a & 0x0f) + (m & 0x0f) + c) & 0x10) cc |= H;
    if (r & 0x80) cc |= N;
    if (!(r & 0xff)) cc |= Z;
    if ((~(a ^ m) & (a ^ r)) & 0x80) cc |= V;
    if (r & 0x100) cc |= C;
    this.cc = cc;
    return r & 0xff;
  }
  sub8(a, m, c) {
    const r = a - m - c;
    let cc = this.cc & ~(N | Z | V | C);
    if (r & 0x80) cc |= N;
    if (!(r & 0xff)) cc |= Z;
    if (((a ^ m) & (a ^ r)) & 0x80) cc |= V;
    if (r & 0x100) cc |= C;
    this.cc = cc;
    return r & 0xff;
  }
  add16(a, m) {
    const r = a + m;
    let cc = this.cc & ~(N | Z | V | C);
    if (r & 0x8000) cc |= N;
    if (!(r & 0xffff)) cc |= Z;
    if ((~(a ^ m) & (a ^ r)) & 0x8000) cc |= V;
    if (r & 0x10000) cc |= C;
    this.cc = cc;
    return r & 0xffff;
  }
  sub16(a, m) {
    const r = a - m;
    let cc = this.cc & ~(N | Z | V | C);
    if (r & 0x8000) cc |= N;
    if (!(r & 0xffff)) cc |= Z;
    if (((a ^ m) & (a ^ r)) & 0x8000) cc |= V;
    if (r & 0x10000) cc |= C;
    this.cc = cc;
    return r & 0xffff;
  }
  logic(r) { this.nz8(r); this.cc &= ~V; return r; }

  // read-modify-write unary ops (NEG, COM, LSR, ROR, ASR, ASL, ROL, DEC, INC, TST, CLR)
  unary(op, v) {
    let r, cc = this.cc;
    switch (op) {
      case 0x0: r = (-v) & 0xff; cc = (cc & ~(N | Z | V | C)) | (r & 0x80 ? N : 0) | (r ? C : Z) | (r === 0x80 ? V : 0); break;
      case 0x3: r = (~v) & 0xff; cc = (cc & ~(N | Z | V)) | C | (r & 0x80 ? N : 0) | (r ? 0 : Z); break;
      case 0x4: { const c = v & 1; r = v >> 1; cc = (cc & ~(N | Z | V | C)) | (r ? 0 : Z) | (c ? C | V : 0); break; }
      case 0x6: { const c = v & 1; r = (v >> 1) | ((cc & C) << 7); const n = r & 0x80; cc = (cc & ~(N | Z | V | C)) | (n ? N : 0) | (r ? 0 : Z) | (c ? C : 0) | ((!!n !== !!c) ? V : 0); break; }
      case 0x7: { const c = v & 1; r = (v >> 1) | (v & 0x80); const n = r & 0x80; cc = (cc & ~(N | Z | V | C)) | (n ? N : 0) | (r ? 0 : Z) | (c ? C : 0) | ((!!n !== !!c) ? V : 0); break; }
      case 0x8: { const c = v & 0x80; r = (v << 1) & 0xff; const n = r & 0x80; cc = (cc & ~(N | Z | V | C)) | (n ? N : 0) | (r ? 0 : Z) | (c ? C : 0) | ((!!n !== !!c) ? V : 0); break; }
      case 0x9: { const c = v & 0x80; r = ((v << 1) | (cc & C)) & 0xff; const n = r & 0x80; cc = (cc & ~(N | Z | V | C)) | (n ? N : 0) | (r ? 0 : Z) | (c ? C : 0) | ((!!n !== !!c) ? V : 0); break; }
      case 0xa: r = (v - 1) & 0xff; cc = (cc & ~(N | Z | V)) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (r === 0x7f ? V : 0); break;
      case 0xc: r = (v + 1) & 0xff; cc = (cc & ~(N | Z | V)) | (r & 0x80 ? N : 0) | (r ? 0 : Z) | (r === 0x80 ? V : 0); break;
      case 0xd: r = v; cc = (cc & ~(N | Z | V | C)) | (v & 0x80 ? N : 0) | (v ? 0 : Z); break;
      case 0xf: r = 0; cc = (cc & ~(N | V | C)) | Z; break;
      default: r = v;
    }
    this.cc = cc;
    return r;
  }

  branch(op) {
    const off = this.fetch();
    const cc = this.cc;
    const n = !!(cc & N), v = !!(cc & V), z = !!(cc & Z), c = !!(cc & C);
    let t;
    switch (op & 0x0f) {
      case 0x0: t = true; break;
      case 0x1: t = false; break;
      case 0x2: t = !(c || z); break;
      case 0x3: t = c || z; break;
      case 0x4: t = !c; break;
      case 0x5: t = c; break;
      case 0x6: t = !z; break;
      case 0x7: t = z; break;
      case 0x8: t = !v; break;
      case 0x9: t = v; break;
      case 0xa: t = !n; break;
      case 0xb: t = n; break;
      case 0xc: t = n === v; break;
      case 0xd: t = n !== v; break;
      case 0xe: t = !z && n === v; break;
      default: t = z || n !== v;
    }
    if (t) this.pc = (this.pc + ((off << 24) >> 24)) & 0xffff;
  }

  // effective address for the 4 addressing columns (imm handled by caller)
  ea(mode) {
    switch (mode) {
      case 1: return this.fetch();                                  // direct
      case 2: return (this.x + this.fetch()) & 0xffff;              // indexed
      default: return this.fetch16();                               // extended
    }
  }

  // ---- timer --------------------------------------------------------------------------
  tickTimer(cycles) {
    const old = this.counter;
    const nw = old + cycles;
    // output compare: did the counter pass OCR during these cycles?
    const dist = (this.ocr - old) & 0xffff;
    if (dist !== 0 && dist <= cycles) this.tcsr |= 0x40;
    if (nw > 0xffff) this.tcsr |= 0x20;
    this.counter = nw & 0xffff;
  }

  // ---- execution ---------------------------------------------------------------------
  step() {
    let cyc;
    if (this.nmiPending) {
      this.nmiPending = false;
      cyc = this.interrupt(0xfffc);
    } else if (!(this.cc & I) && this.irqLine) {
      cyc = this.interrupt(0xfff8);
    } else if (!(this.cc & I) && (this.tcsr & 0x40) && (this.tcsr & 0x08)) {
      cyc = this.interrupt(0xfff4);
    } else if (!(this.cc & I) && (this.tcsr & 0x20) && (this.tcsr & 0x04)) {
      cyc = this.interrupt(0xfff2);
    } else if (this.waiting) {
      cyc = 4;
    } else {
      const op = this.fetch();
      cyc = CYCLES[op];
      this.exec(op);
    }
    this.tickTimer(cyc);
    return cyc;
  }

  exec(op) {
    const hi = op >> 4, lo = op & 0x0f;
    if (hi === 0x2) { this.branch(op); return; }
    if (hi === 0x4 || hi === 0x5) {
      if (hi === 0x4) this.a = this.unary(lo, this.a); else this.b = this.unary(lo, this.b);
      return;
    }
    if (hi === 0x6 || hi === 0x7) {
      const a = hi === 0x6 ? (this.x + this.fetch()) & 0xffff : this.fetch16();
      if (lo === 0xe) { this.pc = a; return; }                 // JMP
      const r = this.unary(lo, lo === 0xf ? 0 : this.rd(a));
      if (lo !== 0xd) this.wr(a, r);                            // TST doesn't write
      return;
    }
    if (hi >= 0x8) {
      const accB = hi >= 0xc;
      const mode = hi & 3;          // 0 imm, 1 dir, 2 idx, 3 ext
      switch (lo) {
        case 0x3: {                 // SUBD / ADDD (16-bit)
          const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
          this.d = accB ? this.add16(this.d, m) : this.sub16(this.d, m);
          return;
        }
        case 0x7: {                 // STA / STB
          if (mode === 0) return;
          const r = accB ? this.b : this.a;
          this.wr(this.ea(mode), r);
          this.logic(r);
          return;
        }
        case 0xc: {                 // CPX / LDD
          const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
          if (accB) { this.d = m; this.nz16(m); this.cc &= ~V; }
          else this.sub16(this.x, m);
          return;
        }
        case 0xd: {                 // BSR / JSR / STD
          if (!accB) {
            if (mode === 0) { const off = this.fetch(); this.push16(this.pc); this.pc = (this.pc + ((off << 24) >> 24)) & 0xffff; }
            else { const a = this.ea(mode); this.push16(this.pc); this.pc = a; }
          } else if (mode !== 0) {
            const a = this.ea(mode); const d = this.d;
            this.wr16(a, d); this.nz16(d); this.cc &= ~V;
          }
          return;
        }
        case 0xe: {                 // LDS / LDX
          const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
          if (accB) this.x = m; else this.sp = m;
          this.nz16(m); this.cc &= ~V;
          return;
        }
        case 0xf: {                 // STS / STX
          if (mode === 0) return;
          const v = accB ? this.x : this.sp;
          this.wr16(this.ea(mode), v); this.nz16(v); this.cc &= ~V;
          return;
        }
      }
      const m = mode === 0 ? this.fetch() : this.rd(this.ea(mode));
      const r0 = accB ? this.b : this.a;
      let r;
      switch (lo) {
        case 0x0: r = this.sub8(r0, m, 0); break;
        case 0x1: this.sub8(r0, m, 0); return;
        case 0x2: r = this.sub8(r0, m, this.cc & C); break;
        case 0x4: r = this.logic(r0 & m); break;
        case 0x5: this.logic(r0 & m); return;
        case 0x6: r = this.logic(m); break;
        case 0x8: r = this.logic(r0 ^ m); break;
        case 0x9: r = this.add8(r0, m, this.cc & C); break;
        case 0xa: r = this.logic(r0 | m); break;
        case 0xb: r = this.add8(r0, m, 0); break;
        default: return;
      }
      if (accB) this.b = r; else this.a = r;
      return;
    }
    // 0x00-0x3f inherent
    switch (op) {
      case 0x01: break;
      case 0x04: { const d = this.d; const c = d & 1; const r = d >> 1; this.d = r; this.cc = (this.cc & ~(N | Z | V | C)) | (r ? 0 : Z) | (c ? C | V : 0); break; }
      case 0x05: { const d = this.d; const c = d & 0x8000; const r = (d << 1) & 0xffff; this.d = r; const n = r & 0x8000; this.cc = (this.cc & ~(N | Z | V | C)) | (n ? N : 0) | (r ? 0 : Z) | (c ? C : 0) | ((!!n !== !!c) ? V : 0); break; }
      case 0x06: this.cc = this.a | 0xc0; break;
      case 0x07: this.a = this.cc; break;
      case 0x08: this.x = (this.x + 1) & 0xffff; this.cc = (this.cc & ~Z) | (this.x ? 0 : Z); break;
      case 0x09: this.x = (this.x - 1) & 0xffff; this.cc = (this.cc & ~Z) | (this.x ? 0 : Z); break;
      case 0x0a: this.cc &= ~V; break;
      case 0x0b: this.cc |= V; break;
      case 0x0c: this.cc &= ~C; break;
      case 0x0d: this.cc |= C; break;
      case 0x0e: this.cc &= ~I; break;
      case 0x0f: this.cc |= I; break;
      case 0x10: this.a = this.sub8(this.a, this.b, 0); break;
      case 0x11: this.sub8(this.a, this.b, 0); break;
      case 0x16: this.b = this.logic(this.a); break;
      case 0x17: this.a = this.logic(this.b); break;
      case 0x19: {
        let a = this.a, cf = 0, adj = 0;
        const msn = a >> 4, lsn = a & 0x0f;
        if ((this.cc & H) || lsn > 9) adj |= 0x06;
        if ((this.cc & C) || msn > 9 || (msn > 8 && lsn > 9)) { adj |= 0x60; cf = 1; }
        const r = a + adj;
        this.a = r & 0xff;
        this.nz8(this.a);
        this.cc = (this.cc & ~(C | V)) | (cf || (r & 0x100) ? C : 0);
        break;
      }
      case 0x1b: this.a = this.add8(this.a, this.b, 0); break;
      case 0x30: this.x = (this.sp + 1) & 0xffff; break;
      case 0x31: this.sp = (this.sp + 1) & 0xffff; break;
      case 0x32: this.a = this.pull(); break;
      case 0x33: this.b = this.pull(); break;
      case 0x34: this.sp = (this.sp - 1) & 0xffff; break;
      case 0x35: this.sp = (this.x - 1) & 0xffff; break;
      case 0x36: this.push(this.a); break;
      case 0x37: this.push(this.b); break;
      case 0x38: this.x = this.pull16(); break;
      case 0x39: this.pc = this.pull16(); break;
      case 0x3a: this.x = (this.x + this.b) & 0xffff; break;
      case 0x3b:
        this.cc = this.pull() | 0xc0; this.b = this.pull(); this.a = this.pull();
        this.x = this.pull16(); this.pc = this.pull16();
        break;
      case 0x3c: this.push16(this.x); break;
      case 0x3d: { const r = this.a * this.b; this.d = r; this.cc = (this.cc & ~C) | (r & 0x80 ? C : 0); break; }
      case 0x3e:
        this.push16(this.pc); this.push16(this.x);
        this.push(this.a); this.push(this.b); this.push(this.cc);
        this.waiting = true;
        break;
      case 0x3f:
        this.push16(this.pc); this.push16(this.x);
        this.push(this.a); this.push(this.b); this.push(this.cc);
        this.cc |= I;
        this.pc = this.rd16(0xfffa);
        break;
      default: break;
    }
  }
}
