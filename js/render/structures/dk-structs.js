// Donkey Kong "Redrawn" structures: steel girders become open truss beams with a deck plate,
// chords, diagonal bracing and rivets; ladders become round-rail steel ladders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tileSig, rasterize, cutTiles, components, dominantIndex, paint, scale3, disposeTree, shadowed } from './common.js';

const DEPTH = 18;

function beamGeometry(L, h, col) {
  const parts = [];
  const deck = scale3(col, 1.12), chord = col, brace = scale3(col, 0.78), bolt = scale3(col, 1.35);
  const box = (w, hh, d, x, y, z, rot, c) => {
    const g = new THREE.BoxGeometry(w, hh, d);
    if (rot) g.rotateZ(rot);
    g.translate(x, y, z);
    parts.push(paint(g, c));
  };
  const rivet = (x, y, z) => {
    const g = new THREE.SphereGeometry(0.42, 6, 4);
    g.translate(x, y, z);
    parts.push(paint(g, bolt));
  };
  // walking deck with raised lips front and back
  box(L, 1.3, DEPTH, L / 2, -0.65, 0, 0, deck);
  for (const s of [-1, 1]) box(L, 0.5, 0.7, L / 2, 0.1, s * (DEPTH / 2 - 0.35), 0, chord);
  const yTop = -2.0, yBot = -h + 0.8;
  for (const s of [-1, 1]) {
    const zc = s * (DEPTH / 2 - 1.0);
    box(L, 1.2, 1.8, L / 2, yTop, zc, 0, chord);
    box(L, 1.5, 1.8, L / 2, yBot, zc, 0, chord);
    const a = yTop - 0.6, b = yBot + 0.75;
    const step = 8;
    for (let x = 0; x < L - 0.5; x += step) {
      const x2 = Math.min(L, x + step), xm = (x + x2) / 2;
      for (const [ax, ay, bx, by] of [[x, b, xm, a], [xm, a, x2, b]]) {
        const len = Math.hypot(bx - ax, by - ay);
        box(len + 0.5, 0.75, 1.1, (ax + bx) / 2, (ay + by) / 2, zc, Math.atan2(by - ay, bx - ax), brace);
      }
      rivet(x + 0.4, yBot, zc + s * 0.95);
      rivet(xm, yTop, zc + s * 0.95);
    }
    rivet(L - 0.4, yBot, zc + s * 0.95);
  }
  // cross ties holding the two trusses together
  for (let x = 2; x < L; x += 16) box(1.0, 1.0, DEPTH - 2, x, yBot, 0, 0, brace);
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return g;
}

export function dkStructures(view) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.38, envMapIntensity: 0.9 });
  const chrome = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.2, envMapIntensity: 1.2 });
  let sig = -1, rest = [];

  function rebuild(tiles, W, H) {
    disposeTree(group);
    group.clear();
    const gIdx = rasterize(view, tiles, W, H, (t, p) => p !== 3);
    const lIdx = rasterize(view, tiles, W, H, (t, p) => p === 3);
    const covered = new Uint8Array(W * H);
    const full = (x0, y) => {
      if (y < 0 || y >= H) return false;
      for (let x = x0; x < x0 + 8; x++) if (x >= W || gIdx[y * W + x] < 0) return false;
      return true;
    };
    const empty = (x0, y) => {
      if (y < 0 || y >= H) return true;
      for (let x = x0; x < x0 + 8; x++) if (x < W && gIdx[y * W + x] >= 0) return false;
      return true;
    };
    // beam segments per 8px column: a full flange row with nothing above it
    const beams = [];
    let open = [];
    for (let x0 = 0; x0 < W; x0 += 8) {
      const next = [];
      for (let y = 0; y < H; y++) {
        if (!full(x0, y) || !empty(x0, y - 1)) continue;
        let yb = y + 7;
        for (let k = y + 3; k <= y + 9; k++) if (full(x0, k) && !full(x0, k + 1)) { yb = k; break; }
        const seg = { x0, ey: y, yb };
        let beam = open.find(b => Math.abs(b.segs[b.segs.length - 1].ey - y) <= 2 && !b.taken);
        if (beam) { beam.taken = true; beam.segs.push(seg); } else { beam = { segs: [seg], taken: true }; beams.push(beam); }
        next.push(beam);
        y = yb;
      }
      for (const b of next) b.taken = false;
      open = next;
    }
    for (const beam of beams) {
      const segs = beam.segs;
      // least-squares line through the top edge
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const s of segs) { const x = s.x0 + 4; sx += x; sy += s.ey; sxx += x * x; sxy += x * s.ey; }
      const n = segs.length;
      const d = n * sxx - sx * sx;
      const b = n > 1 && d ? (n * sxy - sx * sy) / d : 0;
      const a = (sy - b * sx) / n;
      const h = segs.reduce((m, s) => m + (s.yb - s.ey + 1), 0) / n;
      const pix = [];
      for (const s of segs) {
        for (let y = s.ey; y <= s.yb; y++) for (let x = s.x0; x < s.x0 + 8; x++) {
          const i = y * W + x;
          if (gIdx[i] >= 0) { covered[i] = 1; pix.push(i); }
        }
      }
      const col = view.linear(dominantIndex(gIdx, pix));
      const xs = segs[0].x0, L = segs[n - 1].x0 + 8 - xs;
      const mesh = shadowed(new THREE.Mesh(beamGeometry(L, h, col), steel));
      mesh.matrixAutoUpdate = false;
      // shear so the beam follows the slope while its sides stay vertical
      const top = a + b * xs;
      mesh.matrix.set(1, 0, 0, xs - W / 2,
        -b, 1, 0, H / 2 - top,
        0, 0, 1, 0,
        0, 0, 0, 1);
      group.add(mesh);
    }
    // ladders: rails are columns that run most of the height, rungs are full rows
    const { comps } = components(lIdx, W, H);
    const parts = [];
    for (const c of comps) {
      const w = c.x1 - c.x0 + 1, hgt = c.y1 - c.y0 + 1;
      for (const j of c.pixels) covered[j] = 1;
      const colN = new Array(w).fill(0), rowN = new Array(hgt).fill(0);
      for (const j of c.pixels) { colN[(j % W) - c.x0]++; rowN[((j / W) | 0) - c.y0]++; }
      const rails = [];
      for (let i = 0; i < w; i++) {
        if (colN[i] < Math.max(2, hgt * 0.55)) continue;
        if (rails.length && rails[rails.length - 1].end === i - 1) { const r = rails[rails.length - 1]; r.end = i; }
        else rails.push({ start: i, end: i });
      }
      const rx = rails.length >= 2 ? rails.map(r => c.x0 + (r.start + r.end + 1) / 2) : [c.x0 + 0.6, c.x1 + 0.4];
      const col = scale3(view.linear(dominantIndex(lIdx, c.pixels)), 1.05);
      const yTop = H / 2 - c.y0, yBot = H / 2 - c.y1 - 1;
      for (const x of [rx[0], rx[rx.length - 1]]) {
        const g = new THREE.CylinderGeometry(0.7, 0.7, yTop - yBot, 10);
        g.translate(x - W / 2, (yTop + yBot) / 2, 0);
        parts.push(paint(g, col));
      }
      const span = rx[rx.length - 1] - rx[0];
      if (span > 1.5) {
        for (let r = 0; r < hgt; r++) {
          if (rowN[r] < Math.max(3, w - 1)) continue;
          const g = new THREE.CylinderGeometry(0.45, 0.45, span, 8);
          g.rotateZ(Math.PI / 2);
          g.translate((rx[0] + rx[rx.length - 1]) / 2 - W / 2, H / 2 - (c.y0 + r) - 0.5, 0);
          parts.push(paint(g, scale3(col, 0.85)));
        }
      }
    }
    if (parts.length) {
      group.add(shadowed(new THREE.Mesh(mergeGeometries(parts), chrome)));
      parts.forEach(p => p.dispose());
    }
    rest = cutTiles(tiles, covered, W, H);
  }

  return {
    group,
    update(tiles, W, H) {
      const mine = [], others = [];
      for (const t of tiles) (t.kind === 'struct' ? mine : others).push(t);
      const s = tileSig(view, mine);
      if (s !== sig) { sig = s; rebuild(mine, W, H); }
      return rest.length ? [...rest, ...others] : others;
    },
    dispose() { disposeTree(group); steel.dispose(); chrome.dispose(); },
  };
}
