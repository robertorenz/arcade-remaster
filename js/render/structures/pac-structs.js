// Ms. Pac-Man "Redrawn" structures: maze walls become dark glass blocks rimmed with glowing
// neon tubes; dots become glowing pearls and power pellets pulsing energy orbs.
import * as THREE from 'three';
import { tileSig, rasterize, palBase, scale3, disposeTree, shadowed } from './common.js';

const BODY_Z0 = -2, BODY_Z1 = 4.5, TUBE_Z = 4.6, TUBE_R = 0.6;

function instanced(geo, material, n) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, n));
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

export function pacStructures(view) {
  const group = new THREE.Group();
  const walls = new THREE.Group();
  group.add(walls);
  const glass = new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.3 });
  const neon = new THREE.MeshBasicMaterial({ toneMapped: false });
  const pearlMat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.0 });
  const pelletMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const pearlGeo = new THREE.SphereGeometry(1.25, 14, 10);
  const pelletGeo = new THREE.IcosahedronGeometry(3.4, 3);
  const haloGeo = new THREE.SphereGeometry(4.6, 18, 12);
  const haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false });
  const pearls = shadowed(instanced(pearlGeo, pearlMat, 260));
  const pellets = instanced(pelletGeo, pelletMat, 8);
  const halos = instanced(haloGeo, haloMat, 8);
  group.add(pearls, pellets, halos);
  let wallSig = -1, dotSig = -1;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const col = new THREE.Color();

  function rebuildWalls(tiles, W, H) {
    disposeTree(walls);
    walls.clear();
    const idx = rasterize(view, tiles, W, H);
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && idx[y * W + x] >= 0;
    const edge = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) edge[y * W + x] = 1;
    }
    const E = (x, y) => x >= 0 && y >= 0 && x < W && y < H && edge[y * W + x] === 1;
    // body: horizontal runs of wall pixels
    const runs = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W;) {
        if (!on(x, y)) { x++; continue; }
        const c = idx[y * W + x];
        let e = x;
        while (e + 1 < W && idx[y * W + e + 1] === c) e++;
        runs.push([x, e, y, c]);
        x = e + 1;
      }
    }
    const body = shadowed(instanced(new THREE.BoxGeometry(1, 1, BODY_Z1 - BODY_Z0), glass, runs.length));
    runs.forEach(([x0, x1, y, c], i) => {
      m4.makeScale(x1 - x0 + 1, 1, 1);
      m4.setPosition((x0 + x1 + 1) / 2 - W / 2, H / 2 - y - 0.5, (BODY_Z0 + BODY_Z1) / 2);
      body.setMatrixAt(i, m4);
      const k = view.linear(c);
      body.setColorAt(i, col.setRGB(k[0] * 0.09 + 0.008, k[1] * 0.09 + 0.008, k[2] * 0.09 + 0.014));
    });
    body.count = runs.length;
    walls.add(body);

    // neon: tubes along runs of edge pixels, joints at every edge pixel, diagonal links
    const segs = [];
    const used = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!E(x, y) || E(x - 1, y)) continue;
      let e = x;
      while (E(e + 1, y)) e++;
      if (e > x) { segs.push([x + 0.5, y + 0.5, e + 0.5, y + 0.5, idx[y * W + x]]); for (let k = x; k <= e; k++) used[y * W + k] = 1; }
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      if (!E(x, y) || E(x, y - 1)) continue;
      let e = y;
      while (E(x, e + 1)) e++;
      if (e > y) { segs.push([x + 0.5, y + 0.5, x + 0.5, e + 0.5, idx[y * W + x]]); for (let k = y; k <= e; k++) used[k * W + x] = 1; }
    }
    const joints = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!E(x, y)) continue;
      const c = idx[y * W + x];
      for (const dy of [-1, 1]) {
        if (E(x + 1, y + dy) && !E(x + 1, y) && !E(x, y + dy)) segs.push([x + 0.5, y + 0.5, x + 1.5, y + dy + 0.5, c]);
      }
      // joints only where tubes end or turn
      const h = E(x - 1, y) || E(x + 1, y), vv = E(x, y - 1) || E(x, y + 1);
      const straight = (E(x - 1, y) && E(x + 1, y) && !vv) || (E(x, y - 1) && E(x, y + 1) && !h);
      if (!straight) joints.push([x + 0.5, y + 0.5, c]);
    }
    const tubes = instanced(new THREE.CylinderGeometry(TUBE_R, TUBE_R, 1, 8, 1, true), neon, segs.length);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
    segs.forEach(([ax, ay, bx, by, c], i) => {
      const wx0 = ax - W / 2, wy0 = H / 2 - ay, wx1 = bx - W / 2, wy1 = H / 2 - by;
      dir.set(wx1 - wx0, wy1 - wy0, 0);
      const len = dir.length();
      q.setFromUnitVectors(up, dir.normalize());
      m4.compose(v.set((wx0 + wx1) / 2, (wy0 + wy1) / 2, TUBE_Z), q, sc.set(1, len, 1));
      tubes.setMatrixAt(i, m4);
      const k = scale3(view.linear(c), 2.2);
      tubes.setColorAt(i, col.setRGB(k[0] + 0.05, k[1] + 0.05, k[2] + 0.05));
    });
    tubes.count = segs.length;
    const balls = instanced(new THREE.SphereGeometry(TUBE_R, 8, 6), neon, joints.length);
    joints.forEach(([x, y, c], i) => {
      m4.makeTranslation(x - W / 2, H / 2 - y, TUBE_Z);
      balls.setMatrixAt(i, m4);
      const k = scale3(view.linear(c), 2.2);
      balls.setColorAt(i, col.setRGB(k[0] + 0.05, k[1] + 0.05, k[2] + 0.05));
    });
    balls.count = joints.length;
    walls.add(tubes, balls);
  }

  function rebuildDots(tiles, W, H) {
    let np = 0, nb = 0;
    for (const t of tiles) {
      let sx = 0, sy = 0, n = 0, pi = -1;
      for (let py = 0; py < t.h; py++) for (let px = 0; px < t.w; px++) {
        const p = t.pixels[py * t.w + px];
        if (!p) continue;
        sx += px; sy += py; n++; pi = p;
      }
      if (!n) continue;
      const x = t.x + sx / n + 0.5 - W / 2, y = H / 2 - (t.y + sy / n + 0.5);
      const k = view.linear(palBase(t) + pi);
      if (n > 12) {
        if (nb >= 8) continue;
        m4.makeTranslation(x, y, 3.4);
        pellets.setMatrixAt(nb, m4);
        halos.setMatrixAt(nb, m4);
        pellets.setColorAt(nb, col.setRGB(k[0] * 1.8, k[1] * 1.8, k[2] * 1.8));
        halos.setColorAt(nb, col.setRGB(k[0], k[1] * 0.9, k[2] * 0.8));
        nb++;
      } else {
        if (np >= 260) continue;
        m4.makeTranslation(x, y, 1.8);
        pearls.setMatrixAt(np, m4);
        pearls.setColorAt(np, col.setRGB(k[0], k[1], k[2]));
        np++;
      }
    }
    pearls.count = np; pellets.count = nb; halos.count = nb;
    for (const m of [pearls, pellets, halos]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  return {
    group,
    update(tiles, W, H, time) {
      const wallT = [], dotT = [], others = [];
      for (const t of tiles) (t.kind === 'wall' ? wallT : t.kind === 'dot' ? dotT : others).push(t);
      const ws = tileSig(view, wallT);
      if (ws !== wallSig) { wallSig = ws; rebuildWalls(wallT, W, H); }
      const ds = tileSig(view, dotT);
      if (ds !== dotSig) { dotSig = ds; rebuildDots(dotT, W, H); }
      // pellets breathe; pearls catch a little emissive shimmer
      const p = 0.5 + 0.5 * Math.sin(time * 7);
      pellets.scale.setScalar(1);
      pelletMat.color.setScalar(0.8 + 0.5 * p);
      haloMat.opacity = 0.1 + 0.16 * p;
      pearlMat.emissiveIntensity = 0.35;
      pearlMat.emissive.setRGB(0.5, 0.42, 0.36);
      return others;
    },
    dispose() {
      disposeTree(group);
      for (const m of [glass, neon, pearlMat, pelletMat, haloMat]) m.dispose();
    },
  };
}
