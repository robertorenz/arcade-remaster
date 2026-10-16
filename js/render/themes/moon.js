// Moon Patrol backdrop: a lunar plain under a black sky with the Earth hanging overhead.
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

function earthTexture() {
  const r = rng(77);
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#1d4f8f';
    g.fillRect(0, 0, w, h);
    // continents
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = h * 0.15 + r() * h * 0.7, rad = 14 + r() * 46;
      g.fillStyle = r() < 0.6 ? '#3f7a3a' : '#9a8a55';
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, rr = rad * (0.6 + r() * 0.6);
        const px = x + Math.cos(a) * rr * 1.4, py = y + Math.sin(a) * rr * 0.8;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.fill();
    }
    // polar caps and clouds
    g.fillStyle = 'rgba(240,248,255,0.9)';
    g.fillRect(0, 0, w, h * 0.07); g.fillRect(0, h * 0.93, w, h * 0.07);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.45})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 10 + r() * 40, 3 + r() * 7, (r() - 0.5) * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function glowTexture() {
  return canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    grad.addColorStop(0, 'rgba(120,180,255,0.55)');
    grad.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
}

function regolithTexture() {
  const r = rng(3);
  const t = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6d6a66';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 80 + r() * 60;
      g.fillStyle = `rgba(${v},${v - 3},${v - 6},0.35)`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 30;
      const grad = g.createRadialGradient(x - rad * 0.2, y - rad * 0.2, rad * 0.1, x, y, rad);
      grad.addColorStop(0, 'rgba(40,38,36,0.7)');
      grad.addColorStop(0.75, 'rgba(70,68,64,0.4)');
      grad.addColorStop(0.9, 'rgba(160,156,150,0.5)');
      grad.addColorStop(1, 'rgba(160,156,150,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  return t;
}

export function buildMoon(scene, { width: W, height: H, view, deluxe }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(11);

  scene.background = canvasTex(4, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#000003');
    grad.addColorStop(0.6, '#03070f');
    grad.addColorStop(1, '#0b1420');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x05080d, 1400, 4200);

  // deep starfield
  {
    const n = 2200, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 5000;
      p[i * 3 + 1] = -400 + r() * 2600;
      p[i * 3 + 2] = -1800 - r() * 300;
      const b = 0.4 + r() * 0.6, tint = r();
      c[i * 3] = b * (tint < 0.15 ? 1 : 0.92); c[i * 3 + 1] = b * 0.95; c[i * 3 + 2] = b * (tint > 0.85 ? 1 : 0.9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, fog: false })));
  }

  // the Earth
  const earth = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 32), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.8, emissive: 0x0a1a33, fog: false }));
  earth.position.set(-620, 520, -1500);
  earth.rotation.z = 0.35;
  group.add(earth);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(470, 470, 1);
  halo.position.copy(earth.position);
  group.add(halo);

  // the arcade background colour behind the picture, with stars of its own
  const backMat = new THREE.MeshBasicMaterial({ color: 0x000000, clippingPlanes: view.clipPlanes, fog: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.4, H * 1.4), backMat);
  const starTex = canvasTex(512, 512, (g, w, h) => {
    const sr = rng(21);
    for (let i = 0; i < 380; i++) {
      const b = 120 + sr() * 135;
      g.fillStyle = `rgb(${b},${b},${Math.min(255, b + 20)})`;
      const s = sr() < 0.08 ? 2 : 1;
      g.fillRect(sr() * w, sr() * h, s, s);
    }
  });
  const starMat = new THREE.MeshBasicMaterial({ map: starTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: view.clipPlanes, fog: false });
  const stars = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.4, H * 1.4), starMat);
  const BACK_Z = -170;
  group.add(back, stars);

  // lunar plain around the picture
  const regolith = new THREE.MeshStandardMaterial({ map: regolithTexture(), color: 0x8a8884, roughness: 0.95, metalness: 0, envMapIntensity: 0.1 });
  const plain = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000), regolith);
  plain.rotation.x = -Math.PI / 2;
  plain.position.set(0, -H / 2 - 30, -1200);
  plain.receiveShadow = true;
  group.add(plain);

  // boulders and crater rims scattered on the plain (kept off the picture)
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 70; i++) {
      const size = 6 + r() * 40;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), rockMat);
      let x = (r() - 0.5) * 3000, z = -150 - r() * 1600;
      if (Math.abs(x) < W * 0.8) x += Math.sign(x || 1) * W * 0.9;
      rock.position.set(x, -H / 2 - 30 + size * 0.3, z);
      rock.rotation.set(r() * 3, r() * 3, r() * 3);
      rock.scale.y = 0.6;
      rock.castShadow = rock.receiveShadow = true;
      group.add(rock);
    }
  }

  // lunar base domes on the horizon
  {
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x7c8590, roughness: 0.55, metalness: 0.5, envMapIntensity: 0.4 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x5fd4ff, toneMapped: false });
    for (let i = 0; i < 5; i++) {
      const rad = 30 + r() * 45;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(rad, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      const x = (i < 3 ? -1 : 1) * (W * 1.2 + r() * 600);
      dome.position.set(x, -H / 2 - 30, -700 - r() * 500);
      group.add(dome);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), lightMat);
      beacon.position.set(x, -H / 2 - 30 + rad + 4, dome.position.z);
      beacon.userData.blink = r() * 6;
      group.add(beacon);
    }
  }
  const beacons = [];
  group.traverse(o => { if (o.userData.blink !== undefined) beacons.push(o); });

  const meteors = [];
  if (deluxe) {
    const mMat = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, toneMapped: false, transparent: true, fog: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.2, 160, 6), mMat.clone());
      m.rotation.z = Math.PI / 2 + 0.45;
      m.userData.t0 = i * 3.1;
      group.add(m);
      meteors.push(m);
    }
    // a slow satellite crossing the sky with a blinking light
    const sat = new THREE.Group();
    sat.add(new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.8, roughness: 0.3 })));
    for (const s2 of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x1f4f9a, metalness: 0.5, roughness: 0.3 })); p.position.x = s2 * 16; sat.add(p); }
    const blink = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a3a, toneMapped: false }));
    blink.position.y = 6; sat.add(blink);
    sat.position.set(-900, 560, -1100);
    group.add(sat);
    meteors.sat = sat; meteors.blink = blink;
  }

  return {
    group,
    update(t, sceneInfo) {
      for (const m of meteors) {
        const k = ((t + m.userData.t0) % 13) / 1.4;
        m.visible = k < 1;
        if (k < 1) { m.position.set(700 - k * 900 + m.userData.t0 * 60, 700 - k * 420, -1500); m.material.opacity = 1 - k; }
      }
      if (meteors.sat) { meteors.sat.position.x = -1200 + ((t * 12) % 2400); meteors.sat.rotation.y = t * 0.3; meteors.blink.visible = Math.sin(t * 4) > 0.6; }
      const s = view.depthScale(BACK_Z);
      back.position.z = BACK_Z; back.scale.set(s, s, 1);
      const s2 = view.depthScale(BACK_Z + 1);
      stars.position.z = BACK_Z + 1; stars.scale.set(s2, s2, 1);
      if (sceneInfo && sceneInfo.bgColor) {
        const [cr, cg, cb] = sceneInfo.bgColor;
        backMat.color.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
        const lum = (cr + cg + cb) / 765;
        starMat.opacity = Math.max(0, 1 - lum * 3);
      }
      earth.rotation.y = t * 0.02;
      for (const b of beacons) b.visible = Math.sin(t * 2.5 + b.userData.blink) > 0;
    },
    dispose() { scene.remove(group); },
  };
}
