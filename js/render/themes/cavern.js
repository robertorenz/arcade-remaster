// Joust backdrop: a volcanic cavern; the arena floats over a lava sea that lights everything from below.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lavaTexture() {
  const r = rng(9);
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5a0a00';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const hot = r();
      grad.addColorStop(0, hot > 0.7 ? 'rgba(255,230,120,0.9)' : 'rgba(255,120,20,0.8)');
      grad.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grad;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, Math.PI * 2); g.fill(); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 4);
  return t;
}

export function buildCavern(scene, { width: W, height: H, deluxe }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(13);

  scene.background = canvasTex(4, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#040203');
    grad.addColorStop(0.6, '#140604');
    grad.addColorStop(1, '#3a0e04');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x1a0703, 500, 2200);

  // lava sea
  const lavaTex = lavaTexture();
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(5000, 2600), new THREE.MeshBasicMaterial({ map: lavaTex, color: 0xffffff, toneMapped: false }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(0, -H / 2 - 40, -900);
  group.add(lava);

  // warm light from the lava
  const glows = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xff5a1a, 0, 700, 1.4);
    l.position.set((i - 1) * 220, -H / 2 - 20, 60);
    group.add(l);
    glows.push(l);
  }

  // cavern walls: jagged rock columns and stalactites framing the arena
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1;
    const hgt = 200 + r() * 700, rad = 30 + r() * 90;
    const col = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 6 + ((r() * 4) | 0)), rockMat);
    const x = side * (W * 0.62 + r() * 900), z = -100 - r() * 900;
    const fromTop = r() < 0.45;
    col.position.set(x, fromTop ? H / 2 + 200 - hgt / 2 + 300 : -H / 2 - 40 + hgt / 2, z);
    if (fromTop) col.rotation.z = Math.PI;
    col.rotation.y = r() * Math.PI;
    group.add(col);
  }
  for (let i = 0; i < 30; i++) {
    const hgt = 60 + r() * 220, rad = 12 + r() * 40;
    const st = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 5), rockMat);
    st.rotation.z = Math.PI;
    st.position.set((r() - 0.5) * 2400, H / 2 + 120 + r() * 120 - hgt / 2 + 140, -200 - r() * 800);
    group.add(st);
  }

  // rising embers
  const N = 300;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(r() - 0.5) * 1800, -H / 2 - 40 + r() * 700, -80 - r() * 700], i * 3);
    seed[i] = r() * 10;
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dot = canvasTex(32, 32, g => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,220,140,1)');
    grad.addColorStop(0.4, 'rgba(255,120,30,0.6)');
    grad.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: dot, size: 9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(embers);

  const geysers = [];
  if (deluxe) {
    const gm = new THREE.MeshBasicMaterial({ color: 0xffa030, toneMapped: false, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 4; i++) {
      const col = new THREE.Group();
      for (let k = 0; k < 18; k++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(6 + (k % 3) * 3, 10, 8), gm);
        blob.userData.k = k;
        col.add(blob);
      }
      const side = i % 2 ? 1 : -1;
      col.position.set(side * (W * 0.75 + i * 120), -H / 2 - 40, -300 - i * 180);
      col.userData.t0 = i * 2.7;
      group.add(col);
      geysers.push(col);
    }
  }

  return {
    group,
    update(t) {
      for (const gy of geysers) {
        const k = ((t + gy.userData.t0) % 9) / 2.2;
        gy.visible = k < 1;
        gy.children.forEach(b => {
          const u = b.userData.k / 18;
          const hgt = Math.sin(Math.min(1, k) * Math.PI) * 420 * u;
          b.position.set(Math.sin(u * 9 + t) * 10 * u, hgt, Math.cos(u * 7) * 8);
          b.scale.setScalar(1.4 - u * 0.8);
        });
      }
      lavaTex.offset.set((t * 0.004) % 1, (t * 0.002) % 1);
      glows.forEach((l, i) => { l.intensity = 9000 * (0.8 + 0.2 * Math.sin(t * 2.3 + i * 1.7) * Math.sin(t * 0.7 + i)); });
      const p = eg.attributes.position;
      for (let i = 0; i < N; i++) {
        p.array[i * 3 + 1] += 0.35 + Math.sin(seed[i] + t) * 0.1;
        p.array[i * 3] += Math.sin(t * 0.8 + seed[i]) * 0.2;
        if (p.array[i * 3 + 1] > H / 2 + 500) p.array[i * 3 + 1] = -H / 2 - 40;
      }
      p.needsUpdate = true;
    },
    dispose() { scene.remove(group); },
  };
}
