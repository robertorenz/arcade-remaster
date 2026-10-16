// Irem M52 hardware running Moon Patrol (Williams license).
// Main CPU: Z80 @ 3.072 MHz.  Sound: M6803 @ 3.58 MHz (E = 894.9 kHz) driving 2x AY-3-8910 + MSM5205 ADPCM.
// Video: 32x32 character layer (bottom quarter scrolls, top 7 rows opaque), three 256x64 2bpp
// background bitmaps (mountains, hills, city) with their own position registers, 16x16 sprites
// through a colour lookup PROM. 240x252 visible, no rotation.

import { Z80 } from '../cpu/z80.js';
import { M6803 } from '../cpu/m6803.js';
import { AY8910 } from '../audio/ay8910.js';
import { MSM5205 } from '../audio/msm5205.js';

const PIX_CLOCK = 18432000 / 3;
const FPS = PIX_CLOCK / 384 / 282;               // 56.74 Hz
const LINES = 282;
const MAIN_PER_LINE = 3072000 / FPS / LINES;     // 192
const SND_HZ = 3579545 / 4;
const SND_PER_LINE = SND_HZ / FPS / LINES;
const VIS_X0 = 136, VIS_Y0 = 22, W = 240, H = 252;
const VBLANK_LINE = 274;

// combined palette layout used by both renderers
const TX_BASE = 0, BG_BASE = 512, SP_BASE = 524;

export const MP_INFO = {
  id: 'mpatrolw',
  title: 'Moon Patrol',
  zip: 'mpatrolw.zip',
  fps: FPS,
  width: W, height: H,
  files: ['mpa-1w.3m', 'mpa-2w.3l', 'mpa-3w.3k', 'mpa-4w.3j', 'mp-s1.1a', 'mpe-4w.3f', 'mpe-5w.3e', 'mpb-2.3m', 'mpb-1.3n',
    'mpe-1.3l', 'mpe-2.3k', 'mpe-3.3h', 'mpc-4a.2a', 'mpc-3.1m', 'mpc-1.1f', 'mpc-2.2h'],
  buttons: ['Jump', 'Fire'],
};

function weights(res, pulldown) {
  const g = res.map(r => 1 / r);
  const total = g.reduce((a, b) => a + b, 0) + (pulldown ? 1 / pulldown : 0);
  return g.map(x => (x / total) * 255);
}
const combine = (w, ...bits) => Math.round(bits.reduce((s, b, i) => s + (b ? w[i] : 0), 0));

export class MoonPatrol {
  static info = MP_INFO;

  constructor(files, sampleRate = 48000) {
    const get = n => {
      const f = files.get(n);
      if (!f) throw new Error(`Missing ROM file: ${n}`);
      return f;
    };
    this.info = MP_INFO;
    this.rom = new Uint8Array(0x4000);
    ['mpa-1w.3m', 'mpa-2w.3l', 'mpa-3w.3k', 'mpa-4w.3j'].forEach((n, i) => this.rom.set(get(n), i * 0x1000));
    this.sndRom = new Uint8Array(0x8000);
    this.sndRom.set(get('mp-s1.1a'), 0x7000);

    // ---- graphics ----
    const tx = new Uint8Array(0x2000);
    tx.set(get('mpe-4w.3f'), 0); tx.set(get('mpe-5w.3e'), 0x1000);
    this.chars = [];
    for (let c = 0; c < 512; c++) {
      const g = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        const lo = tx[c * 8 + y], hi = tx[0x1000 + c * 8 + y];
        for (let x = 0; x < 8; x++) g[y * 8 + x] = (((hi >> (7 - x)) & 1) << 1) | ((lo >> (7 - x)) & 1);
      }
      this.chars.push(g);
    }
    const sp = new Uint8Array(0x3000);
    sp.set(get('mpb-2.3m'), 0); sp.set(get('mpb-1.3n'), 0x1000);
    this.spriteGfx = [];
    for (let s = 0; s < 128; s++) {
      const g = new Uint8Array(256);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const o = s * 32 + y + (x >= 8 ? 16 : 0), bit = 7 - (x & 7);
          // planes: MSB = 0x2000 (empty), then 0x0000, then 0x1000
          g[y * 16 + x] = (((sp[0x2000 + o] >> bit) & 1) << 2) | (((sp[o] >> bit) & 1) << 1) | ((sp[0x1000 + o] >> bit) & 1);
        }
      }
      this.spriteGfx.push(g);
    }
    this.bgImages = ['mpe-1.3l', 'mpe-2.3k', 'mpe-3.3h'].map(n => {
      const data = get(n);
      const img = new Uint8Array(256 * 128);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 256; x++) {
          // rows 0-63 come from the ROM; 64-127 read the 0xff fill (solid pen 3)
          let byte = 0xff;
          if (y < 64) byte = data[(y >> 5) * 0x800 + (y & 31) * 64 + (x >> 2)];
          const i = x & 3;
          img[y * 256 + x] = (((byte >> (3 - i)) & 1) << 1) | ((byte >> (7 - i)) & 1);
        }
      }
      return img;
    });

    // ---- palettes (combined: tx 0-511, bg 512-523, sprites 524-779) ----
    const w3 = weights([1000, 470, 220]), w2 = weights([470, 220]);
    const pal = [];
    const txPal = get('mpc-4a.2a');
    for (let i = 0; i < 512; i++) {
      const v = txPal[i];
      pal.push([combine(w3, v & 1, v & 2, v & 4), combine(w3, v & 8, v & 16, v & 32), combine(w2, v & 64, v & 128)]);
    }
    const bgPal = get('mpc-3.1m');
    const bgColor = i => {
      const v = bgPal[i];
      return [combine(w3, v & 1, v & 2, v & 4), combine(w3, v & 8, v & 16, v & 32), combine(w2, v & 64, v & 128)];
    };
    const bgMap = [[0, 4, 8, 12], [0, 1, 2, 3], [0, 17, 18, 19]];
    for (let img = 0; img < 3; img++) for (let p = 0; p < 4; p++) pal.push(bgColor(bgMap[img][p]));
    const sw2 = weights([470, 220], 470), sw3 = weights([1000, 470, 220], 470);
    const spPal = get('mpc-1.1f'), clut = get('mpc-2.2h');
    this.spClut = clut;
    for (let i = 0; i < 256; i++) {
      const v = spPal[clut[i] & 0x1f];
      pal.push([combine(sw2, v & 64, v & 128), combine(sw3, v & 8, v & 16, v & 32), combine(sw3, v & 1, v & 2, v & 4)]);
    }
    this.palette = pal;

    // ---- memory / state ----
    this.vram = new Uint8Array(0x400);
    this.cram = new Uint8Array(0x400);
    this.spriteRam = new Uint8Array(0x400);
    this.ram = new Uint8Array(0x800);
    this.scrollReg = 0;
    this.bgx = [0, 0]; this.bgy = [0, 0]; this.bgControl = 0;
    this.flip = 0;
    this.input = { in0: 0xff, in1: 0xff, in2: 0xff };
    this.dsw1 = 0xfe; this.dsw2 = 0xfd;

    // ---- sound board ----
    this.soundLatch = 0;
    this.port1 = 0; this.port2 = 0;
    this.ay = [
      new AY8910({ portARead: () => this.soundLatch, portBWrite: v => this.ayPortB(v) }),
      new AY8910({}),
    ];
    this.msm = new MSM5205(384000, () => this.snd.nmi());
    this.msm.playmode(4);
    const self = this;
    this.snd = new M6803({
      read: a => self.sndRead(a), write: (a, v) => self.sndWrite(a, v),
      p1Read: () => self.port1Read(), p2Read: () => 0,
      p1Write: v => { self.port1 = v; }, p2Write: v => self.port2Write(v),
    });
    this.snd.setIrq(true);   // asserted at reset

    this.cpu = new Z80({
      read: a => self.read(a), write: (a, v) => self.write(a, v),
      in: () => 0xff, out: (p, v) => self.out(p & 0xff, v),
    });

    this.sampleRate = sampleRate;
    this.cyclesPerSample = SND_HZ / sampleRate;
    this.audioBuf = new Float32Array(sampleRate);
    this.audioLen = 0;
    this.sampleAcc = 0; this.ayAcc = 0;
    this.msmAcc = 0; this.msmN = 0;
    this.hpPrev = 0; this.hpOut = 0; this.lp = 0;
    this.mainAcc = 0; this.sndAcc = 0;
    this.frame = 0;
  }

  // ---- main CPU ------------------------------------------------------------------
  read(a) {
    if (a < 0x4000) return this.rom[a];
    if (a >= 0x8000 && a < 0x8400) return this.vram[a - 0x8000];
    if (a >= 0x8400 && a < 0x8800) return this.cram[a - 0x8400];
    if (a >= 0x8800 && a < 0x9000) {
      const v = this.bgx[0];
      let n = 0; for (let b = v & 0x7f; b; b &= b - 1) n++;
      return n ^ (v >> 7);
    }
    if (a >= 0xd000 && a < 0xd800) {
      switch (a & 7) {
        case 0: return this.input.in0;
        case 1: return this.input.in1;
        case 2: return this.input.in2;
        case 3: return this.dsw1;
        case 4: return this.dsw2;
        default: return 0xff;
      }
    }
    if (a >= 0xe000 && a < 0xe800) return this.ram[a - 0xe000];
    return 0xff;
  }

  write(a, v) {
    if (a >= 0x8000 && a < 0x8400) { this.vram[a - 0x8000] = v; return; }
    if (a >= 0x8400 && a < 0x8800) { this.cram[a - 0x8400] = v; return; }
    if (a >= 0xc800 && a < 0xd000) { this.spriteRam[a & 0x3ff] = v; return; }
    if (a >= 0xd000 && a < 0xd800) {
      if ((a & 3) === 0) {
        this.soundLatch = v;
        if (!(v & 0x80)) this.snd.setIrq(true);
      } else if ((a & 3) === 1) {
        this.flip = (v & 1) ^ (~this.dsw2 & 1);
      }
      return;
    }
    if (a >= 0xe000 && a < 0xe800) this.ram[a - 0xe000] = v;
  }

  out(p, v) {
    switch (p & 0xe0) {
      case 0x00: this.scrollReg = v; break;
      case 0x40: this.bgx[0] = v; break;
      case 0x60: this.bgy[0] = v; break;
      case 0x80: this.bgx[1] = v; break;
      case 0xa0: this.bgy[1] = v; break;
      case 0xc0: this.bgControl = v; break;
    }
  }

  // ---- sound CPU --------------------------------------------------------------
  sndRead(a) {
    a &= 0x7fff;
    if (a >= 0x2000) return this.sndRom[a];
    return 0xff;
  }

  sndWrite(a, v) {
    a &= 0x7fff;
    if (a < 0x1000) { if (a & 1) this.msm.write(v); return; }
    if (a < 0x2000) { if (this.soundLatch & 0x80) this.snd.setIrq(false); }
  }

  port1Read() {
    if (this.port2 & 0x08) return this.ay[0].read();
    if (this.port2 & 0x10) return this.ay[1].read();
    return 0xff;
  }

  port2Write(v) {
    // falling edge of bit 0 latches port 1 into the selected PSG(s)
    if ((this.port2 & 1) && !(v & 1)) {
      if (this.port2 & 0x04) {
        if (this.port2 & 0x08) this.ay[0].address(this.port1);
        if (this.port2 & 0x10) this.ay[1].address(this.port1);
      } else {
        if (this.port2 & 0x08) this.ay[0].write(this.port1);
        if (this.port2 & 0x10) this.ay[1].write(this.port1);
      }
    }
    this.port2 = v;
  }

  ayPortB(v) {
    this.msm.playmode((v >> 2) & 7);
    this.msm.reset(v & 1);
  }

  // ---- inputs -----------------------------------------------------------------
  setInput(s) {
    this.input.in0 = ~((s.start1 ? 1 : 0) | (s.start2 ? 2 : 0) | (s.coin ? 8 : 0)) & 0xff;
    // hardware button 2 jumps, button 1 fires; map the primary key (Space) to jump
    this.input.in1 = ~((s.right ? 1 : 0) | (s.left ? 2 : 0) | (s.b1 ? 0x20 : 0) | (s.b2 ? 0x80 : 0)) & 0xff;
    this.input.in2 = 0xff;
  }

  // ---- frame ------------------------------------------------------------------
  runFrame() {
    for (let line = 0; line < LINES; line++) {
      if (line === VBLANK_LINE) {
        this.snapshot();
        this.cpu.holdIrq();
      }
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
  }

  audioClock(c) {
    // AY clock == E clock; one AY step = 8 clocks
    this.ayAcc += c;
    const steps = this.ayAcc >> 3;
    if (steps) { this.ayAcc &= 7; this.ay[0].tick(steps); this.ay[1].tick(steps); }
    this.msm.advance(c / SND_HZ);
    this.msmAcc += this.msm.output() * c; this.msmN += c;
    this.sampleAcc += c;
    if (this.sampleAcc >= this.cyclesPerSample) {
      this.sampleAcc -= this.cyclesPerSample;
      const ay = (this.ay[0].sample() + this.ay[1].sample()) / 6;
      const adpcm = this.msmN ? this.msmAcc / this.msmN : 0;
      this.msmAcc = 0; this.msmN = 0;
      const x = ay * 0.9 + adpcm * 0.6;
      const hp = 0.996 * (this.hpOut + x - this.hpPrev);
      this.hpPrev = x; this.hpOut = hp;
      this.lp += (hp - this.lp) * 0.45;
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
    this.shot = {
      vram: this.vram.slice(), cram: this.cram.slice(), sprites: this.spriteRam.slice(0, 0x100),
      scroll: this.scrollReg, bgx: this.bgx.slice(), bgy: this.bgy.slice(), bgControl: this.bgControl,
    };
  }

  // background images visible this frame: { image, x, y } in raw bitmap coordinates
  backgrounds(sh) {
    const list = [];
    if (sh.bgControl & 0x20) return list;
    if (!(sh.bgControl & 0x10)) list.push({ image: 0, x: sh.bgx[1] + 124, y: sh.bgy[1] + 16 });
    if (!(sh.bgControl & 0x02)) list.push({ image: 1, x: sh.bgx[0] + 124, y: sh.bgy[0] + 16 });
    else if (!(sh.bgControl & 0x04)) list.push({ image: 2, x: sh.bgx[0] + 124, y: sh.bgy[0] + 16 });
    return list;
  }

  txScroll(sh, tileRowY) { return (tileRowY >> 6) === 3 ? -(sh.scroll + 1) : 255; }

  spriteList(sh) {
    const list = [];
    for (let g = 0x3c; g <= 0xfc; g += 0x40) {
      for (let offs = g; offs >= (g & 0xc0); offs -= 4) {
        const sr = sh.sprites;
        list.push({
          sy: 257 - sr[offs], color: sr[offs + 1] & 0x0f, flipx: !!(sr[offs + 1] & 0x40), flipy: !!(sr[offs + 1] & 0x80),
          code: sr[offs + 2] & 0x7f, sx: sr[offs + 3] + 129, slot: offs >> 2,
        });
      }
    }
    return list;
  }

  renderClassic(out) {
    const sh = this.shot;
    if (!sh) return;
    const pal = this.palette;
    const fb = this.fb || (this.fb = new Uint16Array(W * H));
    fb.fill(SP_BASE);   // sprite palette pen 0
    // backgrounds
    for (const bg of this.backgrounds(sh)) {
      const img = this.bgImages[bg.image], base = BG_BASE + bg.image * 4;
      for (let dy = 0; dy < H; dy++) {
        const y = dy + VIS_Y0, iy = y - bg.y;
        if (iy < 0) continue;
        if (iy >= 128) {
          if (iy < 256) for (let dx = 0; dx < W; dx++) fb[dy * W + dx] = base + 3;
          continue;
        }
        for (let dx = 0; dx < W; dx++) {
          const x = dx + VIS_X0;
          const ix = (x - bg.x) & 255;
          // drawn at x and x-256: covers [bg.x-256, bg.x+256)
          if (x < bg.x - 256 || x >= bg.x + 256) continue;
          const p = img[iy * 256 + ix];
          if (p) fb[dy * W + dx] = base + p;
        }
      }
    }
    // characters
    for (let dy = 0; dy < H; dy++) {
      const ty = (dy + VIS_Y0 - 16) & 255;
      const scroll = this.txScroll(sh, ty);
      const row = ty >> 3, opaque = row <= 6;
      for (let dx = 0; dx < W; dx++) {
        const tx = (dx + VIS_X0 + scroll - 127) & 255;
        const idx = row * 32 + (tx >> 3);
        const cr = sh.cram[idx];
        const code = sh.vram[idx] | ((cr & 0x80) << 1);
        const p = this.chars[code][(ty & 7) * 8 + (tx & 7)];
        if (p || opaque) fb[dy * W + dx] = TX_BASE + (cr & 0x7f) * 4 + p;
      }
    }
    // sprites
    for (const s of this.spriteList(sh)) {
      const g = this.spriteGfx[s.code];
      for (let y = 0; y < 16; y++) {
        const dy = s.sy + y - VIS_Y0;
        if (dy < 0 || dy >= H) continue;
        for (let x = 0; x < 16; x++) {
          const dx = s.sx + x - VIS_X0;
          if (dx < 0 || dx >= W) continue;
          const v = g[(s.flipy ? 15 - y : y) * 16 + (s.flipx ? 15 - x : x)];
          const pen = s.color * 8 + v;
          if (!this.spClut[pen]) continue;    // indirect colour 0 is transparent
          fb[dy * W + dx] = SP_BASE + pen;
        }
      }
    }
    for (let i = 0; i < W * H; i++) {
      const c = pal[fb[i]];
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    }
  }

  // ---- remaster scene ---------------------------------------------------------------
  displayScene() {
    const sh = this.shot;
    if (!sh) return { tiles: [], sprites: [] };
    const tiles = [], sprites = [];
    const solid = this.solidTile || (this.solidTile = new Uint8Array(64).fill(3));
    // backgrounds: 8x8 tiles cut from the bitmaps, placed at their own depth layer
    for (const bg of this.backgrounds(sh)) {
      const layer = bg.image === 0 ? 1 : 2;
      const img = this.bgImages[bg.image];
      for (let ty = 0; ty < 32; ty++) {
        const y = bg.y + ty * 8 - VIS_Y0;
        if (y + 8 <= 0 || y >= H) continue;
        for (let tx = 0; tx < 32; tx++) {
          for (const ox of [bg.x - 256, bg.x]) {
            const x = ox + tx * 8 - VIS_X0;
            if (x + 8 <= 0 || x >= W) continue;
            let pixels = solid, key = 'solid';
            if (ty < 8) {
              pixels = this.bgTile(bg.image, tx, ty);
              key = `bg${bg.image}:${tx}:${ty}`;
              if (pixels === null) continue;
            }
            tiles.push({ x, y, w: 8, h: 8, code: key, key, pal: BG_BASE + bg.image * 4, pixels, kind: bg.image === 0 ? 'mountain' : 'hill', layer });
          }
        }
      }
    }
    // character layer
    for (let row = 0; row < 32; row++) {
      const tyRaw = row * 8;
      const scroll = this.txScroll(sh, tyRaw);
      const y = ((tyRaw + 16 - VIS_Y0) & 255);
      if (y >= H) continue;
      const opaque = row <= 6;
      for (let col = 0; col < 32; col++) {
        const idx = row * 32 + col;
        const cr = sh.cram[idx];
        const code = sh.vram[idx] | ((cr & 0x80) << 1);
        let x = (col * 8 - scroll + 127 - VIS_X0) & 255;
        if (x > 248) x -= 256;
        if (x + 8 <= 0 || x >= W) continue;
        let pixels = this.chars[code];
        let pal = TX_BASE + (cr & 0x7f) * 4;
        if (opaque) { pixels = this.opaqueChar(code); pal -= 1; }
        else if (!this.charUsed(code)) continue;
        const kind = opaque ? 'panel' : row >= 24 ? 'ground' : 'tile';
        tiles.push({ x, y, w: 8, h: 8, code, key: `${opaque ? 'o' : 't'}${code}`, pal, pixels, kind, layer: 3 });
      }
    }
    // sprites (transparent pens come from the colour lookup table)
    for (const s of this.spriteList(sh)) {
      const x = s.sx - VIS_X0, y = s.sy - VIS_Y0;
      if (x <= -16 || x >= W || y <= -16 || y >= H) continue;
      const pixels = this.spritePixels(s);
      if (!pixels) continue;
      sprites.push({ x, y, w: 16, h: 16, code: s.code, pal: SP_BASE + s.color * 8 - 1, pixels, kind: 'other', order: 3 });
    }
    return { tiles, sprites, bgColor: this.palette[SP_BASE] };
  }

  bgTile(image, tx, ty) {
    const cache = this.bgTileCache || (this.bgTileCache = new Map());
    const k = image * 1024 + ty * 32 + tx;
    if (cache.has(k)) return cache.get(k);
    const img = this.bgImages[image];
    const d = new Uint8Array(64);
    let any = false;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = img[(ty * 8 + y) * 256 + tx * 8 + x]; d[y * 8 + x] = p; if (p) any = true; }
    cache.set(k, any ? d : null);
    return any ? d : null;
  }

  charUsed(code) {
    const g = this.chars[code];
    for (let i = 0; i < 64; i++) if (g[i]) return true;
    return false;
  }

  opaqueChar(code) {
    const cache = this.opCache || (this.opCache = new Map());
    let d = cache.get(code);
    if (!d) { d = this.chars[code].map(p => p + 1); cache.set(code, d); }
    return d;
  }

  spritePixels(s) {
    const cache = this.spCache || (this.spCache = new Map());
    const k = s.code | (s.color << 7) | (s.flipx ? 0x800 : 0) | (s.flipy ? 0x1000 : 0);
    if (cache.has(k)) return cache.get(k);
    const g = this.spriteGfx[s.code];
    const d = new Uint8Array(256);
    let any = false;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = g[(s.flipy ? 15 - y : y) * 16 + (s.flipx ? 15 - x : x)];
        if (this.spClut[s.color * 8 + v]) { d[y * 16 + x] = v + 1; any = true; }
      }
    }
    cache.set(k, any ? d : null);
    return any ? d : null;
  }
}
