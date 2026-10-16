// Motorola 6821 Peripheral Interface Adapter.
// cfg: { readA(), readB(), writeA(v), writeB(v), irqA(state), irqB(state), cb2(state), ca2(state) }

export class PIA6821 {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.ora = 0; this.ddra = 0; this.cra = 0;
    this.orb = 0; this.ddrb = 0; this.crb = 0;
    this.ca1 = 0; this.cb1 = 0;
    this.inB = 0xff;           // externally latched port B input (if no readB callback)
    this.irqAOut = false; this.irqBOut = false;
  }

  updateIrq() {
    const a = !!((this.cra & 0x80) && (this.cra & 0x01)) || !!((this.cra & 0x40) && (this.cra & 0x08) && !(this.cra & 0x20));
    const b = !!((this.crb & 0x80) && (this.crb & 0x01)) || !!((this.crb & 0x40) && (this.crb & 0x08) && !(this.crb & 0x20));
    if (a !== this.irqAOut) { this.irqAOut = a; if (this.cfg.irqA) this.cfg.irqA(a); }
    if (b !== this.irqBOut) { this.irqBOut = b; if (this.cfg.irqB) this.cfg.irqB(b); }
  }

  outA() { return (this.ora & this.ddra) | (~this.ddra & 0xff); }
  outB() { return (this.orb & this.ddrb) | (~this.ddrb & 0xff); }

  read(r) {
    switch (r & 3) {
      case 0:
        if (this.cra & 4) {
          const pins = this.cfg.readA ? this.cfg.readA() : 0xff;
          this.cra &= 0x3f; this.updateIrq();
          return ((pins & ~this.ddra) | (this.ora & this.ddra)) & 0xff;
        }
        return this.ddra;
      case 1: return this.cra;
      case 2:
        if (this.crb & 4) {
          const pins = this.cfg.readB ? this.cfg.readB() : this.inB;
          this.crb &= 0x3f; this.updateIrq();
          return ((pins & ~this.ddrb) | (this.orb & this.ddrb)) & 0xff;
        }
        return this.ddrb;
      default: return this.crb;
    }
  }

  write(r, v) {
    v &= 0xff;
    switch (r & 3) {
      case 0:
        if (this.cra & 4) { this.ora = v; if (this.cfg.writeA) this.cfg.writeA(this.outA()); }
        else { this.ddra = v; if (this.cfg.writeA) this.cfg.writeA(this.outA()); }
        break;
      case 1:
        this.cra = (this.cra & 0xc0) | (v & 0x3f);
        if ((v & 0x30) === 0x30 && this.cfg.ca2) this.cfg.ca2((v >> 3) & 1);
        this.updateIrq();
        break;
      case 2:
        if (this.crb & 4) { this.orb = v; if (this.cfg.writeB) this.cfg.writeB(this.outB()); }
        else { this.ddrb = v; if (this.cfg.writeB) this.cfg.writeB(this.outB()); }
        break;
      default:
        this.crb = (this.crb & 0xc0) | (v & 0x3f);
        if ((v & 0x30) === 0x30 && this.cfg.cb2) this.cfg.cb2((v >> 3) & 1);
        this.updateIrq();
    }
  }

  // control line inputs; CRx bit 1 selects the active edge (1 = rising)
  ca1W(level) {
    level = level ? 1 : 0;
    if (level !== this.ca1) {
      const rising = level === 1;
      if (rising === !!(this.cra & 0x02)) { this.cra |= 0x80; this.updateIrq(); }
      this.ca1 = level;
    }
  }
  cb1W(level) {
    level = level ? 1 : 0;
    if (level !== this.cb1) {
      const rising = level === 1;
      if (rising === !!(this.crb & 0x02)) { this.crb |= 0x80; this.updateIrq(); }
      this.cb1 = level;
    }
  }
  portBIn(v) { this.inB = v & 0xff; }
}
