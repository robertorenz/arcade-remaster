// Intel 8088 (8086 instruction set, 8-bit bus) interpreter.
// bus: { read(addr20), write(addr20, v), in(port), out(port, v) }
// Cycle counts are approximate: the 8088 is bus-bound, so each instruction costs a base amount
// plus four clocks per byte moved over the bus (opcode fetch included), plus extra for
// multiply/divide, shifts by CL and taken branches.

const CF = 0x001, PF = 0x004, AF = 0x010, ZF = 0x040, SF = 0x080, TF = 0x100, IF = 0x200, DF = 0x400, OF = 0x800;
const ES = 0, CS = 1, SS = 2, DS = 3;
const AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = i, n = 0;
  while (b) { n += b & 1; b >>= 1; }
  PARITY[i] = n & 1 ? 0 : PF;
}

export class I8088 {
  constructor(bus) {
    this.bus = bus;
    this.r = new Uint16Array(8);
    this.s = new Uint16Array(4);
    this.reset();
  }

  reset() {
    this.r.fill(0);
    this.s.fill(0);
    this.s[CS] = 0xffff;
    this.ip = 0;
    this.f = 0;
    this.halted = false;
    this.nmiPending = false;
    this.irqLine = false;
    this.irqVector = 0;
    this.seg = -1;
    this.extra = 0;
    this.bytes = 0;
  }

  get pc() { return ((this.s[CS] << 4) + this.ip) & 0xfffff; }

  nmi() { this.nmiPending = true; }
  setIrq(state, vector = this.irqVector) { this.irqLine = state; this.irqVector = vector; }

  // ---- bus helpers ------------------------------------------------------------------
  rb(seg, off) { this.bytes++; return this.bus.read(((this.s[seg] << 4) + (off & 0xffff)) & 0xfffff); }
  wb(seg, off, v) { this.bytes++; this.bus.write(((this.s[seg] << 4) + (off & 0xffff)) & 0xfffff, v & 0xff); }
  rw(seg, off) { return this.rb(seg, off) | (this.rb(seg, off + 1) << 8); }
  ww(seg, off, v) { this.wb(seg, off, v); this.wb(seg, off + 1, v >> 8); }
  fetch() { const v = this.rb(CS, this.ip); this.ip = (this.ip + 1) & 0xffff; return v; }
  fetchw() { const v = this.fetch(); return v | (this.fetch() << 8); }
  push(v) { this.r[SP] -= 2; this.ww(SS, this.r[SP], v); }
  pop() { const v = this.rw(SS, this.r[SP]); this.r[SP] += 2; return v; }

  // byte registers: 0-3 = AL CL DL BL, 4-7 = AH CH DH BH
  getR8(i) { return i < 4 ? this.r[i] & 0xff : this.r[i - 4] >> 8; }
  setR8(i, v) {
    if (i < 4) this.r[i] = (this.r[i] & 0xff00) | (v & 0xff);
    else this.r[i - 4] = (this.r[i - 4] & 0x00ff) | ((v & 0xff) << 8);
  }

  // ---- ModR/M -------------------------------------------------------------------------
  modrm() {
    const m = this.fetch();
    this.mod = m >> 6; this.reg = (m >> 3) & 7; this.rm = m & 7;
    if (this.mod === 3) return;
    const r = this.r;
    let off, seg = DS;
    switch (this.rm) {
      case 0: off = r[BX] + r[SI]; break;
      case 1: off = r[BX] + r[DI]; break;
      case 2: off = r[BP] + r[SI]; seg = SS; break;
      case 3: off = r[BP] + r[DI]; seg = SS; break;
      case 4: off = r[SI]; break;
      case 5: off = r[DI]; break;
      case 6:
        if (this.mod === 0) { off = this.fetchw(); } else { off = r[BP]; seg = SS; }
        break;
      default: off = r[BX];
    }
    if (this.mod === 1) { const d = this.fetch(); off += d < 0x80 ? d : d - 0x100; } else if (this.mod === 2) off += this.fetchw();
    this.eaOff = off & 0xffff;
    this.eaSeg = this.seg >= 0 ? this.seg : seg;
    this.extra += 7;
  }
  getRM8() { return this.mod === 3 ? this.getR8(this.rm) : this.rb(this.eaSeg, this.eaOff); }
  setRM8(v) { if (this.mod === 3) this.setR8(this.rm, v); else this.wb(this.eaSeg, this.eaOff, v); }
  getRM16() { return this.mod === 3 ? this.r[this.rm] : this.rw(this.eaSeg, this.eaOff); }
  setRM16(v) { if (this.mod === 3) this.r[this.rm] = v; else this.ww(this.eaSeg, this.eaOff, v); }

  // ---- flags ----------------------------------------------------------------------------
  szp8(v) { this.f = (this.f & ~(SF | ZF | PF)) | (v & 0x80) | (v ? 0 : ZF) | PARITY[v]; }
  szp16(v) { this.f = (this.f & ~(SF | ZF | PF)) | ((v >> 8) & 0x80) | (v ? 0 : ZF) | PARITY[v & 0xff]; }
  setF(mask, on) { if (on) this.f |= mask; else this.f &= ~mask; }

  alu8(op, a, b) {
    let res;
    switch (op) {
      case 0: case 2: { // ADD, ADC
        const c = op === 2 ? this.f & CF : 0;
        res = a + b + c;
        this.f = (this.f & ~(CF | AF | OF)) | (res > 0xff ? CF : 0) | ((a ^ b ^ res) & AF) | (((a ^ res) & (b ^ res) & 0x80) ? OF : 0);
        res &= 0xff; this.szp8(res); return res;
      }
      case 3: case 5: case 7: { // SBB, SUB, CMP
        const c = op === 3 ? this.f & CF : 0;
        res = a - b - c;
        this.f = (this.f & ~(CF | AF | OF)) | (res < 0 ? CF : 0) | ((a ^ b ^ res) & AF) | (((a ^ b) & (a ^ res) & 0x80) ? OF : 0);
        res &= 0xff; this.szp8(res); return res;
      }
      case 1: res = a | b; break;
      case 4: res = a & b; break;
      default: res = a ^ b;
    }
    this.f &= ~(CF | OF | AF);
    this.szp8(res);
    return res;
  }

  alu16(op, a, b) {
    let res;
    switch (op) {
      case 0: case 2: {
        const c = op === 2 ? this.f & CF : 0;
        res = a + b + c;
        this.f = (this.f & ~(CF | AF | OF)) | (res > 0xffff ? CF : 0) | ((a ^ b ^ res) & AF) | (((a ^ res) & (b ^ res) & 0x8000) ? OF : 0);
        res &= 0xffff; this.szp16(res); return res;
      }
      case 3: case 5: case 7: {
        const c = op === 3 ? this.f & CF : 0;
        res = a - b - c;
        this.f = (this.f & ~(CF | AF | OF)) | (res < 0 ? CF : 0) | ((a ^ b ^ res) & AF) | (((a ^ b) & (a ^ res) & 0x8000) ? OF : 0);
        res &= 0xffff; this.szp16(res); return res;
      }
      case 1: res = a | b; break;
      case 4: res = a & b; break;
      default: res = a ^ b;
    }
    this.f &= ~(CF | OF | AF);
    this.szp16(res);
    return res;
  }

  inc8(v) { const r = (v + 1) & 0xff; this.f = (this.f & ~(AF | OF)) | ((v ^ r) & AF) | (r === 0x80 ? OF : 0); this.szp8(r); return r; }
  dec8(v) { const r = (v - 1) & 0xff; this.f = (this.f & ~(AF | OF)) | ((v ^ r) & AF) | (r === 0x7f ? OF : 0); this.szp8(r); return r; }
  inc16(v) { const r = (v + 1) & 0xffff; this.f = (this.f & ~(AF | OF)) | ((v ^ r) & AF) | (r === 0x8000 ? OF : 0); this.szp16(r); return r; }
  dec16(v) { const r = (v - 1) & 0xffff; this.f = (this.f & ~(AF | OF)) | ((v ^ r) & AF) | (r === 0x7fff ? OF : 0); this.szp16(r); return r; }

  // rotates and shifts; w = 8 or 16
  shift(op, v, n, w) {
    if (n === 0) return v;
    this.extra += n * 4;
    const top = w === 8 ? 0x80 : 0x8000, mask = w === 8 ? 0xff : 0xffff;
    let f = this.f;
    switch (op) {
      case 0: // ROL
        for (let i = 0; i < n; i++) { const c = v & top ? 1 : 0; v = ((v << 1) | c) & mask; f = (f & ~CF) | c; }
        f = (f & ~OF) | (((v & top ? 1 : 0) ^ (f & CF)) ? OF : 0);
        break;
      case 1: // ROR
        for (let i = 0; i < n; i++) { const c = v & 1; v = (v >> 1) | (c ? top : 0); f = (f & ~CF) | c; }
        f = (f & ~OF) | (((v ^ (v << 1)) & top) ? OF : 0);
        break;
      case 2: // RCL
        for (let i = 0; i < n; i++) { const c = v & top ? 1 : 0; v = ((v << 1) | (f & CF)) & mask; f = (f & ~CF) | c; }
        f = (f & ~OF) | (((v & top ? 1 : 0) ^ (f & CF)) ? OF : 0);
        break;
      case 3: // RCR
        for (let i = 0; i < n; i++) { const c = v & 1; v = (v >> 1) | ((f & CF) ? top : 0); f = (f & ~CF) | c; }
        f = (f & ~OF) | (((v ^ (v << 1)) & top) ? OF : 0);
        break;
      case 4: case 6: { // SHL / SAL
        let c = 0;
        if (n <= w) c = (v >> (w - n)) & 1;
        v = n >= 32 ? 0 : (v << n) & mask;
        this.f = (f & ~(CF | OF | AF)) | c | ((((v & top) ? 1 : 0) ^ c) ? OF : 0);
        if (w === 8) this.szp8(v); else this.szp16(v);
        return v;
      }
      case 5: { // SHR
        const c = n <= w ? (v >> (n - 1)) & 1 : 0;
        const o = n === 1 && (v & top) ? OF : 0;
        v = n >= w ? 0 : v >> n;
        this.f = (f & ~(CF | OF | AF)) | c | o;
        if (w === 8) this.szp8(v); else this.szp16(v);
        return v;
      }
      default: { // SAR
        const sv = w === 8 ? (v << 24) >> 24 : (v << 16) >> 16;
        const k = Math.min(n, w);
        const c = (sv >> (k - 1)) & 1;
        v = (sv >> k) & mask;
        this.f = (f & ~(CF | OF | AF)) | c;
        if (w === 8) this.szp8(v); else this.szp16(v);
        return v;
      }
    }
    this.f = f;
    return v;
  }

  interrupt(n) {
    this.push(this.f | 0xf000);
    this.f &= ~(IF | TF);
    this.push(this.s[CS]);
    this.push(this.ip);
    this.ip = this.rw(-1, n * 4);
    this.s[CS] = this.rw(-1, n * 4 + 2);
    this.extra += 50;
  }

  cond(c) {
    const f = this.f;
    let r;
    switch (c >> 1) {
      case 0: r = f & OF; break;
      case 1: r = f & CF; break;
      case 2: r = f & ZF; break;
      case 3: r = f & (CF | ZF); break;
      case 4: r = f & SF; break;
      case 5: r = f & PF; break;
      case 6: r = !(f & SF) !== !(f & OF); break;
      default: r = (f & ZF) || (!(f & SF) !== !(f & OF));
    }
    r = !!r;
    return c & 1 ? !r : r;
  }

  jumpRel8(take) {
    const d = this.fetch();
    if (take) { this.ip = (this.ip + (d < 0x80 ? d : d - 0x100)) & 0xffff; this.extra += 12; }
  }

  // ---- string instructions ----------------------------------------------------------------
  string(op, rep) {
    const r = this.r, src = this.seg >= 0 ? this.seg : DS;
    const step = this.f & DF ? -1 : 1;
    const word = op & 1;
    const d = word ? step * 2 : step;
    const kind = op & 0xfe;  // A4 movs, A6 cmps, AA stos, AC lods, AE scas
    if (rep && r[CX] === 0) return;
    for (;;) {
      switch (kind) {
        case 0xa4:
          if (word) this.ww(ES, r[DI], this.rw(src, r[SI])); else this.wb(ES, r[DI], this.rb(src, r[SI]));
          r[SI] += d; r[DI] += d; break;
        case 0xa6:
          if (word) this.alu16(7, this.rw(src, r[SI]), this.rw(ES, r[DI])); else this.alu8(7, this.rb(src, r[SI]), this.rb(ES, r[DI]));
          r[SI] += d; r[DI] += d; break;
        case 0xaa:
          if (word) this.ww(ES, r[DI], r[AX]); else this.wb(ES, r[DI], r[AX]);
          r[DI] += d; break;
        case 0xac:
          if (word) r[AX] = this.rw(src, r[SI]); else this.setR8(0, this.rb(src, r[SI]));
          r[SI] += d; break;
        default:
          if (word) this.alu16(7, r[AX], this.rw(ES, r[DI])); else this.alu8(7, r[AX] & 0xff, this.rb(ES, r[DI]));
          r[DI] += d;
      }
      if (!rep) return;
      this.extra += 2;
      r[CX]--;
      if (r[CX] === 0) return;
      if (kind === 0xa6 || kind === 0xae) {
        const z = !!(this.f & ZF);
        if (rep === 0xf3 && !z) return;
        if (rep === 0xf2 && z) return;
      }
    }
  }

  // ---- execution ------------------------------------------------------------------------
  step() {
    this.bytes = 0; this.extra = 0;
    if (this.nmiPending) {
      this.nmiPending = false; this.halted = false;
      this.interrupt(2);
      return this.cost();
    }
    if (this.irqLine && (this.f & IF)) {
      this.halted = false;
      this.interrupt(this.irqVector);
      return this.cost();
    }
    if (this.halted) return 4;
    this.seg = -1;
    let rep = 0;
    let op;
    for (;;) {
      op = this.fetch();
      if (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e) { this.seg = (op >> 3) & 3; continue; }
      if (op === 0xf2 || op === 0xf3) { rep = op; continue; }
      if (op === 0xf0) continue;
      break;
    }
    this.exec(op, rep);
    return this.cost();
  }

  cost() { return 2 + this.bytes * 4 + this.extra; }

  exec(op, rep) {
    const r = this.r;
    if (op < 0x40 && (op & 7) < 6) {
      const alu = op >> 3;
      switch (op & 7) {
        case 0: { this.modrm(); const v = this.alu8(alu, this.getRM8(), this.getR8(this.reg)); if (alu !== 7) this.setRM8(v); return; }
        case 1: { this.modrm(); const v = this.alu16(alu, this.getRM16(), r[this.reg]); if (alu !== 7) this.setRM16(v); return; }
        case 2: { this.modrm(); const v = this.alu8(alu, this.getR8(this.reg), this.getRM8()); if (alu !== 7) this.setR8(this.reg, v); return; }
        case 3: { this.modrm(); const v = this.alu16(alu, r[this.reg], this.getRM16()); if (alu !== 7) r[this.reg] = v; return; }
        case 4: { const v = this.alu8(alu, r[AX] & 0xff, this.fetch()); if (alu !== 7) this.setR8(0, v); return; }
        default: { const v = this.alu16(alu, r[AX], this.fetchw()); if (alu !== 7) r[AX] = v; return; }
      }
    }
    switch (op) {
      case 0x06: this.push(this.s[ES]); return;
      case 0x07: this.s[ES] = this.pop(); return;
      case 0x0e: this.push(this.s[CS]); return;
      case 0x0f: this.s[CS] = this.pop(); return;
      case 0x16: this.push(this.s[SS]); return;
      case 0x17: this.s[SS] = this.pop(); return;
      case 0x1e: this.push(this.s[DS]); return;
      case 0x1f: this.s[DS] = this.pop(); return;
      case 0x27: case 0x2f: { // DAA / DAS
        let al = r[AX] & 0xff;
        const oldAl = al, oldCf = this.f & CF;
        const sub = op === 0x2f;
        if ((al & 0x0f) > 9 || (this.f & AF)) { al = sub ? al - 6 : al + 6; this.f |= AF; } else this.f &= ~AF;
        if (oldAl > 0x99 || oldCf) { al = sub ? al - 0x60 : al + 0x60; this.f |= CF; } else this.f &= ~CF;
        al &= 0xff;
        this.setR8(0, al); this.szp8(al);
        return;
      }
      case 0x37: case 0x3f: { // AAA / AAS
        if ((r[AX] & 0x0f) > 9 || (this.f & AF)) {
          if (op === 0x37) { r[AX] += 0x106; } else { r[AX] = ((r[AX] - 6) & 0xff) | (((r[AX] >> 8) - 1) & 0xff) << 8; }
          this.f |= AF | CF;
        } else this.f &= ~(AF | CF);
        r[AX] &= 0xff0f;
        return;
      }
    }
    if (op >= 0x40 && op < 0x48) { r[op & 7] = this.inc16(r[op & 7]); return; }
    if (op >= 0x48 && op < 0x50) { r[op & 7] = this.dec16(r[op & 7]); return; }
    if (op >= 0x50 && op < 0x58) {
      if (op === 0x54) { r[SP] -= 2; this.ww(SS, r[SP], r[SP]); } else this.push(r[op & 7]);
      return;
    }
    if (op >= 0x58 && op < 0x60) { const v = this.pop(); r[op & 7] = v; return; }
    if (op >= 0x60 && op < 0x80) { this.jumpRel8(this.cond(op & 15)); return; }
    if (op >= 0x90 && op < 0x98) { const t = r[AX]; r[AX] = r[op & 7]; r[op & 7] = t; return; }
    if (op >= 0xb0 && op < 0xb8) { this.setR8(op & 7, this.fetch()); return; }
    if (op >= 0xb8 && op < 0xc0) { r[op & 7] = this.fetchw(); return; }
    if (op >= 0xd8 && op < 0xe0) { this.modrm(); return; }   // ESC (no coprocessor)

    switch (op) {
      case 0x80: case 0x82: { this.modrm(); const b = this.fetch(); const v = this.alu8(this.reg, this.getRM8(), b); if (this.reg !== 7) this.setRM8(v); return; }
      case 0x81: { this.modrm(); const b = this.fetchw(); const v = this.alu16(this.reg, this.getRM16(), b); if (this.reg !== 7) this.setRM16(v); return; }
      case 0x83: { this.modrm(); let b = this.fetch(); if (b & 0x80) b |= 0xff00; const v = this.alu16(this.reg, this.getRM16(), b); if (this.reg !== 7) this.setRM16(v); return; }
      case 0x84: this.modrm(); this.alu8(4, this.getRM8(), this.getR8(this.reg)); return;
      case 0x85: this.modrm(); this.alu16(4, this.getRM16(), r[this.reg]); return;
      case 0x86: { this.modrm(); const a = this.getRM8(); this.setRM8(this.getR8(this.reg)); this.setR8(this.reg, a); return; }
      case 0x87: { this.modrm(); const a = this.getRM16(); this.setRM16(r[this.reg]); r[this.reg] = a; return; }
      case 0x88: this.modrm(); this.setRM8(this.getR8(this.reg)); return;
      case 0x89: this.modrm(); this.setRM16(r[this.reg]); return;
      case 0x8a: this.modrm(); this.setR8(this.reg, this.getRM8()); return;
      case 0x8b: this.modrm(); r[this.reg] = this.getRM16(); return;
      case 0x8c: this.modrm(); this.setRM16(this.s[this.reg & 3]); return;
      case 0x8d: this.modrm(); r[this.reg] = this.eaOff; return;
      case 0x8e: this.modrm(); this.s[this.reg & 3] = this.getRM16(); return;
      case 0x8f: { const v = this.pop(); this.modrm(); this.setRM16(v); return; }
      case 0x98: r[AX] = (r[AX] & 0x80) ? r[AX] | 0xff00 : r[AX] & 0xff; return;
      case 0x99: r[DX] = (r[AX] & 0x8000) ? 0xffff : 0; return;
      case 0x9a: { const o = this.fetchw(), sg = this.fetchw(); this.push(this.s[CS]); this.push(this.ip); this.ip = o; this.s[CS] = sg; this.extra += 20; return; }
      case 0x9b: return;
      case 0x9c: this.push(this.f | 0xf000); return;
      case 0x9d: this.f = this.pop() & 0x0fd5 | 0x0002; return;
      case 0x9e: this.f = (this.f & 0xff00) | ((r[AX] >> 8) & 0xd5) | 2; return;
      case 0x9f: this.setR8(4, (this.f & 0xd5) | 2); return;
      case 0xa0: this.setR8(0, this.rb(this.seg >= 0 ? this.seg : DS, this.fetchw())); return;
      case 0xa1: r[AX] = this.rw(this.seg >= 0 ? this.seg : DS, this.fetchw()); return;
      case 0xa2: this.wb(this.seg >= 0 ? this.seg : DS, this.fetchw(), r[AX]); return;
      case 0xa3: this.ww(this.seg >= 0 ? this.seg : DS, this.fetchw(), r[AX]); return;
      case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
        this.string(op, rep); return;
      case 0xa8: this.alu8(4, r[AX] & 0xff, this.fetch()); return;
      case 0xa9: this.alu16(4, r[AX], this.fetchw()); return;
      case 0xc0: case 0xc2: { const n = this.fetchw(); this.ip = this.pop(); r[SP] += n; this.extra += 8; return; }
      case 0xc1: case 0xc3: this.ip = this.pop(); this.extra += 8; return;
      case 0xc4: case 0xc5: {
        this.modrm();
        r[this.reg] = this.rw(this.eaSeg, this.eaOff);
        this.s[op === 0xc4 ? ES : DS] = this.rw(this.eaSeg, this.eaOff + 2);
        return;
      }
      case 0xc6: this.modrm(); this.setRM8(this.fetch()); return;
      case 0xc7: this.modrm(); this.setRM16(this.fetchw()); return;
      case 0xc8: case 0xca: { const n = this.fetchw(); this.ip = this.pop(); this.s[CS] = this.pop(); r[SP] += n; this.extra += 12; return; }
      case 0xc9: case 0xcb: this.ip = this.pop(); this.s[CS] = this.pop(); this.extra += 12; return;
      case 0xcc: this.interrupt(3); return;
      case 0xcd: this.interrupt(this.fetch()); return;
      case 0xce: if (this.f & OF) this.interrupt(4); return;
      case 0xcf: this.ip = this.pop(); this.s[CS] = this.pop(); this.f = this.pop() & 0x0fd5 | 2; this.extra += 12; return;
      case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
        this.modrm();
        const n = op & 2 ? r[CX] & 0xff : 1;
        if (op & 1) this.setRM16(this.shift(this.reg, this.getRM16(), n, 16));
        else this.setRM8(this.shift(this.reg, this.getRM8(), n, 8));
        return;
      }
      case 0xd4: { // AAM
        const b = this.fetch();
        if (!b) { this.interrupt(0); return; }
        const al = r[AX] & 0xff;
        r[AX] = ((Math.floor(al / b) & 0xff) << 8) | (al % b);
        this.szp8(r[AX] & 0xff); this.extra += 80;
        return;
      }
      case 0xd5: { // AAD
        const b = this.fetch();
        const al = ((r[AX] >> 8) * b + (r[AX] & 0xff)) & 0xff;
        r[AX] = al; this.szp8(al); this.extra += 55;
        return;
      }
      case 0xd6: this.setR8(0, this.f & CF ? 0xff : 0); return;
      case 0xd7: this.setR8(0, this.rb(this.seg >= 0 ? this.seg : DS, r[BX] + (r[AX] & 0xff))); return;
      case 0xe0: { r[CX]--; this.jumpRel8(r[CX] !== 0 && !(this.f & ZF)); return; }
      case 0xe1: { r[CX]--; this.jumpRel8(r[CX] !== 0 && !!(this.f & ZF)); return; }
      case 0xe2: { r[CX]--; this.jumpRel8(r[CX] !== 0); return; }
      case 0xe3: this.jumpRel8(r[CX] === 0); return;
      case 0xe4: this.setR8(0, this.bus.in(this.fetch())); return;
      case 0xe5: { const p = this.fetch(); r[AX] = this.bus.in(p) | (this.bus.in(p + 1) << 8); return; }
      case 0xe6: this.bus.out(this.fetch(), r[AX] & 0xff); return;
      case 0xe7: { const p = this.fetch(); this.bus.out(p, r[AX] & 0xff); this.bus.out(p + 1, r[AX] >> 8); return; }
      case 0xe8: { const d = this.fetchw(); this.push(this.ip); this.ip = (this.ip + d) & 0xffff; this.extra += 12; return; }
      case 0xe9: { const d = this.fetchw(); this.ip = (this.ip + d) & 0xffff; this.extra += 12; return; }
      case 0xea: { const o = this.fetchw(), sg = this.fetchw(); this.ip = o; this.s[CS] = sg; this.extra += 12; return; }
      case 0xeb: this.jumpRel8(true); return;
      case 0xec: this.setR8(0, this.bus.in(r[DX])); return;
      case 0xed: r[AX] = this.bus.in(r[DX]) | (this.bus.in(r[DX] + 1) << 8); return;
      case 0xee: this.bus.out(r[DX], r[AX] & 0xff); return;
      case 0xef: this.bus.out(r[DX], r[AX] & 0xff); this.bus.out(r[DX] + 1, r[AX] >> 8); return;
      case 0xf4: this.halted = true; return;
      case 0xf5: this.f ^= CF; return;
      case 0xf6: this.group3(false); return;
      case 0xf7: this.group3(true); return;
      case 0xf8: this.f &= ~CF; return;
      case 0xf9: this.f |= CF; return;
      case 0xfa: this.f &= ~IF; return;
      case 0xfb: this.f |= IF; return;
      case 0xfc: this.f &= ~DF; return;
      case 0xfd: this.f |= DF; return;
      case 0xfe: {
        this.modrm();
        if (this.reg === 0) this.setRM8(this.inc8(this.getRM8()));
        else if (this.reg === 1) this.setRM8(this.dec8(this.getRM8()));
        return;
      }
      case 0xff: {
        this.modrm();
        switch (this.reg) {
          case 0: this.setRM16(this.inc16(this.getRM16())); return;
          case 1: this.setRM16(this.dec16(this.getRM16())); return;
          case 2: { const t = this.getRM16(); this.push(this.ip); this.ip = t; this.extra += 12; return; }
          case 3: { const o = this.rw(this.eaSeg, this.eaOff), sg = this.rw(this.eaSeg, this.eaOff + 2); this.push(this.s[CS]); this.push(this.ip); this.ip = o; this.s[CS] = sg; this.extra += 20; return; }
          case 4: this.ip = this.getRM16(); this.extra += 12; return;
          case 5: { const o = this.rw(this.eaSeg, this.eaOff), sg = this.rw(this.eaSeg, this.eaOff + 2); this.ip = o; this.s[CS] = sg; this.extra += 12; return; }
          default: this.push(this.getRM16()); return;
        }
      }
    }
    // remaining undefined opcodes behave as NOPs
  }

  group3(word) {
    const r = this.r;
    this.modrm();
    const v = word ? this.getRM16() : this.getRM8();
    switch (this.reg) {
      case 0: case 1:
        if (word) this.alu16(4, v, this.fetchw()); else this.alu8(4, v, this.fetch());
        return;
      case 2: if (word) this.setRM16(~v & 0xffff); else this.setRM8(~v & 0xff); return;
      case 3: {
        if (word) { const res = this.alu16(5, 0, v); this.setRM16(res); } else { const res = this.alu8(5, 0, v); this.setRM8(res); }
        this.setF(CF, v !== 0);
        return;
      }
      case 4: { // MUL
        if (word) {
          const p = r[AX] * v;
          r[AX] = p & 0xffff; r[DX] = Math.floor(p / 0x10000) & 0xffff;
          this.setF(CF | OF, r[DX] !== 0); this.extra += 118;
        } else {
          r[AX] = (r[AX] & 0xff) * v;
          this.setF(CF | OF, (r[AX] & 0xff00) !== 0); this.extra += 70;
        }
        this.f &= ~ZF;
        return;
      }
      case 5: { // IMUL
        if (word) {
          const p = ((r[AX] << 16) >> 16) * ((v << 16) >> 16);
          r[AX] = p & 0xffff; r[DX] = (p >> 16) & 0xffff;
          this.setF(CF | OF, p !== ((p << 16) >> 16)); this.extra += 128;
        } else {
          const p = (((r[AX] & 0xff) << 24) >> 24) * ((v << 24) >> 24);
          r[AX] = p & 0xffff;
          this.setF(CF | OF, p !== ((p << 24) >> 24)); this.extra += 80;
        }
        return;
      }
      case 6: { // DIV
        if (!v) { this.interrupt(0); return; }
        if (word) {
          const n = r[DX] * 0x10000 + r[AX];
          const q = Math.floor(n / v);
          if (q > 0xffff) { this.interrupt(0); return; }
          r[DX] = n % v; r[AX] = q; this.extra += 144;
        } else {
          const n = r[AX], q = Math.floor(n / v);
          if (q > 0xff) { this.interrupt(0); return; }
          r[AX] = ((n % v) << 8) | q; this.extra += 80;
        }
        return;
      }
      default: { // IDIV
        if (!v) { this.interrupt(0); return; }
        if (word) {
          const n = ((r[DX] << 16) | r[AX]) >> 0, d = (v << 16) >> 16;
          const q = Math.trunc(n / d);
          if (q > 0x7fff || q < -0x8000) { this.interrupt(0); return; }
          r[AX] = q & 0xffff; r[DX] = (n - q * d) & 0xffff; this.extra += 165;
        } else {
          const n = (r[AX] << 16) >> 16, d = (v << 24) >> 24;
          const q = Math.trunc(n / d);
          if (q > 0x7f || q < -0x80) { this.interrupt(0); return; }
          r[AX] = (((n - q * d) & 0xff) << 8) | (q & 0xff); this.extra += 100;
        }
      }
    }
  }
}
