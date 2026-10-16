// 2.5D remastered renderer.
// Reads the machine's display-oriented scene each frame and rebuilds it in 3D:
//  - background tiles -> voxel geometry (instanced per tile code/colour), classified per game profile
//  - sprites -> connected clusters inflated into rounded figurines (cached by content hash)
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

function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
class TileLayer {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.geoCache = new Map();   // key -> Map(group -> geometry)
    this.batches = new Map();    // key|group -> { mesh, capacity }
    this.lastSig = -1;
    this.dummy = new THREE.Object3D();
  }

  geometryFor(t) {
    const key = `${t.layer || 0}:${t.code}:${t.color}:${t.kind}:${t.w}x${t.h}`;
    let geos = this.geoCache.get(key);
    if (geos) return [key, geos];
    const v = this.view, prof = v.profile;
    const cols = [0, 1, 2, 3].map(p => v.linear(t.color * 4 + p));
    const ctx = prof.tileContext ? prof.tileContext(t) : null;
    // pixels mapped to pure black are invisible on the arcade monitor; keep them empty
    const data = voxelize(t.pixels, t.w, t.h, (x, y, p) =>
      (cols[p][0] + cols[p][1] + cols[p][2] < 1e-4) ? null : prof.classifyTile(t, x, y, p, cols[p], ctx));
    geos = new Map();
    for (const [g, d] of data) geos.set(g, toGeometry(d));
    this.geoCache.set(key, geos);
    return [key, geos];
  }

  update(tiles, W, H) {
    let sig = 2166136261;
    for (const t of tiles) {
      const code = typeof t.code === 'number' ? t.code : strHash(t.code);
      sig ^= code ^ (t.color << 20); sig = Math.imul(sig, 16777619);
      sig ^= (t.x & 0xffff) | ((t.y & 0xffff) << 16); sig = Math.imul(sig, 16777619);
    }
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const buckets = new Map();
    for (const t of tiles) {
      const [key, geos] = this.geometryFor(t);
      for (const [g, geo] of geos) {
        const bk = `${key}|${g}`;
        let b = buckets.get(bk);
        if (!b) { b = { geo, group: g, list: [] }; buckets.set(bk, b); }
        b.list.push(t);
      }
    }
    for (const [, batch] of this.batches) batch.mesh.count = 0;
    const slopes = this.view.profile.slopePixel ? this.computeSlopes(tiles, W, H) : null;
    const mtx = new THREE.Matrix4();
    for (const [bk, b] of buckets) {
      let batch = this.batches.get(bk);
      if (!batch || batch.capacity < b.list.length) {
        if (batch) { this.group.remove(batch.mesh); batch.mesh.dispose(); }
        const cap = Math.max(16, 1 << Math.ceil(Math.log2(b.list.length)));
        const mat = this.view.profile.materials[b.group] || this.view.materials.art;
        const mesh = new THREE.InstancedMesh(b.geo, mat, cap);
        mesh.castShadow = mat.userData.castShadow !== false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        batch = { mesh, capacity: cap };
        this.batches.set(bk, batch);
        this.group.add(mesh);
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
  }

  // Per-tile slope (display px of y per px of x) of the steel beam the tile belongs to.
  // A beam's top edge is a full-width "flange" row with an empty row above it.
  computeSlopes(tiles, W, H) {
    const prof = this.view.profile, v = this.view;
    const mask = new Uint8Array(W * H);
    const cand = [];
    for (const t of tiles) {
      let any = false;
      for (let py = 0; py < t.h; py++) {
        for (let px = 0; px < t.w; px++) {
          const p = t.pixels[py * t.w + px];
          if (!p || !prof.slopePixel(t, p)) continue;
          const c = v.linear(t.color * 4 + p);
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
    this.batches.clear(); this.geoCache.clear();
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
    const v = this.view;
    const ids = this.ids && this.ids.length === W * H ? this.ids : (this.ids = new Uint16Array(W * H));
    const owner = this.owner && this.owner.length === W * H ? this.owner : (this.owner = new Int16Array(W * H));
    const seen = this.seen && this.seen.length === W * H ? this.seen : (this.seen = new Uint8Array(W * H));
    // clear only what was drawn last frame
    if (this.dirty) for (const i of this.dirty) { ids[i] = 0; seen[i] = 0; }
    const dirty = [];
    sprites.forEach((s, si) => {
      const base = s.color * 4 + 1;   // palette index + 1 (0 = empty)
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

    // connected components (4-neighbour) over drawn pixels
    const comps = [];
    const stack = this.stack || (this.stack = new Int32Array(W * H));
    for (const start of dirty) {
      if (seen[start] || !ids[start]) continue;
      let sp = 0; stack[sp++] = start; seen[start] = 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      const owners = new Set();
      // light-emitting sprites never merge with solid ones, so each keeps its own material
      const glowGroup = sprites[owner[start]].kind === 'fire';
      const ok = j => ids[j] && !seen[j] && (sprites[owner[j]].kind === 'fire') === glowGroup;
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
      comps.push({ x0, y0, x1, y1, owners });
    }

    // build / fetch meshes
    let used = 0;
    const lights = [];
    let player = null;
    for (const c of comps) {
      const w = c.x1 - c.x0 + 3, h = c.y1 - c.y0 + 3;
      const sub = new Uint16Array(w * h);
      for (let y = c.y0; y <= c.y1; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
          const i = y * W + x;
          // only take pixels belonging to this component's sprites
          if (ids[i] && c.owners.has(owner[i])) sub[(y - c.y0 + 1) * w + (x - c.x0 + 1)] = ids[i];
        }
      }
      const kinds = new Set();
      for (const o of c.owners) kinds.add(sprites[o].kind);
      const kind = kinds.has('player') ? 'player' : kinds.has('fire') ? 'fire' : (kinds.size === 1 && kinds.has('hud')) ? 'hud' : 'char';
      const hash = fnv(sub, sub.length, (w << 16) ^ h) + ':' + w + 'x' + h;
      let entry = this.cache.get(hash);
      if (!entry) {
        const data = inflate(sub, w, h, id => v.linear(id - 1), v.profile.inflate || {});
        if (!data) continue;
        entry = { geo: toGeometry(data), depth: data.depth };
        this.cache.set(hash, entry);
      }
      entry.used = this.frame;
      let mesh = this.pool[used];
      if (!mesh) {
        mesh = new THREE.Mesh(entry.geo, v.materials.char);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.pool.push(mesh);
        this.group.add(mesh);
      }
      mesh.visible = true;
      mesh.geometry = entry.geo;
      mesh.material = kind === 'fire' ? v.materials.glow : kind === 'hud' ? v.materials.hudSprite : v.materials.char;
      mesh.castShadow = kind !== 'hud';
      const zc = (v.profile.spriteZ ? v.profile.spriteZ(kind) : 0);
      mesh.position.set(c.x0 - 1 - W / 2, H / 2 - (c.y0 - 1), zc);
      used++;
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      if (kind === 'fire') lights.push({ x: cx - W / 2, y: H / 2 - cy, z: zc + 14 });
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
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 5000);
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
    const rim = new THREE.DirectionalLight(0xffb36b, 0.8);
    rim.position.set(160, -40, -120);
    this.scene.add(rim);

    this.fireLights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xff8a2a, 0, 170, 2);
      this.fireLights.push(l);
      this.scene.add(l);
    }

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
    this.time = 0;
    this.linCache = new Map();
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

  setMachine(machine) {
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose(); }
    if (this.sprites) { this.scene.remove(this.sprites.group); this.sprites.dispose(); }
    if (this.backdrop) this.backdrop.dispose();
    this.machine = machine;
    this.linCache.clear();
    this.profile = getProfile(machine.info.id, this);
    const { width, height } = machine.info;
    this.backdrop = this.profile.backdrop(this.scene, { width, height });
    this.tiles = new TileLayer(this);
    this.sprites = new SpriteLayer(this);
    this.scene.add(this.tiles.group, this.sprites.group);
    this.resize();
  }

  setSettings(s) {
    Object.assign(this.settings, s);
    this.bloom.enabled = this.settings.bloom;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.sun.castShadow = this.settings.shadows;
    for (const m of Object.values(this.materials)) m.needsUpdate = true;
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
    const mh = height * 0.53 + 6, mw = width * 0.53 + 6;
    return Math.max(mh / t, mw / (t * this.camera.aspect));
  }

  // Sprites drawn entirely in black are used by games as masks (e.g. hiding ladder tops).
  // In 3D they would show up as dark boxes, so instead they cut the tiles beneath them.
  isBlackSprite(s) {
    let any = false;
    for (let i = 0; i < s.pixels.length; i++) {
      const p = s.pixels[i];
      if (!p) continue;
      const c = this.linear(s.color * 4 + p);
      if (c[0] + c[1] + c[2] > 1e-4) return false;
      any = true;
    }
    return any;
  }

  applyMaskSprites(scene, W, H) {
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
      return { ...t, pixels: copy, code: `${t.code}m${fnv(copy, copy.length)}` };
    });
    return { sprites, tiles };
  }

  render(dt) {
    if (!this.machine) return;
    this.time += dt;
    const { width: W, height: H } = this.machine.info;
    const scene = this.machine.displayScene();
    if (this.profile.prepare) this.profile.prepare(scene);
    let { sprites, tiles } = this.applyMaskSprites(scene, W, H);
    // character artwork drawn with tiles is sculpted like sprites
    if (tiles.some(t => t.kind === 'art')) {
      sprites = [...tiles.filter(t => t.kind === 'art').map(t => ({ ...t, kind: 'other' })), ...sprites];
      tiles = tiles.filter(t => t.kind !== 'art');
    }
    this.tiles.update(tiles, W, H);
    const info = this.sprites.update(sprites, W, H);

    // fire lights with flicker
    this.fireLights.forEach((l, i) => {
      const f = info.lights[i];
      if (f) {
        l.position.set(f.x, f.y, f.z);
        l.intensity = 1100 * (0.82 + 0.18 * Math.sin(this.time * 23 + i * 2.1) * Math.sin(this.time * 7.3 + i));
      } else l.intensity = 0;
    });

    // camera
    const dist = this.fitDistance();
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
    if (mode === 'flat') {
      cam.position.set(0, 0, dist);
      cam.lookAt(0, 0, 0);
    } else {
      const sway = mode === 'dynamic' ? Math.sin(this.time * 0.25) * 6 : 0;
      cam.position.set(this.camState.x * 1.4 + sway, 58 + this.camState.y, dist);
      cam.lookAt(this.camState.x * 0.45, this.camState.y * 0.35 - 2, 0);
    }
    this.backdrop.update(this.time);
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
