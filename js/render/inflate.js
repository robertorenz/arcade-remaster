// Turns a pixel-art cluster into a rounded, closed 3D "figurine" mesh.
//  1. Scale2x twice (4x) to smooth diagonals while keeping the exact palette.
//  2. Distance transform of the silhouette -> dome height profile.
//  3. Front + mirrored back heightfield surfaces that meet at the silhouette.
// Output is in source-pixel units: x right, y down (negated to world up), z towards the viewer.

function scale2x(src, w, h) {
  const W = w * 2, out = new Uint16Array(W * h * 2);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = src[y * w + x];
      const A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      const o = (y * 2) * W + x * 2;
      out[o] = (C === A && C !== D && A !== B) ? A : P;
      out[o + 1] = (A === B && A !== C && B !== D) ? B : P;
      out[o + W] = (D === C && D !== B && C !== A) ? C : P;
      out[o + W + 1] = (B === D && B !== A && D !== C) ? D : P;
    }
  }
  return out;
}

function distanceField(ids, W, H) {
  const INF = 1e9, d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = ids[i] ? INF : 0;
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[y * W + x];
  const R2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x - 1, y) + 1, get(x, y - 1) + 1, get(x - 1, y - 1) + R2, get(x + 1, y - 1) + R2);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x + 1, y) + 1, get(x, y + 1) + 1, get(x + 1, y + 1) + R2, get(x - 1, y + 1) + R2);
    }
  }
  return d;
}

// ids: Uint16Array(w*h), 0 = empty, otherwise colour id; colorOf(id) -> [r,g,b] linear 0..1
// opts: { thickness (scale of max half-depth), minDepth }
export function inflate(ids, w, h, colorOf, opts = {}) {
  const S = 4;
  const up = scale2x(scale2x(ids, w, h), w * 2, h * 2);
  const W = w * S, H = h * S;
  const dist = distanceField(up, W, H);
  let dmax = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > dmax) dmax = dist[i];
  if (!dmax) return null;
  const thick = opts.thickness ?? 0.8;
  const hMax = Math.min(Math.max(dmax * thick, opts.minDepth ?? 4), opts.maxDepth ?? 22);

  // per-pixel height with a soft groove where colours meet (separates features)
  const hp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, id = up[i];
      if (!id) continue;
      const t = Math.min(dist[i] / dmax, 1);
      let hh = hMax * Math.sqrt(t * (2 - t));
      const n1 = x > 0 ? up[i - 1] : 0, n2 = x < W - 1 ? up[i + 1] : 0;
      const n3 = y > 0 ? up[i - W] : 0, n4 = y < H - 1 ? up[i + W] : 0;
      if ((n1 && n1 !== id) || (n2 && n2 !== id) || (n3 && n3 !== id) || (n4 && n4 !== id)) hh *= 0.86;
      hp[i] = hh;
    }
  }

  // corner heights (silhouette corners pinned to 0 so front and back meet)
  const CW = W + 1, CH = H + 1;
  const hc = new Float32Array(CW * CH);
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      let sum = 0, n = 0, edge = false;
      for (let k = 0; k < 4; k++) {
        const px = cx - 1 + (k & 1), py = cy - 1 + (k >> 1);
        if (px < 0 || py < 0 || px >= W || py >= H || !up[py * W + px]) { edge = true; break; }
        sum += hp[py * W + px]; n++;
      }
      hc[cy * CW + cx] = edge ? 0 : sum / n;
    }
  }
  const hcAt = (x, y) => hc[Math.min(CH - 1, Math.max(0, y)) * CW + Math.min(CW - 1, Math.max(0, x))];

  // corner normals from the height gradient
  const nx = new Float32Array(CW * CH), ny = new Float32Array(CW * CH), nz = new Float32Array(CW * CH);
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const gx = (hcAt(cx + 1, cy) - hcAt(cx - 1, cy)) * 0.5;
      const gy = (hcAt(cx, cy + 1) - hcAt(cx, cy - 1)) * 0.5;
      // world y is flipped, so +gy (down) becomes +ny
      const len = Math.hypot(gx, gy, 1);
      const i = cy * CW + cx;
      nx[i] = -gx / len; ny[i] = gy / len; nz[i] = 1 / len;
    }
  }

  let quads = 0;
  for (let i = 0; i < W * H; i++) if (up[i]) quads++;
  const verts = quads * 12;  // 2 sides * 2 tris * 3 verts
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  let v = 0;
  const inv = 1 / S;
  const put = (cx, cy, side, c) => {
    const ci = cy * CW + cx, o = v * 3;
    pos[o] = cx * inv; pos[o + 1] = -cy * inv; pos[o + 2] = side * hc[ci] * inv;
    nor[o] = nx[ci]; nor[o + 1] = ny[ci]; nor[o + 2] = side * nz[ci];
    col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
    v++;
  };
  const colorCache = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = up[y * W + x];
      if (!id) continue;
      let c = colorCache.get(id);
      if (!c) { c = colorOf(id); colorCache.set(id, c); }
      // front (CCW seen from +z): A(x,y) D(x,y+1) C(x+1,y+1) / A C B
      put(x, y, 1, c); put(x, y + 1, 1, c); put(x + 1, y + 1, 1, c);
      put(x, y, 1, c); put(x + 1, y + 1, 1, c); put(x + 1, y, 1, c);
      // back (reversed winding)
      put(x, y, -1, c); put(x + 1, y + 1, -1, c); put(x, y + 1, -1, c);
      put(x, y, -1, c); put(x + 1, y, -1, c); put(x + 1, y + 1, -1, c);
    }
  }
  return { position: pos, normal: nor, color: col, depth: hMax * inv };
}
