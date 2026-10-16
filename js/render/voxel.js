// Builds voxel geometry for 8x8 (or any size) tiles.
// Each non-transparent pixel becomes one or more boxes spanning z-ranges chosen by a classifier.
// Internal faces between neighbouring voxels with identical z-ranges are culled.

const FACES = [
  // dir, normal, 4 corners as [x,y,z] selectors (0/1) in CCW order seen from outside
  { n: [0, 0, 1], c: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },   // front (+z)
  { n: [0, 0, -1], c: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]] },  // back (-z)
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], dx: -1, dy: 0 },
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], dx: 1, dy: 0 },
  { n: [0, 1, 0], c: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], dx: 0, dy: -1 },  // top (screen up)
  { n: [0, -1, 0], c: [[0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1]], dx: 0, dy: 1 },  // bottom
];
const SHADE = [1, 0.7, 0.82, 0.82, 0.95, 0.6];

// pixels: Uint8Array(w*h); classify(x, y, p) -> array of { group, z0, z1, color:[r,g,b] } or null
// returns Map(group -> { position, normal, color })
export function voxelize(pixels, w, h, classify) {
  const cells = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = pixels[y * w + x];
      cells[y * w + x] = p ? classify(x, y, p) : null;
    }
  }
  const groups = new Map();
  const same = (a, b) => a.group === b.group && a.z0 === b.z0 && a.z1 === b.z1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const list = cells[y * w + x];
      if (!list) continue;
      for (const box of list) {
        let g = groups.get(box.group);
        if (!g) { g = { pos: [], nor: [], col: [] }; groups.set(box.group, g); }
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          if (face.dx !== undefined) {
            const nx = x + face.dx, ny = y + face.dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
              const nb = cells[ny * w + nx];
              if (nb && nb.some(o => same(o, box))) continue;
            }
          }
          const s = SHADE[f];
          const cr = box.color[0] * s, cg = box.color[1] * s, cb = box.color[2] * s;
          const quad = face.c.map(([sx, sy, sz]) => [x + sx, -(y + sy), sz ? box.z1 : box.z0]);
          for (const k of [0, 1, 2, 0, 2, 3]) {
            g.pos.push(quad[k][0], quad[k][1], quad[k][2]);
            g.nor.push(face.n[0], face.n[1], face.n[2]);
            g.col.push(cr, cg, cb);
          }
        }
      }
    }
  }
  const out = new Map();
  for (const [k, g] of groups) {
    out.set(k, { position: new Float32Array(g.pos), normal: new Float32Array(g.nor), color: new Float32Array(g.col) });
  }
  return out;
}
