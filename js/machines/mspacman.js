// Midway Ms. Pac-Man: Namco Pac-Man board + Midway auxiliary board.
// Z80 @ 3.072 MHz with IM2 vblank interrupt; 36x28 tilemap of 8x8 tiles, 8 hardware sprites (16x16);
// Namco WSG 3-voice wavetable sound (96 kHz). The aux board overlays encrypted ROMs and patches,
// switched in/out by accesses to specific "trap" addresses. Screen is rotated 90 degrees.

import { Z80 } from '../cpu/z80.js';

const FPS = 6144000 / 384 / 264;            // 60.61 Hz
const LINES = 264;
const MAIN_PER_LINE = 3072000 / FPS / LINES;
const VBLANK_LINE = 224;
const WSG_HZ = 96000;

export const MSP_INFO = {
  id: 'mspacman',
  title: 'Ms. Pac-Man',
  zip: 'mspacman.zip',
  fps: FPS,
  width: 224, height: 288,
  files: ['pacman.6e', 'pacman.6f', 'pacman.6h', 'pacman.6j', 'u5', 'u6', 'u7', '5e', '5f', '82s123.7f', '82s126.4a', '82s126.1m'],
  buttons: [],
};

// MAME-style bitswap: bits listed from most significant to least significant
function bitswap(v, bits) {
  let r = 0;
  const n = bits.length;
  for (let i = 0; i < n; i++) r |= ((v >> bits[i]) & 1) << (n - 1 - i);
  return r;
}
const DATA_SWAP = [0, 4, 5, 7, 6, 3, 2, 1];

function weights(res) {
  const g = res.map(r => 1 / r), t = g.reduce((a, b) => a + b, 0);
  return g.map(x => (x / t) * 255);
}

export class MsPacman {
  static info = MSP_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = MSP_INFO;
    // ---- program ROMs: normal bank (Pac-Man) and decoded bank (Ms. Pac-Man) ----
    const ROM = new Uint8Array(0x10000), DROM = new Uint8Array(0x10000);
    ROM.set(get('pacman.6e'), 0x0000); ROM.set(get('pacman.6f'), 0x1000);
    ROM.set(get('pacman.6h'), 0x2000); ROM.set(get('pacman.6j'), 0x3000);
    ROM.set(get('u5'), 0x8000); ROM.set(get('u6'), 0x9000); ROM.set(get('u7'), 0xb000);
    for (let i = 0; i < 0x1000; i++) {
      DROM[0x0000 + i] = ROM[0x0000 + i];
      DROM[0x1000 + i] = ROM[0x1000 + i];
      DROM[0x2000 + i] = ROM[0x2000 + i];
      DROM[0x3000 + i] = bitswap(ROM[0xb000 + bitswap(i, [11, 3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], DATA_SWAP);
    }
    for (let i = 0; i < 0x800; i++) {
      DROM[0x8000 + i] = bitswap(ROM[0x8000 + bitswap(i, [8, 7, 5, 9, 10, 6, 3, 4, 2, 1, 0])], DATA_SWAP);
      DROM[0x8800 + i] = bitswap(ROM[0x9800 + bitswap(i, [3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], DATA_SWAP);
      DROM[0x9000 + i] = bitswap(ROM[0x9000 + bitswap(i, [3, 7, 9, 10, 8, 6, 5, 4, 2, 1, 0])], DATA_SWAP);
      DROM[0x9800 + i] = ROM[0x1800 + i];
    }
    for (let i = 0; i < 0x1000; i++) { DROM[0xa000 + i] = ROM[0x2000 + i]; DROM[0xb000 + i] = ROM[0x3000 + i]; }
    const patches = [
      [0x0410, 0x8008], [0x08e0, 0x81d8], [0x0a30, 0x8118], [0x0bd0, 0x80d8], [0x0c20, 0x8120], [0x0e58, 0x8168], [0x0ea8, 0x8198],
      [0x1000, 0x8020], [0x1008, 0x8010], [0x1288, 0x8098], [0x1348, 0x8048], [0x1688, 0x8088], [0x16b0, 0x8188], [0x16d8, 0x80c8],
      [0x16f8, 0x81c8], [0x19a8, 0x80a8], [0x19b8, 0x81a8], [0x2060, 0x8148], [0x2108, 0x8018], [0x21a0, 0x81a0], [0x2298, 0x80a0],
      [0x23e0, 0x80e8], [0x2418, 0x8000], [0x2448, 0x8058], [0x2470, 0x8140], [0x2488, 0x8080], [0x24b0, 0x8180], [0x24d8, 0x80c0],
      [0x24f8, 0x81c0], [0x2748, 0x8050], [0x2780, 0x8090], [0x27b8, 0x8190], [0x2800, 0x8028], [0x2b20, 0x8100], [0x2b30, 0x8110],
      [0x2bf0, 0x81d0], [0x2cc0, 0x80d0], [0x2cd8, 0x80e0], [0x2cf0, 0x81e0], [0x2d60, 0x8160],
    ];
    for (const [dst, src] of patches) for (let i = 0; i < 8; i++) DROM[dst + i] = DROM[src + i];
    for (let i = 0; i < 0x1000; i++) {
      ROM[0x8000 + i] = ROM[0x0000 + i]; ROM[0x9000 + i] = ROM[0x1000 + i];
      ROM[0xa000 + i] = ROM[0x2000 + i]; ROM[0xb000 + i] = ROM[0x3000 + i];
    }
    this.banks = [ROM, DROM];
    this.bank = 0;

    // ---- graphics ----
    const t = get('5e'), s = get('5f');
    this.tileGfx = [];
    for (let c = 0; c < 256; c++) {
      const g = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const byte = t[c * 16 + (x < 4 ? 8 : 0) + y], b = x & 3;
          g[y * 8 + x] = (((byte >> (7 - b)) & 1) << 1) | ((byte >> (3 - b)) & 1);
        }
      }
      this.tileGfx.push(g);
    }
    const SX = [8, 16, 24, 0];
    this.spriteGfx = [];
    for (let c = 0; c < 64; c++) {
      const g = new Uint8Array(256);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const byte = s[c * 64 + SX[x >> 2] + (y < 8 ? y : 32 + y - 8)], b = x & 3;
          g[y * 16 + x] = (((byte >> (7 - b)) & 1) << 1) | ((byte >> (3 - b)) & 1);
        }
      }
      this.spriteGfx.push(g);
    }

    // ---- palette: 32 colours, 256-entry lookup (64 colour codes x 4) ----
    const prom = get('82s123.7f'), lut = get('82s126.4a');
    const w3 = weights([1000, 470, 220]), w2 = weights([470, 220]);
    const cols = [];
    for (let i = 0; i < 32; i++) {
      const v = prom[i];
      cols.push([
        Math.round((v & 1 ? w3[0] : 0) + (v & 2 ? w3[1] : 0) + (v & 4 ? w3[2] : 0)),
        Math.round((v & 8 ? w3[0] : 0) + (v & 16 ? w3[1] : 0) + (v & 32 ? w3[2] : 0)),
        Math.round((v & 64 ? w2[0] : 0) + (v & 128 ? w2[1] : 0)),
      ]);
    }
    this.lut = new Uint8Array(256);
    this.palette = [];
    for (let i = 0; i < 256; i++) { this.lut[i] = lut[i] & 0x0f; this.palette.push(cols[this.lut[i]]); }

    // ---- sound ----
    this.wave = Array.from(get('82s126.1m'), v => (v & 0x0f) - 8);
    this.soundRegs = new Uint8Array(32);
    this.voices = [0, 1, 2].map(() => ({ acc: 0 }));
    this.soundOn = 0;

    // ---- RAM / IO ----
    this.vram = new Uint8Array(0x400);
    this.cram = new Uint8Array(0x400);
    this.ram = new Uint8Array(0x3f0);         // 0x4c00-0x4fef
    this.spriteRam = new Uint8Array(16);      // 0x4ff0-0x4fff
    this.spriteRam2 = new Uint8Array(16);     // 0x5060-0x506f
    this.latch = new Uint8Array(8);
    this.irqVector = 0;
    this.input = { in0: 0xff, in1: 0xff };
    this.dsw1 = 0xc9;  // 1 coin/1 credit, 3 lives, bonus 10000, normal difficulty
    this.dsw2 = 0xff;

    this.cpu = new Z80({ read: a => this.read(a), write: (a, v) => this.write(a, v), in: () => 0xff, out: (p, v) => { if ((p & 0xff) === 0) this.irqVector = v; } });
    this.sampleRate = sampleRate;
    this.wsgPerSample = WSG_HZ / sampleRate;
    this.wsgAcc = 0;
    this.audioBuf = new Float32Array(sampleRate);
    this.audioLen = 0;
    this.hpPrev = 0; this.hpOut = 0; this.lp = 0;
    this.mainAcc = 0;
    this.frame = 0;
  }

  // aux-board trap addresses that switch the decoded bank in or out
  trap(a) {
    if (a >= 0x3ff8 && a <= 0x3fff) { this.bank = 1; return; }
    if ((a >= 0x0038 && a <= 0x003f) || (a >= 0x03b0 && a <= 0x03b7) || (a >= 0x1600 && a <= 0x1607) ||
      (a >= 0x2120 && a <= 0x2127) || (a >= 0x3ff0 && a <= 0x3ff7) || (a >= 0x8000 && a <= 0x8007) ||
      (a >= 0x97f0 && a <= 0x97f7)) this.bank = 0;
  }

  read(a) {
    const r = a & 0x7fff;
    if (r < 0x4000) {
      // the trap ranges return data from the bank they switch to
      this.trap(a);
      return this.banks[this.bank][a];
    }
    const m = a & 0x5fff;  // RAM / IO mirror on A13 and A15
    if (m < 0x4400) return this.vram[m - 0x4000];
    if (m < 0x4800) return this.cram[m - 0x4400];
    if (m < 0x4c00) return 0xbf;
    if (m < 0x4ff0) return this.ram[m - 0x4c00];
    if (m < 0x5000) return this.spriteRam[m - 0x4ff0];
    switch (m & 0x50c0) {
      case 0x5000: return this.input.in0;
      case 0x5040: return this.input.in1;
      case 0x5080: return this.dsw1;
      case 0x50c0: return this.dsw2;
    }
    return 0xff;
  }

  write(a, v) {
    const r = a & 0x7fff;
    if (r < 0x4000) { this.trap(a); return; }
    const m = a & 0x5fff;
    if (m < 0x4400) { this.vram[m - 0x4000] = v; return; }
    if (m < 0x4800) { this.cram[m - 0x4400] = v; return; }
    if (m < 0x4c00) return;
    if (m < 0x4ff0) { this.ram[m - 0x4c00] = v; return; }
    if (m < 0x5000) { this.spriteRam[m - 0x4ff0] = v; return; }
    const io = m & 0x50ff;
    if (io >= 0x5000 && io < 0x5008) {
      const bit = io & 7;
      this.latch[bit] = v & 1;
      if (bit === 0 && !(v & 1)) this.cpu.setIrq(false);
      if (bit === 1) this.soundOn = v & 1;
      return;
    }
    if (io >= 0x5040 && io < 0x5060) { this.soundRegs[io - 0x5040] = v & 0x0f; return; }
    if (io >= 0x5060 && io < 0x5070) { this.spriteRam2[io - 0x5060] = v; return; }
  }

  setInput(s) {
    this.input.in0 = ~((s.up ? 1 : 0) | (s.left ? 2 : 0) | (s.right ? 4 : 0) | (s.down ? 8 : 0) | (s.coin ? 0x20 : 0)) & 0xff;
    this.input.in1 = ~((s.start1 ? 0x20 : 0) | (s.start2 ? 0x40 : 0)) & 0xff;
  }

  runFrame() {
    for (let line = 0; line < LINES; line++) {
      if (line === VBLANK_LINE) {
        this.snapshot();
        if (this.latch[0]) this.cpu.setIrq(true, this.irqVector);
      }
      this.mainAcc += MAIN_PER_LINE;
      while (this.mainAcc > 0) this.mainAcc -= this.cpu.step();
      // the IRQ line stays asserted until the game clears the mask; keep the vector current
      this.cpu.irqVector = this.irqVector;
    }
    this.generateAudio();
    this.frame++;
  }

  generateAudio() {
    const R = this.soundRegs;
    const freq = [
      R[0x10] | (R[0x11] << 4) | (R[0x12] << 8) | (R[0x13] << 12) | (R[0x14] << 16),
      (R[0x16] << 4) | (R[0x17] << 8) | (R[0x18] << 12) | (R[0x19] << 16),
      (R[0x1b] << 4) | (R[0x1c] << 8) | (R[0x1d] << 12) | (R[0x1e] << 16),
    ];
    const vol = [R[0x15], R[0x1a], R[0x1f]];
    const wsel = [R[0x05] & 7, R[0x0a] & 7, R[0x0f] & 7];
    const n = Math.round(this.sampleRate / FPS + (this.fracSamples || 0));
    this.fracSamples = (this.sampleRate / FPS + (this.fracSamples || 0)) - n;
    for (let i = 0; i < n; i++) {
      this.wsgAcc += this.wsgPerSample;
      let sum = 0, cnt = 0;
      while (this.wsgAcc >= 1) {
        this.wsgAcc -= 1;
        for (let v = 0; v < 3; v++) {
          const voice = this.voices[v];
          if (this.soundOn && vol[v]) sum += this.wave[wsel[v] * 32 + ((voice.acc >> 15) & 31)] * vol[v];
          voice.acc = (voice.acc + freq[v]) & 0xfffff;
        }
        cnt++;
      }
      const x = cnt ? sum / cnt / 300 : 0;
      const hp = 0.996 * (this.hpOut + x - this.hpPrev);
      this.hpPrev = x; this.hpOut = hp;
      this.lp += (hp - this.lp) * 0.6;
      if (this.audioLen < this.audioBuf.length) this.audioBuf[this.audioLen++] = Math.max(-1, Math.min(1, this.lp));
    }
  }

  takeAudio() {
    const out = this.audioBuf.slice(0, this.audioLen);
    this.audioLen = 0;
    return out;
  }

  // ---- video ------------------------------------------------------------------
  snapshot() {
    this.shot = { vram: this.vram.slice(), cram: this.cram.slice(), sr: this.spriteRam.slice(), sr2: this.spriteRam2.slice(), flip: this.latch[3] };
  }

  // tilemap column/row (36x28, raw orientation) -> video RAM offset
  static tileOffset(col, row) {
    row += 2; col -= 2;
    return (col & 0x20) ? row + ((col & 0x1f) << 5) : col + (row << 5);
  }

  spriteList(sh) {
    const list = [];
    for (let offs = 14; offs >= 0; offs -= 2) {
      const sx = 272 - sh.sr2[offs + 1];
      let sy = sh.sr2[offs] - 31;
      if (offs <= 4) sy += 1;
      list.push({ code: sh.sr[offs] >> 2, flipx: sh.sr[offs] & 1, flipy: (sh.sr[offs] >> 1) & 1, color: sh.sr[offs + 1] & 0x1f, sx, sy, slot: offs >> 1 });
    }
    return list;
  }

  // raw (288x224) -> display (224x288): rotate 90 degrees clockwise
  renderClassic(out) {
    const sh = this.shot;
    if (!sh) return;
    const fb = this.fb || (this.fb = new Uint8Array(288 * 224));
    for (let row = 0; row < 28; row++) {
      for (let col = 0; col < 36; col++) {
        const o = MsPacman.tileOffset(col, row);
        const g = this.tileGfx[sh.vram[o]], base = (sh.cram[o] & 0x1f) * 4;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) fb[(row * 8 + y) * 288 + col * 8 + x] = base + g[y * 8 + x];
      }
    }
    for (const s of this.spriteList(sh)) {
      const g = this.spriteGfx[s.code], base = s.color * 4;
      for (const ox of [s.sx, s.sx - 256]) {
        for (let y = 0; y < 16; y++) {
          const yy = s.sy + y;
          if (yy < 0 || yy >= 224) continue;
          for (let x = 0; x < 16; x++) {
            const xx = ox + x;
            if (xx < 16 || xx >= 272) continue;
            const p = g[(s.flipy ? 15 - y : y) * 16 + (s.flipx ? 15 - x : x)];
            if (!this.lut[base + p]) continue;
            fb[yy * 288 + xx] = base + p;
          }
        }
      }
    }
    const pal = this.palette;
    for (let dy = 0; dy < 288; dy++) {
      for (let dx = 0; dx < 224; dx++) {
        const c = pal[fb[(223 - dx) * 288 + dy]];
        const o = (dy * 224 + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
  }

  // ---- remaster scene (display orientation) -------------------------------------
  rotTile(code) {
    const cache = this.rtCache || (this.rtCache = new Map());
    let d = cache.get(code);
    if (d) return d;
    const g = this.tileGfx[code];
    d = new Uint8Array(64);
    // display pixel (dx,dy) <- raw (x = dy, y = 7 - dx)
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) d[dy * 8 + dx] = g[(7 - dx) * 8 + dy];
    cache.set(code, d);
    return d;
  }

  rotSprite(s) {
    const cache = this.rsCache || (this.rsCache = new Map());
    const k = s.code | (s.flipx << 6) | (s.flipy << 7) | (s.color << 8);
    if (cache.has(k)) return cache.get(k);
    const g = this.spriteGfx[s.code], base = s.color * 4;
    const d = new Uint8Array(256);
    let any = false;
    for (let dy = 0; dy < 16; dy++) {
      for (let dx = 0; dx < 16; dx++) {
        const x = dy, y = 15 - dx;
        const p = g[(s.flipy ? 15 - y : y) * 16 + (s.flipx ? 15 - x : x)];
        if (this.lut[base + p]) { d[dy * 16 + dx] = p + 1; any = true; }
      }
    }
    cache.set(k, any ? d : null);
    return any ? d : null;
  }

  displayScene() {
    const sh = this.shot;
    if (!sh) return { tiles: [], sprites: [] };
    const tiles = [], sprites = [];
    for (let row = 0; row < 28; row++) {
      for (let col = 0; col < 36; col++) {
        const o = MsPacman.tileOffset(col, row);
        const code = sh.vram[o], color = sh.cram[o] & 0x1f;
        const g = this.tileGfx[code];
        let any = false;
        for (let i = 0; i < 64; i++) if (g[i] && this.lut[color * 4 + g[i]]) { any = true; break; }
        if (!any) continue;
        // raw tile at (col*8, row*8) -> display (223 - row*8 - 7, col*8)
        tiles.push({ x: 216 - row * 8, y: col * 8, w: 8, h: 8, code, color, kind: mspTileKind(code, col), pixels: this.rotTile(code), col, row });
      }
    }
    for (const s of this.spriteList(sh)) {
      if (s.sx <= 0 && s.sx >= -16) continue;
      const pixels = this.rotSprite(s);
      if (!pixels) continue;
      // raw (sx, sy) top-left -> display (223 - sy - 15, sx)
      const x = 208 - s.sy, y = s.sx;
      if (x <= -16 || x >= 224 || y < 16 || y >= 272) continue;
      sprites.push({ x, y, w: 16, h: 16, code: s.code, pal: s.color * 4 - 1, pixels, kind: mspSpriteKind(s.code, s.slot), slot: s.slot });
    }
    return { tiles, sprites };
  }
}

// Tile semantics: maze walls, dots, power pellets, text/HUD (top and bottom rows of the display)
export function mspTileKind(code, col) {
  if (col < 2 || col >= 34) return 'hud';
  if (code === 0x10 || code === 0x12 || code === 0x14) return 'dot';
  if (code >= 0xc0) return 'wall';
  return 'hud';
}

// Sprite slots: 1-4 ghosts, 5 Ms. Pac-Man, others fruit (in-game)
export function mspSpriteKind(code, slot) {
  if (slot === 5) return 'player';
  if (slot >= 1 && slot <= 4) return 'ghost';
  return 'other';
}
