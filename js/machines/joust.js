// Williams Joust.
// Main CPU: MC6809E @ 1 MHz.  Sound: M6808 @ 894.9 kHz driving an 8-bit DAC through a 6821 PIA.
// Video: 304x256 4bpp bitmap in "column" order (byte = 2 horizontal pixels, 256 bytes per column pair),
// 16-entry palette RAM, Special Chip 1 blitter. Three 6821 PIAs (inputs/interrupts, sound command, DAC).
// 4-bit CMOS RAM holds settings and high scores.

import { M6809 } from '../cpu/m6809.js';
import { M6803 } from '../cpu/m6803.js';
import { PIA6821 } from '../cpu/pia6821.js';

const LINES = 260;
const LINE_HZ = 8000000 / 512;                 // 15625 Hz
const FPS = LINE_HZ / LINES;                   // 60.10 Hz
const MAIN_PER_LINE = 1000000 / LINE_HZ;       // 64
const SND_HZ = 3579545 / 4;
const SND_PER_LINE = SND_HZ / LINE_HZ;
const VIS_X0 = 6, VIS_Y0 = 7, W = 292, H = 240;

export const JOUST_INFO = {
  id: 'joust',
  title: 'Joust',
  zip: 'joust.zip',
  fps: FPS,
  width: W, height: H,
  files: ['joust_rom_1b_3006-13.e4', 'joust_rom_2b_3006-14.c4', 'joust_rom_3b_3006-15.a4', 'joust_rom_4b_3006-16.e5',
    'joust_rom_5b_3006-17.c5', 'joust_rom_6b_3006-18.a5', 'joust_rom_7b_3006-19.e6', 'joust_rom_8b_3006-20.c6',
    'joust_rom_9b_3006-21.a6', 'joust_rom_10b_3006-22.a7', 'joust_rom_11b_3006-23.c7', 'joust_rom_12b_3006-24.e7',
    'video_sound_rom_4_std_780.ic12'],
  buttons: ['Flap'],
  nvram: true,
};

export class Joust {
  static info = JOUST_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = JOUST_INFO;
    this.rom = new Uint8Array(0x10000);
    const names = JOUST_INFO.files;
    for (let i = 0; i < 9; i++) this.rom.set(get(names[i]), i * 0x1000);
    this.rom.set(get(names[9]), 0xd000); this.rom.set(get(names[10]), 0xe000); this.rom.set(get(names[11]), 0xf000);
    this.sndRom = new Uint8Array(0x10000);
    this.sndRom.set(get(names[12]), 0xf000);

    this.vram = new Uint8Array(0xc000);
    // per pixel (two per byte, high nibble first): 1 while it holds part of a moving object
    this.objPix = new Uint8Array(0x18000);
    this.paletteRam = new Uint8Array(16);
    this.cmos = new Uint8Array(0x400).fill(0xf0);
    this.romView = false;
    this.sndRam = new Uint8Array(0x100);

    // palette lookup: 8-bit value -> RGB (resistor weights 1200/560/330, 560/330)
    const w = res => { const g = res.map(r => 1 / r), t = g.reduce((a, b) => a + b, 0); return g.map(x => x / t * 255); };
    const rg = w([1200, 560, 330]), bw = w([560, 330]);
    this.colorLut = [];
    for (let i = 0; i < 256; i++) {
      this.colorLut.push([
        Math.round((i & 1 ? rg[0] : 0) + (i & 2 ? rg[1] : 0) + (i & 4 ? rg[2] : 0)),
        Math.round((i & 8 ? rg[0] : 0) + (i & 16 ? rg[1] : 0) + (i & 32 ? rg[2] : 0)),
        Math.round((i & 64 ? bw[0] : 0) + (i & 128 ? bw[1] : 0)),
      ]);
    }
    this.palette = new Array(16).fill(0).map(() => [0, 0, 0]);
    this.paletteVersion = 0;

    this.blit = { solid: 0, src: 0, dst: 0, w: 0, h: 0 };
    this.input = { in0: 0, inp1: 0, in2: 0 };
    this.muxSelect = 0;
    this.mainIrq = [false, false];
    this.sndIrq = [false, false];
    this.dac = 0x80;

    this.pia0 = new PIA6821({
      readA: () => (this.input.in0 & 0x30) | (this.muxSelect ? this.input.inp1 & 0x0f : 0),
      readB: () => 0,
      cb2: v => { this.muxSelect = v; },
    });
    this.pia1 = new PIA6821({
      readA: () => this.input.in2,
      writeB: v => this.soundCommand(v),
      irqA: s => { this.mainIrq[0] = s; this.cpu.setIrq(this.mainIrq[0] || this.mainIrq[1]); },
      irqB: s => { this.mainIrq[1] = s; this.cpu.setIrq(this.mainIrq[0] || this.mainIrq[1]); },
    });
    this.pia2 = new PIA6821({
      writeA: v => { this.dac = v; },
      irqA: s => { this.sndIrq[0] = s; this.snd.setIrq(this.sndIrq[0] || this.sndIrq[1]); },
      irqB: s => { this.sndIrq[1] = s; this.snd.setIrq(this.sndIrq[0] || this.sndIrq[1]); },
    });

    this.cpu = new M6809({ read: a => this.read(a), write: (a, v) => this.write(a, v) });
    this.snd = new M6803({ read: a => this.sndRead(a), write: (a, v) => this.sndWrite(a, v), p1Read: () => 0xff, p2Read: () => 0xff, p1Write: () => {}, p2Write: () => {} }, { plain: true });
    this.cpu.nmiArmed = true;

    this.scanline = 0;
    this.frame = 0;
    this.watchdog = 0;
    this.mainAcc = 0; this.sndAcc = 0;
    this.sampleRate = sampleRate;
    this.cyclesPerSample = SND_HZ / sampleRate;
    this.sampleAcc = 0; this.dacAcc = 0; this.dacN = 0;
    this.audioBuf = new Float32Array(sampleRate);
    this.audioLen = 0;
    this.hpPrev = 0; this.hpOut = 0; this.lp = 0;
  }

  // ---- persistence (settings and high scores) -------------------------------------
  getNvram() { return this.cmos.slice(); }
  setNvram(d) { if (d && d.length === this.cmos.length) this.cmos.set(d); }

  // ---- main bus -----------------------------------------------------------------------
  read(a) {
    if (a < 0xc000) {
      if (this.romView && a < 0x9000) return this.rom[a];
      return this.vram[a];
    }
    if (a < 0xc400) return 0;                                   // palette is write-only
    if (a >= 0xc800 && a < 0xc900) {
      const r = a & 0x0f;
      if (r >= 4 && r < 8) return this.pia0.read(r - 4);
      if (r >= 12) return this.pia1.read(r - 12);
      return 0;
    }
    if (a >= 0xcb00 && a < 0xcc00) return this.scanline < 256 ? this.scanline & 0xfc : 0xfc;
    if (a >= 0xcc00 && a < 0xd000) return this.cmos[a - 0xcc00];
    if (a >= 0xd000) return this.rom[a];
    return 0;
  }

  write(a, v) {
    if (a < 0xc000) {
      this.vram[a] = v;
      this.objPix[a * 2] = this.objPix[a * 2 + 1] = 0;
      return;
    }
    if (a < 0xc400) {
      const i = a & 0x0f;
      if (this.paletteRam[i] !== v) {
        this.paletteRam[i] = v;
        const c = this.colorLut[v];
        this.palette[i] = c;
        this.paletteVersion++;
      }
      return;
    }
    if (a >= 0xc800 && a < 0xc900) {
      const r = a & 0x0f;
      if (r >= 4 && r < 8) this.pia0.write(r - 4, v);
      else if (r >= 12) this.pia1.write(r - 12, v);
      return;
    }
    if (a >= 0xc900 && a < 0xca00) { this.romView = !!(v & 1); return; }
    if (a >= 0xca00 && a < 0xcb00) { this.blitterWrite(a & 7, v); return; }
    if (a === 0xcbff) { if (v === 0x39) this.watchdog = 0; return; }
    if (a >= 0xcc00 && a < 0xd000) { this.cmos[a - 0xcc00] = v | 0xf0; return; }
  }

  // ---- Special Chip 1 blitter ----------------------------------------------------------
  blitterWrite(r, v) {
    const b = this.blit;
    switch (r) {
      case 0: this.doBlit(v); break;
      case 1: b.solid = v; break;
      case 2: b.src = (b.src & 0x00ff) | (v << 8); break;
      case 3: b.src = (b.src & 0xff00) | v; break;
      case 4: b.dst = (b.dst & 0x00ff) | (v << 8); break;
      case 5: b.dst = (b.dst & 0xff00) | v; break;
      case 6: b.w = v; break;
      case 7: b.h = v; break;
    }
  }

  doBlit(ctrl) {
    const b = this.blit;
    let w = b.w ^ 4, h = b.h ^ 4;        // SC1 size bug
    if (!w) w = 1;
    if (!h) h = 1;
    const noEven = ctrl & 0x80, noOdd = ctrl & 0x40, shift = ctrl & 0x20, solid = ctrl & 0x10, fgOnly = ctrl & 0x08;
    const dst256 = ctrl & 0x02, src256 = ctrl & 0x01;
    const sxadv = src256 ? 0x100 : 1, syadv = src256 ? 1 : w;
    const dxadv = dst256 ? 0x100 : 1, dyadv = dst256 ? 1 : w;
    // a draw of a small ROM image (riders, birds, eggs, pterodactyls are at most 15 bytes wide)
    // marks pixels as a moving object until something else overwrites them. Ledges are wider
    // and are redrawn throughout play to repair them, so they never count. A rider respawning is
    // a solid-colour silhouette through a character image (0x1000-0x3fff; text lives higher up).
    const small = w < 16 && b.src < 0x9000;
    const isDraw = small && (!solid || (fgOnly && b.src >= 0x1000 && b.src < 0x4000));
    let sstart = b.src, dstart = b.dst, pix = 0;
    for (let y = 0; y < h; y++) {
      let s = sstart, d = dstart;
      for (let x = 0; x < w; x++) {
        let data = this.read(s);
        if (shift) { pix = (pix << 8) | data; data = (pix >> 4) & 0xff; }
        // blit pixel
        let cur = d < 0xc000 ? this.vram[d] : this.read(d);
        let keep = 0xff;
        if (fgOnly && !(data & 0xf0)) { if (noEven) keep &= 0x0f; } else if (!noEven) keep &= 0x0f;
        if (fgOnly && !(data & 0x0f)) { if (noOdd) keep &= 0xf0; } else if (!noOdd) keep &= 0xf0;
        cur &= keep;
        cur |= (solid ? b.solid : data) & ~keep;
        if (d < 0xc000) this.vram[d] = cur & 0xff; else this.write(d, cur & 0xff);
        if (d < 0xc000) {
          // each nibble the blit wrote is now either part of an object or not
          const put = solid ? b.solid : data;
          if (!(keep & 0xf0)) this.objPix[d * 2] = isDraw && (put & 0xf0) ? 1 : 0;
          if (!(keep & 0x0f)) this.objPix[d * 2 + 1] = isDraw && (put & 0x0f) ? 1 : 0;
        }
        s = (s + sxadv) & 0xffff;
        d = (d + dxadv) & 0xffff;
      }
      dstart = dst256 ? (dstart & 0xff00) | ((dstart + dyadv) & 0xff) : (dstart + dyadv) & 0xffff;
      sstart = src256 ? (sstart & 0xff00) | ((sstart + syadv) & 0xff) : (sstart + syadv) & 0xffff;
    }
    // the blitter halts the CPU while it works (~1 us per byte, two accesses each)
    this.cpu.extraCycles += Math.round((4 + ((ctrl & 4) ? 4 : 2) * (w * h * 2 + 2)) / 4);
  }

  soundCommand(v) {
    const cmd = v | 0xc0;
    this.pia2.portBIn(cmd);
    this.pia2.cb1W(cmd === 0xff ? 0 : 1);
  }

  // ---- sound bus ------------------------------------------------------------------------
  sndRead(a) {
    if (a < 0x100) return this.sndRam[a];
    if ((a & 0x7ffc) === 0x0400) return this.pia2.read(a & 3);
    if (a >= 0xb000) return this.sndRom[a];
    return 0xff;
  }
  sndWrite(a, v) {
    if (a < 0x100) { this.sndRam[a] = v; return; }
    if ((a & 0x7ffc) === 0x0400) this.pia2.write(a & 3, v);
  }

  // ---- inputs ---------------------------------------------------------------------------
  setInput(s) {
    this.input.in0 = (s.start2 ? 0x10 : 0) | (s.start1 ? 0x20 : 0);
    this.input.inp1 = (s.left ? 1 : 0) | (s.right ? 2 : 0) | (s.b1 ? 4 : 0);
    this.input.in2 = (s.coin ? 0x10 : 0);
    // after a CMOS reset the game waits on the operator's "Advance" switch; press it for the player
    if (this.cpu.pc >= 0x3d60 && this.cpu.pc < 0x3d80) this.input.in2 |= 0x02;
  }

  // ---- frame ------------------------------------------------------------------------------
  runFrame() {
    for (let line = 0; line < LINES; line++) {
      this.scanline = line;
      if ((line & 31) === 0 && line !== 256) this.pia1.cb1W((line >> 5) & 1);
      if (line === 0) this.pia1.ca1W(0);
      if (line === 240) this.pia1.ca1W(1);
      if (line === VIS_Y0 + H) this.snapshot();
      this.mainAcc += MAIN_PER_LINE;
      while (this.mainAcc > 0) this.mainAcc -= this.cpu.step();
      this.sndAcc += SND_PER_LINE;
      while (this.sndAcc > 0) {
        const c = this.snd.step();
        this.sndAcc -= c;
        this.audioClock(c);
      }
    }
    this.frame++;
    // the games deliberately starve the watchdog to reboot (e.g. after restoring factory settings)
    if (++this.watchdog > 90) this.hardReset();
  }

  hardReset() {
    this.watchdog = 0;
    this.romView = false;
    for (const p of [this.pia0, this.pia1, this.pia2]) {
      p.ora = p.ddra = p.cra = p.orb = p.ddrb = p.crb = 0;
      p.irqAOut = p.irqBOut = false;
    }
    this.mainIrq = [false, false]; this.sndIrq = [false, false];
    this.cpu.reset(); this.cpu.nmiArmed = true;
    this.snd.reset();
  }

  audioClock(c) {
    this.dacAcc += this.dac * c; this.dacN += c;
    this.sampleAcc += c;
    while (this.sampleAcc >= this.cyclesPerSample) {
      this.sampleAcc -= this.cyclesPerSample;
      const v = this.dacN ? this.dacAcc / this.dacN : this.dac;
      this.dacAcc = 0; this.dacN = 0;
      const x = (v / 255) * 2 - 1;
      const hp = 0.997 * (this.hpOut + x - this.hpPrev);
      this.hpPrev = x; this.hpOut = hp;
      this.lp += (hp - this.lp) * 0.55;
      if (this.audioLen < this.audioBuf.length) this.audioBuf[this.audioLen++] = this.lp * 0.6;
    }
  }

  takeAudio() {
    const out = this.audioBuf.slice(0, this.audioLen);
    this.audioLen = 0;
    return out;
  }

  // ---- video -------------------------------------------------------------------------------
  snapshot() {
    this.shot = { vram: this.vram.slice(), objPix: this.objPix.slice(), frame: this.frame };
  }

  pixelAt(vram, x, y) {
    const b = vram[(x >> 1) * 256 + y];
    return (x & 1) ? b & 0x0f : b >> 4;
  }

  renderClassic(out) {
    const sh = this.shot;
    if (!sh) return;
    const pal = this.palette;
    for (let dy = 0; dy < H; dy++) {
      const y = dy + VIS_Y0;
      for (let dx = 0; dx < W; dx++) {
        const c = pal[this.pixelAt(sh.vram, dx + VIS_X0, y)];
        const o = (dy * W + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  }

  // Bitmap hardware has no tiles or sprites, so the scene is reconstructed: pixels the blitter
  // drew from small object images are moving objects; everything else is scenery,
  // cut into 8x8 tiles keyed by content.
  displayScene() {
    const sh = this.shot;
    if (!sh) return { tiles: [], sprites: [] };
    const { vram, objPix } = sh;
    const live = (x, y) => objPix[((x >> 1) * 256 + y) * 2 + (x & 1)];
    const tiles = [];
    const spr = new Uint8Array(W * H);
    let anySprite = false;
    for (let ty = 0; ty < H; ty += 8) {
      for (let tx = 0; tx < W; tx += 8) {
        const tw = Math.min(8, W - tx);
        let px = null, hash = 2166136261;
        for (let y = 0; y < 8 && ty + y < H; y++) {
          for (let x = 0; x < tw; x++) {
            const sx = tx + x + VIS_X0, sy = ty + y + VIS_Y0;
            const p = this.pixelAt(vram, sx, sy);
            if (!p) continue;
            if (live(sx, sy)) { spr[(ty + y) * W + tx + x] = p; anySprite = true; continue; }
            if (!px) px = new Uint8Array(64);
            px[y * 8 + x] = p;
            hash = Math.imul(hash ^ (y * 8 + x) ^ (p << 8), 16777619);
          }
        }
        if (px) tiles.push({ x: tx, y: ty, w: 8, h: 8, code: hash >>> 0, key: `j${hash >>> 0}`, pal: 0, pixels: px, kind: ty >= 224 ? 'lava' : 'rock' });
      }
    }
    const sprites = anySprite ? [{ x: 0, y: 0, w: W, h: H, code: 0, pal: 0, pixels: spr, kind: 'other' }] : [];
    return { tiles, sprites };
  }
}
