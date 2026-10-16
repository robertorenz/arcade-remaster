// Redrawn Q*bert pyramid: each of the 28 cube slots is rebuilt as a real bevelled cube.
// The arcade art is an exact 2:1 dimetric projection (top face 32x16 px, vertical edges 16 px),
// which is a cube yawed 45 degrees and tilted 30 degrees toward the viewer. Stepping one row
// down the pyramid moves a cube 24 px down the screen and 4.62 units nearer, so neighbouring
// cubes meet edge to edge as in a real stacked pyramid. Face colours are read from the game's
// own pixels every frame, so cube tops change exactly when the game changes them.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rasterize, cutTiles } from './common.js';

export const QB_TILT = Math.PI / 6;
const EDGE = 32 / Math.SQRT2;                     // top face projects 32 px wide
const HEIGHT = 16 / Math.cos(QB_TILT);           // vertical edges project 16 px tall
// one step down the pyramid: (+-EDGE/sqrt2, -HEIGHT, +EDGE/sqrt2) before the tilt; its depth after it
export const ROW_Z = (EDGE / Math.SQRT2) * Math.cos(QB_TILT) - HEIGHT * Math.sin(QB_TILT);

// depth of the pyramid surface under a screen y (characters stand on it)
export function qbSurfaceZ(y) { return ROW_Z * ((y - 56) / 24 - 3) + (HEIGHT / 2) * Math.sin(QB_TILT); }

export function qbStructures(view) {
  const group = new THREE.Group();
  const geo = new RoundedBoxGeometry(EDGE, HEIGHT, EDGE, 3, 0.7);
  const slots = [];
  for (let r = 0; r < 7; r++) for (let i = 0; i <= r; i++) slots.push({ r, i, cx: 120 - 16 * r + 32 * i, cy: 56 + 24 * r });
  const faceMat = () => new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.3, envMapIntensity: 0.15 });
  const cubes = slots.map(s => {
    const top = faceMat(), left = faceMat(), right = faceMat();
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z. After the 45 degree yaw -x faces left, +z faces right.
    const mesh = new THREE.Mesh(geo, [right, left, top, left, right, left]);
    mesh.rotation.set(QB_TILT, Math.PI / 4, 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.visible = false;
    group.add(mesh);
    return { s, mesh, top, left, right, key: '' };
  });
  const lin = new THREE.Color();
  const setFace = (m, index) => {
    const c = view.linear(index);
    lin.setRGB(c[0], c[1], c[2]);
    // mostly self-lit so the game's flat face colours (which carry the gameplay) stay true
    m.color.copy(lin).multiplyScalar(0.6);
    m.emissive.copy(lin).multiplyScalar(0.45);
  };
  return {
    group,
    update(tiles, W, H) {
      const idx = rasterize(view, tiles, W, H);
      const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : idx[y * W + x]);
      const covered = new Uint8Array(W * H);
      for (const c of cubes) {
        const { cx, cy } = c.s;
        const top = at(cx, cy), left = at(cx - 8, cy + 12), right = at(cx + 8, cy + 12);
        const same = (v, pts) => pts.every(([x, y]) => at(x, y) === v);
        const ok = top >= 0 && left >= 0 && right >= 0 && left !== right && top !== left && top !== right &&
          same(top, [[cx - 10, cy], [cx + 10, cy], [cx, cy - 5], [cx, cy + 5]]) &&
          same(left, [[cx - 13, cy + 6], [cx - 3, cy + 18], [cx - 13, cy + 14]]) &&
          same(right, [[cx + 12, cy + 6], [cx + 2, cy + 18], [cx + 12, cy + 14]]);
        c.mesh.visible = ok;
        if (!ok) continue;
        const key = `${top}.${left}.${right}.${view.paletteVersion}`;
        if (key !== c.key) { c.key = key; setFace(c.top, top); setFace(c.left, left); setFace(c.right, right); }
        const z = ROW_Z * (c.s.r - 3);
        const k = view.depthScale(z);
        c.mesh.position.set((cx - W / 2) * k, (H / 2 - (cy + 8)) * k, z);
        c.mesh.scale.setScalar(k);
        // the hexagon this cube covers on screen
        for (let y = cy - 8; y < cy + 24; y++) {
          for (let x = cx - 16; x < cx + 16; x++) {
            const dx = Math.abs(x + 0.5 - cx);
            if (y + 0.5 < cy - 8 + dx / 2 || y + 0.5 > cy + 24 - dx / 2) continue;
            if (x >= 0 && y >= 0 && x < W && y < H) covered[y * W + x] = 1;
          }
        }
      }
      return cutTiles(tiles, covered, W, H);
    },
    dispose() {
      geo.dispose();
      for (const c of cubes) for (const m of [c.top, c.left, c.right]) m.dispose();
    },
  };
}
