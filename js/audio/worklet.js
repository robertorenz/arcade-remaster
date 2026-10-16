// AudioWorklet that plays sample blocks pushed from the emulator.
class EmuFeeder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.pos = 0;
    this.queued = 0;
    this.maxQueued = sampleRate * 0.2;
    this.port.onmessage = e => {
      const d = e.data;
      this.queue.push(d);
      this.queued += d.length;
      // drop old audio if we fall too far behind (keeps latency bounded)
      while (this.queued > this.maxQueued && this.queue.length > 1) {
        const x = this.queue.shift();
        this.queued -= x.length;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    for (let i = 0; i < ch0.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.queue.shift() || null;
        this.pos = 0;
        if (this.cur) this.queued -= this.cur.length;
      }
      ch0[i] = this.cur ? this.cur[this.pos++] : 0;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}
registerProcessor('emu-feeder', EmuFeeder);
