// Gottlieb Q*bert (US set 2, "qberta").
// Main CPU: Intel 8088 @ 5 MHz, NMI at vblank. Video: 32x32 background of 8x8 4bpp tiles (ROM),
// 64 hardware sprites of 16x16 4bpp, 16-colour palette RAM (4 bits per gun), bg/sprite priority bit.
// Screen 256x240 (rows 0-239), rotated 270 degrees (vertical monitor).
// Sound: "Rev 1" board — 6502 @ 895 kHz with a 6532 RIOT (command latch, IRQ, timer), an 8-bit DAC,
// and a Votrax SC-01 speech chip whose clock is set by a second DAC. Plus the cabinet knocker.

import { I8088 } from '../cpu/i8088.js';
import { M6502 } from '../cpu/m6502.js';
import { Votrax } from '../audio/votrax.js';

const MAIN_HZ = 5000000;
const HTOTAL = 318, LINES = 256;
const FPS = MAIN_HZ / HTOTAL / LINES;          // 61.42 Hz
const VBLANK_LINE = 240;
const SND_HZ = 3579545 / 4;
const SND_PER_LINE = SND_HZ / (MAIN_HZ / HTOTAL);
const W = 240, H = 256;                        // display (rotated) size

export const QBERT_INFO = {
  id: 'qbert',
  title: 'Q*bert',
  zip: 'qberta.zip',
  fps: FPS,
  width: W, height: H,
  files: ['qrom_0.bin', 'qrom_1.bin', 'qrom_2.bin', 'qb-snd1.bin', 'qb-snd2.bin',
    'qb-bg0.bin', 'qb-bg1.bin', 'qb-fg0.bin', 'qb-fg1.bin', 'qb-fg2.bin', 'qb-fg3.bin', 'sc01a.bin'],
  buttons: [],
  nvram: true,
};

// ---- MOS 6532 RIOT: 128 bytes RAM (mapped by the board), two ports, timer, PA7 edge IRQ ----------
class Riot6532 {
  constructor(onIrq) {
    this.onIrq = onIrq;
    this.paIn = 0; this.pbIn = 0;
    this.ora = 0; this.orb = 0; this.ddra = 0; this.ddrb = 0;
    this.timer = 0xff; this.shift = 10; this.sub = 0; this.expired = true;
    this.timerFlag = false; this.timerIrqEn = false;
    this.pa7Flag = false; this.pa7IrqEn = false; this.pa7Pos = false;
    this.irq = false;
  }
  update() {
    const s = (this.timerFlag && this.timerIrqEn) || (this.pa7Flag && this.pa7IrqEn);
    if (s !== this.irq) { this.irq = s; this.onIrq(s); }
  }
  read(r) {
    if (r & 4) {
      if (r & 1) {
        const v = (this.timerFlag ? 0x80 : 0) | (this.pa7Flag ? 0x40 : 0);
        this.pa7Flag = false; this.update();
        return v;
      }
      this.timerIrqEn = !!(r & 8);
      if (this.expired) this.timerFlag = false;
      this.update();
      return this.timer;
    }
    switch (r & 3) {
      case 0: return (this.ora & this.ddra) | (this.paIn & ~this.ddra);
      case 1: return this.ddra;
      case 2: return (this.orb & this.ddrb) | (this.pbIn & ~this.ddrb);
      default: return this.ddrb;
    }
  }
  write(r, v) {
    if (r & 4) {
      if (r & 0x10) {
        this.shift = [0, 3, 6, 10][r & 3];
        this.timer = v; this.sub = 0; this.expired = false;
        this.timerIrqEn = !!(r & 8); this.timerFlag = false;
      } else {
        this.pa7Pos = !!(r & 1); this.pa7IrqEn = !!(r & 2);
      }
      this.update();
      return;
    }
    switch (r & 3) {
      case 0: this.ora = v; break;
      case 1: this.ddra = v; break;
      case 2: this.orb = v; break;
      default: this.ddrb = v;
    }
  }
  setPortA(v) {
    const was = this.paIn & 0x80, now = v & 0x80;
    this.paIn = v;
    if (was !== now && (now ? this.pa7Pos : !this.pa7Pos)) { this.pa7Flag = true; this.update(); }
  }
  clock(c) {
    if (this.expired) { this.timer = (this.timer - c) & 0xff; return; }
    this.sub += c;
    const period = 1 << this.shift;
    while (this.sub >= period) {
      this.sub -= period;
      if (this.timer === 0) {
        this.timer = 0xff; this.expired = true; this.timerFlag = true; this.update();
        this.timer = (this.timer - this.sub) & 0xff; this.sub = 0;
        return;
      }
      this.timer--;
    }
  }
}

export class Qbert {
  static info = QBERT_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = QBERT_INFO;

    // ---- main CPU memory ----
    this.rom = new Uint8Array(0x10000);
    this.rom.set(get('qrom_2.bin'), 0xa000);
    this.rom.set(get('qrom_1.bin'), 0xc000);
    this.rom.set(get('qrom_0.bin'), 0xe000);
    this.ram = new Uint8Array(0x3000);          // 0x0000-0x2fff (0x0000-0x0fff battery backed)
    this.spriteRam = new Uint8Array(0x100);
    this.videoRam = new Uint8Array(0x400);
    this.charRam = new Uint8Array(0x1000);
    this.paletteRam = new Uint8Array(0x20);
    this.palette = new Array(16).fill(0).map(() => [0, 0, 0]);
    this.paletteVersion = 0;
    this.videoControl = 0;
    this.charRamUsed = [false, false];

    // ---- graphics ----
    // background tiles: 8x8, 4bpp packed (high nibble first), 256 tiles in ROM
    const bg = new Uint8Array(0x2000);
    bg.set(get('qb-bg0.bin'), 0); bg.set(get('qb-bg1.bin'), 0x1000);
    this.tileGfx = [];
    for (let c = 0; c < 256; c++) this.tileGfx.push(Qbert.decodeTile(bg, c * 32));
    this.ramTileGfx = new Array(256).fill(null);
    // sprites: 16x16, 4 planes in separate ROMs (fg3 = most significant)
    const planes = [get('qb-fg3.bin'), get('qb-fg2.bin'), get('qb-fg1.bin'), get('qb-fg0.bin')];
    this.spriteGfx = [];
    for (let c = 0; c < 256; c++) {
      const g = new Uint8Array(256);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const byte = c * 32 + y * 2 + (x >> 3), b = 7 - (x & 7);
          let p = 0;
          for (let k = 0; k < 4; k++) p = (p << 1) | ((planes[k][byte] >> b) & 1);
          g[y * 16 + x] = p;
        }
      }
      this.spriteGfx.push(g);
    }
    // 4-bit resistor DAC per gun (2000/1000/470/240 ohm)
    const g = [2000, 1000, 470, 240].map(r => 1 / r), t = g.reduce((a, b) => a + b, 0);
    this.weights = g.map(x => x / t * 255);

    // ---- sound board ----
    this.sndRom = new Uint8Array(0x8000);
    this.sndRom.set(get('qb-snd1.bin'), 0x7000);
    this.sndRom.set(get('qb-snd2.bin'), 0x7800);
    // static RAM powers up holding garbage; the speech code relies on it (its random-phoneme
    // generator is reseeded from a register by a ROM bug and would otherwise stay near zero)
    this.sndRam = new Uint8Array(0x80);
    for (let i = 0; i < 0x80; i++) this.sndRam[i] = (Math.random() * 256) | 0;
    this.riot = new Riot6532(s => this.snd.setIrq(s));
    this.riot.pbIn = 0x40;                       // sound board DIPs: normal operation (not self-test)
    this.riot.setPortA(0x00);
    this.dac = 0x80;
    this.speechClock = 0xa0;
    this.votrax = new Votrax(get('sc01a.bin'), sampleRate, s => this.snd.setNmi(s));
    this.knock = 0; this.knockPhase = 0; this.lastOut = 0;

    // ---- inputs ----
    this.dsw = 0x03;     // demo sounds on, knocker on, upright, 1 coin 1 credit
    this.in1 = 0x70;
    this.in4 = 0x00;

    this.cpu = new I8088({
      read: a => this.read(a & 0xffff),
      write: (a, v) => this.write(a & 0xffff, v),
      in: () => 0xff, out: () => {},
    });
    this.snd = new M6502({ read: a => this.sndRead(a), write: (a, v) => this.sndWrite(a, v) });
    this.snd.reset();

    this.sampleRate = sampleRate;
    this.cyclesPerSample = SND_HZ / sampleRate;
    this.sampleAcc = 0; this.dacAcc = 0; this.dacN = 0;
    this.audioBuf = new Float32Array(sampleRate);
    this.audioLen = 0;
    this.hpPrev = 0; this.hpOut = 0; this.lp = 0;
    this.mainAcc = 0; this.sndAcc = 0;
    this.frame = 0;
  }

  static decodeTile(src, off) {
    const g = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const b = src[off + y * 4 + (x >> 1)];
        g[y * 8 + x] = x & 1 ? b & 0x0f : b >> 4;
      }
    }
    return g;
  }

  // ---- persistence (high scores, bookkeeping) ------------------------------------------
  getNvram() { return this.ram.slice(0, 0x1000); }
  setNvram(d) { if (d && d.length === 0x1000) this.ram.set(d); }

  // ---- main bus ----------------------------------------------------------------------------
  read(a) {
    if (a < 0x3000) return this.ram[a];
    if (a < 0x3800) return this.spriteRam[a & 0xff];
    if (a < 0x4000) return this.videoRam[a & 0x3ff];
    if (a < 0x5000) return this.charRam[a & 0xfff];
    if (a < 0x5800) return this.paletteRam[a & 0x1f];
    if (a < 0x6000) {
      switch (a & 7) {
        case 0: return this.dsw;
        case 1: return this.in1;
        case 2: case 3: return 0;   // trackball (not fitted)
        case 4: return this.in4;
        default: return 0xff;
      }
    }
    return this.rom[a];
  }

  write(a, v) {
    if (a < 0x3000) { this.ram[a] = v; return; }
    if (a < 0x3800) { this.spriteRam[a & 0xff] = v; return; }
    if (a < 0x4000) { this.videoRam[a & 0x3ff] = v; return; }
    if (a < 0x5000) {
      const o = a & 0xfff;
      if (this.charRam[o] !== v) {
        this.charRam[o] = v;
        this.ramTileGfx[o >> 5] = null;
        this.charRamUsed[o >> 11] = true;
      }
      return;
    }
    if (a < 0x5800) { this.paletteWrite(a & 0x1f, v); return; }
    if (a < 0x6000) {
      switch (a & 7) {
        case 2: this.soundCommand(v); break;
        case 3: this.outputWrite(v); break;
        default: break;            // watchdog, trackball reset
      }
    }
  }

  paletteWrite(o, v) {
    this.paletteRam[o] = v;
    const i = o >> 1;
    const gb = this.paletteRam[i * 2], rr = this.paletteRam[i * 2 + 1];
    const w = this.weights, c4 = n => Math.round((n & 1 ? w[0] : 0) + (n & 2 ? w[1] : 0) + (n & 4 ? w[2] : 0) + (n & 8 ? w[3] : 0));
    const c = [c4(rr & 15), c4(gb >> 4), c4(gb & 15)];
    const p = this.palette[i];
    if (p[0] !== c[0] || p[1] !== c[1] || p[2] !== c[2]) { this.palette[i] = c; this.paletteVersion++; }
  }

  outputWrite(v) {
    this.videoControl = v & 0x0f;
    // bit 5 fires the cabinet knocker (the solenoid that thumps when Q*bert falls off the pyramid)
    const k = (v >> 5) & 1;
    if (k && !this.lastOut) this.knock = 1;
    this.lastOut = k;
  }

  soundCommand(v) {
    const pa7 = (v & 0x0f) !== 0x0f ? 0x80 : 0;
    this.riot.setPortA((~v & 0x3f) | pa7 | (this.riot.paIn & 0x40));
  }

  // ---- sound bus ---------------------------------------------------------------------------
  sndRead(a) {
    a &= 0x7fff;
    if (a < 0x1000) return a & 0x200 ? this.riot.read(a & 0x1f) : this.sndRam[a & 0x7f];
    if (a >= 0x6000) return this.sndRom[a];
    return 0xff;
  }
  sndWrite(a, v) {
    a &= 0x7fff;
    if (a < 0x1000) { if (a & 0x200) this.riot.write(a & 0x1f, v); else this.sndRam[a & 0x7f] = v; return; }
    switch (a >> 12) {
      case 1: this.dac = v; break;
      case 2: this.votrax.setInflection(v >> 6); this.votrax.write(~v & 0x3f); break;
      case 3: {
        const d = Math.max(0x65, v);
        if (d !== this.speechClock) { this.speechClock = d; this.votrax.setClock(720000 * d / 0xa0); }
        break;
      }
    }
  }

  // ---- inputs --------------------------------------------------------------------------------
  // The Q*bert stick is mounted at 45 degrees: each of its four directions is a diagonal hop.
  // Arrow keys are rotated a quarter turn so that Up = up-right, Right = down-right,
  // Down = down-left, Left = up-left.
  setInput(s) {
    this.in1 = 0x70 | (s.start1 ? 0x01 : 0) | (s.start2 ? 0x02 : 0) | (s.coin ? 0x04 : 0);
    this.in4 = (s.up ? 0x04 : 0) | (s.right ? 0x01 : 0) | (s.down ? 0x08 : 0) | (s.left ? 0x02 : 0);
  }

  // ---- frame -----------------------------------------------------------------------------------
  runFrame() {
    for (let line = 0; line < LINES; line++) {
      if (line === VBLANK_LINE) { this.snapshot(); this.cpu.nmi(); }
      this.mainAcc += HTOTAL;
      while (this.mainAcc > 0) this.mainAcc -= this.cpu.step();
      this.sndAcc += SND_PER_LINE;
      while (this.sndAcc > 0) {
        const c = this.snd.step();
        this.sndAcc -= c;
        this.riot.clock(c);
        this.audioClock(c);
      }
    }
    this.frame++;
  }

  audioClock(c) {
    this.dacAcc += this.dac * c; this.dacN += c;
    this.sampleAcc += c;
    while (this.sampleAcc >= this.cyclesPerSample) {
      this.sampleAcc -= this.cyclesPerSample;
      const d = this.dacN ? this.dacAcc / this.dacN : this.dac;
      this.dacAcc = 0; this.dacN = 0;
      let x = (d / 255) * 2 - 1;
      x += this.votrax.sample() * 0.6;
      if (this.knock > 0.001) {
        this.knockPhase += 2 * Math.PI * (55 + 90 * this.knock) / this.sampleRate;
        x += Math.sin(this.knockPhase) * this.knock * 0.9 + (Math.random() - 0.5) * this.knock * this.knock * 0.6;
        this.knock *= 0.9993;
      }
      const hp = 0.997 * (this.hpOut + x - this.hpPrev);
      this.hpPrev = x; this.hpOut = hp;
      this.lp += (hp - this.lp) * 0.6;
      if (this.audioLen < this.audioBuf.length) this.audioBuf[this.audioLen++] = Math.max(-1, Math.min(1, this.lp * 0.55));
    }
  }

  takeAudio() {
    const out = this.audioBuf.slice(0, this.audioLen);
    this.audioLen = 0;
    return out;
  }

  // ---- video -------------------------------------------------------------------------------------
  snapshot() {
    this.shot = { vram: this.videoRam.slice(), sr: this.spriteRam.slice(), ctrl: this.videoControl };
  }

  tileGraphic(code) {
    // tiles come from ROM unless the game has written character RAM for that half
    if (!this.charRamUsed[code >> 7]) return this.tileGfx[code];
    let g = this.ramTileGfx[code];
    if (!g) g = this.ramTileGfx[code] = Qbert.decodeTile(this.charRam, code * 32);
    return g;
  }

  spriteList(sh) {
    const list = [];
    for (let offs = 0; offs < 256; offs += 4) {
      const sx = sh.sr[offs + 1] - 4, sy = sh.sr[offs] - 13;
      const code = (255 ^ sh.sr[offs + 2]) & 0xff;
      list.push({ code, sx, sy, slot: offs >> 2 });
    }
    return list;
  }

  // raw 256x256 frame (palette indices; 0x10 marks transparent background for compositing)
  rawFrame(sh) {
    const fb = this.fb || (this.fb = new Uint8Array(256 * 256));
    const prio = sh.ctrl & 1;
    const drawBg = opaque => {
      for (let row = 0; row < 30; row++) {
        for (let col = 0; col < 32; col++) {
          const g = this.tileGraphic(sh.vram[row * 32 + col]);
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const p = g[y * 8 + x];
              if (p || opaque) fb[(row * 8 + y) * 256 + col * 8 + x] = p;
            }
          }
        }
      }
    };
    if (!prio) drawBg(true); else fb.fill(0);
    for (const s of this.spriteList(sh)) {
      const g = this.spriteGfx[s.code];
      for (let y = 0; y < 16; y++) {
        const yy = s.sy + y;
        if (yy < 0 || yy >= 240) continue;
        for (let x = 0; x < 16; x++) {
          const xx = s.sx + x;
          if (xx < 8 || xx >= 256) continue;
          const p = g[y * 16 + x];
          if (p) fb[yy * 256 + xx] = p;
        }
      }
    }
    if (prio) drawBg(false);
    return fb;
  }

  // raw (256 wide x 240 visible) -> display 240x256, rotated 270 degrees
  renderClassic(out) {
    const sh = this.shot;
    if (!sh) return;
    const fb = this.rawFrame(sh), pal = this.palette;
    for (let dy = 0; dy < H; dy++) {
      const rx = 255 - dy;
      for (let dx = 0; dx < W; dx++) {
        const c = pal[fb[dx * 256 + rx]];
        const o = (dy * W + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  }

  // ---- remaster scene (display orientation) -------------------------------------------------------
  rotTile(code) {
    const cache = this.rtCache || (this.rtCache = new Map());
    const g = this.tileGraphic(code);
    let d = cache.get(g);
    if (d) return d;
    d = new Uint8Array(64);
    // display pixel (px,py) <- raw (x = 7 - py, y = px)
    for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) d[py * 8 + px] = g[px * 8 + 7 - py];
    cache.set(g, d);
    return d;
  }

  rotSprite(code) {
    const cache = this.rsCache || (this.rsCache = new Map());
    if (cache.has(code)) return cache.get(code);
    const g = this.spriteGfx[code];
    const d = new Uint8Array(256);
    let any = false;
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const p = g[px * 16 + 15 - py];
        if (p) { d[py * 16 + px] = p; any = true; }
      }
    }
    cache.set(code, any ? d : null);
    return any ? d : null;
  }

  displayScene() {
    const sh = this.shot;
    if (!sh) return { tiles: [], sprites: [] };
    const tiles = [], sprites = [];
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const code = sh.vram[row * 32 + col];
        const g = this.tileGraphic(code);
        let any = false;
        for (let i = 0; i < 64; i++) if (g[i]) { any = true; break; }
        if (!any) continue;
        const pixels = this.rotTile(code);
        tiles.push({ x: row * 8, y: 248 - col * 8, w: 8, h: 8, code, pal: 0, kind: qbTileKind(row * 8, 248 - col * 8), pixels, col, row });
      }
    }
    for (const s of this.spriteList(sh)) {
      if (s.sy <= -16 || s.sy >= 240 || s.sx >= 256) continue;
      let pixels = this.rotSprite(s.code);
      if (!pixels) continue;
      const x = s.sy, y = 240 - s.sx;
      if (x <= -16 || x >= W || y <= -16 || y >= H) continue;
      // the hardware hides sprite pixels left of raw x = 8 (display y >= 248) and outside the 240 visible lines
      if (y > 232 || x < 0 || x > W - 16) {
        let any = false;
        const cut = pixels.slice();
        for (let py = 0; py < 16; py++) {
          for (let px = 0; px < 16; px++) {
            if (y + py >= 248 || x + px < 0 || x + px >= W) cut[py * 16 + px] = 0;
            else if (cut[py * 16 + px]) any = true;
          }
        }
        if (!any) continue;
        pixels = cut;
      }
      sprites.push({ x, y, w: 16, h: 16, code: s.code, pal: 0, pixels, kind: 'other', slot: s.slot, order: s.slot });
    }
    return { tiles, sprites, prio: sh.ctrl & 1 };
  }
}

// Tiles inside the pyramid's triangle are cube art; everything else is HUD text and icons.
export function qbTileKind(x, y) {
  const cx = x + 4, cy = y + 4;
  if (cy < 40 || cy > 232) return 'hud';
  return Math.abs(cx - 120) <= 16 + (cy - 48) * (2 / 3) + 4 ? 'cube' : 'hud';
}
