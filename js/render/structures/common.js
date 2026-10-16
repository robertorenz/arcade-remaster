// Shared helpers for "Redrawn" structure builders: they take over some of a game's background
// tiles (girders, maze walls, ledges...) and rebuild them as purpose-made 3D models.
import * as THREE from 'three';

export const palBase = o => (o.pal !== undefined ? o.pal : o.color * 4);

export function fnv(arr, len = arr.length, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < len; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function strHash(str, h = 2166136261) {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// identity of a tile set: content, palette colours and position
export function tileSig(view, tiles) {
  let h = 2166136261;
  for (const t of tiles) h = strHash(`${t.key !== undefined ? t.key : t.code}:${view.palKey(palBase(t), 16)}:${t.x},${t.y};`, h);
  return h;
}

// rasterise tiles into a W*H map of palette indices (-1 = empty / black)
export function rasterize(view, tiles, W, H, filter) {
  const idx = new Int32Array(W * H).fill(-1);
  for (const t of tiles) {
    const base = palBase(t);
    for (let py = 0; py < t.h; py++) {
      const y = t.y + py;
      if (y < 0 || y >= H) continue;
      for (let px = 0; px < t.w; px++) {
        const p = t.pixels[py * t.w + px];
        if (!p) continue;
        const x = t.x + px;
        if (x < 0 || x >= W) continue;
        const c = view.linear(base + p);
        if (c[0] + c[1] + c[2] < 1e-4) continue;
        if (filter && !filter(t, p)) continue;
        idx[y * W + x] = base + p;
      }
    }
  }
  return idx;
}

// copies of tiles with the covered pixels removed (fully covered tiles are dropped)
export function cutTiles(tiles, covered, W, H) {
  const out = [];
  for (const t of tiles) {
    let copy = null, left = 0;
    for (let py = 0; py < t.h; py++) {
      for (let px = 0; px < t.w; px++) {
        const p = t.pixels[py * t.w + px];
        if (!p) continue;
        const x = t.x + px, y = t.y + py;
        if (x >= 0 && y >= 0 && x < W && y < H && covered[y * W + x]) {
          if (!copy) copy = t.pixels.slice();
          copy[py * t.w + px] = 0;
        } else left++;
      }
    }
    if (!copy) out.push(t);
    else if (left) out.push({ ...t, pixels: copy, key: `${t.key !== undefined ? t.key : t.code}s${fnv(copy)}` });
  }
  return out;
}

// connected components (8-neighbour) of non-empty cells
export function components(idx, W, H) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (idx[i] < 0 || label[i] >= 0) continue;
    const id = comps.length;
    const pixels = [];
    let sp = 0;
    stack[sp++] = i; label[i] = id;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    while (sp) {
      const j = stack[--sp];
      pixels.push(j);
      const x = j % W, y = (j / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (idx[k] < 0 || label[k] >= 0) continue;
          label[k] = id;
          stack[sp++] = k;
        }
      }
    }
    comps.push({ id, pixels, x0, y0, x1, y1 });
  }
  return { comps, label };
}

export function dominantIndex(idx, pixels) {
  const counts = new Map();
  for (const j of pixels) counts.set(idx[j], (counts.get(idx[j]) || 0) + 1);
  let best = -1, bc = -1;
  for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
  return best;
}

// give every vertex of a geometry one colour
export function paint(geo, rgb) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

export const scale3 = (c, k) => [Math.min(c[0] * k, 4), Math.min(c[1] * k, 4), Math.min(c[2] * k, 4)];

// cheap deterministic value noise in [-1, 1]
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = t => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

export function disposeTree(obj) {
  obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

export function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}
