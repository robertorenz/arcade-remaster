// Moon Patrol "Redrawn" backgrounds: the two scrolling bitmap layers (jagged blue mountains and
// green hills) become real faceted 3D ranges. Each range is sculpted once from the bitmap's
// skyline (so its crest projects exactly onto the arcade silhouette) and then scrolled in step
// with the hardware scroll registers.
import * as THREE from 'three';
import { noise3, disposeTree, rasterize, cutTiles } from './common.js';

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
      // the front and back edges come down to the base so the ridge meets its skirt without a gap
      y = base - h * (1 - f ** 1.6) + style.rough * n * f * (1 - f) * 6;
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

// The lunar road: a regolith strip whose surface follows the arcade's ground line (craters
// included) and whose texture is anchored to the road scroll so it slides with the terrain.
function makeRoad(view) {
  const D = 16, R = 6, COLS = 241;
  const nTop = COLS * (R + 1), nFront = COLS * 2;
  const pos = new Float32Array((nTop + nFront) * 3), col = new Float32Array((nTop + nFront) * 3);
  const index = [];
  for (let x = 0; x < COLS - 1; x++) {
    for (let r = 0; r < R; r++) {
      const a = x * (R + 1) + r, b = a + R + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const f = nTop + x * 2, f2 = f + 2;
    index.push(f, f + 1, f2, f + 1, f2 + 1, f2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, envMapIntensity: 0.3 });
  mat.clippingPlanes = view.clipPlanes;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.visible = false;
  // periodic detail (period 256 = one road wrap) so the texture never seams
  const P = Math.PI * 2 / 256;
  const detail = (u, z) => 0.5 * Math.sin(u * P * 9 + z * 0.4) * Math.sin(u * P * 23 + 1.3) + 0.35 * Math.sin(u * P * 61 + z * 1.7) + 0.25 * Math.sin(u * P * 127 - z * 0.9);
  let lastKey = '';
  let rest = [];
  return {
    mesh,
    update(tiles, W, H, scroll) {
      if (!tiles.length) { mesh.visible = false; return tiles; }
      const idx = rasterize(view, tiles, W, H);
      // the road surface is the colour that fills the bottom of the screen; anything else
      // (the green band, signs) stays as tiles
      const counts = new Map();
      for (let i = (H - 12) * W; i < W * H; i++) if (idx[i] >= 0) counts.set(idx[i], (counts.get(idx[i]) || 0) + 1);
      const surf = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 1).map(e => e[0]);
      if (!surf.length) { mesh.visible = false; return tiles; }
      const top = new Float32Array(COLS).fill(H);
      const covered = new Uint8Array(W * H);
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          const i = y * W + x;
          if (surf.includes(idx[i])) { covered[i] = 1; if (top[x] === H) top[x] = y; }
        }
      }
      top[W] = top[W - 1];
      const key = `${scroll}:${top.join(',')}`;
      if (key !== lastKey) {
        lastKey = key;
        const base = view.linear(surf[0]);
        let p = 0, c = 0;
        for (let x = 0; x < COLS; x++) {
          const u = x + scroll;
          const t0 = top[x];
          for (let r = 0; r <= R; r++) {
            const z = D - (2 * D * r) / R;
            const bump = r === 0 ? 0 : detail(u, z) * 0.6;
            pos[p++] = x - W / 2; pos[p++] = H / 2 - t0 + bump; pos[p++] = z;
            const k = 0.78 + 0.22 * detail(u * 1.7, z * 2) - (t0 > 225 ? 0.25 : 0);
            col[c++] = base[0] * k; col[c++] = base[1] * k; col[c++] = base[2] * k;
          }
        }
        for (let x = 0; x < COLS; x++) {
          const u = x + scroll;
          for (const y of [top[x], H + 4]) {
            pos[p++] = x - W / 2; pos[p++] = H / 2 - y; pos[p++] = D;
            const k = 0.62 + 0.15 * detail(u * 2.3, y * 0.5);
            col[c++] = base[0] * k; col[c++] = base[1] * k; col[c++] = base[2] * k;
          }
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        rest = cutTiles(tiles, covered, W, H);
      }
      mesh.visible = true;
      return rest;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
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

  const road = makeRoad(view);
  group.add(road.mesh);

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
      const kept = tiles.filter(t => !((t.kind === 'mountain' && active.has(0)) || (t.kind === 'hill' && active.has(1))));
      const groundTiles = kept.filter(t => t.kind === 'ground');
      const others = kept.filter(t => t.kind !== 'ground');
      return [...others, ...road.update(groundTiles, W, H, m.shot ? m.shot.scroll : 0)];
    },
    dispose() { disposeTree(group); mat.dispose(); road.dispose(); ranges.clear(); },
  };
}
