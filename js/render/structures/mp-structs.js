// Moon Patrol "Redrawn" backgrounds: the two scrolling bitmap layers (jagged blue mountains and
// green hills) become real faceted 3D ranges. Each range is sculpted once from the bitmap's
// skyline (so its crest projects exactly onto the arcade silhouette) and then scrolled in step
// with the hardware scroll registers.
import * as THREE from 'three';
import { noise3, disposeTree } from './common.js';

const BG_BASE = 512, VIS_X0 = 136, VIS_Y0 = 22;
const STYLE = {
  0: { depth: 26, rows: 8, smooth: 1, rough: 2.2, snow: 0.45 },   // mountains
  1: { depth: 18, rows: 6, smooth: 3, rough: 0.9, snow: 0.0 },    // hills
};

function rangeGeometry(view, image, style) {
  const img = view.machine.bgImages[image];
  const top = new Float32Array(257);
  const colIdx = new Int32Array(256);
  for (let x = 0; x < 256; x++) {
    let t = 64;
    for (let y = 0; y < 64; y++) if (img[y * 256 + x]) { t = y; break; }
    top[x] = t;
    // fill colour: the most common pen below the outline
    const counts = [0, 0, 0, 0];
    for (let y = t; y < 64; y++) counts[img[y * 256 + x]]++;
    // black pens are shading lines in the bitmap art, not the rock colour
    let best = 3;
    for (let p = 1; p < 4; p++) {
      const c = view.linear(BG_BASE + image * 4 + p);
      if (c[0] + c[1] + c[2] > 0.02 && counts[p] > counts[best]) best = p;
    }
    colIdx[x] = BG_BASE + image * 4 + best;
  }
  top[256] = top[0];
  // light smoothing keeps the character of the skyline but removes pixel stairs
  const crest = new Float32Array(257);
  for (let x = 0; x <= 256; x++) {
    let s = 0, n = 0;
    for (let k = -style.smooth; k <= style.smooth; k++) { s += top[(x + k + 256) % 256]; n++; }
    crest[x] = Math.min(top[x % 256], s / n + 0.4);
  }
  const R = style.rows, D = style.depth;
  const pos = [], col = [];
  const base = 64, bottom = 64 + 190;   // the solid fill runs to the bottom of the screen
  const vtx = (x, row, z, kind) => {
    // arcade pixel coords (y down, relative to the image origin) -> local
    const c = view.linear(colIdx[Math.min(255, Math.floor(x))]);
    let y;
    if (kind === 'ridge') {
      const f = Math.abs(z) / D;   // 0 at the crest plane, 1 at front/back edge
      const h = base - crest[x];
      const n = noise3(x * 0.18, z * 0.25, image * 7.1);
      y = base - h * (1 - 0.75 * f ** 1.4) + style.rough * n * f * 2 - (f > 0.99 ? 0 : 0);
    } else y = row;
    pos.push(x, -y, z);
    // shade: lighter towards the crest, a snowy glint on the high peaks of the far range
    const hgt = (base - y) / 64;
    const snow = style.snow * Math.max(0, hgt - 0.45) * 2.2;
    const lift = 0.75 + 0.55 * hgt;
    col.push(Math.min(1.5, c[0] * lift + snow), Math.min(1.5, c[1] * lift + snow), Math.min(1.5, c[2] * lift + snow));
  };
  const quad = (a, b, c, d) => { for (const v of [a, b, c, a, c, d]) vtx(...v); };
  for (let x = 0; x < 256; x++) {
    for (let r = 0; r < R; r++) {
      const z0 = D - (2 * D * r) / R, z1 = D - (2 * D * (r + 1)) / R;
      quad([x, 0, z0, 'ridge'], [x + 1, 0, z0, 'ridge'], [x + 1, 0, z1, 'ridge'], [x, 0, z1, 'ridge']);
    }
    // front skirt down to the bottom of the screen
    quad([x, bottom, D, 'flat'], [x + 1, bottom, D, 'flat'], [x + 1, base, D, 'flat'], [x, base, D, 'flat']);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function mpStructures(view) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, flatShading: true, envMapIntensity: 0.3, side: THREE.DoubleSide });
  mat.clippingPlanes = view.clipPlanes;
  const ranges = new Map();   // image -> { meshes: [a, b], palKey }
  const LAYER = { 0: 1, 1: 2 };

  function rangeFor(image) {
    const pk = view.palKey(BG_BASE + image * 4, 4);
    let r = ranges.get(image);
    if (r && r.palKey === pk) return r;
    if (r) { for (const m of r.meshes) group.remove(m); r.geo.dispose(); }
    const geo = rangeGeometry(view, image, STYLE[image]);
    const meshes = [0, 1].map(() => {
      const m = new THREE.Mesh(geo, mat);
      // the far range sits in open sunlight; shadows of the hills would black out its foot
      m.castShadow = false;
      m.receiveShadow = image === 1;
      group.add(m);
      return m;
    });
    r = { geo, meshes, palKey: pk };
    ranges.set(image, r);
    return r;
  }

  return {
    group,
    update(tiles, W, H) {
      const m = view.machine;
      const bgs = m.shot ? m.backgrounds(m.shot) : [];
      const active = new Set();
      for (const bg of bgs) {
        if (!(bg.image in STYLE)) continue;
        active.add(bg.image);
        const r = rangeFor(bg.image);
        const layer = LAYER[bg.image];
        const z = view.profile.layerZ ? view.profile.layerZ(layer) : 0;
        const s = view.depthScale(z);
        const y0 = bg.y - VIS_Y0;
        [bg.x - 256, bg.x].forEach((ox, i) => {
          const x0 = ox - VIS_X0;
          const mesh = r.meshes[i];
          mesh.visible = true;
          mesh.position.set((x0 - W / 2) * s, (H / 2 - y0) * s, z);
          mesh.scale.set(s, s, 1);
        });
      }
      for (const [img, r] of ranges) if (!active.has(img)) for (const mm of r.meshes) mm.visible = false;
      // the rebuilt layers replace their bitmap tiles; the city skyline (image 2) stays as tiles
      return tiles.filter(t => !((t.kind === 'mountain' && active.has(0)) || (t.kind === 'hill' && active.has(1))));
    },
    dispose() { disposeTree(group); mat.dispose(); ranges.clear(); },
  };
}
