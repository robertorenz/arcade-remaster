// Joust "Redrawn" characters. The board has no sprites: riders are drawn straight into the
// bitmap, so moving pixels are grouped into objects, recognised by their colours (the player's
// yellow knight on an ostrich, enemy knights on green buzzards, pterodactyls, eggs) and tracked
// from frame to frame. Each object becomes a sculpted, animated model.
import * as THREE from 'three';
import { blob, taper, eye, joint, damp, featherMat, metalMat, glossMat, skinMat } from './sculpt.js';

// ---- colour classes of the arcade palette --------------------------------------------------------
function hueClass([r, g, b]) {
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (r > 200 && g > 200 && b < 120) return 'yellow';
  if (r > 200 && g < 70) return 'red';
  if (r > 200 && g >= 70 && g < 180) return 'orange';
  if (b > r && b >= g && b > 80) return g > 140 ? 'cyan' : 'blue';
  if (g > r && g >= b * 0.9 && g > 60) return 'green';
  if (r > 100 && Math.abs(r - g) < 30 && Math.abs(g - b) < 40) return 'grey';
  if (r >= g && g >= b) return 'brown';
  return 'other';
}

// ---- models -----------------------------------------------------------------------------------
function feather(len, wid, m) {
  const f = blob(len / 2, 0.35, wid / 2, m, v => 1 - 0.35 * Math.max(0, v.x) ** 2);
  f.position.x = -len / 2;
  const p = new THREE.Group();
  p.add(f);
  return p;
}

function makeWing(m, span, chord) {
  const w = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const f = feather(chord * (0.7 + i * 0.12), 1.8, m);
    f.position.z = 0.6 + i * (span / 6);
    f.rotation.y = -0.15 - i * 0.07;
    f.rotation.z = 0.05 * i;
    w.add(f);
  }
  const arm = blob(chord * 0.45, 0.8, span * 0.42, m);
  arm.position.set(-0.6, 0.2, span * 0.4);
  w.add(arm);
  return w;
}

function makeBird(kind) {
  // kind: 'ostrich' (player) or 'buzzard' (enemy)
  const g = new THREE.Group();
  const flip = new THREE.Group();   // mirrored to face left
  g.add(flip);
  const body = new THREE.Group();
  flip.add(body);
  const plumage = featherMat(kind === 'ostrich' ? 0x9a6a18 : 0x1e5a1c);
  const dark = featherMat(kind === 'ostrich' ? 0x5a3a10 : 0x0e300e);
  const skin = skinMat(kind === 'ostrich' ? 0xa86040 : 0x8a3a24);
  const beakMat = glossMat(kind === 'ostrich' ? 0xf0b020 : 0xe0c040);
  body.add(blob(4.6, 3.0, 3.0, plumage, v => 1 + 0.12 * v.x - 0.1 * Math.max(0, -v.y)));
  const tail = joint(-4.6, 0.8, 0);
  for (let i = 0; i < 4; i++) { const f = feather(4.5 - i * 0.4, 1.6, dark); f.rotation.z = 0.35 + i * 0.18; f.rotation.y = (i - 1.5) * 0.25; tail.add(f); }
  body.add(tail);
  // neck and head
  const neckPts = kind === 'ostrich' ? [[3.6, 1.2, 0], [5.0, 4.2, 0], [5.4, 7.5, 0]] : [[3.8, 1.0, 0], [5.4, 2.8, 0], [6.4, 4.4, 0]];
  body.add(taper(neckPts, kind === 'ostrich' ? [1.9, 1.0, 0.8] : [2.0, 1.4, 1.2], kind === 'ostrich' ? skin : plumage));
  const head = joint(...neckPts[2]);
  head.add(blob(1.7, 1.45, 1.35, kind === 'ostrich' ? plumage : dark));
  if (kind === 'buzzard') {
    head.add(taper([[1.2, 0.2, 0], [2.6, -0.2, 0], [3.3, -1.3, 0]], [0.75, 0.45, 0.1], beakMat));
    const crest = taper([[-0.6, 1.1, 0], [-1.8, 2.0, 0]], [0.5, 0.15], skinMat(0xc03020));
    head.add(crest);
  } else {
    head.add(taper([[1.2, -0.1, 0], [3.4, -0.4, 0]], [0.6, 0.12], beakMat));
  }
  for (const s of [-1, 1]) { const e = eye(0.42, kind === 'ostrich' ? 0x3a2a10 : 0xd02010); e.position.set(0.8, 0.45, s * 1.05); e.rotation.y = s * 1.2; head.add(e); }
  body.add(head);
  // wings
  const wings = [-1, 1].map(s => {
    const p = joint(0.8, 1.8, s * 2.2);
    const w = makeWing(dark, 7.5, 5.5);
    w.scale.z = s;
    p.add(w);
    body.add(p);
    return p;
  });
  // legs: thigh -> shin -> toes
  const legs = [-1, 1].map(s => {
    const hip = joint(0.6, -2.6, s * 1.3);
    hip.add(taper([[0, 0, 0], [0.9, -2.6, 0]], [1.1, 0.6], kind === 'ostrich' ? plumage : skin));
    const knee = joint(0.9, -2.6, 0);
    knee.add(taper([[0, 0, 0], [-0.4, -3.6, 0]], [0.45, 0.35], skin));
    for (const a of [-0.5, 0, 0.5]) {
      const toe = taper([[-0.4, -3.6, 0], [-0.4 + Math.cos(a) * 1.6, -3.9, Math.sin(a) * 1.2]], [0.32, 0.15], skin, { caps: false });
      knee.add(toe);
    }
    hip.add(knee);
    hip.userData.knee = knee;
    body.add(hip);
    return hip;
  });
  return { g, flip, body, wings, legs, head, tail };
}

function makeKnight(color, kind) {
  const k = new THREE.Group();
  const armor = metalMat(color, { roughness: 0.28 });
  const trim = metalMat(0xd8c070, { roughness: 0.3 });
  k.add(blob(1.8, 2.4, 1.7, armor, v => 1 + 0.1 * v.y));
  const belt = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.3, 6, 20), trim); belt.rotation.x = Math.PI / 2; belt.position.y = -0.9; k.add(belt);
  const helm = joint(0.2, 3.3, 0);
  helm.add(blob(1.55, 1.75, 1.5, armor, v => 1 + 0.12 * Math.max(0, v.y)));
  const visor = blob(0.25, 0.25, 1.1, new THREE.MeshStandardMaterial({ color: 0x050505 })); visor.position.set(1.45, 0.1, 0); visor.scale.x = 0.6;
  helm.add(visor);
  const plumeCol = kind === 'player' ? 0xff3020 : 0xffffff;
  helm.add(taper([[-0.2, 1.6, 0], [-1.2, 3.0, 0], [-2.8, 3.2, 0], [-3.8, 2.2, 0]], [0.55, 0.65, 0.5, 0.15], glossMat(plumeCol, { roughness: 0.6, clearcoat: 0.2 })));
  k.add(helm);
  // lance couched under the arm
  const lance = new THREE.Group();
  lance.add(taper([[-1.5, 0, 0], [3, 0, 0], [11, 0.4, 0]], [0.42, 0.36, 0.06], metalMat(0xe8e8f0, { roughness: 0.18 })));
  const guard = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 14, 1, true), trim); guard.rotation.z = -Math.PI / 2; guard.position.x = 0.4;
  lance.add(guard);
  lance.position.set(0.6, 0.6, 1.6);
  k.add(lance);
  const arm = taper([[0.3, 1.6, 1.4], [1.0, 0.5, 1.8], [0.8, 0.4, 1.6]], [0.55, 0.45, 0.4], armor);
  k.add(arm);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 20), metalMat(kind === 'player' ? 0x2050c0 : 0x404048, { roughness: 0.4 }));
  shield.rotation.x = Math.PI / 2; shield.position.set(0.2, 0.2, -1.8);
  const boss = blob(0.5, 0.5, 0.3, trim); boss.position.set(0.2, 0.2, -2.05);
  k.add(shield, boss);
  // legs straddling the bird
  for (const s of [-1, 1]) k.add(taper([[0, -1.6, s * 1.2], [1.0, -2.8, s * 2.6], [1.2, -4.0, s * 2.6]], [0.6, 0.5, 0.45], armor));
  return { k, lance, helm };
}

function makeRider(kind, color) {
  const bird = makeBird(kind === 'player' ? 'ostrich' : 'buzzard');
  const knight = makeKnight(color, kind);
  knight.k.position.set(-0.4, 5.6, 0);
  bird.body.add(knight.k);
  bird.body.position.y = 1.5;
  const st = { flap: 0, run: 0, air: 0, face: 1, lean: 0 };
  return {
    group: bird.g,
    update(obj, { t, dt, st: s }) {
      const face = obj.facing || (s.vx > 0.05 ? 1 : s.vx < -0.05 ? -1 : st.face);
      st.face = face;
      bird.flip.scale.x = face;
      bird.flip.rotation.y = -face * 0.3;
      const air = Math.abs(s.vy) > 0.08 ? 1 : 0;
      st.air = damp(st.air, air, 8, dt);
      st.run += Math.abs(s.vx) * 0.55;
      // wings beat in the air, fold on the ground
      const beat = Math.sin(t * 16);
      for (const [i, w] of bird.wings.entries()) {
        const sgn = i ? 1 : -1;
        w.rotation.x = sgn * (0.35 + st.air * (0.25 + 0.75 * beat));
        w.rotation.z = 0.1 - st.air * 0.2;
      }
      // legs run on the ground, tuck in flight
      for (const [i, l] of bird.legs.entries()) {
        const ph = st.run + i * Math.PI;
        const swing = Math.abs(s.vx) > 0.05 ? Math.sin(ph) * 0.8 : 0;
        l.rotation.z = (1 - st.air) * swing + st.air * 1.1;
        l.userData.knee.rotation.z = (1 - st.air) * (-0.3 - Math.max(0, Math.cos(ph)) * 0.6) - st.air * 1.6;
      }
      st.lean = damp(st.lean, -s.vx * face * 0.08 + st.air * 0.1, 6, dt);
      bird.body.rotation.z = Math.max(-0.3, Math.min(0.3, st.lean));
      bird.body.position.y = 1.5 + (1 - st.air) * Math.abs(Math.sin(st.run)) * 0.5;
      bird.head.rotation.z = Math.sin(t * 3) * 0.08 + (1 - st.air) * Math.sin(st.run * 2) * 0.12;
      bird.tail.rotation.z = Math.sin(t * 7) * 0.08;
      knight.lance.rotation.z = Math.sin(t * 2) * 0.03;
    },
  };
}

function makePterodactyl() {
  const g = new THREE.Group();
  const flip = new THREE.Group();
  g.add(flip);
  const hide = new THREE.MeshPhysicalMaterial({ color: 0x3a7ab0, roughness: 0.5, clearcoat: 0.4, sheen: 0.4 });
  const membrane = new THREE.MeshPhysicalMaterial({ color: 0x5aa0d0, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  flip.add(blob(5, 1.8, 1.8, hide, v => 1 - 0.3 * Math.max(0, -v.x)));
  flip.add(taper([[-4, 0, 0], [-9, 0.8, 0], [-12, 0.4, 0]], [1.0, 0.5, 0.1], hide));
  const head = joint(5, 1.2, 0);
  head.add(blob(2.0, 1.4, 1.2, hide));
  head.add(taper([[1.5, -0.2, 0], [7, -0.8, 0]], [0.9, 0.1], glossMat(0xe8d070)));
  head.add(taper([[-1, 0.8, 0], [-5, 2.0, 0]], [0.8, 0.1], hide));
  for (const s of [-1, 1]) { const e = eye(0.5, 0xff3010); e.position.set(0.8, 0.5, s * 1.0); e.rotation.y = s * 1.1; head.add(e); }
  flip.add(head);
  const wingGeo = () => {
    const geo = new THREE.BufferGeometry();
    const v = [0, 0, 0, -3, 0, 14, 4, 0, 0, -3, 0, 14, -7, 0, 6, 0, 0, 0];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    return geo;
  };
  const wings = [-1, 1].map(s => {
    const p = joint(0.5, 0.8, s * 0.8);
    const w = new THREE.Mesh(wingGeo(), membrane);
    w.scale.z = s;
    p.add(w);
    p.add(taper([[0, 0, 0], [-3, 0, s * 14]], [0.45, 0.15], hide));
    flip.add(p);
    return p;
  });
  let face = 1;
  return {
    group: g,
    update(obj, { t, st }) {
      if (Math.abs(st.vx) > 0.05) face = st.vx > 0 ? 1 : -1;
      flip.scale.x = face;
      flip.rotation.y = -face * 0.25;
      const b = Math.sin(t * 9);
      wings.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * (0.2 + 0.7 * b); });
      head.rotation.z = Math.sin(t * 4) * 0.15;
    },
  };
}

function makeEgg() {
  const g = new THREE.Group();
  const shell = glossMat(0xf2ead8, { roughness: 0.35 });
  const e = blob(2.3, 2.9, 2.3, shell, v => 1 + 0.12 * v.y);
  g.add(e);
  const spot = glossMat(0x8aa860);
  for (let i = 0; i < 6; i++) {
    const a = i * 2.1, y = -1.5 + (i % 3) * 1.4;
    const s = blob(0.45, 0.45, 0.2, spot);
    const r = 2.2 * Math.sqrt(1 - (y / 3) ** 2);
    s.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    s.lookAt(0, y, 0);
    e.add(s);
  }
  return { group: g, update(obj, { t }) { e.rotation.z = Math.sin(t * 6) * 0.12; } };
}

// ---- rig set -----------------------------------------------------------------------------------
const RIDER_COLORS = { player: 0xc8a010, red: 0xa01810, grey: 0x8a8e98, blue: 0x1838a8 };

export function joustRigSet(view) {
  let tracks = [];    // { id, type, cx, cy }
  let nextId = 1;
  return {
    scale: 1.35,
    classify(sprites) {
      const s = sprites[0];
      if (!s || s.w < 64) return { objects: [], rest: sprites };
      const { w: W, h: H, pixels } = s;
      const pal = view.machine.palette;
      const lab = new Int32Array(W * H).fill(-1);
      const comps = [];
      const stack = [];
      for (let i = 0; i < W * H; i++) {
        if (!pixels[i] || lab[i] >= 0) continue;
        const c = { id: comps.length, px: [], x0: W, y0: H, x1: -1, y1: -1, cls: {}, white: [0, 0] };
        lab[i] = c.id; stack.push(i);
        while (stack.length) {
          const j = stack.pop();
          c.px.push(j);
          const x = j % W, y = (j / W) | 0;
          if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
          const k = hueClass(pal[pixels[j]] || [0, 0, 0]);
          c.cls[k] = (c.cls[k] || 0) + 1;
          if (k === 'white') { c.white[0] += x; c.white[1]++; }
          // join pixels up to two apart so a rider and its mount stay one object
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (pixels[q] && lab[q] < 0) { lab[q] = c.id; stack.push(q); }
          }
        }
        comps.push(c);
      }
      const objects = [];
      const claimed = new Set();
      const next = [];
      for (const c of comps) {
        const n = c.px.length, w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
        const k = c.cls;
        let type = null, rider = null;
        if ((k.green || 0) >= 14 && n >= 50) {
          type = 'rider';
          // the buzzard itself has dark teal feathers, so only bright rider colours count
          const r = k.red || 0, b = k.cyan || 0, gr = k.grey || 0;
          rider = r >= 4 && r >= b ? 'red' : b >= 4 && b >= gr ? 'blue' : 'grey';
        } else if ((k.yellow || 0) >= 3 && (k.blue || 0) + (k.cyan || 0) >= 8 && n >= 50) { type = 'rider'; rider = 'player'; }
        else if (w >= 22 && n >= 60) type = 'ptero';
        else if (n >= 10 && n <= 45 && w <= 10 && h <= 11 && (k.white || 0) + (k.grey || 0) + (k.green || 0) >= n * 0.5) type = 'egg';
        if (!type) continue;
        for (const j of c.px) claimed.add(j);
        const cx = (c.x0 + c.x1 + 1) / 2, cy = (c.y0 + c.y1 + 1) / 2;
        // keep identities stable: nearest track of the same kind
        let best = null, bd = 24;
        for (const tr of tracks) {
          if (tr.type !== type || tr.used) continue;
          const d = Math.hypot(tr.cx - cx, tr.cy - cy);
          if (d < bd) { bd = d; best = tr; }
        }
        const id = best ? best.id : nextId++;
        if (best) best.used = true;
        next.push({ id, type, cx, cy });
        const facing = c.white[1] >= 2 ? (c.white[0] / c.white[1] > cx ? 1 : -1) : 0;
        objects.push({ type: type === 'rider' ? `rider-${rider}` : type, id: `${type}${id}`, x0: s.x + c.x0, y0: s.y + c.y0, x1: s.x + c.x1, y1: s.y + c.y1, facing, z: 3, player: rider === 'player' });
      }
      tracks = next;
      if (!claimed.size) return { objects, rest: sprites };
      const px = pixels.slice();
      for (const j of claimed) px[j] = 0;
      return { objects, rest: [{ ...s, pixels: px }] };
    },
    create(type) {
      if (type === 'ptero') return makePterodactyl();
      if (type === 'egg') return makeEgg();
      const rider = type.slice(6);
      return makeRider(rider === 'player' ? 'player' : 'enemy', RIDER_COLORS[rider]);
    },
  };
}
