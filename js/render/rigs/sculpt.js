// Sculpting toolkit for the Redrawn characters: smooth tapered tubes along curves, shaped blobs,
// expressive eyes and procedural normal maps for fur, cloth and leather.
import * as THREE from 'three';

// a tube along a smooth curve whose radius varies along its length (limbs, necks, tails, hair)
export function taper(points, radii, material, { radial = 14, seg = 0, caps = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const n = seg || Math.max(8, points.length * 6);
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], nor = [], uv = [], index = [];
  const rAt = t => {
    const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)), k = f - i;
    return radii[i] + (radii[i + 1] - radii[i]) * k;
  };
  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    curve.getPointAt(t, p);
    const r = rAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      nrm.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(p.x + nrm.x * r, p.y + nrm.y * r, p.z + nrm.z * r);
      nor.push(nrm.x, nrm.y, nrm.z);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, material);
  if (caps) {
    const group = new THREE.Group();
    group.add(mesh);
    const r0 = radii[0], r1 = radii[radii.length - 1];
    const s0 = new THREE.Mesh(new THREE.SphereGeometry(r0, radial, 8), material); s0.position.copy(curve.getPointAt(0));
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(r1, radial, 8), material); s1.position.copy(curve.getPointAt(1));
    group.add(s0, s1);
    return group;
  }
  return mesh;
}

// a sphere pushed into shape: scale per axis, then an optional displacement function
// fn(v: Vector3 on the unit sphere) -> radius multiplier
export function blob(rx, ry, rz, material, fn, w = 32, h = 24) {
  const g = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = fn ? fn(v) : 1;
    p.setXYZ(i, v.x * rx * k, v.y * ry * k, v.z * rz * k);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

// an eye that looks along +z: sclera, iris, pupil and a specular highlight
export function eye(r, irisColor, { lid = null, scaleY = 1 } = {}) {
  const g = new THREE.Group();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xf8f6f0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const iris = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 18, 12), new THREE.MeshPhysicalMaterial({ color: irisColor, roughness: 0.3, clearcoat: 1 }));
  iris.scale.z = 0.45; iris.position.z = r * 0.72;
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.34, 14, 10), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 }));
  pupil.scale.z = 0.4; pupil.position.z = r * 0.86;
  const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  glint.position.set(r * 0.25, r * 0.28, r * 0.97);
  glint.userData.noShadow = true;
  const look = new THREE.Group();
  look.add(iris, pupil, glint);
  g.add(sclera, look);
  if (lid) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), lid);
    l.rotation.x = -0.35;
    g.add(l);
    g.userData.lid = l;
  }
  g.scale.y = scaleY;
  g.userData.look = look;
  return g;
}

// ---- procedural normal maps -------------------------------------------------------------------
const texCache = new Map();
function normalFromHeight(size, height) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const nx = -dx * 2, ny = -dy * 2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

export function furNormal() {
  if (texCache.has('fur')) return texCache.get('fur');
  const N = 256, hgt = new Float32Array(N * N), r = rng(7);
  // thousands of short strands flowing mostly downward
  for (let k = 0; k < 2600; k++) {
    let x = r() * N, y = r() * N;
    const len = 6 + r() * 10, ang = Math.PI / 2 + (r() - 0.5) * 0.7, w = 0.6 + r() * 0.6;
    for (let s = 0; s < len; s++) {
      const xi = Math.round(x) & (N - 1), yi = Math.round(y) & (N - 1);
      hgt[yi * N + xi] = Math.max(hgt[yi * N + xi], w * (1 - s / len));
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }
  const t = normalFromHeight(N, hgt);
  texCache.set('fur', t);
  return t;
}

export function clothNormal() {
  if (texCache.has('cloth')) return texCache.get('cloth');
  const N = 128, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // twill weave: diagonal ribs
    hgt[y * N + x] = 0.5 + 0.5 * Math.sin(((x + y) / N) * Math.PI * 2 * 24) * 0.6 + 0.2 * Math.sin((x / N) * Math.PI * 2 * 64);
  }
  const t = normalFromHeight(N, hgt);
  texCache.set('cloth', t);
  return t;
}

export function scaleNormal() {
  if (texCache.has('scale')) return texCache.get('scale');
  const N = 128, hgt = new Float32Array(N * N);
  const cell = 16;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const row = Math.floor(y / cell), ox = (row % 2) * cell / 2;
    const cx = ((x + ox) % cell) - cell / 2, cy = (y % cell) - cell * 0.2;
    hgt[y * N + x] = Math.max(0, 1 - Math.hypot(cx, cy * 0.8) / (cell * 0.7));
  }
  const t = normalFromHeight(N, hgt);
  texCache.set('scale', t);
  return t;
}

export function featherNormal() {
  if (texCache.has('feather')) return texCache.get('feather');
  const N = 128, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = (y % 32) / 32, u = Math.abs((x % 32) - 16) / 16;
    hgt[y * N + x] = (1 - v) * (1 - u * u) + 0.15 * Math.sin(x * 1.7 + y * 0.3);
  }
  const t = normalFromHeight(N, hgt);
  texCache.set('feather', t);
  return t;
}

// standard materials with detail maps
export function furMat(color, sheen = 0x9a6a40) {
  const n = furNormal();
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.82, normalMap: n, normalScale: new THREE.Vector2(0.9, 0.9), sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(sheen).multiplyScalar(0.6) });
  return m;
}
export function clothMat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.72, normalMap: clothNormal(), normalScale: new THREE.Vector2(0.12, 0.12), sheen: 0.12, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(0.5), ...opts });
}
export function skinMat(color = 0xf2b48c) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.1, clearcoatRoughness: 0.5, sheen: 0.15, sheenColor: new THREE.Color(0xc06a50), sheenRoughness: 0.6 });
}
export function glossMat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, ...opts });
}
export function metalMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.25, envMapIntensity: 0.75, ...opts });
}
export function featherMat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, normalMap: featherNormal(), normalScale: new THREE.Vector2(0.5, 0.5), sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).multiplyScalar(0.6), ...opts });
}

// a pivot group: children hang along -y from it
export function joint(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
