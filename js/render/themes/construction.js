// Donkey Kong backdrop: a construction site at night above a city skyline.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  const warm = ['#ffcf7a', '#ffb54d', '#ffe2a8', '#fff1cf'], cool = ['#9fd8ff', '#c8ecff'];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = r();
      if (v < 0.22) {
        g.fillStyle = v < 0.05 ? cool[(r() * cool.length) | 0] : warm[(r() * warm.length) | 0];
        g.globalAlpha = 0.25 + r() * 0.5;
        g.fillRect(x * 16 + 4, y * 16 + 3, 8, 10);
      }
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#03060c');
  grad.addColorStop(0.45, '#0a1626');
  grad.addColorStop(0.78, '#173049');
  grad.addColorStop(1, '#2b3d4c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, inner);
  grad.addColorStop(0.22, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boxInto(arrays, x, y, z, w, h, d, uvScale) {
  // appends a box (min corner x,y,z) with UVs scaled in world units for tiling window textures
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, y + h / 2, z + d / 2);
  const uv = g.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * faceDims[f][0] * uvScale, uv.getY(i) * faceDims[f][1] * uvScale);
    }
  }
  arrays.push(g);
}

function mergeGeometries(list) {
  let n = 0, idx = 0;
  for (const g of list) { n += g.attributes.position.count; idx += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const index = new Uint32Array(idx);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

export function buildConstruction(scene, { width, height }) {
  const group = new THREE.Group();
  scene.add(group);
  const groundY = -height / 2 - 1;
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x0e1c2b, 900, 2900);

  // stars
  {
    const r = rng(42), n = 900, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 3000;
      p[i * 3 + 1] = groundY + 120 + r() * 1300;
      p[i * 3 + 2] = -1500 - r() * 200;
      const b = 0.5 + r() * 0.5;
      c[i * 3] = b; c[i * 3 + 1] = b; c[i * 3 + 2] = b * (0.9 + r() * 0.15);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.85 });
    group.add(new THREE.Points(g, m));
  }

  // moon with halo
  {
    const m = new THREE.SpriteMaterial({ map: glowTexture('#fff6e0', 'rgba(255,236,200,0.16)'), fog: false, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.scale.set(520, 520, 1);
    s.position.set(-420, 420, -1400);
    group.add(s);
  }

  // city skyline (two layers of buildings with lit windows)
  {
    const r = rng(1234), boxes = [];
    for (let layer = 0; layer < 3; layer++) {
      const z = -1000 - layer * 380;
      const span = 1700 + layer * 700;
      let x = -span;
      while (x < span) {
        const w = 70 + r() * 150, h = 90 + r() * (260 + layer * 260);
        boxInto(boxes, x, groundY - 10, z - r() * 120, w, h, 60 + r() * 80, 1 / 200);
        if (r() < 0.25) boxInto(boxes, x + w * 0.3, groundY - 10 + h, z, w * 0.4, 20 + r() * 50, 40, 1 / 200);
        x += w + 10 + r() * 60;
      }
    }
    const geo = mergeGeometries(boxes);
    const tex = windowTexture();
    const mat = new THREE.MeshStandardMaterial({ color: 0x06090d, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.75 });
    const city = new THREE.Mesh(geo, mat);
    group.add(city);
  }

  // ground: wet concrete
  {
    const g = new THREE.PlaneGeometry(4000, 2400);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.42, metalness: 0.2, envMapIntensity: 0.15 });
    const ground = new THREE.Mesh(g, m);
    ground.position.set(0, groundY - 8, -600);
    ground.receiveShadow = true;
    group.add(ground);
    // slab under the playfield
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width + 60, 8, 70), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.85, envMapIntensity: 0.2 }));
    slab.position.set(0, groundY - 4, 0);
    slab.receiveShadow = true;
    group.add(slab);
  }

  // scaffolding behind the playfield
  {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a1f1d, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.25 });
    const z = -70;
    const H = height + 70;
    const cols = [-width / 2 - 14, -width / 4, width / 4, width / 2 + 14];
    const beams = [];
    for (const x of cols) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(7, H, 7), steel);
      col.position.set(x, groundY + H / 2 - 8, z);
      col.castShadow = col.receiveShadow = true;
      beams.push(col);
    }
    for (let i = 0; i < cols.length - 1; i++) {
      const x0 = cols[i], x1 = cols[i + 1];
      for (let y = groundY + 34; y < groundY + H - 20; y += 64) {
        const len = Math.hypot(x1 - x0, 64);
        const brace = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 3), steel);
        brace.position.set((x0 + x1) / 2, y + 32, z);
        brace.rotation.z = Math.atan2(64, x1 - x0) * (i % 2 ? -1 : 1);
        beams.push(brace);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 4, 4), steel);
        rail.position.set((x0 + x1) / 2, y, z);
        beams.push(rail);
      }
    }
    for (const b of beams) group.add(b);
    // warning lights on top of the scaffolding
    for (const x of [cols[0], cols[3]]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4a3a, toneMapped: false }));
      lamp.position.set(x, groundY + H - 4, z);
      lamp.userData.blink = true;
      group.add(lamp);
    }
  }

  // tower crane silhouette in the distance
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.8 });
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(14, 620, 14), mat);
    mast.position.y = 310;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(520, 10, 10), mat);
    jib.position.set(120, 610, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(50, 26, 18), mat);
    counter.position.set(-110, 600, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }));
    lamp.position.set(378, 616, 0);
    lamp.userData.blink = true;
    crane.add(mast, jib, counter, lamp);
    crane.position.set(520, groundY, -1150);
    group.add(crane);
  }

  const blinkers = [];
  group.traverse(o => { if (o.userData.blink) blinkers.push(o); });

  return {
    group,
    update(t) {
      const on = Math.sin(t * 3.2) > 0.2;
      for (const b of blinkers) b.visible = on;
    },
    dispose() { scene.remove(group); },
  };
}
