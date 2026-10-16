// OKI MSM5205 ADPCM speech/sample decoder.
// The VCK pin toggles at clock/prescaler; on its rising edge `onVck()` is called (games use it
// as an NMI to feed the next nibble) and on the falling edge the current nibble is decoded.

const INDEX_SHIFT = [-1, -1, -1, -1, 2, 4, 6, 8];
const DIFF = new Int32Array(49 * 16);
for (let step = 0; step < 49; step++) {
  const stepval = Math.floor(16.0 * Math.pow(11.0 / 10.0, step));
  for (let nib = 0; nib < 16; nib++) {
    const mag = ((nib & 4) ? stepval : 0) + ((nib & 2) ? stepval >> 1 : 0) + ((nib & 1) ? stepval >> 2 : 0) + (stepval >> 3);
    DIFF[step * 16 + nib] = (nib & 8) ? -mag : mag;
  }
}
const PRESCALE = [96, 48, 64, 0];

export class MSM5205 {
  constructor(clock, onVck) {
    this.clock = clock;
    this.onVck = onVck;
    this.data = 0; this.signal = 0; this.step = 0;
    this.resetLine = 0;
    this.bits = 4;
    this.prescaler = 96;
    this.phase = 0;      // time accumulated within a half period (seconds)
    this.vck = 0;
  }

  playmode(m) {
    this.prescaler = PRESCALE[m & 3];
    this.bits = (m & 4) ? 4 : 3;
  }

  reset(v) {
    this.resetLine = v ? 1 : 0;
    if (this.resetLine) { this.signal = 0; this.step = 0; }
  }

  write(v) { this.data = v & 0x0f; }

  decode() {
    if (this.resetLine) { this.signal = 0; this.step = 0; return; }
    const val = this.bits === 3 ? (this.data & 7) << 1 : this.data;
    let s = this.signal + DIFF[this.step * 16 + val];
    if (s > 2047) s = 2047; else if (s < -2048) s = -2048;
    this.signal = s;
    this.step += INDEX_SHIFT[val & 7];
    if (this.step > 48) this.step = 48; else if (this.step < 0) this.step = 0;
  }

  // advance by `seconds`; fires VCK edges as they occur
  advance(seconds) {
    if (!this.prescaler) return;   // slave / stopped mode
    const half = this.prescaler / this.clock / 2;
    this.phase += seconds;
    while (this.phase >= half) {
      this.phase -= half;
      this.vck ^= 1;
      if (this.vck) { if (this.onVck) this.onVck(); }
      else this.decode();
    }
  }

  output() { return this.signal / 2048; }
}
