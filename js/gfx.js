// Graphics decoding helpers (MAME-style gfx layouts, bit offsets are MSB-first).

export function decodePlanar(data, { w, h, count, planes, xoff, yoff, stride, start = 0 }) {
  const out = [];
  const bit = n => (data[n >> 3] >> (7 - (n & 7))) & 1;
  for (let c = 0; c < count; c++) {
    const g = new Uint8Array(w * h);
    const base = start + c * stride;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let p = 0; p < planes.length; p++) {
          v = (v << 1) | bit(base + planes[p] + xoff[x] + yoff[y]);
        }
        g[y * w + x] = v;
      }
    }
    out.push(g);
  }
  return out;
}
