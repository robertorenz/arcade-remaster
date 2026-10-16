// Intel MCS-48 (8035/8039/8048) CPU core.
// io: { rom, extRead(a), extWrite(a,v), p1Read(), p2Read(), p1Write(v), p2Write(v), t0(), t1(), busRead(), busWrite(v) }
// step() returns machine cycles used (1 machine cycle = 15 input clocks).

const CY = 0x80, AC = 0x40, F0 = 0x20, BS = 0x10;

export class I8035 {
  constructor(io) {
    this.io = io;
    this.rom = io.rom;
    this.romMask = this.rom.length - 1;
    this.ram = new Uint8Array(128);
    this.ramMask = 0x3f;
    this.reset();
  }

  reset() {
    this.pc = 0; this.a = 0; this.psw = 0x08;
    this.f1 = 0; this.a11 = 0;
    this.p1 = 0xff; this.p2 = 0xff;
    this.timer = 0; this.prescaler = 0;
    this.timerOn = false; this.counterOn = false;
    this.tf = false; this.timerIrqPending = false;
    this.xirqEn = false; this.tirqEn = false;
    this.inIrq = false; this.irqLine = false;
    this.lastT1 = 0;
  }

  setIrq(state) { this.irqLine = !!state; }

  prog(a) { return this.rom[a & this.romMask]; }
  fetch() {
    const v = this.prog(this.pc);
    this.pc = ((this.pc + 1) & 0x7ff) | (this.pc & 0x800);
    return v;
  }
  regAddr(r) { return ((this.psw & BS) ? 0x18 : 0) + r; }
  getR(r) { return this.ram[this.regAddr(r)]; }
  setR(r, v) { this.ram[this.regAddr(r)] = v & 0xff; }
  ind(r) { return this.getR(r) & this.ramMask; }

  push() {
    const sp = this.psw & 7;
    this.ram[8 + sp * 2] = this.pc & 0xff;
    this.ram[9 + sp * 2] = ((this.pc >> 8) & 0x0f) | (this.psw & 0xf0);
    this.psw = (this.psw & 0xf8) | ((sp + 1) & 7);
  }
  pull(restorePsw) {
    const sp = (this.psw - 1) & 7;
    this.psw = (this.psw & 0xf8) | sp;
    const lo = this.ram[8 + sp * 2], hi = this.ram[9 + sp * 2];
    this.pc = lo | ((hi & 0x0f) << 8);
    if (restorePsw) this.psw = (this.psw & 0x0f) | (hi & 0xf0);
  }

  add(v, c) {
    const r = this.a + v + c;
    let psw = this.psw & ~(CY | AC);
    if (r > 0xff) psw |= CY;
    if ((this.a & 0x0f) + (v & 0x0f) + c > 0x0f) psw |= AC;
    this.psw = psw;
    this.a = r & 0xff;
  }

  jcc(cond) {
    const page = this.pc & 0xf00;
    const off = this.fetch();
    if (cond) this.pc = page | off;
    return 2;
  }
  jmp(addr) { this.pc = addr | (this.inIrq ? 0 : (this.a11 ? 0x800 : 0)); }

  step() {
    // interrupts
    if (!this.inIrq) {
      if (this.irqLine && this.xirqEn) {
        this.push(); this.pc = 0x003; this.inIrq = true;
        this.tickTimer(2); return 2;
      }
      if (this.timerIrqPending && this.tirqEn) {
        this.timerIrqPending = false;
        this.push(); this.pc = 0x007; this.inIrq = true;
        this.tickTimer(2); return 2;
      }
    }
    const c = this.exec(this.fetch());
    this.tickTimer(c);
    return c;
  }

  tickTimer(c) {
    if (this.timerOn) {
      this.prescaler += c;
      while (this.prescaler >= 32) {
        this.prescaler -= 32;
        this.timer = (this.timer + 1) & 0xff;
        if (this.timer === 0) { this.tf = true; if (this.tirqEn) this.timerIrqPending = true; }
      }
    } else if (this.counterOn) {
      const t1 = this.io.t1() ? 1 : 0;
      if (this.lastT1 && !t1) {
        this.timer = (this.timer + 1) & 0xff;
        if (this.timer === 0) { this.tf = true; if (this.tirqEn) this.timerIrqPending = true; }
      }
      this.lastT1 = t1;
    }
  }

  exec(op) {
    const io = this.io;
    // register-indexed groups
    if (op >= 0x08) {
      const r = op & 7, hi = op & 0xf8;
      switch (hi) {
        case 0x18: this.setR(r, this.getR(r) + 1); return 1;              // INC Rr
        case 0x28: { const t = this.a; this.a = this.getR(r); this.setR(r, t); return 1; } // XCH A,Rr
        case 0x48: this.a |= this.getR(r); return 1;                       // ORL A,Rr
        case 0x58: this.a &= this.getR(r); return 1;                       // ANL A,Rr
        case 0x68: this.add(this.getR(r), 0); return 1;                    // ADD A,Rr
        case 0x78: this.add(this.getR(r), (this.psw & CY) ? 1 : 0); return 1; // ADDC A,Rr
        case 0xa8: this.setR(r, this.a); return 1;                         // MOV Rr,A
        case 0xb8: this.setR(r, this.fetch()); return 2;                   // MOV Rr,#data
        case 0xc8: this.setR(r, this.getR(r) - 1); return 1;              // DEC Rr
        case 0xd8: this.a ^= this.getR(r); return 1;                       // XRL A,Rr
        case 0xe8: {                                                       // DJNZ Rr,addr
          const v = (this.getR(r) - 1) & 0xff; this.setR(r, v);
          return this.jcc(v !== 0);
        }
        case 0xf8: this.a = this.getR(r); return 1;                        // MOV A,Rr
      }
    }
    // JMP / CALL page groups
    if ((op & 0x1f) === 0x04) { const lo = this.fetch(); this.jmp(((op & 0xe0) << 3) | lo); return 2; }
    if ((op & 0x1f) === 0x14) { const lo = this.fetch(); this.push(); this.jmp(((op & 0xe0) << 3) | lo); return 2; }
    // JBb
    if ((op & 0x1f) === 0x12) return this.jcc(this.a & (1 << (op >> 5)));

    switch (op) {
      case 0x00: return 1;
      case 0x02: io.busWrite(this.a); return 2;                            // OUTL BUS,A
      case 0x03: this.add(this.fetch(), 0); return 2;
      case 0x05: this.xirqEn = true; return 1;
      case 0x07: this.a = (this.a - 1) & 0xff; return 1;
      case 0x08: this.a = io.busRead() & 0xff; return 2;                   // INS A,BUS
      case 0x09: this.a = io.p1Read() & this.p1; return 2;
      case 0x0a: this.a = io.p2Read() & this.p2; return 2;
      case 0x0c: case 0x0d: case 0x0e: case 0x0f: this.a = 0; return 2;     // MOVD A,Pp (no 8243)
      case 0x10: case 0x11: { const a = this.ind(op & 1); this.ram[a] = (this.ram[a] + 1) & 0xff; return 1; }
      case 0x13: this.add(this.fetch(), (this.psw & CY) ? 1 : 0); return 2;
      case 0x15: this.xirqEn = false; return 1;
      case 0x16: { const t = this.tf; this.tf = false; return this.jcc(t); } // JTF
      case 0x17: this.a = (this.a + 1) & 0xff; return 1;
      case 0x20: case 0x21: { const a = this.ind(op & 1); const t = this.a; this.a = this.ram[a]; this.ram[a] = t; return 1; }
      case 0x23: this.a = this.fetch(); return 2;
      case 0x25: this.tirqEn = true; return 1;
      case 0x26: return this.jcc(!io.t0());
      case 0x27: this.a = 0; return 1;
      case 0x30: case 0x31: {                                              // XCHD A,@Ri
        const a = this.ind(op & 1), m = this.ram[a];
        this.ram[a] = (m & 0xf0) | (this.a & 0x0f);
        this.a = (this.a & 0xf0) | (m & 0x0f);
        return 1;
      }
      case 0x35: this.tirqEn = false; this.timerIrqPending = false; return 1;
      case 0x36: return this.jcc(io.t0());
      case 0x37: this.a ^= 0xff; return 1;
      case 0x39: this.p1 = this.a; io.p1Write(this.p1); return 2;
      case 0x3a: this.p2 = this.a; io.p2Write(this.p2); return 2;
      case 0x3c: case 0x3d: case 0x3e: case 0x3f: return 2;                // MOVD Pp,A
      case 0x40: case 0x41: this.a |= this.ram[this.ind(op & 1)]; return 1;
      case 0x42: this.a = this.timer; return 1;
      case 0x43: this.a |= this.fetch(); return 2;
      case 0x45: this.counterOn = true; this.timerOn = false; this.lastT1 = io.t1() ? 1 : 0; return 1;
      case 0x46: return this.jcc(!io.t1());
      case 0x47: this.a = ((this.a << 4) | (this.a >> 4)) & 0xff; return 1;
      case 0x50: case 0x51: this.a &= this.ram[this.ind(op & 1)]; return 1;
      case 0x53: this.a &= this.fetch(); return 2;
      case 0x55: this.timerOn = true; this.counterOn = false; this.prescaler = 0; return 1;
      case 0x56: return this.jcc(io.t1());
      case 0x57: {                                                         // DA A
        let a = this.a, psw = this.psw;
        if ((a & 0x0f) > 9 || (psw & AC)) { a += 6; if (a > 0xff) psw |= CY; a &= 0xff; }
        if ((a & 0xf0) > 0x90 || (psw & CY)) { a += 0x60; psw |= CY; a &= 0xff; }
        this.a = a; this.psw = psw; return 1;
      }
      case 0x60: case 0x61: this.add(this.ram[this.ind(op & 1)], 0); return 1;
      case 0x62: this.timer = this.a; return 1;
      case 0x65: this.timerOn = false; this.counterOn = false; return 1;
      case 0x67: { const c = this.a & 1; this.a = (this.a >> 1) | ((this.psw & CY) ? 0x80 : 0); this.psw = (this.psw & ~CY) | (c ? CY : 0); return 1; }
      case 0x70: case 0x71: this.add(this.ram[this.ind(op & 1)], (this.psw & CY) ? 1 : 0); return 1;
      case 0x75: return 1;                                                 // ENT0 CLK
      case 0x76: return this.jcc(this.f1);
      case 0x77: this.a = ((this.a >> 1) | (this.a << 7)) & 0xff; return 1;
      case 0x80: case 0x81: this.a = io.extRead(this.getR(op & 1)) & 0xff; return 2;
      case 0x83: this.pull(false); return 2;
      case 0x85: this.psw &= ~F0; return 1;
      case 0x86: return this.jcc(this.irqLine);                            // JNI
      case 0x88: io.busWrite(io.busRead() | this.fetch()); return 2;
      case 0x89: this.p1 |= this.fetch(); io.p1Write(this.p1); return 2;
      case 0x8a: this.p2 |= this.fetch(); io.p2Write(this.p2); return 2;
      case 0x8c: case 0x8d: case 0x8e: case 0x8f: return 2;
      case 0x90: case 0x91: io.extWrite(this.getR(op & 1), this.a); return 2;
      case 0x93: this.pull(true); this.inIrq = false; return 2;            // RETR
      case 0x95: this.psw ^= F0; return 1;
      case 0x96: return this.jcc(this.a !== 0);
      case 0x97: this.psw &= ~CY; return 1;
      case 0x98: io.busWrite(io.busRead() & this.fetch()); return 2;
      case 0x99: this.p1 &= this.fetch(); io.p1Write(this.p1); return 2;
      case 0x9a: this.p2 &= this.fetch(); io.p2Write(this.p2); return 2;
      case 0x9c: case 0x9d: case 0x9e: case 0x9f: return 2;
      case 0xa0: case 0xa1: this.ram[this.ind(op & 1)] = this.a; return 1;
      case 0xa3: this.a = this.prog((this.pc & 0xf00) | this.a); return 2;
      case 0xa5: this.f1 = 0; return 1;
      case 0xa7: this.psw ^= CY; return 1;
      case 0xb0: case 0xb1: this.ram[this.ind(op & 1)] = this.fetch(); return 2;
      case 0xb3: this.pc = (this.pc & 0xf00) | this.prog((this.pc & 0xf00) | this.a); return 2;
      case 0xb5: this.f1 ^= 1; return 1;
      case 0xb6: return this.jcc(this.psw & F0);
      case 0xc5: this.psw &= ~BS; return 1;
      case 0xc6: return this.jcc(this.a === 0);
      case 0xc7: this.a = this.psw | 0x08; return 1;
      case 0xd0: case 0xd1: this.a ^= this.ram[this.ind(op & 1)]; return 1;
      case 0xd3: this.a ^= this.fetch(); return 2;
      case 0xd5: this.psw |= BS; return 1;
      case 0xd7: this.psw = this.a | 0x08; return 1;
      case 0xe3: this.a = this.prog(0x300 | this.a); return 2;
      case 0xe5: this.a11 = 0; return 1;
      case 0xe6: return this.jcc(!(this.psw & CY));
      case 0xe7: this.a = ((this.a << 1) | (this.a >> 7)) & 0xff; return 1;
      case 0xf0: case 0xf1: this.a = this.ram[this.ind(op & 1)]; return 1;
      case 0xf5: this.a11 = 1; return 1;
      case 0xf6: return this.jcc(this.psw & CY);
      case 0xf7: { const c = this.a >> 7; this.a = ((this.a << 1) | ((this.psw & CY) ? 1 : 0)) & 0xff; this.psw = (this.psw & ~CY) | (c ? CY : 0); return 1; }
      default: return 1;
    }
  }
}
