// Ms. Pac-Man backdrop: the maze floats as a lacquered board above a glowing synth-grid floor.
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

export function buildNeon(scene, { width: W, height: H, deluxe }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(5);

  scene.background = canvasTex(4, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#02030a');
    grad.addColorStop(0.55, '#06102a');
    grad.addColorStop(0.8, '#0b2244');
    grad.addColorStop(1, '#03050d');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x050a1a, 700, 2600);

  // the board: a dark lacquered slab under the maze with a glowing rim
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(W + 16, H + 16, 10),
    new THREE.MeshPhysicalMaterial({ color: 0x020308, roughness: 0.35, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.05 }),
  );
  board.position.z = -8;
  board.receiveShadow = true;
  group.add(board);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x2fd0ff, toneMapped: false });
  const rimW = 2.2;
  for (const [w, h, x, y] of [[W + 20, rimW, 0, H / 2 + 9], [W + 20, rimW, 0, -H / 2 - 9], [rimW, H + 20, W / 2 + 9, 0], [rimW, H + 20, -W / 2 - 9, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), rimMat);
    bar.position.set(x, y, -2);
    group.add(bar);
  }

  // synth grid floor far below
  const gridTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1e7fff';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,127,255,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.repeat.set(40, 40);
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, -H / 2 - 120, -600);
  group.add(grid);

  // floating bokeh lights in arcade colours
  const N = 160;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), seeds = [];
  const palette = [[1, 0.85, 0.1], [1, 0.3, 0.35], [0.3, 0.85, 1], [1, 0.6, 0.85], [1, 0.62, 0.2]];
  for (let i = 0; i < N; i++) {
    let x = (r() - 0.5) * 1600, y = (r() - 0.5) * 900;
    if (Math.abs(x) < W * 0.7 && Math.abs(y) < H * 0.7) x += Math.sign(x || 1) * W;
    pos.set([x, y, -150 - r() * 900], i * 3);
    col.set(palette[(r() * palette.length) | 0], i * 3);
    seeds.push(r() * 10);
  }
  const dot = canvasTex(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const bokeh = new THREE.Points(bg, new THREE.PointsMaterial({ map: dot, size: 26, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  group.add(bokeh);

  const extra = [];
  if (deluxe) {
    // striped synthwave sun on the horizon
    const sun = new THREE.Mesh(new THREE.CircleGeometry(440, 64), new THREE.MeshBasicMaterial({
      map: canvasTex(512, 512, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#fff3a0'); grad.addColorStop(0.5, '#ffb02e'); grad.addColorStop(1, '#ff4a3a');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 9; i++) { const y = h * 0.52 + i * 26; g.fillRect(0, y, w, 4 + i * 2.2); }
      }), transparent: true, toneMapped: false, fog: false, depthWrite: false }));
    sun.position.set(-1250, 40, -2600);
    group.add(sun);
    // light streaks racing along the grid
    const streakMat = new THREE.MeshBasicMaterial({ color: 0x3ad0ff, toneMapped: false, transparent: true, opacity: 0.9 });
    const streaks = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 140), streakMat);
      m.position.set((i - 7) * 150 + 75, -H / 2 - 118, -2000 + r() * 2000);
      m.userData.speed = 6 + r() * 8;
      group.add(m);
      streaks.push(m);
    }
    extra.push(t => {
      for (const m of streaks) { m.position.z += m.userData.speed; if (m.position.z > 400) m.position.z = -2400; }
      sun.scale.setScalar(1 + Math.sin(t * 0.6) * 0.01);
    });
  }

  return {
    group,
    update(t) {
      for (const f of extra) f(t);
      gridTex.offset.y = (t * 0.15) % 1;
      const p = bg.attributes.position;
      for (let i = 0; i < N; i++) p.array[i * 3 + 1] += Math.sin(t * 0.5 + seeds[i]) * 0.12;
      p.needsUpdate = true;
      rimMat.color.setHSL(0.53 + Math.sin(t * 0.3) * 0.04, 1, 0.55);
    },
    dispose() { scene.remove(group); },
  };
}
