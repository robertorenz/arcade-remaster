// NMOS 6502 interpreter (documented instruction set, decimal mode; undocumented opcodes act as NOPs).
// bus: { read(addr), write(addr, v) }

const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

// addressing modes
const IMP = 0, IMM = 1, ZP = 2, ZPX = 3, ZPY = 4, ABS = 5, ABX = 6, ABY = 7, IND = 8, IZX = 9, IZY = 10, REL = 11, ACC = 12;

// [mnemonic, mode, cycles] for the documented opcodes
const OPS = {
  0x69: ['ADC', IMM, 2], 0x65: ['ADC', ZP, 3], 0x75: ['ADC', ZPX, 4], 0x6d: ['ADC', ABS, 4], 0x7d: ['ADC', ABX, 4], 0x79: ['ADC', ABY, 4], 0x61: ['ADC', IZX, 6], 0x71: ['ADC', IZY, 5],
  0x29: ['AND', IMM, 2], 0x25: ['AND', ZP, 3], 0x35: ['AND', ZPX, 4], 0x2d: ['AND', ABS, 4], 0x3d: ['AND', ABX, 4], 0x39: ['AND', ABY, 4], 0x21: ['AND', IZX, 6], 0x31: ['AND', IZY, 5],
  0x0a: ['ASL', ACC, 2], 0x06: ['ASL', ZP, 5], 0x16: ['ASL', ZPX, 6], 0x0e: ['ASL', ABS, 6], 0x1e: ['ASL', ABX, 7],
  0x90: ['BCC', REL, 2], 0xb0: ['BCS', REL, 2], 0xf0: ['BEQ', REL, 2], 0x30: ['BMI', REL, 2], 0xd0: ['BNE', REL, 2], 0x10: ['BPL', REL, 2], 0x50: ['BVC', REL, 2], 0x70: ['BVS', REL, 2],
  0x24: ['BIT', ZP, 3], 0x2c: ['BIT', ABS, 4], 0x00: ['BRK', IMP, 7],
  0x18: ['CLC', IMP, 2], 0xd8: ['CLD', IMP, 2], 0x58: ['CLI', IMP, 2], 0xb8: ['CLV', IMP, 2],
  0xc9: ['CMP', IMM, 2], 0xc5: ['CMP', ZP, 3], 0xd5: ['CMP', ZPX, 4], 0xcd: ['CMP', ABS, 4], 0xdd: ['CMP', ABX, 4], 0xd9: ['CMP', ABY, 4], 0xc1: ['CMP', IZX, 6], 0xd1: ['CMP', IZY, 5],
  0xe0: ['CPX', IMM, 2], 0xe4: ['CPX', ZP, 3], 0xec: ['CPX', ABS, 4], 0xc0: ['CPY', IMM, 2], 0xc4: ['CPY', ZP, 3], 0xcc: ['CPY', ABS, 4],
  0xc6: ['DEC', ZP, 5], 0xd6: ['DEC', ZPX, 6], 0xce: ['DEC', ABS, 6], 0xde: ['DEC', ABX, 7], 0xca: ['DEX', IMP, 2], 0x88: ['DEY', IMP, 2],
  0x49: ['EOR', IMM, 2], 0x45: ['EOR', ZP, 3], 0x55: ['EOR', ZPX, 4], 0x4d: ['EOR', ABS, 4], 0x5d: ['EOR', ABX, 4], 0x59: ['EOR', ABY, 4], 0x41: ['EOR', IZX, 6], 0x51: ['EOR', IZY, 5],
  0xe6: ['INC', ZP, 5], 0xf6: ['INC', ZPX, 6], 0xee: ['INC', ABS, 6], 0xfe: ['INC', ABX, 7], 0xe8: ['INX', IMP, 2], 0xc8: ['INY', IMP, 2],
  0x4c: ['JMP', ABS, 3], 0x6c: ['JMP', IND, 5], 0x20: ['JSR', ABS, 6],
  0xa9: ['LDA', IMM, 2], 0xa5: ['LDA', ZP, 3], 0xb5: ['LDA', ZPX, 4], 0xad: ['LDA', ABS, 4], 0xbd: ['LDA', ABX, 4], 0xb9: ['LDA', ABY, 4], 0xa1: ['LDA', IZX, 6], 0xb1: ['LDA', IZY, 5],
  0xa2: ['LDX', IMM, 2], 0xa6: ['LDX', ZP, 3], 0xb6: ['LDX', ZPY, 4], 0xae: ['LDX', ABS, 4], 0xbe: ['LDX', ABY, 4],
  0xa0: ['LDY', IMM, 2], 0xa4: ['LDY', ZP, 3], 0xb4: ['LDY', ZPX, 4], 0xac: ['LDY', ABS, 4], 0xbc: ['LDY', ABX, 4],
  0x4a: ['LSR', ACC, 2], 0x46: ['LSR', ZP, 5], 0x56: ['LSR', ZPX, 6], 0x4e: ['LSR', ABS, 6], 0x5e: ['LSR', ABX, 7],
  0xea: ['NOP', IMP, 2],
  0x09: ['ORA', IMM, 2], 0x05: ['ORA', ZP, 3], 0x15: ['ORA', ZPX, 4], 0x0d: ['ORA', ABS, 4], 0x1d: ['ORA', ABX, 4], 0x19: ['ORA', ABY, 4], 0x01: ['ORA', IZX, 6], 0x11: ['ORA', IZY, 5],
  0x48: ['PHA', IMP, 3], 0x08: ['PHP', IMP, 3], 0x68: ['PLA', IMP, 4], 0x28: ['PLP', IMP, 4],
  0x2a: ['ROL', ACC, 2], 0x26: ['ROL', ZP, 5], 0x36: ['ROL', ZPX, 6], 0x2e: ['ROL', ABS, 6], 0x3e: ['ROL', ABX, 7],
  0x6a: ['ROR', ACC, 2], 0x66: ['ROR', ZP, 5], 0x76: ['ROR', ZPX, 6], 0x6e: ['ROR', ABS, 6], 0x7e: ['ROR', ABX, 7],
  0x40: ['RTI', IMP, 6], 0x60: ['RTS', IMP, 6],
  0xe9: ['SBC', IMM, 2], 0xe5: ['SBC', ZP, 3], 0xf5: ['SBC', ZPX, 4], 0xed: ['SBC', ABS, 4], 0xfd: ['SBC', ABX, 4], 0xf9: ['SBC', ABY, 4], 0xe1: ['SBC', IZX, 6], 0xf1: ['SBC', IZY, 5],
  0x38: ['SEC', IMP, 2], 0xf8: ['SED', IMP, 2], 0x78: ['SEI', IMP, 2],
  0x85: ['STA', ZP, 3], 0x95: ['STA', ZPX, 4], 0x8d: ['STA', ABS, 4], 0x9d: ['STA', ABX, 5], 0x99: ['STA', ABY, 5], 0x81: ['STA', IZX, 6], 0x91: ['STA', IZY, 6],
  0x86: ['STX', ZP, 3], 0x96: ['STX', ZPY, 4], 0x8e: ['STX', ABS, 4], 0x84: ['STY', ZP, 3], 0x94: ['STY', ZPX, 4], 0x8c: ['STY', ABS, 4],
  0xaa: ['TAX', IMP, 2], 0xa8: ['TAY', IMP, 2], 0xba: ['TSX', IMP, 2], 0x8a: ['TXA', IMP, 2], 0x9a: ['TXS', IMP, 2], 0x98: ['TYA', IMP, 2],
};

// undocumented opcode lengths (so they can be skipped as NOPs)
function undocMode(op) {
  const lo = op & 0x1f;
  if (lo === 0x00 || lo === 0x02 || lo === 0x09 || lo === 0x0b) return IMM;
  if (lo === 0x01 || lo === 0x03 || lo === 0x11 || lo === 0x13) return IZX;
  if (lo === 0x04 || lo === 0x05 || lo === 0x06 || lo === 0x07) return ZP;
  if (lo >= 0x14 && lo <= 0x17) return ZPX;
  if (lo === 0x0c || lo === 0x0d || lo === 0x0e || lo === 0x0f || lo >= 0x18) return ABS;
  return IMP;
}

const TABLE = new Array(256);
for (let op = 0; op < 256; op++) TABLE[op] = OPS[op] || ['NOP', undocMode(op), 2];

export class M6502 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xfd; this.p = U | I; this.pc = 0;
    this.irqLine = false; this.nmiLine = false; this.nmiPending = false;
  }

  reset() {
    this.sp = 0xfd; this.p = U | I;
    this.pc = this.read16(0xfffc);
    this.nmiPending = false;
  }

  read(a) { return this.bus.read(a & 0xffff); }
  write(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  read16(a) { return this.read(a) | (this.read(a + 1) << 8); }

  setIrq(s) { this.irqLine = s; }
  // NMI is edge triggered
  setNmi(s) { if (s && !this.nmiLine) this.nmiPending = true; this.nmiLine = s; }

  push(v) { this.write(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xff; }
  pull() { this.sp = (this.sp + 1) & 0xff; return this.read(0x100 | this.sp); }
  nz(v) { this.p = (this.p & ~(N | Z)) | (v & N) | (v ? 0 : Z); return v; }

  interrupt(vec, brk) {
    this.push(this.pc >> 8); this.push(this.pc & 0xff);
    this.push((this.p | U) & (brk ? 0xff : ~B));
    this.p |= I;
    this.pc = this.read16(vec);
    return 7;
  }

  adc(v) {
    const c = this.p & C;
    if (this.p & D) {
      let lo = (this.a & 0x0f) + (v & 0x0f) + c;
      let hi = (this.a >> 4) + (v >> 4);
      if (lo > 9) { lo += 6; hi++; }
      const bin = (this.a + v + c) & 0xff;
      this.p = (this.p & ~(Z | N | V | C)) | (bin ? 0 : Z);
      if (hi & 8) this.p |= N;
      if (~(this.a ^ v) & (this.a ^ (hi << 4)) & 0x80) this.p |= V;
      if (hi > 9) hi += 6;
      if (hi > 15) this.p |= C;
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
      return;
    }
    const r = this.a + v + c;
    this.p = (this.p & ~(C | V)) | (r > 0xff ? C : 0) | ((~(this.a ^ v) & (this.a ^ r) & 0x80) ? V : 0);
    this.a = this.nz(r & 0xff);
  }

  sbc(v) {
    const c = this.p & C ? 0 : 1;
    const r = this.a - v - c;
    if (this.p & D) {
      let lo = (this.a & 0x0f) - (v & 0x0f) - c;
      let hi = (this.a >> 4) - (v >> 4);
      if (lo & 0x10) { lo -= 6; hi--; }
      if (hi & 0x10) hi -= 6;
      this.p = (this.p & ~(C | V | Z | N)) | (r < 0 ? 0 : C) | (((this.a ^ v) & (this.a ^ r) & 0x80) ? V : 0);
      this.nz(r & 0xff);
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
      return;
    }
    this.p = (this.p & ~(C | V)) | (r < 0 ? 0 : C) | (((this.a ^ v) & (this.a ^ r) & 0x80) ? V : 0);
    this.a = this.nz(r & 0xff);
  }

  cmp(reg, v) { const r = reg - v; this.p = (this.p & ~C) | (r >= 0 ? C : 0); this.nz(r & 0xff); }

  step() {
    if (this.nmiPending) { this.nmiPending = false; return this.interrupt(0xfffa, false); }
    if (this.irqLine && !(this.p & I)) return this.interrupt(0xfffe, false);
    const op = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const [mn, mode, base] = TABLE[op];
    let cyc = base, addr = 0;
    switch (mode) {
      case IMM: addr = this.pc; this.pc = (this.pc + 1) & 0xffff; break;
      case ZP: addr = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; break;
      case ZPX: addr = (this.read(this.pc) + this.x) & 0xff; this.pc = (this.pc + 1) & 0xffff; break;
      case ZPY: addr = (this.read(this.pc) + this.y) & 0xff; this.pc = (this.pc + 1) & 0xffff; break;
      case ABS: addr = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff; break;
      case ABX: case ABY: {
        const b = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff;
        addr = (b + (mode === ABX ? this.x : this.y)) & 0xffff;
        if ((b & 0xff00) !== (addr & 0xff00) && base === 4) cyc++;
        break;
      }
      case IND: {
        const p = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff;
        addr = this.read(p) | (this.read((p & 0xff00) | ((p + 1) & 0xff)) << 8);
        break;
      }
      case IZX: { const z = (this.read(this.pc) + this.x) & 0xff; this.pc = (this.pc + 1) & 0xffff; addr = this.read(z) | (this.read((z + 1) & 0xff) << 8); break; }
      case IZY: {
        const z = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff;
        const b = this.read(z) | (this.read((z + 1) & 0xff) << 8);
        addr = (b + this.y) & 0xffff;
        if ((b & 0xff00) !== (addr & 0xff00) && base === 5) cyc++;
        break;
      }
      case REL: { const d = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; addr = (this.pc + (d < 0x80 ? d : d - 0x100)) & 0xffff; break; }
    }
    const branch = cond => {
      if (!cond) return;
      cyc += (this.pc & 0xff00) !== (addr & 0xff00) ? 2 : 1;
      this.pc = addr;
    };
    const rmw = fn => {
      if (mode === ACC) { this.a = this.nz(fn(this.a)); return; }
      const v = this.read(addr);
      this.write(addr, v);
      this.write(addr, this.nz(fn(v)));
    };
    switch (mn) {
      case 'ADC': this.adc(this.read(addr)); break;
      case 'SBC': this.sbc(this.read(addr)); break;
      case 'AND': this.a = this.nz(this.a & this.read(addr)); break;
      case 'ORA': this.a = this.nz(this.a | this.read(addr)); break;
      case 'EOR': this.a = this.nz(this.a ^ this.read(addr)); break;
      case 'ASL': rmw(v => { this.p = (this.p & ~C) | (v >> 7); return (v << 1) & 0xff; }); break;
      case 'LSR': rmw(v => { this.p = (this.p & ~C) | (v & 1); return v >> 1; }); break;
      case 'ROL': rmw(v => { const c = this.p & C; this.p = (this.p & ~C) | (v >> 7); return ((v << 1) | c) & 0xff; }); break;
      case 'ROR': rmw(v => { const c = this.p & C; this.p = (this.p & ~C) | (v & 1); return (v >> 1) | (c << 7); }); break;
      case 'INC': rmw(v => (v + 1) & 0xff); break;
      case 'DEC': rmw(v => (v - 1) & 0xff); break;
      case 'BCC': branch(!(this.p & C)); break;
      case 'BCS': branch(this.p & C); break;
      case 'BEQ': branch(this.p & Z); break;
      case 'BNE': branch(!(this.p & Z)); break;
      case 'BMI': branch(this.p & N); break;
      case 'BPL': branch(!(this.p & N)); break;
      case 'BVS': branch(this.p & V); break;
      case 'BVC': branch(!(this.p & V)); break;
      case 'BIT': { const v = this.read(addr); this.p = (this.p & ~(N | V | Z)) | (v & (N | V)) | ((v & this.a) ? 0 : Z); break; }
      case 'BRK': this.pc = (this.pc + 1) & 0xffff; this.interrupt(0xfffe, true); break;
      case 'CLC': this.p &= ~C; break;
      case 'CLD': this.p &= ~D; break;
      case 'CLI': this.p &= ~I; break;
      case 'CLV': this.p &= ~V; break;
      case 'SEC': this.p |= C; break;
      case 'SED': this.p |= D; break;
      case 'SEI': this.p |= I; break;
      case 'CMP': this.cmp(this.a, this.read(addr)); break;
      case 'CPX': this.cmp(this.x, this.read(addr)); break;
      case 'CPY': this.cmp(this.y, this.read(addr)); break;
      case 'DEX': this.x = this.nz((this.x - 1) & 0xff); break;
      case 'DEY': this.y = this.nz((this.y - 1) & 0xff); break;
      case 'INX': this.x = this.nz((this.x + 1) & 0xff); break;
      case 'INY': this.y = this.nz((this.y + 1) & 0xff); break;
      case 'JMP': this.pc = addr; break;
      case 'JSR': { const ret = (this.pc - 1) & 0xffff; this.push(ret >> 8); this.push(ret & 0xff); this.pc = addr; break; }
      case 'RTS': this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff; break;
      case 'RTI': this.p = (this.pull() & ~B) | U; this.pc = this.pull() | (this.pull() << 8); break;
      case 'LDA': this.a = this.nz(this.read(addr)); break;
      case 'LDX': this.x = this.nz(this.read(addr)); break;
      case 'LDY': this.y = this.nz(this.read(addr)); break;
      case 'STA': this.write(addr, this.a); break;
      case 'STX': this.write(addr, this.x); break;
      case 'STY': this.write(addr, this.y); break;
      case 'PHA': this.push(this.a); break;
      case 'PHP': this.push(this.p | B | U); break;
      case 'PLA': this.a = this.nz(this.pull()); break;
      case 'PLP': this.p = (this.pull() & ~B) | U; break;
      case 'TAX': this.x = this.nz(this.a); break;
      case 'TAY': this.y = this.nz(this.a); break;
      case 'TSX': this.x = this.nz(this.sp); break;
      case 'TXA': this.a = this.nz(this.x); break;
      case 'TXS': this.sp = this.x; break;
      case 'TYA': this.a = this.nz(this.y); break;
      default: break;  // NOP
    }
    return cyc;
  }
}
