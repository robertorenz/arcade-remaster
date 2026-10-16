// Jungle King backdrop: the arcade picture becomes a window into a deep, sunlit rainforest.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function leafTexture(seed, hue) {
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.translate(w / 2, h);
    const leaves = 7 + Math.floor(r() * 5);
    for (let i = 0; i < leaves; i++) {
      g.save();
      g.rotate((r() - 0.5) * 2.2);
      const len = 120 + r() * 110, wid = 26 + r() * 30;
      const grad = g.createLinearGradient(0, 0, 0, -len);
      const l1 = 18 + r() * 14, l2 = 32 + r() * 18;
      grad.addColorStop(0, `hsl(${hue + r() * 20}, 55%, ${l1}%)`);
      grad.addColorStop(1, `hsl(${hue + 10 + r() * 20}, 60%, ${l2}%)`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(wid, -len * 0.3, wid * 0.8, -len * 0.8, 0, -len);
      g.bezierCurveTo(-wid * 0.8, -len * 0.8, -wid, -len * 0.3, 0, 0);
      g.fill();
      g.strokeStyle = `hsla(${hue + 20}, 50%, 55%, 0.35)`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.95); g.stroke();
      g.restore();
    }
  });
}

function rayTexture() {
  return canvasTex(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,240,200,0.55)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, w, h);
  });
}

function dotTexture() {
  return canvasTex(32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.35, 'rgba(255,240,160,0.6)');
    grad.addColorStop(1, 'rgba(255,240,160,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  });
}

export function buildJungle(scene, { width: W, height: H, view, deluxe }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(99);

  scene.background = canvasTex(4, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0d2216');
    grad.addColorStop(0.45, '#163824');
    grad.addColorStop(0.75, '#21452b');
    grad.addColorStop(1, '#0a160e');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x1d3a26, 650, 2400);

  // the arcade's background colour fills the picture behind every playfield
  // vertical gradient multiplied by the arcade colour, plus soft drifting clouds on top
  const gradTex = canvasTex(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#b8b8b8');
    grad.addColorStop(0.7, '#f4f4f4');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const cloudTex = canvasTex(512, 256, (g, w, h) => {
    const cr = rng(5);
    for (let i = 0; i < 26; i++) {
      const x = cr() * w, y = 30 + cr() * h * 0.6, rad = 20 + cr() * 50;
      for (let k = 0; k < 6; k++) {
        const ox = x + (cr() - 0.5) * rad * 2.2, oy = y + (cr() - 0.5) * rad * 0.5, rr = rad * (0.5 + cr() * 0.6);
        for (const dx of [-w, 0, w]) {
          const grad = g.createRadialGradient(ox + dx, oy, 0, ox + dx, oy, rr);
          grad.addColorStop(0, 'rgba(255,255,255,0.32)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad;
          g.fillRect(ox + dx - rr, oy - rr, rr * 2, rr * 2);
        }
      }
    }
  });
  cloudTex.wrapS = THREE.RepeatWrapping;
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.8, clippingPlanes: view.clipPlanes, fog: false });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.4, H * 1.4), cloudMat);
  const backMat = new THREE.MeshBasicMaterial({ color: 0x5577cc, map: gradTex, clippingPlanes: view.clipPlanes, fog: false });
  // oversized and clipped to the picture so it always fills it, whatever the camera angle
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.4, H * 1.4), backMat);
  const BACK_Z = -60;
  group.add(back, clouds);

  // distant trunks
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x23301f, roughness: 0.95 });
    for (let i = 0; i < 26; i++) {
      const rad = 8 + r() * 22, z = -260 - r() * 900;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad, 1600, 10), mat);
      let x = (r() - 0.5) * 2200;
      if (Math.abs(x) < W * 0.7 && z > -500) x += Math.sign(x || 1) * W;
      trunk.position.set(x, 200, z);
      group.add(trunk);
    }
  }

  // foliage framing the picture (never inside the arcade rectangle)
  const leafTex = [leafTexture(1, 95), leafTexture(2, 110), leafTexture(3, 125), leafTexture(4, 80)];
  const leafMats = leafTex.map(t => new THREE.MeshStandardMaterial({ map: t, color: 0x7f9f82, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.2 }));
  const leaves = [];
  const placeLeaf = (x, y, z, size, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), leafMats[(r() * leafMats.length) | 0]);
    m.position.set(x, y, z);
    m.rotation.z = rot;
    m.userData.base = rot;
    m.userData.phase = r() * Math.PI * 2;
    m.castShadow = false;
    group.add(m);
    leaves.push(m);
  };
  for (let i = 0; i < 140; i++) {
    const side = i % 4;
    const z = -40 - r() * 380;
    const s = (500 - z) / 500;                       // stay outside the picture at this depth
    const size = 70 + r() * 140;
    let x, y;
    if (side === 0) { x = -W / 2 * s - size * 0.5 - 18 - r() * 600; y = (r() - 0.5) * H * 2.2; }
    else if (side === 1) { x = W / 2 * s + size * 0.5 + 18 + r() * 600; y = (r() - 0.5) * H * 2.2; }
    else if (side === 2) { x = (r() - 0.5) * W * 3; y = H / 2 * s + size * 0.5 + 18 + r() * 300; }
    else { x = (r() - 0.5) * W * 3; y = -H / 2 * s - size * 0.5 - 18 - r() * 200; }
    const rot = Math.atan2(-y, -x) + Math.PI / 2 + (r() - 0.5) * 0.8;
    placeLeaf(x, y, z, size, rot);
  }

  // soft light shafts
  const rayMat = new THREE.MeshBasicMaterial({ map: rayTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.28, fog: false });
  const rays = [];
  for (let i = 0; i < 7; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(60 + r() * 80, 900), rayMat);
    ray.position.set(-500 + i * 170 + r() * 60, 260, -380 - r() * 300);
    ray.rotation.z = -0.38;
    ray.userData.phase = r() * 6;
    group.add(ray);
    rays.push(ray);
  }

  // floating pollen / fireflies
  const N = 260;
  const pos = new Float32Array(N * 3), seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (r() - 0.5) * 1400;
    pos[i * 3 + 1] = (r() - 0.5) * 800;
    pos[i * 3 + 2] = -60 - r() * 600;
    seeds[i] = r() * 100;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(pg, new THREE.PointsMaterial({
    map: dotTexture(), size: 7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0b0, opacity: 0.8,
  }));
  group.add(motes);

  // forest floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3000), new THREE.MeshStandardMaterial({ color: 0x14200f, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -H / 2 - 120, -900);
  floor.receiveShadow = true;
  group.add(floor);

  const birds = [];
  if (deluxe) {
    const bm = new THREE.MeshStandardMaterial({ color: 0x1c241a, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Group();
      for (const s2 of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), bm);
        wing.position.x = s2 * 7;
        wing.userData.side = s2;
        const pivot = new THREE.Group(); pivot.add(wing); b.add(pivot);
      }
      b.position.set(-1400 + r() * 400, 250 + r() * 300, -700 - r() * 400);
      b.userData = { speed: 1.5 + r(), phase: r() * 6, y0: b.position.y };
      group.add(b);
      birds.push(b);
    }
  }

  return {
    group,
    update(t, sceneInfo) {
      for (const b of birds) {
        b.position.x += b.userData.speed;
        if (b.position.x > 1500) b.position.x = -1500;
        b.position.y = b.userData.y0 + Math.sin(t * 0.8 + b.userData.phase) * 20;
        b.children.forEach(p => { p.rotation.z = Math.sin(t * 9 + b.userData.phase) * 0.6 * p.children[0].userData.side; });
      }
      const s = view.depthScale(BACK_Z);
      back.position.z = BACK_Z;
      back.scale.set(s, s, 1);
      if (sceneInfo && sceneInfo.bgColor) {
        const [cr, cg, cb] = sceneInfo.bgColor;
        backMat.color.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
        // clouds only make sense over a bright sky
        const lum = (0.3 * cr + 0.59 * cg + 0.11 * cb) / 255;
        cloudMat.opacity = Math.max(0, Math.min(0.4, (lum - 0.25) * 0.9));
      }
      const cs = view.depthScale(BACK_Z + 2);
      clouds.position.z = BACK_Z + 2;
      clouds.scale.set(cs, cs, 1);
      cloudTex.offset.x = (t * 0.004) % 1;
      for (const l of leaves) l.rotation.z = l.userData.base + Math.sin(t * 0.7 + l.userData.phase) * 0.04;
      for (const ray of rays) ray.material.opacity = 0.22 + 0.06 * Math.sin(t * 0.4 + ray.userData.phase);
      const p = pg.attributes.position;
      for (let i = 0; i < N; i++) {
        p.array[i * 3 + 1] += Math.sin(t * 0.6 + seeds[i]) * 0.15;
        p.array[i * 3] += Math.cos(t * 0.4 + seeds[i]) * 0.12;
      }
      p.needsUpdate = true;
    },
    dispose() { scene.remove(group); },
  };
}
