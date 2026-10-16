// Taito "SJ" system running Jungle King (Japan).
// Main CPU: Z80 @ 4 MHz.  Sound CPU: Z80 @ 3 MHz with 4x AY-3-8910 (1.5 MHz) + 8-bit DAC.
// Video: 3 tilemaps (256x256, per-column scroll) + 16x16 sprites, graphics live in RAM
// uploaded by the CPU from the graphics ROMs; PROM-controlled layer priority; hardware
// sprite/sprite and sprite/playfield collision detection. Screen is rotated 180 degrees.

import { Z80 } from '../cpu/z80.js';
import { AY8910 } from '../audio/ay8910.js';

const FPS = 6000000 / 384 / 264;                  // 59.19 Hz
const LINES = 264;
const MAIN_PER_LINE = 4000000 / FPS / LINES;      // 256
const SND_PER_LINE = 3000000 / FPS / LINES;       // 192
const SND_IRQ_PERIOD = 3000000 / (12000000 / (2 * 4 * 16 * 16 * 10 * 16));
const VBLANK_LINE = 240;
const TRANSPARENT = 0xff;

export const JK_INFO = {
  id: 'junglek',
  title: 'Jungle King',
  zip: 'junglek.zip',
  fps: FPS,
  width: 256, height: 224,
  files: ['kn21-1.bin', 'kn22-1.bin', 'kn43.bin', 'kn24.bin', 'kn25.bin', 'kn46.bin', 'kn47.bin', 'kn28.bin', 'kn60.bin',
    'kn37.bin', 'kn38.bin', 'kn59-1.bin', 'kn29.bin', 'kn30.bin', 'kn51.bin', 'kn52.bin', 'kn53.bin', 'kn34.bin',
    'kn55.bin', 'kn56.bin', 'eb16.22'],
  buttons: ['Jump / Action'],
};

function fnv8(arr) {
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class JungleKing {
  static info = JK_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = JK_INFO;
    this.rom = new Uint8Array(0x12000);
    [['kn21-1.bin', 0x0000], ['kn22-1.bin', 0x1000], ['kn43.bin', 0x2000], ['kn24.bin', 0x3000], ['kn25.bin', 0x4000],
      ['kn46.bin', 0x5000], ['kn47.bin', 0x6000], ['kn28.bin', 0x7000], ['kn60.bin', 0x11000]].forEach(([n, o]) => this.rom.set(get(n), o));
    this.sndRom = new Uint8Array(0x4000);
    this.sndRom.set(get('kn37.bin'), 0x0000); this.sndRom.set(get('kn38.bin'), 0x1000); this.sndRom.set(get('kn59-1.bin'), 0x2000);
    this.gfxRom = new Uint8Array(0x8000);
    ['kn29.bin', 'kn30.bin', 'kn51.bin', 'kn52.bin', 'kn53.bin', 'kn34.bin', 'kn55.bin', 'kn56.bin'].forEach((n, i) => this.gfxRom.set(get(n), i * 0x1000));
    this.prom = get('eb16.22');
    this.drawOrder = this.computeDrawOrder();

    this.ram = new Uint8Array(0x800);
    this.charRam = new Uint8Array(0x3000);
    this.cRam = new Uint8Array(0x400);
    this.vram = [new Uint8Array(0x400), new Uint8Array(0x400), new Uint8Array(0x400)];
    this.colScroll = new Uint8Array(0x60);
    this.dRam = new Uint8Array(0xa0);
    this.spriteRam = new Uint8Array(0x100);
    this.paletteRam = new Uint8Array(0x80);
    this.collision = new Uint8Array(4);
    this.scroll = new Uint8Array(6);
    this.colorBank = new Uint8Array(2);
    this.gfxPtr = 0;
    this.videoMode = 0; this.priority = 0; this.bank = 0; this.soundOn = 0;

    // decoded graphics: 2 banks x (256 chars, 64 sprites); dirty-tracked
    this.chars = [[], []]; this.sprites = [[], []];
    this.charHash = [new Uint32Array(256), new Uint32Array(256)];
    this.spriteHash = [new Uint32Array(64), new Uint32Array(64)];
    for (let b = 0; b < 2; b++) {
      for (let i = 0; i < 256; i++) this.chars[b].push(new Uint8Array(64));
      for (let i = 0; i < 64; i++) this.sprites[b].push(new Uint8Array(256));
    }
    this.charDirty = [new Uint8Array(256).fill(1), new Uint8Array(256).fill(1)];
    this.spriteDirty = [new Uint8Array(64).fill(1), new Uint8Array(64).fill(1)];

    this.palette = new Array(64).fill(0).map(() => [0, 0, 0]);
    this.paletteVersion = 0;
    this.buildPaletteWeights();

    this.input = { in0: 0xff, in1: 0xff, in2: 0xff, in3: 0xef };
    this.dsw1 = 0x3f; this.dsw2 = 0x00; this.dsw3 = 0xff;
    this.inPort4 = 0;

    // sound side
    this.sndRam = new Uint8Array(0x400);
    this.latch = 0xff; this.latchFlag = false; this.sem2 = false;
    this.nmiEnable = false; this.nmiLevel = false;
    this.dacValue = 0x80; this.dacVol = 0;
    this.ay = [
      new AY8910({ portARead: () => this.dsw2, portBRead: () => this.dsw3 }),
      new AY8910({ portAWrite: v => { this.dacValue = v; }, portBWrite: v => { this.dacVol = (v ^ 0xff) / 255; } }),
      new AY8910({ portAWrite: v => { this.inPort4 = v >> 4; } }),
      new AY8910({ portBWrite: v => { this.nmiEnable = !(v & 1); this.updateNmi(); } }),
    ];

    const self = this;
    this.cpu = new Z80({
      read: a => self.mainRead(a), write: (a, v) => self.mainWrite(a, v), in: () => 0xff, out: () => {},
    });
    this.snd = new Z80({
      read: a => self.sndRead(a), write: (a, v) => self.sndWrite(a, v), in: () => 0xff, out: () => {},
    });

    this.sampleRate = sampleRate;
    this.cyclesPerSample = 3000000 / sampleRate;
    this.audioBuf = new Float32Array(sampleRate);
    this.audioLen = 0;
    this.sampleAcc = 0; this.ayAcc = 0; this.dacAcc = 0; this.dacN = 0;
    this.hpPrev = 0; this.hpOut = 0; this.lp = 0;
    this.mainAcc = 0; this.sndAcc = 0; this.sndIrqAcc = 0;
    this.frame = 0;
    this.layerBits = [new Uint8Array(65536), new Uint8Array(65536), new Uint8Array(65536)];
    this.scrolled = [new Uint8Array(65536), new Uint8Array(65536), new Uint8Array(65536)];
  }

  // ---- static tables -------------------------------------------------------
  computeDrawOrder() {
    const order = [];
    for (let i = 0; i < 32; i++) {
      let mask = 0;
      const o = [0, 0, 0, 0];
      for (let j = 3; j >= 0; j--) {
        let data = this.prom[0x10 * (i & 0x0f) + mask] & 0x0f;
        data = (i & 0x10) ? data >> 2 : data & 3;
        mask |= 1 << data;
        o[j] = data;
      }
      order.push(o);
    }
    return order;
  }

  buildPaletteWeights() {
    const res = [1000, 470, 270];
    const g = res.map(r => 1 / r);
    const sum = g.reduce((a, b) => a + b, 0);
    this.palW = g.map(x => (x / sum) * 255);
  }

  updatePalette() {
    const p = this.paletteRam, w = this.palW;
    let changed = false;
    for (let i = 0; i < 64; i++) {
      const hi = p[(i << 1) | 1], lo = p[i << 1];
      const r = Math.round(((~hi >> 6) & 1) * w[0] + ((~hi >> 7) & 1) * w[1] + ((~lo) & 1) * w[2]);
      const gg = Math.round(((~hi >> 3) & 1) * w[0] + ((~hi >> 4) & 1) * w[1] + ((~hi >> 5) & 1) * w[2]);
      const b = Math.round(((~hi) & 1) * w[0] + ((~hi >> 1) & 1) * w[1] + ((~hi >> 2) & 1) * w[2]);
      const c = this.palette[i];
      if (c[0] !== r || c[1] !== gg || c[2] !== b) { c[0] = r; c[1] = gg; c[2] = b; changed = true; }
    }
    if (changed) this.paletteVersion++;
  }

  decodeGfx() {
    const ram = this.charRam;
    for (let b = 0; b < 2; b++) {
      const base = b * 0x1800;
      for (let c = 0; c < 256; c++) {
        if (!this.charDirty[b][c]) continue;
        this.charDirty[b][c] = 0;
        const g = this.chars[b][c];
        for (let y = 0; y < 8; y++) {
          const o = base + c * 8 + y;
          const p0 = ram[o + 0x1000], p1 = ram[o + 0x800], p2 = ram[o];
          for (let x = 0; x < 8; x++) g[y * 8 + x] = (((p0 >> x) & 1) << 2) | (((p1 >> x) & 1) << 1) | ((p2 >> x) & 1);
        }
        this.charHash[b][c] = fnv8(g);
      }
      for (let s = 0; s < 64; s++) {
        if (!this.spriteDirty[b][s]) continue;
        this.spriteDirty[b][s] = 0;
        const g = this.sprites[b][s];
        for (let y = 0; y < 16; y++) {
          const ro = base + s * 32 + (y < 8 ? y : 16 + y - 8);
          for (let half = 0; half < 2; half++) {
            const o = ro + half * 8;
            const p0 = ram[o + 0x1000], p1 = ram[o + 0x800], p2 = ram[o];
            for (let x = 0; x < 8; x++) {
              g[y * 16 + half * 8 + x] = (((p0 >> x) & 1) << 2) | (((p1 >> x) & 1) << 1) | ((p2 >> x) & 1);
            }
          }
        }
        this.spriteHash[b][s] = fnv8(g);
      }
    }
  }

  // ---- main CPU bus -----------------------------------------------------------
  mainRead(a) {
    if (a < 0x6000) return this.rom[a];
    if (a < 0x8000) return this.bank ? this.rom[0x10000 + a - 0x6000] : this.rom[a];
    if (a < 0x8800) return this.ram[a - 0x8000];
    if (a < 0x9000) return (a & 1) ? 0xff : 0x00;              // no protection MCU
    if (a < 0xc000) return this.charRam[a - 0x9000];
    if (a < 0xc400) return this.cRam[a - 0xc000];
    if (a < 0xd000) return this.vram[(a - 0xc400) >> 10][a & 0x3ff];
    if (a < 0xd060) return this.colScroll[a - 0xd000];
    if (a < 0xd100) return this.dRam[a - 0xd060];
    if (a < 0xd200) return this.spriteRam[a - 0xd100];
    if (a < 0xd300) return this.paletteRam[a & 0x7f];
    if (a < 0xd400) return 0;
    if (a < 0xd500) {
      const r = a & 0x0f;
      if (r < 4) return this.collision[r];
      if (r < 8) {
        const v = this.gfxPtr < 0x8000 ? this.gfxRom[this.gfxPtr] : 0;
        this.gfxPtr = (this.gfxPtr + 1) & 0xffff;
        return v;
      }
      switch (r) {
        case 8: return this.input.in0;
        case 9: return this.input.in1;
        case 10: return this.dsw1;
        case 11: return this.input.in2;
        case 12: return this.input.in3;
        case 13: return 0x0f | (this.inPort4 << 4);
        case 15: return this.ay[0].read();
        default: return 0;
      }
    }
    if (a >= 0xe000) return this.rom[a];
    return 0;
  }

  mainWrite(a, v) {
    if (a < 0x8000) return;
    if (a < 0x8800) { this.ram[a - 0x8000] = v; return; }
    if (a < 0x9000) return;
    if (a < 0xc000) {
      const o = a - 0x9000;
      if (this.charRam[o] !== v) {
        this.charRam[o] = v;
        const b = o >= 0x1800 ? 1 : 0, ob = o - b * 0x1800;
        this.charDirty[b][(ob >> 3) & 0xff] = 1;
        this.spriteDirty[b][(ob >> 5) & 0x3f] = 1;
      }
      return;
    }
    if (a < 0xc400) { this.cRam[a - 0xc000] = v; return; }
    if (a < 0xd000) { this.vram[(a - 0xc400) >> 10][a & 0x3ff] = v; return; }
    if (a < 0xd060) { this.colScroll[a - 0xd000] = v; return; }
    if (a < 0xd100) { this.dRam[a - 0xd060] = v; return; }
    if (a < 0xd200) { this.spriteRam[a - 0xd100] = v; return; }
    if (a < 0xd300) { this.paletteRam[a & 0x7f] = v; return; }
    if (a < 0xd400) { this.priority = v; return; }
    if (a < 0xd500) {
      const r = a & 0x0f;
      if (r === 14) this.ay[0].address(v);
      else if (r === 15) this.ay[0].write(v);
      return;
    }
    if (a < 0xd600) {
      const r = a & 0x0f;
      if (r < 6) this.scroll[r] = v;
      else if (r < 8) this.colorBank[r - 6] = v;
      else if (r === 8) this.collision.fill(0);
      else if (r === 9) this.gfxPtr = (this.gfxPtr & 0xff00) | v;
      else if (r === 10) this.gfxPtr = (this.gfxPtr & 0x00ff) | (v << 8);
      else if (r === 11) { this.latch = v; this.latchFlag = true; this.updateNmi(); }
      else if (r === 12) { this.sem2 = !!(v & 1); this.updateNmi(); }
      else if (r === 14) { this.bank = v >> 7; this.soundOn = (v >> 1) & 1; }
      return;
    }
    if (a < 0xd700) { this.videoMode = v; return; }
  }

  // ---- sound CPU bus ------------------------------------------------------
  sndRead(a) {
    if (a < 0x4000) return this.sndRom[a];
    if (a < 0x4400) return this.sndRam[a - 0x4000];
    if ((a & 0xf800) === 0x4800) {
      const ay = this.ay[(a & 4) ? 3 : (a & 2) ? 2 : 1];
      return (a & 1) ? ay.read() : 0xff;
    }
    if ((a & 0xf800) === 0x5000) {
      switch (a & 3) {
        case 0: this.latchFlag = false; this.updateNmi(); return this.latch;
        case 1: return (this.latchFlag ? 8 : 0) | (this.sem2 ? 4 : 0) | 3;
      }
    }
    return 0xff;
  }

  sndWrite(a, v) {
    if (a >= 0x4000 && a < 0x4400) { this.sndRam[a - 0x4000] = v; return; }
    if ((a & 0xf800) === 0x4800) {
      const ay = this.ay[(a & 4) ? 3 : (a & 2) ? 2 : 1];
      if (a & 1) ay.write(v); else ay.address(v);
      return;
    }
    if ((a & 0xf800) === 0x5000) {
      if ((a & 3) === 0) this.latch &= 0x7f;
      else if ((a & 3) === 1) { this.sem2 = false; this.updateNmi(); }
    }
  }

  updateNmi() {
    const level = (this.nmiEnable && this.latchFlag) || this.sem2;
    if (level && !this.nmiLevel) this.snd.nmi();
    this.nmiLevel = level;
  }

  // ---- inputs ---------------------------------------------------------------
  setInput(s) {
    const in0 = (s.left ? 1 : 0) | (s.right ? 2 : 0) | (s.down ? 4 : 0) | (s.up ? 8 : 0) | (s.b1 ? 0x10 : 0);
    this.input.in0 = ~in0 & 0xff;
    this.input.in1 = 0xff;
    this.input.in2 = ~((s.coin ? 0x20 : 0) | (s.start1 ? 0x40 : 0) | (s.start2 ? 0x80 : 0)) & 0xff;
    this.input.in3 = 0xef;
  }

  // ---- frame ----------------------------------------------------------------
  runFrame() {
    for (let line = 0; line < LINES; line++) {
      if (line === VBLANK_LINE) {
        this.videoUpdate();
        this.cpu.holdIrq();
      }
      this.mainAcc += MAIN_PER_LINE;
      while (this.mainAcc > 0) this.mainAcc -= this.cpu.step();
      this.sndAcc += SND_PER_LINE;
      while (this.sndAcc > 0) {
        const c = this.snd.step();
        this.sndAcc -= c;
        this.sndIrqAcc += c;
        if (this.sndIrqAcc >= SND_IRQ_PERIOD) { this.sndIrqAcc -= SND_IRQ_PERIOD; this.snd.holdIrq(); }
        this.audioClock(c);
      }
    }
    this.frame++;
  }

  audioClock(c) {
    // AY steps are 8 clocks of 1.5 MHz = 16 sound-CPU cycles
    this.ayAcc += c;
    const steps = this.ayAcc >> 4;
    if (steps) {
      this.ayAcc &= 15;
      for (const ay of this.ay) ay.tick(steps);
    }
    this.dacAcc += ((this.dacValue / 255) * 2 - 1) * this.dacVol * c;
    this.dacN += c;
    this.sampleAcc += c;
    if (this.sampleAcc >= this.cyclesPerSample) {
      this.sampleAcc -= this.cyclesPerSample;
      const a0 = this.ay[0].sample(), a1 = this.ay[1].sample(), a2 = this.ay[2].sample(), a3 = this.ay[3].sample();
      const dac = this.dacN ? this.dacAcc / this.dacN : 0;
      this.dacAcc = 0; this.dacN = 0;
      let x = this.soundOn ? (a0 * 0.15 + a1 * 0.5 / 3 + a2 * 0.5 / 3 + a3 * 1.0 / 3 + dac * 0.3) * 0.7 : 0;
      const hp = 0.996 * (this.hpOut + x - this.hpPrev);
      this.hpPrev = x; this.hpOut = hp;
      this.lp += (hp - this.lp) * 0.5;
      if (this.audioLen < this.audioBuf.length) this.audioBuf[this.audioLen++] = Math.max(-1, Math.min(1, this.lp));
    }
  }

  takeAudio() {
    const out = this.audioBuf.slice(0, this.audioLen);
    this.audioLen = 0;
    return out;
  }

  // ---- video ----------------------------------------------------------------
  get flipX() { return this.videoMode & 1; }
  get flipY() { return (this.videoMode >> 1) & 1; }
  spriteBase() { return (this.videoMode & 4) ? 0x80 : 0; }

  // raw (unrotated) sprite position; returns null if off
  spriteXY(which) {
    const o = this.spriteBase() + which * 4;
    const sx = (this.spriteRam[o] - 1) & 0xff;
    const sy = (240 - this.spriteRam[o + 1]) & 0xff;
    return sy < 240 ? [sx, sy] : null;
  }

  spriteGfx(which) {
    const o = this.spriteBase() + which * 4;
    const attr = this.spriteRam[o + 3];
    return this.sprites[(attr & 0x40) ? 1 : 0][attr & 0x3f];
  }

  layerParams(n) {
    const cb0 = this.colorBank[0], cb1 = this.colorBank[1];
    const bank = n === 0 ? (cb0 & 0x08 ? 1 : 0) : n === 1 ? (cb0 & 0x80 ? 1 : 0) : (cb1 & 0x08 ? 1 : 0);
    const color = n === 0 ? cb0 & 7 : n === 1 ? (cb0 >> 4) & 7 : cb1 & 7;
    const fudge1 = [3, 1, -1][n], fudge2 = [8, 10, 12][n];
    let sx = this.scroll[2 * n];
    sx = this.flipX ? (sx & 0xf8) + ((sx + fudge1) & 7) + fudge2 : -(sx & 0xf8) + ((sx + fudge1) & 7) + fudge2;
    const sy = new Int32Array(32);
    for (let i = 0; i < 32; i++) {
      if (this.flipY) sy[31 - i] = this.colScroll[32 * n + i] + this.scroll[2 * n + 1];
      else sy[i] = -this.colScroll[32 * n + i] - this.scroll[2 * n + 1];
    }
    return { bank, color, scrollX: sx, scrollY: sy, enabled: !!(this.videoMode & (0x10 << n)) };
  }

  // Draws layer n into a 256x256 pen buffer (TRANSPARENT where empty), then its scrolled copy.
  buildLayer(n, p) {
    const bits = this.layerBits[n], out = this.scrolled[n];
    bits.fill(TRANSPARENT);
    const fx = this.flipX, fy = this.flipY;
    const vr = this.vram[n];
    for (let offs = 0; offs < 0x400; offs++) {
      let sx = offs & 31, sy = offs >> 5;
      if (fx) sx = 31 - sx;
      if (fy) sy = 31 - sy;
      const g = this.chars[p.bank][vr[offs]];
      const base = p.color * 8;
      for (let y = 0; y < 8; y++) {
        const gy = fy ? 7 - y : y;
        const row = (sy * 8 + y) * 256 + sx * 8;
        for (let x = 0; x < 8; x++) {
          const pix = g[gy * 8 + (fx ? 7 - x : x)];
          if (pix) bits[row + x] = base + pix;
        }
      }
    }
    // scrolled copy: source column c is shifted vertically by scrollY[c], everything by scrollX
    for (let sxp = 0; sxp < 256; sxp++) {
      const dx = (sxp + p.scrollX) & 255;
      const ys = p.scrollY[sxp >> 3];
      for (let syp = 0; syp < 256; syp++) out[((syp + ys) & 255) * 256 + dx] = bits[syp * 256 + sxp];
    }
  }

  videoUpdate() {
    this.decodeGfx();
    this.updatePalette();
    const params = [0, 1, 2].map(n => this.layerParams(n));
    for (let n = 0; n < 3; n++) if (params[n].enabled) this.buildLayer(n, params[n]);
    this.checkCollisions(params);
    this.shot = {
      params,
      vram: this.vram.map(v => v.slice()),
      sprites: this.spriteRam.slice(),
      videoMode: this.videoMode,
      order: this.drawOrder[this.priority & 0x1f].slice(),
      bgPen: 8 * (this.colorBank[1] & 7),
      spriteColorBank: (this.colorBank[1] >> 4) & 3,
    };
  }

  spritesOn() { return this.videoMode & 0x80; }

  checkCollisions(params) {
    if (!this.spritesOn()) return;
    const list = [];
    for (let w = 0; w < 32; w++) {
      if (w >= 0x10 && w <= 0x17) continue;
      const xy = this.spriteXY(w);
      if (!xy) continue;
      const o = this.spriteBase() + w * 4;
      list.push({ w, sx: xy[0], sy: xy[1], g: this.spriteGfx(w), fx: this.spriteRam[o + 2] & 1, fy: (this.spriteRam[o + 2] >> 1) & 1 });
    }
    const pix = (s, x, y) => s.g[(s.fy ? 15 - y : y) * 16 + (s.fx ? 15 - x : x)];
    // sprite / sprite
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.abs(((a.sx << 24) >> 24) - ((b.sx << 24) >> 24)) >= 16 || Math.abs(((a.sy << 24) >> 24) - ((b.sy << 24) >> 24)) >= 16) continue;
        let hit = false;
        for (let y = 0; y < 16 && !hit; y++) {
          const by = a.sy + y - b.sy;
          if (by < 0 || by > 15) continue;
          for (let x = 0; x < 16; x++) {
            const bx = a.sx + x - b.sx;
            if (bx < 0 || bx > 15) continue;
            if (pix(a, x, y) && pix(b, bx, by)) { hit = true; break; }
          }
        }
        if (!hit) continue;
        const mark = b.w === 0x1f ? a.w : b.w;
        let reg = mark >> 3; if (reg === 3) reg = 2;
        this.collision[reg] |= 1 << (mark & 7);
      }
    }
    // sprite / playfield
    const gfx = this.flipX, gfy = this.flipY;
    for (const s of list) {
      let sx = s.sx, sy = s.sy;
      if (gfx) sx = (238 - sx) & 0xff;
      if (gfy) sy = (242 - sy) & 0xff;
      const fx = s.fx ^ gfx, fy = s.fy ^ gfy;
      let result = 0;
      for (let y = 0; y < 16; y++) {
        const yy = sy + y;
        if (yy > 255) break;
        for (let x = 0; x < 16; x++) {
          const xx = sx + x;
          if (xx > 255) break;
          if (!s.g[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)]) continue;
          for (let n = 0; n < 3; n++) {
            if (params[n].enabled && this.scrolled[n][yy * 256 + xx] !== TRANSPARENT) result |= 1 << n;
          }
        }
      }
      this.collision[3] |= result;
    }
  }

  // ---- classic rendering (display = raw rotated 180 degrees) -------------
  renderClassic(out) {
    if (!this.shot) return;
    const fb = this.fb || (this.fb = new Uint8Array(65536));
    const sh = this.shot;
    fb.fill(sh.bgPen);
    for (let i = 0; i < 4; i++) {
      const which = sh.order[i];
      if (which === 0) this.drawSprites(fb, sh);
      else {
        const n = which - 1;
        if (!sh.params[n].enabled) continue;
        const src = this.scrolled[n];
        for (let k = 16 * 256; k < 240 * 256; k++) { const v = src[k]; if (v !== TRANSPARENT) fb[k] = v; }
      }
    }
    const pal = this.palette;
    for (let dy = 0; dy < 224; dy++) {
      const y = 239 - dy;
      for (let dx = 0; dx < 256; dx++) {
        const c = pal[fb[y * 256 + (255 - dx)] & 63];
        const o = (dy * 256 + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  }

  drawSprites(fb, sh) {
    if (!(sh.videoMode & 0x80)) return;
    const base = (sh.videoMode & 4) ? 0x80 : 0;
    const gfx = sh.videoMode & 1, gfy = (sh.videoMode >> 1) & 1;
    const minX = gfx ? 1 : 3, maxX = gfx ? 252 : 254;
    for (let sprite = 0x1f; sprite >= 0; sprite--) {
      const which = (sprite - 1) & 0x1f;
      if (which >= 0x10 && which <= 0x17) continue;
      const o = base + which * 4;
      let sx = (sh.sprites[o] - 1) & 0xff, sy = (240 - sh.sprites[o + 1]) & 0xff;
      if (sy >= 240) continue;
      const attr2 = sh.sprites[o + 2], attr3 = sh.sprites[o + 3];
      const g = this.sprites[(attr3 & 0x40) ? 1 : 0][attr3 & 0x3f];
      const color = 2 * sh.spriteColorBank + ((attr2 >> 2) & 1);
      let fx = attr2 & 1, fy = (attr2 >> 1) & 1;
      if (gfx) { sx = (238 - sx) & 0xff; fx ^= 1; }
      if (gfy) { sy = (242 - sy) & 0xff; fy ^= 1; }
      for (const ox of [sx, sx - 256]) {
        for (let y = 0; y < 16; y++) {
          const yy = sy + y;
          if (yy < 16 || yy > 239) continue;
          for (let x = 0; x < 16; x++) {
            const xx = ox + x;
            if (xx < minX || xx > maxX) continue;
            const p = g[(fy ? 15 - y : y) * 16 + (fx ? 15 - x : x)];
            if (p) fb[yy * 256 + xx] = color * 8 + p;
          }
        }
      }
    }
  }

  // ---- remaster scene ----------------------------------------------------------
  // Tiles are placed per layer (after scroll), sprites individually; display = raw rotated 180.
  displayScene() {
    const sh = this.shot;
    if (!sh) return { tiles: [], sprites: [], bgColor: [0, 0, 0] };
    const tiles = [], sprites = [];
    const gfx = sh.videoMode & 1, gfy = (sh.videoMode >> 1) & 1;
    const orderPos = {};
    sh.order.forEach((w, i) => { orderPos[w] = i; });
    for (let n = 0; n < 3; n++) {
      const p = sh.params[n];
      if (!p.enabled) continue;
      const layer = n + 1;
      const vr = sh.vram[n];
      for (let offs = 0; offs < 0x400; offs++) {
        const code = vr[offs];
        const g = this.chars[p.bank][code];
        const h = this.charHash[p.bank][code];
        let sx = offs & 31, sy = offs >> 5;
        if (gfx) sx = 31 - sx;
        if (gfy) sy = 31 - sy;
        const bx = sx * 8, by = sy * 8;
        const dxRaw = (bx + p.scrollX) & 255;
        const dyRaw = (by + p.scrollY[sx]) & 255;
        if (this.isEmpty(p.bank, code)) continue;
        for (const ox of dxRaw > 248 ? [dxRaw, dxRaw - 256] : [dxRaw]) {
          for (const oy of dyRaw > 248 ? [dyRaw, dyRaw - 256] : [dyRaw]) {
            if (ox + 8 <= 0 || ox >= 256 || oy + 8 <= 16 || oy >= 240) continue;
            tiles.push({
              x: 255 - (ox + 7), y: 239 - (oy + 7), w: 8, h: 8,
              code, pal: p.color * 8, key: `${p.bank}:${h}:${gfx ^ 1}${gfy ^ 1}`,
              pixels: this.orient(g, 8, !gfx, !gfy, `c${p.bank}:${code}:${!gfx}${!gfy}`, h),
              kind: 'tile', layer, order: orderPos[layer],
            });
          }
        }
      }
    }
    if (sh.videoMode & 0x80) {
      const base = (sh.videoMode & 4) ? 0x80 : 0;
      for (let which = 0; which < 32; which++) {
        if (which >= 0x10 && which <= 0x17) continue;
        const o = base + which * 4;
        let sx = (sh.sprites[o] - 1) & 0xff, sy = (240 - sh.sprites[o + 1]) & 0xff;
        if (sy >= 240) continue;
        const attr2 = sh.sprites[o + 2], attr3 = sh.sprites[o + 3];
        const bank = (attr3 & 0x40) ? 1 : 0, code = attr3 & 0x3f;
        const g = this.sprites[bank][code];
        const color = 2 * sh.spriteColorBank + ((attr2 >> 2) & 1);
        let fx = attr2 & 1, fy = (attr2 >> 1) & 1;
        if (gfx) { sx = (238 - sx) & 0xff; fx ^= 1; }
        if (gfy) { sy = (242 - sy) & 0xff; fy ^= 1; }
        if (sx > 240) sx -= 256;
        const h = this.spriteHash[bank][code];
        sprites.push({
          x: 255 - (sx + 15), y: 239 - (sy + 15), w: 16, h: 16, code, pal: color * 8,
          pixels: this.orient(g, 16, !fx, !fy, `s${bank}:${code}:${!fx}${!fy}`, h),
          kind: 'other', order: orderPos[0], slot: which, flipx: !fx,
        });
      }
    }
    return { tiles, sprites, bgColor: this.palette[sh.bgPen], order: sh.order };
  }

  isEmpty(bank, code) {
    const g = this.chars[bank][code];
    for (let i = 0; i < 64; i++) if (g[i]) return false;
    return true;
  }

  // flipped copy of a gfx element, cached by content hash
  orient(g, size, fx, fy, key, hash) {
    if (!fx && !fy) return g;
    const cache = this.orCache || (this.orCache = new Map());
    const k = key + ':' + hash;
    let d = cache.get(k);
    if (d) return d;
    d = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[y * size + x] = g[(fy ? size - 1 - y : y) * size + (fx ? size - 1 - x : x)];
    if (cache.size > 4000) cache.clear();
    cache.set(k, d);
    return d;
  }
}
