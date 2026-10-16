// Nintendo Donkey Kong (TKG-4 board, US set 1) machine emulation.
// Main CPU: Z80 @ 3.072 MHz.  Sound CPU: i8035 @ 6 MHz (400 kHz machine cycles) + discrete sounds.
// Video: 32x32 tilemap of 8x8 chars, 16x16 sprites, 256x224 visible, rotated 270 degrees.

import { Z80 } from '../cpu/z80.js';
import { I8035 } from '../cpu/i8035.js';
import { decodePlanar } from '../gfx.js';
import { DkDiscrete } from '../audio/dk-discrete.js';

const MAIN_HZ = 3072000;
const FPS = 6144000 / 384 / 264;          // 60.606 Hz
const LINES = 264;
const MAIN_PER_LINE = MAIN_HZ / FPS / LINES;  // 192
const SND_HZ = 6000000 / 15;
const SND_PER_LINE = SND_HZ / FPS / LINES;
const VBLANK_LINE = 240;

export const DK_INFO = {
  id: 'dkong',
  title: 'Donkey Kong',
  zip: 'dkong.zip',
  fps: FPS,
  width: 224, height: 256,        // display orientation (after rotation)
  files: ['c_5et_g.bin', 'c_5ct_g.bin', 'c_5bt_g.bin', 'c_5at_g.bin', 's_3i_b.bin', 's_3j_b.bin',
    'v_5h_b.bin', 'v_3pt.bin', 'l_4m_b.bin', 'l_4n_b.bin', 'l_4r_b.bin', 'l_4s_b.bin',
    'c-2k.bpr', 'c-2j.bpr', 'v-5e.bpr'],
  buttons: ['Jump'],
};

// Tile semantics for the remastered renderer.
//  struct: girders / ladders / conveyors (pixel value 3 = ladder, 1-2 = steel)
//  hud:    text, digits, bonus box, HELP balloon, life icons
//  art:    anything else (title-screen Kong pieces etc.)
const HELP_TILES = new Set([0xdc, 0xdd, 0xde, 0xdf, 0xec, 0xed, 0xee, 0xef, 0xfb, 0xfc, 0xfd, 0xfe, 0xff]);
export function dkTileKind(code) {
  if (HELP_TILES.has(code)) return 'hud';
  if (code >= 0xb0) return 'struct';
  if (code < 0x40 || (code >= 0x70 && code < 0xb0)) return 'hud';
  return 'art';
}

// Sprite semantics: player (Mario), fire (light sources), hud (score pop-ups), other.
export function dkSpriteKind(code) {
  if (code < 0x10) return 'player';
  if ((code >= 0x40 && code <= 0x43) || code === 0x3d || code === 0x3e || code === 0x4d || code === 0x4e) return 'fire';
  if (code >= 0x7b) return 'hud';
  return 'other';
}

function buildPalette(lo, hi) {
  // Resistor network (1k/470/220 for R,G; 470/220 for B) with inverted PROM outputs.
  const w3 = [1 / 1000, 1 / 470, 1 / 220], w2 = [1 / 470, 1 / 220];
  const s3 = w3[0] + w3[1] + w3[2], s2 = w2[0] + w2[1];
  const pal = new Array(256);
  for (let i = 0; i < 256; i++) {
    const r3 = ((hi[i] >> 1) & 7) ^ 7;
    const g3 = (((hi[i] << 2) & 4) | ((lo[i] >> 2) & 3)) ^ 7;
    const b2 = (lo[i] & 3) ^ 3;
    const c3 = v => Math.round(255 * ((v & 1 ? w3[0] : 0) + (v & 2 ? w3[1] : 0) + (v & 4 ? w3[2] : 0)) / s3);
    const c2 = v => Math.round(255 * ((v & 1 ? w2[0] : 0) + (v & 2 ? w2[1] : 0)) / s2);
    pal[i] = [c3(r3), c3(g3), c2(b2)];
    if ((i & 3) === 0) pal[i] = [0, 0, 0];
  }
  return pal;
}

export class DonkeyKong {
  static info = DK_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = DK_INFO;
    this.rom = new Uint8Array(0x4000);
    this.rom.set(get('c_5et_g.bin'), 0x0000);
    this.rom.set(get('c_5ct_g.bin'), 0x1000);
    this.rom.set(get('c_5bt_g.bin'), 0x2000);
    this.rom.set(get('c_5at_g.bin'), 0x3000);

    this.sndRom = new Uint8Array(0x1800);
    this.sndRom.set(get('s_3i_b.bin'), 0x0000);
    this.sndRom.set(get('s_3i_b.bin'), 0x0800);
    this.sndRom.set(get('s_3j_b.bin'), 0x1000);

    // graphics: chars 2bpp planes separated by half region; sprites 16x16 split in halves
    const chars = new Uint8Array(0x1000);
    chars.set(get('v_5h_b.bin'), 0); chars.set(get('v_3pt.bin'), 0x800);
    this.tileGfx = decodePlanar(chars, { w: 8, h: 8, count: 256, planes: [0x800 * 8, 0], xoff: [0, 1, 2, 3, 4, 5, 6, 7], yoff: [0, 8, 16, 24, 32, 40, 48, 56], stride: 64 });
    const spr = new Uint8Array(0x2000);
    spr.set(get('l_4m_b.bin'), 0x0000); spr.set(get('l_4n_b.bin'), 0x0800);
    spr.set(get('l_4r_b.bin'), 0x1000); spr.set(get('l_4s_b.bin'), 0x1800);
    const xo = []; for (let i = 0; i < 8; i++) xo.push(i); for (let i = 0; i < 8; i++) xo.push(0x800 * 8 + i);
    const yo = []; for (let i = 0; i < 16; i++) yo.push(i * 8);
    this.spriteGfx = decodePlanar(spr, { w: 16, h: 16, count: 128, planes: [0x1000 * 8, 0], xoff: xo, yoff: yo, stride: 128 });

    this.palette = buildPalette(get('c-2k.bpr'), get('c-2j.bpr'));
    this.colorCodes = get('v-5e.bpr');

    this.ram = new Uint8Array(0x0c00);
    this.spriteRam = new Uint8Array(0x400);
    this.videoRam = new Uint8Array(0x400);

    this.input = { in0: 0, in1: 0, in2: 0 };
    this.dsw0 = 0x80;  // 3 lives, 7000 bonus, 1 coin/1 credit, upright

    this.flip = 0; this.spriteBank = 0; this.nmiMask = 0; this.paletteBank = 0;
    this.dma = { regs: new Uint16Array(8), ff: 0, mode: 0, drq: 0 };
    this.soundLatch = 0; this.sound6h = 0; this.sndP2 = 0xff; this.sndIrq = 0;

    this.cpu = new Z80(this);
    this.snd = new I8035({
      rom: this.sndRom.subarray(0, 0x1000),
      extRead: a => {
        const page = this.sndP2 & 0x47;
        if (page & 0x40) return (this.soundLatch & 0x0f) ^ 0x0f;
        return this.sndRom[0x1000 + (page & 7) * 256 + a];
      },
      extWrite: () => {},
      p1Read: () => 0xff,
      p2Read: () => (((this.sndP2 & ~0x20) | (((this.sound6h >> 3) & 1) << 5)) ^ 0x20),
      p1Write: v => { this.audio.dac(v); },
      p2Write: v => { this.sndP2 = v; this.audio.discharge((v >> 7) & 1); },
      t0: () => !((this.sound6h >> 5) & 1),
      t1: () => !((this.sound6h >> 4) & 1),
      busRead: () => 0xff,
      busWrite: () => {},
    });
    this.audio = new DkDiscrete(SND_HZ, sampleRate);
    this.mainAcc = 0; this.sndAcc = 0;
    this.frame = 0;
  }

  // ---- bus ------------------------------------------------------------------
  read(a) {
    if (a < 0x4000) return this.rom[a];
    if (a >= 0x6000 && a < 0x6c00) return this.ram[a - 0x6000];
    if (a >= 0x7000 && a < 0x7400) return this.spriteRam[a - 0x7000];
    if (a >= 0x7400 && a < 0x7800) return this.videoRam[a - 0x7400];
    switch (a) {
      case 0x7c00: return this.input.in0;
      case 0x7c80: return this.input.in1;
      case 0x7d00: return this.input.in2 & 0xbf;
      case 0x7d80: return this.dsw0;
    }
    return 0;
  }

  write(a, v) {
    if (a >= 0x6000 && a < 0x6c00) { this.ram[a - 0x6000] = v; return; }
    if (a >= 0x7000 && a < 0x7400) { this.spriteRam[a - 0x7000] = v; return; }
    if (a >= 0x7400 && a < 0x7800) { this.videoRam[a - 0x7400] = v; return; }
    if (a >= 0x7800 && a < 0x7810) { this.dmaWrite(a & 0x0f, v); return; }
    if (a === 0x7c00) { this.soundLatch = v; return; }
    if (a >= 0x7d00 && a <= 0x7d07) {
      const bit = a & 7;
      this.sound6h = (this.sound6h & ~(1 << bit)) | ((v & 1) << bit);
      if (bit < 3) this.audio.trigger(bit, v & 1);
      return;
    }
    switch (a) {
      case 0x7d80: this.sndIrq = v & 1; this.snd.setIrq(this.sndIrq); break;
      case 0x7d82: this.flip = (~v) & 1; break;
      case 0x7d83: this.spriteBank = v & 1; break;
      case 0x7d84: this.nmiMask = v & 1; break;
      case 0x7d85: {
        const drq = v & 1;
        if (drq && !this.dma.drq) this.dmaTransfer();
        this.dma.drq = drq;
        break;
      }
      case 0x7d86: this.paletteBank = (this.paletteBank & 2) | (v & 1); break;
      case 0x7d87: this.paletteBank = (this.paletteBank & 1) | ((v & 1) << 1); break;
    }
  }
  in() { return 0xff; }
  out() {}

  dmaWrite(reg, v) {
    const d = this.dma;
    if (reg < 8) {
      const cur = d.regs[reg];
      d.regs[reg] = d.ff ? (cur & 0x00ff) | (v << 8) : (cur & 0xff00) | v;
      d.ff ^= 1;
    } else if (reg === 8) { d.mode = v; d.ff = 0; }
  }

  dmaTransfer() {
    // 8257 memory-to-memory: channel 0 reads, channel 1 writes
    const d = this.dma;
    let src = d.regs[0], dst = d.regs[2];
    const count = (d.regs[1] & 0x3fff) + 1;
    for (let i = 0; i < count; i++) {
      this.write((dst + i) & 0xffff, this.read((src + i) & 0xffff));
    }
  }

  // ---- inputs -------------------------------------------------------------
  // state: { left, right, up, down, b1, start1, start2, coin } (+ p2 variants unused)
  setInput(s) {
    this.input.in0 = (s.right ? 1 : 0) | (s.left ? 2 : 0) | (s.up ? 4 : 0) | (s.down ? 8 : 0) | (s.b1 ? 0x10 : 0);
    this.input.in1 = this.input.in0;
    this.input.in2 = (s.start1 ? 4 : 0) | (s.start2 ? 8 : 0) | (s.coin ? 0x80 : 0);
  }

  // ---- frame --------------------------------------------------------------
  runFrame() {
    for (let line = 0; line < LINES; line++) {
      if (line === VBLANK_LINE) {
        this.snapshot();
        if (this.nmiMask) this.cpu.nmi();
      }
      this.mainAcc += MAIN_PER_LINE;
      while (this.mainAcc > 0) this.mainAcc -= this.cpu.step();
      this.sndAcc += SND_PER_LINE;
      while (this.sndAcc > 0) {
        const c = this.snd.step();
        this.sndAcc -= c;
        this.audio.clock(c);
      }
    }
    this.frame++;
  }

  // Capture the video state at vblank so renderers see a consistent frame.
  snapshot() {
    this.shotVram = this.videoRam.slice();
    this.shotSprites = this.spriteRam.slice((this.spriteBank << 9), (this.spriteBank << 9) + 0x200);
    this.shotPalBank = this.paletteBank;
    this.shotFlip = this.flip;
  }

  takeAudio() { return this.audio.take(); }

  // ---- video: produce a renderer-neutral description ----------------------
  // Coordinates are in DISPLAY orientation (224 wide x 256 tall).
  // Raw hardware space is 256x224 (x = scanline position, y = scanline 16..239); display rotates 270.
  rawToDisplay(x, y) { return [239 - y, x]; }

  getScene() {
    if (!this.shotVram) this.snapshot();
    const vram = this.shotVram, pb = this.shotPalBank;
    const tiles = [];
    for (let row = 2; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const i = row * 32 + col;
        const code = vram[i];
        const color = (this.colorCodes[col + 32 * (row >> 2)] & 0x0f) + 16 * pb;
        // raw tile at (col*8, row*8) -> display
        tiles.push({ code, color, rx: col * 8, ry: row * 8, col, row });
      }
    }
    const sprites = [];
    const sr = this.shotSprites;
    for (let o = 0; o < 0x200; o += 4) {
      if (!sr[o]) continue;
      const code = sr[o + 1] & 0x7f;
      const color = (sr[o + 2] & 0x0f) + 16 * pb;
      let flipx = !!(sr[o + 2] & 0x80), flipy = !!(sr[o + 1] & 0x80);
      let x = sr[o + 3] - 8, y = 240 - sr[o] + 7;
      if (this.shotFlip) { x = 240 - x; y = 240 - y; flipx = !flipx; flipy = !flipy; }
      sprites.push({ code, color, flipx, flipy, rx: x, ry: y, slot: o >> 2 });
    }
    return { tiles, sprites, flip: this.shotFlip };
  }

  // ---- remaster support: display-oriented objects + semantic hints ---------
  tileDisp(code) {
    const cache = this.tdCache || (this.tdCache = new Array(256));
    if (cache[code]) return cache[code];
    const g = this.tileGfx[code], d = new Uint8Array(64);
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) d[dy * 8 + dx] = g[(7 - dx) * 8 + dy];
    return (cache[code] = d);
  }

  spriteDisp(code, flipx, flipy) {
    const cache = this.sdCache || (this.sdCache = new Map());
    const key = code | (flipx ? 0x100 : 0) | (flipy ? 0x200 : 0);
    let d = cache.get(key);
    if (d) return d;
    const g = this.spriteGfx[code];
    d = new Uint8Array(256);
    for (let dy = 0; dy < 16; dy++) {
      for (let dx = 0; dx < 16; dx++) {
        const px = dy, py = 15 - dx;
        const sx = flipx ? 15 - px : px, sy = flipy ? 15 - py : py;
        d[dy * 16 + dx] = g[sy * 16 + sx];
      }
    }
    cache.set(key, d);
    return d;
  }

  // Returns { tiles, sprites } with x,y in display pixels (224x256, origin top-left).
  displayScene() {
    const sc = this.getScene();
    const tiles = [], sprites = [];
    for (const t of sc.tiles) {
      if (t.code === 0x10) continue;
      tiles.push({ x: 239 - t.ry - 7, y: t.rx, w: 8, h: 8, code: t.code, color: t.color, kind: dkTileKind(t.code), pixels: this.tileDisp(t.code) });
    }
    for (const s of sc.sprites) {
      const x = 239 - s.ry - 15, y = s.rx;
      if (x <= -16 || x >= 224 || y <= -16 || y >= 256) continue;
      sprites.push({ x, y, w: 16, h: 16, code: s.code, color: s.color, kind: dkSpriteKind(s.code), pixels: this.spriteDisp(s.code, s.flipx, s.flipy), hflip: s.flipy, vflip: s.flipx, slot: s.slot });
    }
    return { tiles, sprites };
  }

  // Render the classic pixel-exact frame into an RGBA Uint8ClampedArray of 224x256.
  renderClassic(out) {
    const W = 224, H = 256;
    const scene = this.getScene();
    const pal = this.palette;
    const flip = scene.flip;
    // raw framebuffer (index into palette, 0xffff = transparent)
    const fb = this.fb || (this.fb = new Uint16Array(256 * 256));
    for (const t of scene.tiles) {
      const g = this.tileGfx[t.code];
      const base = t.color * 4;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          let x = t.rx + px, y = t.ry + py;
          if (flip) { x = 255 - x; y = 255 - y; }
          fb[y * 256 + x] = base + g[py * 8 + px];
        }
      }
    }
    for (const s of scene.sprites) {
      const g = this.spriteGfx[s.code];
      const base = s.color * 4;
      for (let py = 0; py < 16; py++) {
        const sy = s.flipy ? 15 - py : py;
        const y = s.ry + py;
        if (y < 16 || y >= 240) continue;
        for (let px = 0; px < 16; px++) {
          const sx = s.flipx ? 15 - px : px;
          const p = g[sy * 16 + sx];
          if (!p) continue;
          const x = (s.rx + px) & 0xff;
          fb[y * 256 + x] = base + p;
        }
      }
    }
    for (let dy = 0; dy < H; dy++) {
      for (let dx = 0; dx < W; dx++) {
        const rx = dy, ry = 239 - dx;
        const c = pal[fb[ry * 256 + rx]];
        const o = (dy * W + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  }
}
