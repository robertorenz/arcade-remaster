// Joust "Redrawn" structures: the flat rock ledges become craggy, faceted stone slabs with a
// worn, lighter walking surface. Small static bits (score digits etc.) stay as tiles.
import * as THREE from 'three';
import { tileSig, rasterize, cutTiles, components, dominantIndex, noise3, disposeTree, shadowed, fnv } from './common.js';

const D = 16;   // slab depth

function slabGeometry(c, idx, W, H, base) {
  const w = c.x1 - c.x0 + 1;
  const top = new Array(w).fill(1e9), bot = new Array(w).fill(-1e9);
  for (const j of c.pixels) {
    const x = (j % W) - c.x0, y = (j / W) | 0;
    if (y < top[x]) top[x] = y;
    if (y > bot[x]) bot[x] = y;
  }
  // vertex edges at x0..x1+1: take the neighbouring columns' extremes
  const edgeTop = [], edgeBot = [];
  for (let i = 0; i <= w; i++) {
    const a = top[Math.max(0, i - 1)], b = top[Math.min(w - 1, i)];
    const ba = bot[Math.max(0, i - 1)], bb = bot[Math.min(w - 1, i)];
    edgeTop.push(Math.min(a, b));
    edgeBot.push(Math.max(ba, bb) + 1);
  }
  const pos = [], colr = [];
  const seed = c.x0 * 7.3 + c.y0 * 3.1;
  const rockA = base.map(v => v * 0.55), rockB = base.map(v => v * 0.95);
  const crust = [Math.min(1, base[0] * 1.35 + 0.05), Math.min(1, base[1] * 1.25 + 0.04), Math.min(1, base[2] * 1.1 + 0.02)];
  const vert = (x, y, z, kind) => {
    // positions in arcade pixels (y down); displaced for a hewn look
    let px = x, py = y, pz = z;
    const n = noise3(x * 0.35 + seed, y * 0.35, z * 0.35);
    if (kind === 'front') pz += 1.4 * n + 0.6;
    else if (kind === 'under') py += Math.max(0, 1.8 * noise3(x * 0.3 + seed, 9, z * 0.3) + 0.6);
    else if (kind === 'top') py += 0.12 * n;
    else if (kind === 'cap') px += 1.0 * n;
    pos.push(px - W / 2, H / 2 - py, pz);
    let k;
    if (kind === 'top') k = crust.map(v => v * (0.9 + 0.12 * noise3(x * 0.8, z * 0.8, seed)));
    else {
      const s = 0.5 + 0.5 * noise3(x * 0.15 + seed, y * 0.9, 3.3);
      k = rockA.map((v, i) => v + (rockB[i] - v) * s);
    }
    colr.push(k[0], k[1], k[2]);
  };
  const quad = (a, b, cc, d) => { for (const v of [a, b, cc, a, cc, d]) vert(...v); };
  const zs = [D / 2, D / 4, 0, -D / 4, -D / 2];
  for (let i = 0; i < w; i++) {
    const x0 = c.x0 + i, x1 = x0 + 1;
    const t0 = edgeTop[i], t1 = edgeTop[i + 1], b0 = edgeBot[i], b1 = edgeBot[i + 1];
    // top surface (front edge chamfered down)
    for (let k = 0; k < zs.length - 1; k++) {
      const za = zs[k], zb = zs[k + 1];
      const da = k === 0 ? 0.6 : 0;
      quad([x0, t0 + da, za, k === 0 ? 'front' : 'top'], [x1, t1 + da, za, k === 0 ? 'front' : 'top'], [x1, t1, zb, 'top'], [x0, t0, zb, 'top']);
    }
    // front face, split into bands
    const bands = 3;
    for (let k = 0; k < bands; k++) {
      const ya0 = t0 + 0.6 + ((b0 - t0 - 0.6) * k) / bands, ya1 = t0 + 0.6 + ((b0 - t0 - 0.6) * (k + 1)) / bands;
      const yb0 = t1 + 0.6 + ((b1 - t1 - 0.6) * k) / bands, yb1 = t1 + 0.6 + ((b1 - t1 - 0.6) * (k + 1)) / bands;
      quad([x0, ya1, D / 2, 'front'], [x1, yb1, D / 2, 'front'], [x1, yb0, D / 2, 'front'], [x0, ya0, D / 2, 'front']);
    }
    // underside
    for (let k = 0; k < zs.length - 1; k++) {
      quad([x0, b0, zs[k + 1], 'under'], [x1, b1, zs[k + 1], 'under'], [x1, b1, zs[k], 'under'], [x0, b0, zs[k], 'under']);
    }
  }
  // end caps
  for (const [xe, t, b, s] of [[c.x0, edgeTop[0], edgeBot[0], -1], [c.x1 + 1, edgeTop[w], edgeBot[w], 1]]) {
    for (let k = 0; k < zs.length - 1; k++) {
      const za = zs[k], zb = zs[k + 1];
      if (s < 0) quad([xe, t, zb, 'cap'], [xe, b, zb, 'cap'], [xe, b, za, 'cap'], [xe, t, za, 'cap']);
      else quad([xe, t, za, 'cap'], [xe, b, za, 'cap'], [xe, b, zb, 'cap'], [xe, t, zb, 'cap']);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.computeVertexNormals();
  return g;
}

export function joustStructures(view) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true, envMapIntensity: 0.35, side: THREE.DoubleSide });
  const cache = new Map();   // component hash -> mesh
  let sig = -1, rest = [];

  function rebuild(tiles, W, H) {
    const idx = rasterize(view, tiles, W, H);
    const { comps } = components(idx, W, H);
    const covered = new Uint8Array(W * H);
    const live = new Set();
    for (const c of comps) {
      const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      // ledges are wide, flat slabs only a few pixels thick
      if (w < 20 || c.pixels.length < 90 || h > 26 || c.pixels.length / w > 11) continue;
      for (const j of c.pixels) covered[j] = 1;
      const colIdx = dominantIndex(idx, c.pixels);
      const key = `${fnv(c.pixels)}:${view.palKey(colIdx, 1)}`;
      let mesh = cache.get(key);
      if (!mesh) {
        mesh = shadowed(new THREE.Mesh(slabGeometry(c, idx, W, H, view.linear(colIdx)), stone));
        cache.set(key, mesh);
        group.add(mesh);
      }
      live.add(mesh);
    }
    for (const [k, m] of cache) {
      if (!live.has(m)) { group.remove(m); m.geometry.dispose(); cache.delete(k); }
    }
    rest = cutTiles(tiles, covered, W, H);
  }

  return {
    group,
    update(tiles, W, H) {
      const mine = [], others = [];
      for (const t of tiles) (t.kind === 'rock' ? mine : others).push(t);
      const s = tileSig(view, mine);
      if (s !== sig) { sig = s; rebuild(mine, W, H); }
      return [...rest, ...others];
    },
    dispose() { disposeTree(group); stone.dispose(); cache.clear(); },
  };
}
