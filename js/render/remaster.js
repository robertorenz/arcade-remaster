// 2.5D remastered renderer.
// Reads the machine's display-oriented scene each frame and rebuilds it in 3D:
//  - background tiles -> voxel geometry (instanced per tile content/palette), classified per game profile
//  - sprites -> connected clusters inflated into rounded figurines (cached by content hash)
//  - playfield layers sit at different depths; each is scaled so it projects exactly where the
//    arcade drew it when seen from the default camera (parallax appears only when the camera moves)
//  - fire sprites drive point lights; the player drives the camera
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { inflate } from './inflate.js';
import { voxelize } from './voxel.js';
import { getProfile } from './profiles.js';
import { RigLayer } from './rigs/rig-layer.js';

const MAX_LIGHTS = 4;

function toGeometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
  g.computeBoundingSphere();
  return g;
}

function fnv(arr, len, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < len; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function strHash(str, h = 2166136261) {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const palBase = o => (o.pal !== undefined ? o.pal : o.color * 4);

// ---------------------------------------------------------------------------
class TileLayer {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.layers = new Map();     // layer id -> THREE.Group
    this.geoCache = new Map();   // key -> Map(group -> geometry)
    this.batches = new Map();    // key|group|layer -> { mesh, capacity }
    this.lastSig = -1;
  }

  layerGroup(id) {
    let g = this.layers.get(id);
    if (!g) { g = new THREE.Group(); g.userData.layer = id; this.layers.set(id, g); this.group.add(g); }
    return g;
  }

  tileKey(t) {
    const v = this.view;
    return `${t.key !== undefined ? t.key : t.code}:${v.palKey(palBase(t), 16)}:${t.kind}:${t.w}x${t.h}`;
  }

  geometryFor(t, key) {
    let geos = this.geoCache.get(key);
    if (geos) return geos;
    const v = this.view, prof = v.profile;
    const base = palBase(t);
    const cols = [];
    for (let p = 0; p < 16; p++) cols.push(v.linear(base + p));
    const ctx = prof.tileContext ? prof.tileContext(t) : null;
    const skipBlack = prof.skipBlackTiles;
    const data = voxelize(t.pixels, t.w, t.h, (x, y, p) =>
      (skipBlack && cols[p][0] + cols[p][1] + cols[p][2] < 1e-4) ? null : prof.classifyTile(t, x, y, p, cols[p], ctx));
    geos = new Map();
    for (const [g, d] of data) geos.set(g, toGeometry(d));
    this.geoCache.set(key, geos);
    if (this.geoCache.size > 3000) this.trim();
    return geos;
  }

  trim() {
    // drop geometries not referenced by live batches
    const live = new Set();
    for (const [, b] of this.batches) if (b.mesh.count) live.add(b.mesh.geometry);
    for (const [k, geos] of this.geoCache) {
      let used = false;
      for (const [, g] of geos) if (live.has(g)) used = true;
      if (!used) { for (const [, g] of geos) g.dispose(); this.geoCache.delete(k); }
    }
  }

  update(tiles, W, H) {
    const v = this.view;
    let sig = strHash(String(v.paletteVersion));
    const keys = new Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      keys[i] = this.tileKey(t);
      sig = strHash(keys[i], sig);
      sig ^= (t.x & 0xffff) | ((t.y & 0xffff) << 16); sig = Math.imul(sig, 16777619);
      sig ^= (t.layer || 0); sig = Math.imul(sig, 16777619);
    }
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const buckets = new Map();
    tiles.forEach((t, i) => {
      const geos = this.geometryFor(t, keys[i]);
      for (const [g, geo] of geos) {
        const bk = `${keys[i]}|${g}|${t.layer || 0}`;
        let b = buckets.get(bk);
        if (!b) { b = { geo, group: g, layer: t.layer || 0, list: [] }; buckets.set(bk, b); }
        b.list.push(t);
      }
    });
    for (const [, batch] of this.batches) batch.mesh.count = 0;
    const slopes = v.profile.slopePixel ? this.computeSlopes(tiles, W, H) : null;
    const mtx = new THREE.Matrix4();
    for (const [bk, b] of buckets) {
      let batch = this.batches.get(bk);
      if (!batch || batch.capacity < b.list.length) {
        if (batch) { batch.mesh.parent?.remove(batch.mesh); batch.mesh.dispose(); }
        const cap = Math.max(16, 1 << Math.ceil(Math.log2(b.list.length)));
        const mat = v.profile.materials[b.group] || v.materials.art;
        const mesh = new THREE.InstancedMesh(b.geo, mat, cap);
        mesh.castShadow = mat.userData.castShadow !== false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        batch = { mesh, capacity: cap };
        this.batches.set(bk, batch);
        this.layerGroup(b.layer).add(mesh);
      }
      const m = batch.mesh;
      b.list.forEach((t, i) => {
        // shear sloped girder tiles so neighbouring 1px steps become one continuous beam
        const k = slopes ? -(slopes.get(t) || 0) : 0;
        const cx = t.w / 2;
        mtx.set(1, 0, 0, t.x - W / 2,
          k, 1, 0, H / 2 - t.y - k * cx,
          0, 0, 1, t.z || 0,
          0, 0, 0, 1);
        m.setMatrixAt(i, mtx);
      });
      m.count = b.list.length;
      m.instanceMatrix.needsUpdate = true;
    }
    // drop batches that have been empty for a while (dynamic graphics churn)
    if (this.batches.size > 1500) {
      for (const [bk, batch] of this.batches) {
        if (!batch.mesh.count) { batch.mesh.parent?.remove(batch.mesh); batch.mesh.dispose(); this.batches.delete(bk); }
      }
    }
  }

  // Per-tile slope (display px of y per px of x) of the steel beam the tile belongs to.
  // A beam's top edge is a full-width "flange" row with an empty row above it.
  computeSlopes(tiles, W, H) {
    const prof = this.view.profile, v = this.view;
    const mask = new Uint8Array(W * H);
    const cand = [];
    for (const t of tiles) {
      let any = false;
      const base = palBase(t);
      for (let py = 0; py < t.h; py++) {
        for (let px = 0; px < t.w; px++) {
          const p = t.pixels[py * t.w + px];
          if (!p || !prof.slopePixel(t, p)) continue;
          const c = v.linear(base + p);
          if (c[0] + c[1] + c[2] < 1e-4) continue;
          const x = t.x + px, y = t.y + py;
          if (x >= 0 && y >= 0 && x < W && y < H) { mask[y * W + x] = 1; any = true; }
        }
      }
      if (any) cand.push(t);
    }
    const row = (x0, y, full) => {
      if (y < 0 || y >= H) return !full;
      let n = 0;
      for (let x = x0; x < x0 + 8; x++) if (x >= 0 && x < W && mask[y * W + x]) n++;
      return full ? n === 8 : n === 0;
    };
    const edgeIn = (x0, ya, yb) => {
      for (let y = ya; y <= yb; y++) if (row(x0, y, true) && row(x0, y - 1, false)) return y;
      return null;
    };
    const slopes = new Map();
    const byPos = new Map();
    for (const t of cand) {
      byPos.set(`${t.x},${t.y}`, t);
      const ey = edgeIn(t.x, t.y - 8, t.y + t.h - 1);
      if (ey === null) continue;
      const l = edgeIn(t.x - 8, ey - 3, ey + 3), r = edgeIn(t.x + 8, ey - 3, ey + 3);
      let s = null;
      if (l !== null && r !== null) s = (r - l) / 16;
      else if (l !== null) s = (ey - l) / 8;
      else if (r !== null) s = (r - ey) / 8;
      if (s !== null && Math.abs(s) <= 0.25) slopes.set(t, s);
    }
    // tiles without their own edge (e.g. ladder crossings) inherit from horizontal neighbours
    for (const t of cand) {
      if (slopes.has(t)) continue;
      const a = byPos.get(`${t.x - 8},${t.y}`), b = byPos.get(`${t.x + 8},${t.y}`);
      const sa = a && slopes.get(a), sb = b && slopes.get(b);
      if (sa !== undefined && sb !== undefined) slopes.set(t, (sa + sb) / 2);
      else if (sa !== undefined) slopes.set(t, sa);
      else if (sb !== undefined) slopes.set(t, sb);
    }
    return slopes;
  }

  dispose() {
    for (const [, b] of this.batches) b.mesh.dispose();
    for (const [, geos] of this.geoCache) for (const [, g] of geos) g.dispose();
    this.batches.clear(); this.geoCache.clear(); this.layers.clear();
  }
}

// ---------------------------------------------------------------------------
class SpriteLayer {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.cache = new Map();   // hash -> { geo, used }
    this.pool = [];
    this.frame = 0;
  }

  update(sprites, W, H) {
    this.frame++;
    const v = this.view, prof = v.profile;
    const ids = this.ids && this.ids.length === W * H ? this.ids : (this.ids = new Uint16Array(W * H));
    const owner = this.owner && this.owner.length === W * H ? this.owner : (this.owner = new Int16Array(W * H));
    const seen = this.seen && this.seen.length === W * H ? this.seen : (this.seen = new Uint8Array(W * H));
    // clear only what was drawn last frame
    if (this.dirty) for (const i of this.dirty) { ids[i] = 0; seen[i] = 0; }
    const dirty = [];
    sprites.forEach((s, si) => {
      const base = palBase(s) + 1;   // palette index + 1 (0 = empty)
      for (let py = 0; py < s.h; py++) {
        const y = s.y + py;
        if (y < 0 || y >= H) continue;
        for (let px = 0; px < s.w; px++) {
          const p = s.pixels[py * s.w + px];
          if (!p) continue;
          const x = s.x + px;
          if (x < 0 || x >= W) continue;
          const i = y * W + x;
          if (!ids[i]) dirty.push(i);
          ids[i] = base + p;
          owner[i] = si;
        }
      }
    });
    this.dirty = dirty;

    // connected components (4-neighbour) over drawn pixels; only sprites on the same
    // depth layer and of the same light class are merged
    const comps = [];
    const stack = this.stack || (this.stack = new Int32Array(W * H));
    const cls = s => (s.kind === 'fire' ? 1000 : 0) + (s.order || 0);
    for (const start of dirty) {
      if (seen[start] || !ids[start]) continue;
      let sp = 0; stack[sp++] = start; seen[start] = 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      const owners = new Set();
      const group = cls(sprites[owner[start]]);
      const ok = j => ids[j] && !seen[j] && cls(sprites[owner[j]]) === group;
      while (sp) {
        const i = stack[--sp];
        const x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        owners.add(owner[i]);
        if (x > 0 && ok(i - 1)) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < W - 1 && ok(i + 1)) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && ok(i - W)) { seen[i - W] = 1; stack[sp++] = i - W; }
        if (y < H - 1 && ok(i + W)) { seen[i + W] = 1; stack[sp++] = i + W; }
      }
      comps.push({ x0, y0, x1, y1, owners, order: sprites[owner[start]].order || 0 });
    }

    // build / fetch meshes
    let used = 0;
    const lights = [];
    let player = null;
    for (const c of comps) {
      const w = c.x1 - c.x0 + 3, h = c.y1 - c.y0 + 3;
      const sub = new Uint16Array(w * h);
      const colorIds = new Set();
      for (let y = c.y0; y <= c.y1; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
          const i = y * W + x;
          // only take pixels belonging to this component's sprites
          if (ids[i] && c.owners.has(owner[i])) { sub[(y - c.y0 + 1) * w + (x - c.x0 + 1)] = ids[i]; colorIds.add(ids[i]); }
        }
      }
      const kinds = new Set();
      for (const o of c.owners) kinds.add(sprites[o].kind);
      const kind = kinds.has('player') ? 'player' : kinds.has('fire') ? 'fire' : (kinds.size === 1 && kinds.has('hud')) ? 'hud' : 'char';
      let hash = fnv(sub, sub.length, (w << 16) ^ h);
      for (const id of colorIds) hash = strHash(v.palKey(id - 1, 1), hash);
      const key = `${hash}:${w}x${h}`;
      let entry = this.cache.get(key);
      if (!entry) {
        const data = inflate(sub, w, h, id => v.linear(id - 1), prof.inflate || {});
        if (!data) continue;
        entry = { geo: toGeometry(data), depth: data.depth };
        this.cache.set(key, entry);
      }
      entry.used = this.frame;
      let mesh = this.pool[used];
      if (!mesh) {
        mesh = new THREE.Mesh(entry.geo, v.materials.char);
        mesh.receiveShadow = true;
        this.pool.push(mesh);
        this.group.add(mesh);
      }
      mesh.visible = true;
      mesh.geometry = entry.geo;
      mesh.material = kind === 'fire' ? v.materials.glow : kind === 'hud' ? v.materials.hudSprite : v.materials.char;
      mesh.castShadow = kind !== 'hud';
      const zc = prof.spriteZ ? prof.spriteZ(kind, c.order) : 0;
      const s = v.depthScale(zc);
      mesh.scale.set(s, s, s);
      mesh.position.set((c.x0 - 1 - W / 2) * s, (H / 2 - (c.y0 - 1)) * s, zc);
      used++;
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      if (kind === 'fire') lights.push({ x: (cx - W / 2) * s, y: (H / 2 - cy) * s, z: zc + 14 });
      if (kind === 'player' && !player) player = { x: cx, y: cy };
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;

    // evict stale cache entries
    if (this.cache.size > 600) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < 200; i++) { entries[i][1].geo.dispose(); this.cache.delete(entries[i][0]); }
    }
    return { lights, player };
  }

  dispose() {
    for (const [, e] of this.cache) e.geo.dispose();
    this.cache.clear();
    this.pool.length = 0;
  }
}

// ---------------------------------------------------------------------------
export class RemasterView {
  constructor(container) {
    this.container = container;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 6000);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

    this.hemi = new THREE.HemisphereLight(0x9cc4ff, 0x3a2414, 0.9);
    this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xdce8ff, 1.9);
    sun.position.set(-110, 230, 280);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 200, bottom: -200, near: 50, far: 900 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.rim = new THREE.DirectionalLight(0xffb36b, 0.8);
    this.rim.position.set(160, -40, -120);
    this.scene.add(this.rim);

    this.fireLights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xff8a2a, 0, 170, 2);
      this.fireLights.push(l);
      this.scene.add(l);
    }

    this.clipPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
    this.materials = {
      char: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32, envMapIntensity: 0.5 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      hudSprite: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      art: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
    };

    this.settings = { bloom: true, camera: 'dynamic', shadows: true };
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.4, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.camState = { x: 0, y: 0 };
    this.style = 'remaster';
    this.time = 0;
    this.linCache = new Map();
    this.palKeyCache = new Map();
    this.paletteVersion = -1;
    this.baseDist = 500;
  }

  // ---- palette helpers --------------------------------------------------------
  syncPalette() {
    const ver = this.machine.paletteVersion || 0;
    if (ver !== this.paletteVersion) {
      this.paletteVersion = ver;
      this.linCache.clear();
      this.palKeyCache.clear();
    }
  }

  linear(index) {
    let c = this.linCache.get(index);
    if (c) return c;
    const [r, g, b] = this.machine.palette[index] || [0, 0, 0];
    const col = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    c = [col.r, col.g, col.b];
    this.linCache.set(index, c);
    return c;
  }

  // short string identifying the RGB values of `count` palette entries from `base`
  palKey(base, count = 8) {
    const k = base * 16 + count;
    let s = this.palKeyCache.get(k);
    if (s) return s;
    const pal = this.machine.palette;
    s = '';
    for (let i = 0; i < count; i++) {
      const c = pal[base + i] || [0, 0, 0];
      s += ((c[0] << 16) | (c[1] << 8) | c[2]).toString(36) + '.';
    }
    this.palKeyCache.set(k, s);
    return s;
  }

  // scale for an object at depth z so it projects like the arcade image at z = 0
  depthScale(z) { return (this.baseDist - z) / this.baseDist; }

  // ---- lifecycle -------------------------------------------------------------
  // 'remaster' sculpts the original pixel art; 'redrawn' swaps in hand-built models and deluxe scenery
  setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    if (this.machine) this.setMachine(this.machine);
  }

  setMachine(machine) {
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose(); }
    if (this.sprites) { this.scene.remove(this.sprites.group); this.sprites.dispose(); }
    if (this.rigs) { this.scene.remove(this.rigs.group); this.rigs.dispose(); this.rigs = null; }
    if (this.backdrop) this.backdrop.dispose();
    this.machine = machine;
    this.linCache.clear();
    this.palKeyCache.clear();
    this.paletteVersion = -1;
    this.profile = getProfile(machine.info.id, this);
    const { width, height } = machine.info;
    this.backdrop = this.profile.backdrop(this.scene, { width, height, view: this, deluxe: this.style === 'redrawn' });
    this.tiles = new TileLayer(this);
    this.sprites = new SpriteLayer(this);
    this.scene.add(this.tiles.group, this.sprites.group);
    if (this.style === 'redrawn' && this.profile.rigs) {
      this.rigs = new RigLayer(this, this.profile.rigs(this));
      this.scene.add(this.rigs.group);
    }
    this.applyLighting(this.profile.lighting || {});
    const clip = this.profile.clip ? this.clipPlanes : null;
    for (const m of [...Object.values(this.materials), ...Object.values(this.profile.materials)]) {
      m.clippingPlanes = clip;
      m.needsUpdate = true;
    }
    this.resize();
  }

  applyLighting(l) {
    this.hemi.color.set(l.hemiSky ?? 0x9cc4ff);
    this.hemi.groundColor.set(l.hemiGround ?? 0x3a2414);
    this.hemi.intensity = l.hemiIntensity ?? 0.9;
    this.sun.color.set(l.sunColor ?? 0xdce8ff);
    this.sun.intensity = l.sunIntensity ?? 1.9;
    this.sun.position.set(...(l.sunPos ?? [-110, 230, 280]));
    this.rim.color.set(l.rimColor ?? 0xffb36b);
    this.rim.intensity = l.rimIntensity ?? 0.8;
    this.renderer.toneMappingExposure = l.exposure ?? 1.0;
    this.bloom.strength = l.bloomStrength ?? 0.42;
    this.bloom.threshold = l.bloomThreshold ?? 0.92;
  }

  setSettings(s) {
    Object.assign(this.settings, s);
    this.bloom.enabled = this.settings.bloom;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.sun.castShadow = this.settings.shadows;
    for (const m of Object.values(this.materials)) m.needsUpdate = true;
    if (this.profile) for (const m of Object.values(this.profile.materials)) m.needsUpdate = true;
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewW = w; this.viewH = h;
  }

  fitDistance() {
    const { width, height } = this.machine.info;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const margin = this.profile.margin ?? 0.53;
    const mh = height * margin + 6, mw = width * margin + 6;
    return Math.max(mh / t, mw / (t * this.camera.aspect));
  }

  // Sprites drawn entirely in black are used by games as masks (e.g. hiding ladder tops).
  // In 3D they would show up as dark boxes, so instead they cut the tiles beneath them.
  isBlackSprite(s) {
    let any = false;
    const base = palBase(s);
    for (let i = 0; i < s.pixels.length; i++) {
      const p = s.pixels[i];
      if (!p) continue;
      const c = this.linear(base + p);
      if (c[0] + c[1] + c[2] > 1e-4) return false;
      any = true;
    }
    return any;
  }

  applyMaskSprites(scene) {
    const masks = scene.sprites.filter(s => this.isBlackSprite(s));
    if (!masks.length) return scene;
    const sprites = scene.sprites.filter(s => !masks.includes(s));
    const tiles = scene.tiles.map(t => {
      let copy = null;
      for (const s of masks) {
        if (s.x >= t.x + t.w || s.x + s.w <= t.x || s.y >= t.y + t.h || s.y + s.h <= t.y) continue;
        for (let py = 0; py < t.h; py++) {
          for (let px = 0; px < t.w; px++) {
            const sx = t.x + px - s.x, sy = t.y + py - s.y;
            if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h || !s.pixels[sy * s.w + sx]) continue;
            if (!copy) copy = t.pixels.slice();
            copy[py * t.w + px] = 0;
          }
        }
      }
      if (!copy) return t;
      return { ...t, pixels: copy, key: `${t.key !== undefined ? t.key : t.code}m${fnv(copy, copy.length)}` };
    });
    return { ...scene, sprites, tiles };
  }

  // planes through the camera and the edges of the arcade screen: everything outside the
  // original picture is clipped, whatever its depth
  updateClipPlanes(W, H) {
    const c = this.camera.position;
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4];
      a.set(x0, y0, 0); b.set(x1, y1, 0);
      this.clipPlanes[i].setFromCoplanarPoints(c, a, b);
      if (this.clipPlanes[i].distanceToPoint(new THREE.Vector3(0, 0, 0)) < 0) this.clipPlanes[i].negate();
    }
  }

  render(dt) {
    if (!this.machine) return;
    this.time += dt;
    this.syncPalette();
    const { width: W, height: H } = this.machine.info;
    let scene = this.machine.displayScene();
    if (this.profile.maskSprites) scene = this.applyMaskSprites(scene);
    let { sprites, tiles } = scene;
    // character artwork drawn with tiles is sculpted like sprites
    if (tiles.some(t => t.kind === 'art')) {
      sprites = [...tiles.filter(t => t.kind === 'art').map(t => ({ ...t, kind: 'other' })), ...sprites];
      tiles = tiles.filter(t => t.kind !== 'art');
    }
    // camera first: layer depth compensation depends on its distance
    const dist = this.fitDistance();
    this.baseDist = dist;
    this.tiles.update(tiles, W, H);
    for (const [id, g] of this.tiles.layers) {
      const z = this.profile.layerZ ? this.profile.layerZ(id, scene) : 0;
      const s = this.depthScale(z);
      g.position.z = z;
      g.scale.set(s, s, 1);
    }
    let rigInfo = null;
    if (this.rigs) {
      rigInfo = this.rigs.update(sprites, scene, W, H, dt);
      sprites = rigInfo.rest;
    }
    const info = this.sprites.update(sprites, W, H);
    if (rigInfo) {
      info.lights = [...rigInfo.lights, ...info.lights];
      info.player = rigInfo.player || info.player;
    }

    // fire lights with flicker
    this.fireLights.forEach((l, i) => {
      const f = info.lights[i];
      if (f) {
        l.position.set(f.x, f.y, f.z);
        l.intensity = 1100 * (0.82 + 0.18 * Math.sin(this.time * 23 + i * 2.1) * Math.sin(this.time * 7.3 + i));
      } else l.intensity = 0;
    });

    const mode = this.settings.camera;
    let tx = 0, ty = 0;
    if (mode === 'dynamic' && info.player) {
      tx = (info.player.x - W / 2) * 0.16;
      ty = (H / 2 - info.player.y) * 0.08;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    this.camState.x += (tx - this.camState.x) * k;
    this.camState.y += (ty - this.camState.y) * k;
    const cam = this.camera;
    const tilt = this.profile.cameraTilt ?? 58;
    if (mode === 'flat') {
      cam.position.set(0, 0, dist);
      cam.lookAt(0, 0, 0);
    } else {
      const sway = mode === 'dynamic' ? Math.sin(this.time * 0.25) * 6 : 0;
      cam.position.set(this.camState.x * 1.4 + sway, tilt + this.camState.y, dist);
      cam.lookAt(this.camState.x * 0.45, this.camState.y * 0.35 - 2, 0);
    }
    cam.updateMatrixWorld();
    if (this.profile.clip) this.updateClipPlanes(W, H);
    this.backdrop.update(this.time, scene);
    if (this.settings.bloom) this.composer.render(dt);
    else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, cam);
    }
  }

  dispose() {
    this.tiles?.dispose();
    this.sprites?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
