// Q*bert backdrop: the pyramid floats in deep space among nebula clouds, twinkling stars and
// drifting isometric cubes. Deluxe (Redrawn) adds a ringed planet, shooting stars and flying discs.
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

// soft cloud made of many overlapping radial puffs
function nebulaTex(seed, colors) {
  const r = rng(seed);
  return canvasTex(512, 512, (g, w, h) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * w * 0.32;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d * 0.6;
      const rad = 30 + r() * 110;
      const [cr, cg, cb] = colors[(r() * colors.length) | 0];
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.035 + r() * 0.05})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
}

// a small isometric cube with the game's three face colours baked into vertex colours
function cubeGeometry(top, left, right, size) {
  const geo = new THREE.BoxGeometry(size, size * 0.82, size);
  const col = [];
  const faceCol = [right, left, top, left, right, left];   // px nx py ny pz nz (after a 45 degree yaw: -x left, +z right)
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.push(...faceCol[f]);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export function buildCosmos(scene, { width: W, height: H, deluxe }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(11);

  scene.background = canvasTex(4, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#01030a');
    grad.addColorStop(0.45, '#041026');
    grad.addColorStop(0.75, '#062433');
    grad.addColorStop(1, '#020509');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x030a16, 900, 3200);

  // nebula clouds far behind the pyramid
  const clouds = [];
  const cloudSets = [
    [[30, 130, 160], [15, 70, 160], [50, 150, 130]],
    [[200, 100, 30], [170, 50, 30], [210, 140, 60]],
    [[20, 80, 170], [40, 140, 190], [15, 45, 110]],
  ];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshBasicMaterial({
      map: nebulaTex(100 + i, cloudSets[i % 3]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false,
    }));
    m.position.set((r() - 0.5) * 1800, (r() - 0.5) * 700, -1500 - r() * 900);
    m.rotation.z = r() * Math.PI;
    m.userData.spin = (r() - 0.5) * 0.01;
    group.add(m);
    clouds.push(m);
  }

  // stars
  const N = 900;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), tw = [];
  for (let i = 0; i < N; i++) {
    pos.set([(r() - 0.5) * 5000, (r() - 0.5) * 3000, -600 - r() * 2600], i * 3);
    const warm = r();
    col.set(warm < 0.2 ? [1, 0.82, 0.6] : warm < 0.45 ? [0.7, 0.85, 1] : [1, 1, 1], i * 3);
    tw.push(r() * 10);
  }
  const dot = canvasTex(64, 64, g => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.PointsMaterial({ map: dot, size: 9, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  group.add(new THREE.Points(starGeo, starMat));

  // a soft glow behind the pyramid
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.6, H * 2.2), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 256, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, w / 2);
      grad.addColorStop(0, 'rgba(50,140,200,0.16)');
      grad.addColorStop(0.5, 'rgba(25,80,150,0.06)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.position.set(0, -10, -160);
  group.add(halo);

  // drifting cubes in the game's colours
  const faces = [
    [[0.25, 0.22, 0.95], [0.3, 0.68, 0.6], [0.15, 0.25, 0.27]],
    [[0.95, 0.85, 0.1], [0.3, 0.68, 0.6], [0.15, 0.25, 0.27]],
    [[0.95, 0.45, 0.1], [0.2, 0.4, 0.75], [0.1, 0.15, 0.3]],
  ];
  const cubeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.4 });
  const cubes = [];
  for (let i = 0; i < 26; i++) {
    const f = faces[(r() * faces.length) | 0];
    const m = new THREE.Mesh(cubeGeometry(...f, 14 + r() * 26), cubeMat);
    let x = (r() - 0.5) * 1700, y = (r() - 0.5) * 900;
    if (Math.abs(x) < W * 1.5) x = Math.sign(x || 1) * (W * 1.5 + r() * 500);
    m.position.set(x, y, -250 - r() * 900);
    m.rotation.set(Math.PI / 6, Math.PI / 4, 0);
    m.userData = { bob: r() * 10, spin: (r() - 0.5) * 0.4, y };
    m.castShadow = false;
    group.add(m);
    cubes.push(m);
  }

  const extra = [];
  if (deluxe) {
    // ringed planet low on the horizon
    const planetMat = new THREE.MeshStandardMaterial({
      map: canvasTex(512, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#f2a050'); grad.addColorStop(0.3, '#d06a30'); grad.addColorStop(0.55, '#f6c27a');
        grad.addColorStop(0.75, '#b85a2a'); grad.addColorStop(1, '#7a3418');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        const rr = rng(4);
        for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,230,190,${rr() * 0.12})`; g.fillRect(0, rr() * h, w, 1 + rr() * 6); }
      }), roughness: 0.8, metalness: 0, emissive: 0x3a1a08, emissiveIntensity: 0.25,
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(260, 64, 32), planetMat);
    planet.position.set(1050, -420, -1900);
    planet.rotation.z = 0.35;
    const ring = new THREE.Mesh(new THREE.RingGeometry(330, 520, 96), new THREE.MeshBasicMaterial({
      map: canvasTex(512, 8, (g, w) => {
        for (let x = 0; x < w; x++) { const a = 0.25 + 0.55 * Math.abs(Math.sin(x * 0.11) * Math.sin(x * 0.037)); g.fillStyle = `rgba(255,214,160,${a})`; g.fillRect(x, 0, 1, 8); }
      }), transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
    }));
    // map the 1D band radially
    const uv = ring.geometry.attributes.uv, p = ring.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) { const d = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (d - 330) / 190, 0.5); }
    ring.position.copy(planet.position);
    ring.rotation.set(-1.15, 0.2, 0.35);
    group.add(planet, ring);

    // shooting stars
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, toneMapped: false, transparent: true, opacity: 0.9, fog: false });
    const shooters = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.01, 120, 6), streakMat);
      m.rotation.z = Math.PI / 2.6;
      m.userData = { t0: r() * 12, z: -700 - r() * 900 };
      group.add(m);
      shooters.push(m);
    }
    // rainbow discs circling far behind
    const discTex = canvasTex(128, 128, (g, w, h) => {
      const cols = ['#ff3030', '#ffd020', '#30c040', '#2a7cff'];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = cols[i];
        g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, w / 2, i * Math.PI / 2, (i + 1) * Math.PI / 2); g.fill();
      }
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.12, 0, Math.PI * 2); g.fill();
    });
    const discMat = new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.3, metalness: 0.2, emissive: 0xffffff, emissiveMap: discTex, emissiveIntensity: 0.35 });
    const discs = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 4, 40), discMat);
      d.userData = { ph: i * 2.1, rad: 760 + i * 120, z: -1000 - i * 220 };
      group.add(d);
      discs.push(d);
    }
    extra.push(t => {
      for (const m of shooters) {
        const k = ((t + m.userData.t0) % 9) / 9;
        m.visible = k < 0.12;
        m.position.set(-900 + k * 9000, 520 - k * 5200, m.userData.z);
      }
      discs.forEach(d => {
        const a = t * 0.25 + d.userData.ph;
        d.position.set(Math.cos(a) * d.userData.rad, 160 + Math.sin(a * 1.3) * 90, d.userData.z + Math.sin(a) * 120);
        d.rotation.set(0.9, t * 3, 0.2);
      });
      planet.rotation.y = t * 0.02;
    });
  }

  return {
    group,
    update(t) {
      for (const f of extra) f(t);
      for (const c of clouds) c.rotation.z += c.userData.spin * 0.016;
      for (const c of cubes) {
        c.position.y = c.userData.y + Math.sin(t * 0.4 + c.userData.bob) * 12;
        c.rotation.y = Math.PI / 4 + Math.sin(t * c.userData.spin + c.userData.bob) * 0.5;
      }
      starMat.size = 8.5 + Math.sin(t * 2.2) * 0.8;
    },
    dispose() { scene.remove(group); },
  };
}
