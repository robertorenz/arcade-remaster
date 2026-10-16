// Jungle King "Redrawn" models. The hero (two stacked hardware sprites) becomes a sculpted jungle
// man who hangs, runs, leaps and swims; the vine (a chain of thin sprites) becomes a leafy rope
// that swings through the same points as the arcade's.
import * as THREE from 'three';
import { bboxOf, canvasTexture, dominantColor } from './rig-layer.js';
import { blob, taper, eye, joint, damp, skinMat, furMat, glossMat, scaleNormal, rock, rockMat } from './sculpt.js';
import { makePauline } from './dk-chars.js';

let leopardTex = null;
function leopard() {
  if (leopardTex) return leopardTex;
  leopardTex = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#d8a030'; c.fillRect(0, 0, w, h);
    let s = 11;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rad = 5 + r() * 6;
      c.fillStyle = '#5a3008';
      for (let k = 0; k < 5; k++) { const a = k * 1.3 + r(); c.beginPath(); c.ellipse(x + Math.cos(a) * rad, y + Math.sin(a) * rad, 2.4, 3.2, a, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#b07018'; c.beginPath(); c.arc(x, y, rad * 0.55, 0, Math.PI * 2); c.fill();
    }
  });
  leopardTex.wrapS = leopardTex.wrapT = THREE.RepeatWrapping;
  return leopardTex;
}

function makeHero() {
  const g = new THREE.Group();
  const turn = new THREE.Group();
  g.add(turn);
  const body = new THREE.Group();
  turn.add(body);
  const skin = skinMat(0xc07a48);
  const hair = new THREE.MeshPhysicalMaterial({ color: 0x1a0e08, roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color(0x6a4028) });
  const cloth = new THREE.MeshPhysicalMaterial({ map: leopard(), roughness: 0.7, sheen: 0.5, sheenColor: new THREE.Color(0xffd080), side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.6 });

  // torso with pecs, abs and shoulders
  body.add(blob(3.0, 4.4, 2.2, skin, v => 1 + 0.18 * v.y));
  for (const s of [-1, 1]) {
    const pec = blob(1.6, 1.2, 0.55, skin); pec.position.set(s * 1.35, 2.0, 1.75); pec.rotation.z = s * -0.2; body.add(pec);
    const delt = blob(1.15, 1.1, 1.1, skin); delt.position.set(s * 3.3, 3.3, 0); body.add(delt);
  }
  const pelvis = blob(2.7, 1.9, 2.0, skin); pelvis.position.y = -4.4; body.add(pelvis);
  // loincloth with a front flap and a belt
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.4, 3.0, 24, 1, true), cloth); wrap.position.y = -4.8; body.add(wrap);
  const flap = blob(1.8, 2.4, 0.4, cloth); flap.position.set(0, -6.6, 2.4); body.add(flap);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.35, 6, 24), leather); belt.rotation.x = Math.PI / 2; belt.position.y = -3.4; body.add(belt);

  // head, face and a long mane
  const head = joint(0, 7.3, 0.2);
  head.add(taper([[0, -1.9, 0], [0, 0, 0]], [1.0, 0.95], skin));
  const skull = blob(1.95, 2.35, 2.05, skin, v => 1 - 0.08 * Math.max(0, -v.y) * Math.abs(v.x)); skull.position.y = 1.6;
  head.add(skull);
  for (const s of [-1, 1]) { const e = eye(0.42, 0x3a2410, { scaleY: 1.1 }); e.position.set(s * 0.72, 1.85, 1.75); head.add(e); }
  head.add(taper([[-1.1, 2.55, 1.85], [-0.3, 2.65, 2.0]], [0.16, 0.12], hair));
  head.add(taper([[1.1, 2.55, 1.85], [0.3, 2.65, 2.0]], [0.16, 0.12], hair));
  const nose = blob(0.35, 0.55, 0.4, skin); nose.position.set(0, 1.3, 2.1); head.add(nose);
  const mouth = blob(0.55, 0.12, 0.1, new THREE.MeshStandardMaterial({ color: 0x6a2a1a })); mouth.position.set(0, 0.55, 1.95); head.add(mouth);
  const mane = blob(2.25, 2.4, 2.3, hair, v => 1 + 0.1 * Math.sin(v.x * 9 + v.y * 4)); mane.position.set(0, 2.0, -0.35); head.add(mane);
  const fringe = blob(1.9, 0.8, 1.0, hair, v => 1 + 0.18 * Math.max(0, -v.y) * Math.sin(v.x * 12)); fringe.position.set(0, 3.3, 1.2); fringe.rotation.x = 0.4; head.add(fringe);
  const locks = [];
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    const p = joint(Math.sin(a) * 1.7, 2.2, -Math.cos(a) * 1.6);
    p.add(taper([[0, 0, 0], [0, -2.5, -0.3], [0, -5.4, -0.1]], [0.85, 0.7, 0.2], hair));
    head.add(p);
    locks.push(p);
  }
  body.add(head);

  // limbs: shoulder -> elbow -> hand, hip -> knee -> foot
  const arms = [-1, 1].map(s => {
    const sh = joint(s * 3.5, 3.2, 0);
    sh.add(taper([[0, 0, 0], [0, -2.2, 0.2], [0, -4.3, 0]], [1.05, 1.0, 0.75], skin));
    const el = joint(0, -4.3, 0);
    el.add(taper([[0, 0, 0], [0, -2.0, 0.1], [0, -3.9, 0]], [0.78, 0.8, 0.55], skin));
    const hand = blob(0.75, 0.95, 0.5, skin); hand.position.y = -4.6; el.add(hand);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.22, 6, 14), leather); cuff.rotation.x = Math.PI / 2; cuff.position.y = -3.4; el.add(cuff);
    sh.add(el);
    sh.userData.el = el;
    body.add(sh);
    return sh;
  });
  const legs = [-1, 1].map(s => {
    const hip = joint(s * 1.5, -5.4, 0);
    hip.add(taper([[0, 0, 0], [0, -2.6, 0.3], [0, -5.0, 0]], [1.35, 1.2, 0.85], skin));
    const kn = joint(0, -5.0, 0);
    kn.add(taper([[0, 0, 0], [0, -2.2, -0.3], [0, -4.4, 0]], [0.85, 0.8, 0.55], skin));
    const foot = blob(0.75, 0.5, 1.5, skin); foot.position.set(0, -4.8, 0.7); kn.add(foot);
    hip.add(kn);
    hip.userData.kn = kn;
    body.add(hip);
    return hip;
  });

  const st = { face: 1, phase: 0, mode: 'idle', swim: 0 };
  const P = { armX: [0, 0], armZ: [0, 0], elb: [0, 0], hipX: [0, 0], knee: [0, 0], tilt: 0, roll: 0 };
  const set = (k, i, v, dt, rate = 16) => { P[k][i] = damp(P[k][i], v, rate, dt); };
  return {
    group: g,
    update(obj, { t, dt, st: s }) {
      if (Math.abs(s.vx) > 0.08) st.face = s.vx > 0 ? 1 : -1;
      else if (obj.flipx !== undefined && obj.mode === 'idle') st.face = obj.flipx ? 1 : -1;
      turn.rotation.y = damp(turn.rotation.y, st.face * 0.95, 10, dt);
      st.phase += Math.max(Math.abs(s.vx), 0.02) * 0.7;
      const ph = st.phase;
      const mode = heroMode(obj, s);
      let tilt = 0, roll = 0;
      for (let i = 0; i < 2; i++) {
        const sg = i ? 1 : -1;
        if (mode === 'hang') {
          set('armX', i, -2.95, dt); set('armZ', i, -sg * 0.18, dt); set('elb', i, -0.15, dt);
          set('hipX', i, -0.35 + Math.sin(t * 3 + i) * 0.1, dt); set('knee', i, 0.5, dt);
          tilt = obj.angle || 0;
        } else if (mode === 'swim') {
          const a = ph * 1.2 + i * Math.PI;
          set('armX', i, -1.5 + Math.sin(a) * 1.6, dt, 30); set('armZ', i, -sg * 0.3, dt); set('elb', i, -0.4, dt);
          set('hipX', i, Math.sin(t * 9 + i * Math.PI) * 0.35, dt, 30); set('knee', i, 0.3, dt);
          roll = Math.PI / 2 - 0.15;
        } else if (mode === 'jump') {
          set('armX', i, -2.2, dt); set('armZ', i, -sg * 0.6, dt); set('elb', i, -0.5, dt);
          set('hipX', i, -1.0 - i * 0.4, dt); set('knee', i, 1.4, dt);
        } else if (mode === 'run') {
          const a = ph + i * Math.PI;
          set('armX', i, Math.sin(a) * 0.9, dt, 25); set('armZ', i, -sg * 0.12, dt); set('elb', i, -0.8, dt);
          set('hipX', i, -Math.sin(a) * 0.85, dt, 25); set('knee', i, 0.3 + Math.max(0, Math.cos(a)) * 1.0, dt, 25);
        } else {
          set('armX', i, 0.1, dt); set('armZ', i, -sg * 0.18, dt); set('elb', i, -0.25, dt);
          set('hipX', i, 0, dt); set('knee', i, 0.05, dt);
        }
        arms[i].rotation.set(P.armX[i], 0, P.armZ[i]);
        arms[i].userData.el.rotation.x = P.elb[i];
        legs[i].rotation.x = P.hipX[i];
        legs[i].userData.kn.rotation.x = P.knee[i];
      }
      P.tilt = damp(P.tilt, tilt, 10, dt);
      P.roll = damp(P.roll, roll, 6, dt);
      // swinging tilts the whole figure in the screen plane; swimming lays it along the water
      g.rotation.z = P.tilt - P.roll * st.face;
      body.position.y = mode === 'run' ? Math.abs(Math.sin(ph)) * 0.6 : 0;
      head.rotation.x = mode === 'swim' ? -0.6 : 0;
      for (const [i, l] of locks.entries()) l.rotation.x = 0.05 + Math.sin(t * 4 + i) * 0.06 + (mode === 'run' || mode === 'jump' ? 0.25 : 0);
    },
  };
}

function makeVine() {
  const g = new THREE.Group();
  const bark = new THREE.MeshPhysicalMaterial({ color: 0x6a4a1c, roughness: 0.8, sheen: 0.3, sheenColor: new THREE.Color(0x9a8040) });
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x3a9a2a, roughness: 0.5, clearcoat: 0.3, side: THREE.DoubleSide });
  const leafGeo = new THREE.SphereGeometry(1, 10, 6);
  leafGeo.scale(1.6, 0.25, 0.8);
  leafGeo.translate(1.4, 0, 0);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 24);
  g.add(leaves);
  let rope = null, lastKey = '';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    group: g,
    update(obj, { t }) {
      const key = obj.points.map(p => p.join(',')).join(';');
      if (key !== lastKey && obj.points.length >= 2) {
        lastKey = key;
        if (rope) { g.remove(rope); rope.traverse(o => o.geometry?.dispose()); }
        // a gentle twist so the rope reads as plaited vine
        const pts = obj.points.map(([x, y], i) => [x, y, Math.sin(i * 1.3) * 0.6]);
        rope = taper(pts, [0.85, 0.7, 0.55], bark, { radial: 10 });
        g.add(rope);
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
        const n = leaves.count = Math.min(24, obj.points.length * 3);
        for (let i = 0; i < n; i++) {
          curve.getPointAt((i + 0.5) / n, v);
          e.set(Math.sin(i * 2.1) * 0.8, i * 2.4, Math.sin(i * 1.7) * 0.6 + Math.sin(t * 2 + i) * 0.1);
          q.setFromEuler(e);
          m4.compose(v, q, one.setScalar(0.8 + (i % 3) * 0.2));
          leaves.setMatrixAt(i, m4);
        }
        leaves.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// ---- creatures and props ---------------------------------------------------------------------
function makeCroc() {
  const g = new THREE.Group();
  const flip = new THREE.Group();
  g.add(flip);
  const hide = new THREE.MeshPhysicalMaterial({ color: 0x3e6a24, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, normalMap: scaleNormal(), normalScale: new THREE.Vector2(0.8, 0.8) });
  const belly = new THREE.MeshPhysicalMaterial({ color: 0xb8b070, roughness: 0.5, clearcoat: 0.3 });
  const tooth = glossMat(0xfff8e0);
  const mouth = new THREE.MeshStandardMaterial({ color: 0x8a2a28, roughness: 0.6 });
  flip.add(blob(8.5, 2.9, 4.0, hide, v => 1 + 0.1 * v.x - 0.15 * Math.max(0, -v.y)));
  const under = blob(7.8, 1.6, 3.4, belly); under.position.y = -1.4; flip.add(under);
  // ridge of scutes along the back
  for (let i = 0; i < 9; i++) {
    for (const z of [-1, 1]) {
      const sc = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 6), hide);
      sc.position.set(-7 + i * 1.7, 2.7 - Math.abs(i - 4) * 0.12, z * 1.1);
      flip.add(sc);
    }
  }
  // tail in three jointed sections
  const tail = [];
  let parent = flip, x0 = -7.5;
  for (let i = 0; i < 3; i++) {
    const j = joint(x0, 0.2, 0);
    const r0 = 2.6 - i * 0.8, r1 = 1.9 - i * 0.75;
    j.add(taper([[0, 0, 0], [-5.5, 0, 0]], [r0, Math.max(0.25, r1)], hide));
    parent.add(j);
    tail.push(j);
    parent = j; x0 = -5.5;
  }
  // head: upper and lower jaw with teeth
  const head = joint(7.5, 0.6, 0);
  const upper = blob(5.8, 1.4, 2.5, hide, v => 1 - 0.35 * Math.max(0, v.x) ** 2); upper.position.set(4.6, 0.6, 0);
  const jaw = joint(0.5, -0.2, 0);
  const lower = blob(5.4, 1.0, 2.2, hide, v => 1 - 0.35 * Math.max(0, v.x) ** 2); lower.position.set(4.6, -0.7, 0);
  const tongue = blob(3.5, 0.4, 1.4, mouth); tongue.position.set(3.8, -0.1, 0);
  jaw.add(lower, tongue);
  for (let i = 0; i < 7; i++) for (const z of [-1, 1]) {
    const t1 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 5), tooth);
    t1.position.set(1.5 + i * 1.15, -0.5, z * (1.9 - i * 0.18)); t1.rotation.x = Math.PI;
    head.add(t1);
    const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 5), tooth);
    t2.position.set(1.8 + i * 1.1, -0.1, z * (1.7 - i * 0.17));
    jaw.add(t2);
  }
  for (const z of [-1, 1]) {
    const bump = blob(1.0, 0.9, 0.9, hide); bump.position.set(1.5, 2.0, z * 1.4); head.add(bump);
    const e = eye(0.55, 0xd0a020, { scaleY: 0.8 }); e.position.set(1.8, 2.3, z * 1.5); e.rotation.y = z * 0.9; head.add(e);
  }
  head.add(upper, jaw);
  flip.add(head);
  // stubby splayed legs
  const legs = [];
  for (const [x, z] of [[4.5, 1], [4.5, -1], [-4.5, 1], [-4.5, -1]]) {
    const l = joint(x, -1.2, z * 3.2);
    l.add(taper([[0, 0, 0], [0.5, -1.5, z * 1.2], [1.2, -2.4, z * 1.4]], [1.0, 0.8, 0.6], hide));
    flip.add(l);
    legs.push(l);
  }
  let face = 1;
  return {
    group: g,
    update(obj, { t, st }) {
      if (Math.abs(st.vx) > 0.05) face = st.vx > 0 ? 1 : -1;
      else if (obj.facing) face = obj.facing;
      flip.scale.x = face;
      flip.rotation.y = -face * 0.25;
      tail.forEach((j, i) => { j.rotation.y = Math.sin(t * 4 - i * 0.9) * 0.28; });
      const open = Math.max(0, Math.sin(t * 2.2)) ** 2;
      jaw.rotation.z = -0.55 * open;
      head.rotation.z = 0.12 * open;
      legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 5 + i * 1.6) * 0.35; });
      flip.position.y = Math.sin(t * 2) * 0.4;
    },
  };
}

function makeBoulder() {
  const g = new THREE.Group();
  const r = rock(7.5, rockMat(0x8a7a6a), 3.1);
  g.add(r);
  return {
    group: g,
    update(obj, { st }) {
      const s = Math.max(0.4, Math.max(obj.x1 - obj.x0, obj.y1 - obj.y0) / 16);
      r.scale.setScalar(s);
      r.rotation.z -= st.vx * 0.13 / s;
      r.material.color.setRGB(obj.tint[0] / 255 * 0.55 + 0.25, obj.tint[1] / 255 * 0.45 + 0.22, obj.tint[2] / 255 * 0.4 + 0.2, THREE.SRGBColorSpace);
    },
  };
}

function makeNative() {
  const g = new THREE.Group();
  const turn = new THREE.Group();
  g.add(turn);
  const skin = skinMat(0x5a3420);
  const bone = glossMat(0xf0ead8, { roughness: 0.4, clearcoat: 0.3 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x9a8a3a, roughness: 0.8, side: THREE.DoubleSide });
  const black = new THREE.MeshStandardMaterial({ color: 0x080808 });
  turn.add(blob(2.8, 4.0, 2.0, skin, v => 1 + 0.15 * v.y));
  // grass skirt: a fringe of blades
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.45, 4.2, 4), grass);
    blade.position.set(Math.cos(a) * 2.5, -4.6, Math.sin(a) * 2.1);
    blade.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25 + Math.PI);
    turn.add(blade);
  }
  // skull mask with dark sockets, and a feather crest
  const head = joint(0, 6.5, 0);
  head.add(blob(2.2, 2.5, 2.1, skin));
  const mask = blob(2.0, 2.4, 1.0, bone); mask.position.set(0, 0.2, 1.6); head.add(mask);
  for (const x of [-1, 1]) { const s = blob(0.55, 0.65, 0.3, black); s.position.set(x * 0.8, 0.6, 2.45); head.add(s); }
  for (let i = 0; i < 4; i++) { const tth = blob(0.22, 0.35, 0.2, black); tth.position.set(-0.6 + i * 0.4, -1.1, 2.4); head.add(tth); }
  for (let i = 0; i < 5; i++) {
    const f = taper([[0, 0, 0], [(i - 2) * 0.5, 3.2, -0.3]], [0.35, 0.08], glossMat([0xe03020, 0xf0c020, 0x2060d0][i % 3]));
    f.position.set((i - 2) * 0.55, 2.0, -0.4);
    head.add(f);
  }
  turn.add(head);
  const arms = [-1, 1].map(s => {
    const sh = joint(s * 3.0, 2.8, 0);
    sh.add(taper([[0, 0, 0], [0, -3.8, 0.4], [0, -7, 0.6]], [0.9, 0.75, 0.6], skin));
    turn.add(sh);
    return sh;
  });
  const spear = new THREE.Group();
  spear.add(taper([[0, -9, 0], [0, 9, 0]], [0.3, 0.3], new THREE.MeshStandardMaterial({ color: 0x6a4420, roughness: 0.7 })));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.6, 6), rockMat(0x6a6a72)); tip.position.y = 10.2; spear.add(tip);
  spear.position.set(0, -7, 0.6);
  arms[1].add(spear);
  const legs = [-1, 1].map(s => {
    const hip = joint(s * 1.3, -4.0, 0);
    hip.add(taper([[0, 0, 0], [0, -3.5, 0.3], [0, -7, 0]], [1.1, 0.85, 0.6], skin));
    const foot = blob(0.7, 0.45, 1.3, skin); foot.position.set(0, -7.4, 0.6); hip.add(foot);
    turn.add(hip);
    return hip;
  });
  let face = 1, ph = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      if (Math.abs(st.vx) > 0.05) face = st.vx > 0 ? 1 : -1;
      turn.rotation.y = damp(turn.rotation.y, face * 0.9, 8, dt);
      ph += Math.max(Math.abs(st.vx), 0.03) * 0.8;
      legs[0].rotation.x = Math.sin(ph) * 0.6; legs[1].rotation.x = -Math.sin(ph) * 0.6;
      arms[0].rotation.x = -Math.sin(ph) * 0.5;
      // spear arm held forward, the spear itself kept upright
      arms[1].rotation.x = -0.55 + Math.sin(t * 3) * 0.1;
      spear.rotation.x = 0.55 - Math.sin(t * 3) * 0.1;
      head.rotation.z = Math.sin(t * 2.5) * 0.08;
    },
  };
}

function makeMonkey() {
  const g = new THREE.Group();
  const turn = new THREE.Group();
  g.add(turn);
  const fur = furMat(0x6a3a18, 0xa86a38);
  const skin = skinMat(0xd8a070);
  turn.add(blob(3.0, 3.6, 2.6, fur));
  const belly = blob(2.0, 2.6, 1.2, skin); belly.position.set(0, -0.5, 1.7); turn.add(belly);
  const head = joint(0, 4.6, 0.3);
  head.add(blob(2.4, 2.3, 2.2, fur));
  const mask = blob(1.7, 1.6, 1.0, skin); mask.position.set(0, -0.3, 1.6); head.add(mask);
  for (const s of [-1, 1]) {
    const e = eye(0.42, 0x3a1a08); e.position.set(s * 0.6, 0.2, 2.2); head.add(e);
    const ear = blob(0.9, 0.9, 0.4, skin); ear.position.set(s * 2.4, 0.4, 0); head.add(ear);
  }
  const muzzle = blob(0.9, 0.6, 0.6, skin); muzzle.position.set(0, -0.9, 2.3); head.add(muzzle);
  turn.add(head);
  const limbs = [];
  for (const [x, y, len] of [[-2.4, 2.0, 6], [2.4, 2.0, 6], [-1.4, -3.0, 4.5], [1.4, -3.0, 4.5]]) {
    const j = joint(x, y, 0);
    j.add(taper([[0, 0, 0], [0, -len / 2, 0.3], [0, -len, 0]], [0.75, 0.65, 0.5], fur));
    const paw = blob(0.6, 0.6, 0.6, skin); paw.position.y = -len - 0.3; j.add(paw);
    turn.add(j);
    limbs.push(j);
  }
  const tail = taper([[0, -3, -2], [0, -5, -4], [0, -3, -6.5], [0, -0.5, -6]], [0.6, 0.5, 0.4, 0.3], fur);
  turn.add(tail);
  let face = 1;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      if (Math.abs(st.vx) > 0.05) face = st.vx > 0 ? 1 : -1;
      turn.rotation.y = damp(turn.rotation.y, face * 0.8, 8, dt);
      const a = t * 9;
      limbs.forEach((l, i) => { l.rotation.x = Math.sin(a + i * 1.7) * 0.7; l.rotation.z = (i % 2 ? 1 : -1) * 0.3; });
      head.rotation.z = Math.sin(t * 4) * 0.15;
      tail.rotation.x = Math.sin(t * 3) * 0.2;
    },
  };
}

function makeSpear() {
  const g = new THREE.Group();
  const aim = new THREE.Group();
  g.add(aim);
  aim.add(taper([[-8, 0, 0], [6, 0, 0]], [0.32, 0.3], new THREE.MeshStandardMaterial({ color: 0x7a5228, roughness: 0.7 })));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.8, 6), rockMat(0x707078)); tip.rotation.z = -Math.PI / 2; tip.position.x = 7.2; aim.add(tip);
  for (const s of [-1, 1]) { const f = blob(1.4, 0.15, 0.6, glossMat(0xd04020)); f.position.set(-7.2, s * 0.4, 0); f.rotation.z = s * 0.4; aim.add(f); }
  let ang = 0;
  return {
    group: g,
    update(obj, { dt, st }) {
      if (Math.abs(st.vx) + Math.abs(st.vy) > 0.2) ang = Math.atan2(-st.vy, st.vx);
      aim.rotation.z = damp(aim.rotation.z, ang, 20, dt);
      aim.scale.setScalar(Math.max(obj.x1 - obj.x0, obj.y1 - obj.y0) / 16);
    },
  };
}

function makeBubble() {
  const g = new THREE.Group();
  const m = new THREE.MeshPhysicalMaterial({ color: 0xcfefff, roughness: 0.02, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.35, iridescence: 1, iridescenceIOR: 1.3, envMapIntensity: 1.5, depthWrite: false });
  const b = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 14), m);
  b.userData.noShadow = true;
  g.add(b);
  return { group: g, update(obj, { t }) { const s = Math.max(obj.x1 - obj.x0, obj.y1 - obj.y0) / 8; b.scale.set(s * (1 + 0.06 * Math.sin(t * 9)), s * (1 - 0.06 * Math.sin(t * 9)), s); } };
}

function makeHeart() {
  const g = new THREE.Group();
  const m = glossMat(0xff3a7a, { emissive: 0x501020 });
  const shape = new THREE.Shape();
  shape.moveTo(0, -6);
  shape.bezierCurveTo(-2, -4, -7, -1, -7, 2.5);
  shape.bezierCurveTo(-7, 6, -2.5, 7, 0, 4);
  shape.bezierCurveTo(2.5, 7, 7, 6, 7, 2.5);
  shape.bezierCurveTo(7, -1, 2, -4, 0, -6);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.5, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.2, bevelSegments: 6, curveSegments: 24 });
  geo.center();
  const h = new THREE.Mesh(geo, m);
  g.add(h);
  return { group: g, update(obj, { t }) { h.scale.setScalar(1 + 0.12 * Math.max(0, Math.sin(t * 6))); h.rotation.y = Math.sin(t * 1.5) * 0.4; } };
}

function makeFire() {
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(1.5 + (i % 3) * 0.6, 7 + (i % 4) * 1.6, 8),
      new THREE.MeshBasicMaterial({ color: [0xffe27a, 0xffa22a, 0xff5a10][i % 3], toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }));
    f.userData.noShadow = true;
    f.userData.seed = i * 1.7;
    g.add(f);
    parts.push(f);
  }
  const logs = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.9 });
  for (const a of [0.5, -0.5, 1.6]) { const l = taper([[-5, -6, 0], [5, -6, 0]], [0.8, 0.7], logs); l.rotation.y = a; g.add(l); }
  return {
    group: g, light: true,
    update(obj, { t }) {
      const w = Math.max(8, obj.x1 - obj.x0) / 2;
      for (const f of parts) {
        const s = f.userData.seed;
        const life = (t * 1.6 + s) % 1;
        f.position.set(Math.sin(s * 3) * w * 0.7, -4 + life * 7, Math.cos(s * 2) * 2.5);
        f.scale.setScalar(1.15 - life * 0.75);
        f.material.opacity = 0.9 - life * 0.6;
      }
    },
  };
}

// ---- classification --------------------------------------------------------------------------
// graphics ROM sprite index -> object type (indices from the sprite sheet decoded from kn29..kn56)
const RANGES = [
  ['vine', 33, 44], ['hero', 45, 60], ['hero', 72, 75], ['hero', 92, 107], ['hero', 152, 177], ['hero', 208, 219],
  ['hero', 245, 250], ['fire', 232, 239], ['croc', 67, 71], ['croc', 108, 119],
  ['bubble', 120, 124], ['boulder', 128, 131], ['boulder', 178, 183], ['monkey', 132, 135],
  ['native', 192, 203], ['native', 224, 225], ['native', 227, 228], ['native', 230, 230],
  ['spear', 226, 226], ['spear', 229, 229], ['spear', 251, 255], ['jane', 220, 223], ['heart', 240, 241],
];
const TYPE = new Map();
for (const [t, a, b] of RANGES) for (let i = a; i <= b; i++) TYPE.set(i, t);
const SWIM = new Set([96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107]);

// sprites of one type that touch each other form one object (a crocodile is several sprites)
function clusters(list, gap = 3) {
  const out = [];
  const bbs = list.map(s => bboxOf([s]));
  const used = new Array(list.length).fill(false);
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    const c = [i]; used[i] = true;
    for (let k = 0; k < c.length; k++) {
      const a = bbs[c[k]];
      for (let j = 0; j < list.length; j++) {
        if (used[j]) continue;
        const b = bbs[j];
        if (b.x0 <= a.x1 + gap && b.x1 >= a.x0 - gap && b.y0 <= a.y1 + gap && b.y1 >= a.y0 - gap) { used[j] = true; c.push(j); }
      }
    }
    out.push(c.map(n => list[n]));
  }
  return out;
}

const segEnds = s => {
  let top = null, bot = null;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!s.pixels[y * 16 + x]) continue;
    if (!top) top = [s.x + x + 0.5, s.y + y + 0.5];
    bot = [s.x + x + 0.5, s.y + y + 0.5];
  }
  return [top, bot];
};

export function jkRigSet(view) {
  let tracks = [], nextId = 1;
  const catalog = view.machine.romSpriteCatalog ? view.machine.romSpriteCatalog() : new Map();
  return {
    scale: 1.05,
    classify(sprites) {
      const objects = [], rest = [];
      const groups = new Map(), idxOf = new Map();
      for (const s of sprites) {
        const n = catalog.get(s.hash);
        const t = n !== undefined ? TYPE.get(n) : undefined;
        if (!t) { rest.push(s); continue; }
        idxOf.set(s, n);
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push(s);
      }
      const zOf = list => view.profile.spriteZ('other', list[0].order);
      // vines: chains of touching segments
      const vinePts = [];
      clusters(groups.get('vine') || [], 4).forEach((vine, vi) => {
        const bb = bboxOf(vine);
        const cx = (bb.x0 + bb.x1 + 1) / 2, cy = (bb.y0 + bb.y1 + 1) / 2;
        const segs = vine.map(segEnds).filter(e => e[0]).sort((p, q) => p[0][1] - q[0][1]);
        const pts = segs.map(e => e[0]);
        if (segs.length) pts.push(segs[segs.length - 1][1]);
        if (pts.length < 2) { rest.push(...vine); return; }
        vinePts.push(pts);
        objects.push({ type: 'vine', id: `vine${vi}`, ...bb, points: pts.map(([x, y]) => [x - cx, cy - y]), z: zOf(vine) - 0.5 });
      });
      // the hero: the largest cluster of hero frames
      const heroes = clusters(groups.get('hero') || [], 4).sort((a, b) => b.length - a.length);
      if (heroes.length) {
        const hero = heroes[0];
        const bb = bboxOf(hero);
        let mode = 'idle', angle = 0;
        const top = [(bb.x0 + bb.x1) / 2, bb.y0];
        for (const pts of vinePts) {
          const end = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 3)];
          if (Math.hypot(end[0] - top[0], end[1] - top[1]) < 16) { mode = 'hang'; angle = -Math.atan2(end[0] - prev[0], end[1] - prev[1]); }
        }
        if (mode === 'idle' && hero.some(s => SWIM.has(idxOf.get(s)))) mode = 'swim';
        objects.push({ type: 'hero', id: 'hero', ...bb, mode, angle, flipx: hero[0].flipx, z: zOf(hero), player: true });
        for (const c of heroes.slice(1)) rest.push(...c);
      }
      // everything else: one object per touching cluster, identities kept by nearest match
      const next = [];
      for (const type of ['croc', 'boulder', 'native', 'monkey', 'spear', 'bubble', 'jane', 'heart', 'fire']) {
        for (const c of clusters(groups.get(type) || [], type === 'bubble' ? 0 : 3)) {
          const bb = bboxOf(c);
          const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
          let best = null, bd = 24;
          for (const tr of tracks) {
            if (tr.type !== type || tr.used) continue;
            const d = Math.hypot(tr.cx - cx, tr.cy - cy);
            if (d < bd) { bd = d; best = tr; }
          }
          const id = best ? best.id : nextId++;
          if (best) best.used = true;
          next.push({ id, type, cx, cy });
          objects.push({ type, id: `${type}${id}`, ...bb, facing: c[0].flipx ? -1 : 1, tint: dominantColor(view, c), z: zOf(c) });
        }
      }
      tracks = next;
      return { objects, rest };
    },
    create(type) {
      switch (type) {
        case 'hero': return makeHero();
        case 'vine': return makeVine();
        case 'croc': return makeCroc();
        case 'boulder': return makeBoulder();
        case 'native': return makeNative();
        case 'monkey': return makeMonkey();
        case 'spear': return makeSpear();
        case 'bubble': return makeBubble();
        case 'heart': return makeHeart();
        case 'fire': return makeFire();
        default: return makePauline({ dress: 0x2a8a5a, hair: 0xd8b040 });
      }
    },
  };
}

// motion state is derived in the rig from velocity; refine 'idle' into run/jump there
export function heroMode(obj, st) {
  if (obj.mode !== 'idle') return obj.mode;
  if (Math.abs(st.vy) > 0.35) return 'jump';
  if (Math.abs(st.vx) > 0.12) return 'run';
  return 'idle';
}
