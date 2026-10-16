// "Redrawn" mode: recognised game objects are drawn with hand-built 3D models instead of
// sculpted pixel art. A game's rig set classifies sprites into objects (one object can span
// several hardware sprites, e.g. Donkey Kong himself) and builds/poses a model for each.
import * as THREE from 'three';

export class RigLayer {
  // set: { classify(sprites, scene) -> { objects: [{ type, id, sprites, x0,y0,x1,y1, ... }], rest }, create(type) -> rig }
  // rig: { group: THREE.Object3D, update(obj, ctx) , lights?: [] }
  constructor(view, set) {
    this.view = view;
    this.set = set;
    this.group = new THREE.Group();
    this.pools = new Map();     // type -> [rig]
    this.state = new Map();     // object id -> persistent per-object state (previous position etc.)
    this.time = 0;
  }

  update(sprites, scene, W, H, dt) {
    this.time += dt;
    const { objects, rest } = this.set.classify(sprites, scene);
    const used = new Map();
    const lights = [];
    let player = null;
    const seen = new Set();
    for (const obj of objects) {
      let pool = this.pools.get(obj.type);
      if (!pool) { pool = []; this.pools.set(obj.type, pool); }
      const n = used.get(obj.type) || 0;
      used.set(obj.type, n + 1);
      let rig = pool[n];
      if (!rig) {
        rig = this.set.create(obj.type);
        const clip = this.view.profile.clip ? this.view.clipPlanes : null;
        rig.group.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = !o.userData.noShadow;
          o.receiveShadow = true;
          // games framed by clip planes also clip the models at the edge of the arcade picture
          if (clip) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.clippingPlanes = clip; m.needsUpdate = true; }
        });
        pool.push(rig);
        this.group.add(rig.group);
      }
      rig.group.visible = true;
      const cx = (obj.x0 + obj.x1 + 1) / 2, cy = (obj.y0 + obj.y1 + 1) / 2;
      let st = this.state.get(obj.id);
      if (!st) { st = { x: cx, y: cy, vx: 0, vy: 0, dir: 1, age: 0 }; this.state.set(obj.id, st); }
      const vx = cx - st.x, vy = cy - st.y;
      if (Math.abs(vx) + Math.abs(vy) > 0.01 && Math.abs(vx) + Math.abs(vy) < 12) { st.vx = vx; st.vy = vy; }
      if (Math.abs(vx) > 0.05) st.dir = vx > 0 ? 1 : -1;
      st.x = cx; st.y = cy; st.age += dt;
      seen.add(obj.id);
      const z = obj.z ?? 2;
      const s = this.view.depthScale(z);
      rig.group.position.set((cx - W / 2) * s, (H / 2 - cy) * s, z);
      rig.group.scale.setScalar(s * (obj.scale || 1) * (this.set.scale || 1));
      rig.update(obj, { t: this.time, dt, st, view: this.view });
      if (rig.light) lights.push({ x: rig.group.position.x, y: rig.group.position.y, z: z + 12 });
      if (obj.player && !player) player = { x: cx, y: cy };
    }
    for (const [type, pool] of this.pools) {
      const n = used.get(type) || 0;
      for (let i = n; i < pool.length; i++) pool[i].group.visible = false;
    }
    for (const id of [...this.state.keys()]) if (!seen.has(id)) this.state.delete(id);
    return { rest, lights, player };
  }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.pools.clear();
  }
}

// ---- modelling helpers ------------------------------------------------------------------------
export function mat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4, ...opts });
}
export function glowMat(color) {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  return m;
}
export function sphere(r, m, w = 24, h = 16) { return new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m); }
export function capsule(r, len, m) { return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m); }
export function box(w, h, d, m) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); }
export function cyl(rt, rb, h, m, seg = 20) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); }

// a limb hanging from a pivot: rotate the returned pivot to swing the limb
export function limb(r, len, m, end) {
  const pivot = new THREE.Group();
  const seg = capsule(r, len, m);
  seg.position.y = -len / 2 - r * 0.3;
  pivot.add(seg);
  if (end) { end.position.y = -len - r * 0.6; pivot.add(end); }
  return pivot;
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// dominant non-black colour of a set of sprites (palette lookups through the view)
export function dominantColor(view, sprites) {
  const counts = new Map();
  for (const s of sprites) {
    const base = s.pal !== undefined ? s.pal : s.color * 4;
    for (let i = 0; i < s.pixels.length; i++) {
      const p = s.pixels[i];
      if (!p) continue;
      const k = base + p;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let best = null, bc = -1;
  for (const [k, c] of counts) {
    const rgb = view.machine.palette[k] || [0, 0, 0];
    if (rgb[0] + rgb[1] + rgb[2] < 40) continue;
    if (c > bc) { bc = c; best = rgb; }
  }
  return best || [255, 255, 255];
}

export function bboxOf(sprites) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of sprites) {
    // tight bounds over opaque pixels
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (!s.pixels[y * s.w + x]) continue;
        const px = s.x + x, py = s.y + y;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
    }
  }
  return { x0, y0, x1, y1 };
}
