// Donkey Kong characters for the Redrawn mode: Mario, Donkey Kong and Pauline, sculpted from
// smooth shaped forms with cloth, fur and skin materials. Poses come from the arcade sprite codes.
import * as THREE from 'three';
import { taper, blob, eye, joint, damp, furMat, clothMat, skinMat, glossMat, metalMat } from './sculpt.js';
import { canvasTexture } from './rig-layer.js';

// ---- shared bits --------------------------------------------------------------------------------
function glove(material) {
  const g = new THREE.Group();
  const palm = blob(1.35, 1.25, 1.0, material, v => 1 + 0.08 * v.y);
  const thumb = blob(0.45, 0.75, 0.45, material); thumb.position.set(0.95, 0.25, 0.55); thumb.rotation.z = -0.6;
  const fingers = [-0.6, 0, 0.6].map(x => { const f = blob(0.42, 0.62, 0.42, material); f.position.set(x, -1.05, 0.25); return f; });
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.38, 8, 18), material); cuff.rotation.x = Math.PI / 2; cuff.position.y = 1.15;
  g.add(palm, thumb, cuff, ...fingers);
  return g;
}

function emblemTexture(letter, fg, bg) {
  return canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = bg; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = fg; c.font = '900 84px Inter, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(letter, w / 2, h / 2 + 6);
  });
}

export function makeHammer() {
  const g = new THREE.Group();
  const wood = new THREE.MeshPhysicalMaterial({ color: 0xa8743a, roughness: 0.55, clearcoat: 0.4 });
  const handle = taper([[0, 0, 0], [0, 5, 0], [0, 9.5, 0]], [0.55, 0.5, 0.6], wood);
  const grip = taper([[0, 0.2, 0], [0, 3, 0]], [0.68, 0.68], new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.8 }));
  const steel = metalMat(0xb8c0c8);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 6, 20), steel);
  head.rotation.z = Math.PI / 2; head.position.y = 10.2;
  const faces = [-1, 1].map(s => { const f = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.6, 20), steel); f.rotation.z = Math.PI / 2; f.position.set(s * 3, 10.2, 0); return f; });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 1.6, 20), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: 0.6, roughness: 0.4 }));
  band.rotation.z = Math.PI / 2; band.position.y = 10.2;
  g.add(handle, grip, head, band, ...faces);
  return g;
}

// ---- Mario --------------------------------------------------------------------------------------
export function makeMario() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = -0.8;
  g.add(body);
  const red = clothMat(0xc4160e), denim = clothMat(0x1c36a8), skin = skinMat(0xe8a47a);
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x5b2c10, roughness: 0.4, clearcoat: 0.6 });
  const hair = new THREE.MeshPhysicalMaterial({ color: 0x3a1a08, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0x7a4a28) });
  const white = clothMat(0xc8c4bc, { sheen: 0 });
  const gold = metalMat(0xf0c040, { roughness: 0.3 });

  // legs with shoes
  const legs = [-1, 1].map(s => {
    const hip = joint(s * 1.55, -2.0, 0);
    hip.add(taper([[0, 0, 0], [0, -2.4, 0.25], [0, -4.3, 0]], [1.45, 1.3, 1.15], denim));
    const shoe = blob(1.75, 1.15, 2.5, leather, v => 1 + 0.12 * v.z - 0.08 * Math.max(0, -v.y));
    shoe.position.set(0, -5.0, 0.75);
    hip.add(shoe);
    body.add(hip);
    return hip;
  });
  // overalls, shirt, bib, straps, buttons
  const pelvis = blob(3.35, 2.6, 2.75, denim); pelvis.position.y = -0.9;
  const torso = blob(3.45, 3.05, 2.75, red, v => 1 + 0.06 * v.y); torso.position.y = 2.3;
  const bib = blob(2.5, 1.9, 0.75, denim); bib.position.set(0, 1.5, 2.25);
  const straps = [-1, 1].map(s => taper([[s * 1.6, 2.9, 2.35], [s * 2.15, 4.7, 1.0], [s * 2.0, 4.4, -2.0], [s * 1.6, 1.2, -2.55]], [0.42, 0.42, 0.42, 0.42], denim, { caps: false }));
  const buttons = [-1, 1].map(s => { const b = blob(0.55, 0.55, 0.3, gold); b.position.set(s * 1.55, 2.95, 2.75); return b; });
  body.add(pelvis, torso, bib, ...straps, ...buttons);

  // arms: shoulder -> elbow -> glove
  const arms = [-1, 1].map(s => {
    const sh = joint(s * 3.45, 3.7, 0);
    sh.add(taper([[0, 0, 0], [0, -2.5, 0]], [1.3, 1.08], red));
    const el = joint(0, -2.5, 0);
    el.add(taper([[0, 0, 0], [0, -2.1, 0.2]], [1.08, 0.95], red));
    const gl = glove(white); gl.position.set(0, -3.3, 0.2); gl.scale.setScalar(0.95);
    el.add(gl);
    sh.add(el);
    sh.userData.elbow = el;
    body.add(sh);
    return sh;
  });

  // head
  const head = joint(0, 6.1, 0.2);
  const skull = blob(3.35, 3.25, 3.15, skin, v => 1 + 0.05 * v.z);
  const nose = blob(1.35, 1.1, 1.2, skinMat(0xf4a882)); nose.position.set(0, -0.45, 3.35);
  const stache = [-1, 1].map(s => {
    const m = blob(1.7, 0.85, 0.9, hair, v => 1 + 0.12 * Math.sin(v.x * 9));
    m.position.set(s * 1.25, -1.55, 2.95); m.rotation.z = s * -0.28; m.rotation.y = s * 0.25;
    return m;
  });
  const eyes = [-1, 1].map(s => { const e = eye(0.7, 0x2f62d0, { scaleY: 1.35 }); e.position.set(s * 1.0, 0.45, 2.95); e.rotation.y = s * 0.14; return e; });
  const brows = [-1, 1].map(s => taper([[s * 0.4, 1.5, 3.25], [s * 1.05, 1.72, 3.2], [s * 1.65, 1.5, 2.95]], [0.2, 0.26, 0.18], hair));
  const ears = [-1, 1].map(s => { const e = blob(0.65, 1.0, 0.5, skin); e.position.set(s * 3.25, -0.1, 0.1); return e; });
  const back = blob(3.3, 2.3, 2.1, hair, v => 1 + 0.1 * Math.sin(v.x * 12) * Math.max(0, -v.y)); back.position.set(0, -0.6, -1.4);
  const burns = [-1, 1].map(s => { const b = blob(0.45, 1.0, 0.6, hair); b.position.set(s * 3.05, 0.2, 0.9); return b; });
  // cap: crown, brim and emblem
  const crown = new THREE.Mesh(new THREE.SphereGeometry(3.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), red);
  crown.position.y = 1.3; crown.scale.set(1, 0.85, 1.05);
  const brimGeo = new THREE.CylinderGeometry(3.0, 3.0, 0.42, 28, 1, false, -Math.PI / 2, Math.PI);
  const brim = new THREE.Mesh(brimGeo, red); brim.position.set(0, 1.42, 1.95); brim.scale.set(1.05, 1, 0.95); brim.rotation.x = 0.12;
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(1.15, 24), new THREE.MeshStandardMaterial({ map: emblemTexture('M', '#d8231b', '#ffffff'), roughness: 0.6 }));
  emblem.position.set(0, 2.9, 3.05); emblem.rotation.x = -0.5;
  head.add(skull, nose, back, crown, brim, emblem, ...stache, ...eyes, ...brows, ...ears, ...burns);
  body.add(head);

  const hammer = makeHammer();
  hammer.visible = false;
  hammer.rotation.x = Math.PI;
  hammer.position.set(0, -3.6, 0.3);
  arms[1].userData.elbow.add(hammer);

  const pose = { leg: 0, climb: 0, swing: 0, phase: 0, turn: 0 };
  return {
    group: g,
    update(obj, { t, dt, st }) {
      const code = obj.code;
      const climbing = code >= 0x03 && code <= 0x06;
      const hammerFrame = code >= 0x08 && code <= 0x0f;
      const dying = code >= 0x78 && code <= 0x7a;
      const jumping = code === 0x0e && !hammerFrame;
      const facing = obj.hflip ? 1 : -1;
      const speed = Math.abs(st.vx);
      if (speed > 0.05) pose.phase += speed * 0.55;
      const walk = !climbing && speed > 0.05 ? Math.sin(pose.phase) * 0.75 : 0;
      pose.leg = damp(pose.leg, climbing ? ((code & 1) ? 0.55 : -0.55) : walk, 22, dt);
      pose.climb = damp(pose.climb, climbing ? 1 : 0, 14, dt);
      pose.turn = damp(pose.turn, climbing ? Math.PI : facing * 1.05, 12, dt);
      body.rotation.y = pose.turn;
      legs[0].rotation.x = pose.leg; legs[1].rotation.x = -pose.leg;
      for (const [i, a] of arms.entries()) {
        const s = i ? 1 : -1;
        const swingArm = -pose.leg * 0.9 * s;
        a.rotation.x = swingArm * (1 - pose.climb) + (-2.7 + pose.leg * 0.6 * s) * pose.climb;
        a.rotation.z = s * (0.22 + 0.15 * pose.climb);
        a.userData.elbow.rotation.x = -0.35 - 0.3 * pose.climb;
      }
      hammer.visible = hammerFrame;
      if (hammerFrame) {
        const up = ((code >> 1) & 1) === 0;
        pose.swing = damp(pose.swing, up ? 1 : 0, 30, dt);
        arms[1].rotation.x = -1.2 - 1.9 * pose.swing;
        arms[1].userData.elbow.rotation.x = -0.2 - 0.4 * pose.swing;
        arms[0].rotation.x = -1.0 - 0.8 * pose.swing;
      }
      head.rotation.x = jumping ? -0.2 : 0;
      body.rotation.z = dying ? (code === 0x7a ? Math.PI / 2 : Math.sin(t * 20) * 0.3) : 0;
      body.position.y = -0.8 + Math.abs(Math.sin(pose.phase)) * 0.45 * (speed > 0.05 && !climbing ? 1 : 0);
      for (const e of eyes) e.scale.y = 1.4 * ((t % 3.7) < 0.12 ? 0.15 : 1);
    },
  };
}

// ---- Donkey Kong --------------------------------------------------------------------------------
export function makeKong() {
  const g = new THREE.Group();
  const fur = furMat(0x4a200a, 0x9a5a2a);
  const darkFur = furMat(0x3a1808, 0x8a4a20);
  const hide = skinMat(0xb87a48);
  hide.sheenColor = new THREE.Color(0xffc090);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a0904, roughness: 0.5 });
  const teethMat = glossMat(0xfff6e0);

  const torso = blob(13, 11.5, 9, fur, v => 1 + 0.14 * v.y + 0.06 * Math.max(0, v.y) * Math.abs(v.x)); torso.position.y = -1;
  const pecs = [-1, 1].map(s => { const p = blob(4.4, 3.5, 2.2, hide); p.position.set(s * 3.8, 3.2, 7.4); p.rotation.z = s * -0.15; return p; });
  const belly = blob(6.8, 6, 3.2, hide, v => 1 + 0.05 * Math.sin(v.y * 8)); belly.position.set(0, -4.6, 7.0);
  g.add(torso, belly, ...pecs);

  const head = joint(0, 11, 3);
  const cranium = blob(7.2, 6.6, 6.6, fur, v => 1 + 0.16 * Math.max(0, v.y) ** 3);
  const face = blob(5.8, 4.8, 3.0, hide); face.position.set(0, -0.6, 4.6);
  const muzzle = blob(5.2, 3.6, 3.4, hide, v => 1 + 0.06 * v.z); muzzle.position.set(0, -3.3, 6.3);
  const brow = taper([[-4.8, 1.4, 5.8], [-2.2, 2.4, 7.0], [0, 2.0, 7.3], [2.2, 2.4, 7.0], [4.8, 1.4, 5.8]], [1.0, 1.35, 1.1, 1.35, 1.0], darkFur);
  const eyes = [-1, 1].map(s => { const e = eye(1.05, 0x6a2c08); e.position.set(s * 2.25, 0.35, 6.7); e.rotation.y = s * 0.15; return e; });
  const nostrils = [-1, 1].map(s => { const n = blob(0.75, 0.5, 0.5, dark); n.position.set(s * 1.25, -1.9, 9.2); return n; });
  const mouth = blob(3.6, 1.3, 1.0, dark); mouth.position.set(0, -4.6, 8.8);
  const upperTeeth = blob(3.0, 0.55, 0.6, teethMat); upperTeeth.position.set(0, -3.95, 9.3);
  const lowerTeeth = blob(2.6, 0.45, 0.55, teethMat); lowerTeeth.position.set(0, -5.2, 9.1);
  const ears = [-1, 1].map(s => { const e = blob(1.4, 1.9, 0.9, hide); e.position.set(s * 6.8, 0, 0.5); return e; });
  const tuft = blob(2.4, 2.0, 2.0, darkFur, v => 1 + 0.35 * Math.max(0, v.y) * Math.sin(v.x * 10)); tuft.position.set(0, 5.6, 0.8);
  head.add(cranium, face, muzzle, brow, mouth, upperTeeth, lowerTeeth, tuft, ...eyes, ...nostrils, ...ears);
  g.add(head);

  const hand = () => {
    const h = new THREE.Group();
    h.add(blob(3.5, 2.8, 3.2, hide));
    for (let i = 0; i < 4; i++) { const k = blob(0.95, 1.2, 0.95, hide); k.position.set(-2.1 + i * 1.4, -2.2, 1.4); h.add(k); }
    const th = blob(0.9, 1.4, 0.9, hide); th.position.set(3.0, -0.6, 1.5); th.rotation.z = -0.5; h.add(th);
    return h;
  };
  const arms = [-1, 1].map(s => {
    const sh = joint(s * 12, 6, 1);
    sh.add(taper([[0, 0, 0], [s * 1.2, -4, 0.3], [s * 1.6, -7.5, 0]], [4.5, 3.9, 3.4], fur));
    const el = joint(s * 1.6, -7.5, 0);
    el.add(taper([[0, 0, 0], [0, -3.5, 0.6], [0, -7, 1]], [3.4, 3.2, 3.0], fur));
    const hd = hand(); hd.position.set(0, -9.0, 1.2); hd.scale.setScalar(0.8);
    el.add(hd);
    sh.add(el);
    sh.userData.elbow = el;
    g.add(sh);
    return sh;
  });
  const legs = [-1, 1].map(s => {
    const hip = joint(s * 6.5, -9, 0);
    hip.add(taper([[0, 0, 0], [s * 1.6, -3, 1.4], [s * 2.0, -5, 1.8]], [4.4, 3.6, 3.0], fur));
    const foot = blob(3.8, 1.8, 4.6, hide, v => 1 + 0.08 * v.z); foot.position.set(s * 2.4, -6.6, 3.0);
    for (let i = 0; i < 3; i++) { const toe = blob(0.9, 0.8, 1.0, hide); toe.position.set(-1.6 + i * 1.6, -0.4, 4.2); foot.add(toe); }
    hip.add(foot);
    hip.rotation.z = s * 0.25;
    g.add(hip);
    return hip;
  });

  let lastSig = '', beat = 0, beatTarget = 0;
  return {
    group: g,
    update(obj, { t, dt }) {
      const sig = obj.codes.join(',');
      if (sig !== lastSig) { lastSig = sig; beatTarget = beatTarget ? 0 : 1; }
      beat = damp(beat, beatTarget, 14, dt);
      // fists alternately pound the chest: upper arm forward and in, forearm folded to the chest
      for (const [i, arm] of arms.entries()) {
        const side = i ? 1 : -1;
        const p = i ? 1 - beat : beat;
        arm.rotation.set(-0.45 - 0.55 * p, 0, -side * (0.2 + 0.25 * p));
        arm.userData.elbow.rotation.set(-0.5 - 1.3 * p, 0, -side * 0.7 * p);
      }
      const breathe = Math.sin(t * 2.4) * 0.025;
      torso.scale.set(1 + breathe, 1 + breathe, 1);
      head.rotation.y = Math.sin(t * 0.9) * 0.18;
      head.rotation.z = (beat - 0.5) * 0.12;
      head.position.y = 11 + Math.abs(beat - 0.5) * 0.8;
      for (const e of eyes) e.scale.y = (t % 4.3) < 0.13 ? 0.15 : 1;
      legs[0].rotation.x = Math.sin(t * 1.3) * 0.05;
      legs[1].rotation.x = -Math.sin(t * 1.3) * 0.05;
    },
  };
}

// ---- Pauline ------------------------------------------------------------------------------------
export function makePauline(opts = {}) {
  const g = new THREE.Group();
  const dress = clothMat(opts.dress ?? 0xc8306e, { sheen: 0.5, sheenColor: new THREE.Color(opts.dress ?? 0xff80b0) });
  const trim = clothMat(0xd8c8d0, { sheen: 0 });
  const skin = skinMat(0xdc9f7c);
  const hairMat = new THREE.MeshPhysicalMaterial({ color: opts.hair ?? 0x7a240a, roughness: 0.42, sheen: 0.8, sheenColor: new THREE.Color(0xc8602a), clearcoat: 0.3 });

  // flared skirt with a wavy hem
  const prof = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    prof.push(new THREE.Vector2(2.3 + 4.0 * t * t + 0.4 * t, 0.8 - t * 10));
  }
  const skirtGeo = new THREE.LatheGeometry(prof, 40);
  const sp = skirtGeo.attributes.position, base = sp.array.slice();
  const skirt = new THREE.Mesh(skirtGeo, dress);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.55, 8, 48), trim);
  hem.rotation.x = Math.PI / 2; hem.position.y = -9.1;
  const bodice = blob(2.5, 3.1, 2.1, dress, v => 1 + 0.12 * v.y); bodice.position.y = 3.0;
  const sash = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.45, 8, 28), trim); sash.rotation.x = Math.PI / 2; sash.position.y = 0.9;
  const sleeves = [-1, 1].map(s => { const p = blob(1.55, 1.4, 1.4, dress); p.position.set(s * 2.7, 4.7, 0); return p; });
  const neck = taper([[0, 5.6, 0], [0, 7, 0.1]], [0.75, 0.7], skin);
  g.add(skirt, hem, bodice, sash, neck, ...sleeves);

  const head = joint(0, 9.2, 0.2);
  const face = blob(2.45, 2.85, 2.45, skin, v => 1 - 0.1 * Math.max(0, -v.y) * Math.abs(v.x));
  const eyes = [-1, 1].map(s => { const e = eye(0.55, 0x2d7a46, { scaleY: 1.3 }); e.position.set(s * 0.9, 0.35, 2.05); return e; });
  const lashes = [-1, 1].map(s => taper([[s * 0.35, 1.2, 2.3], [s * 0.95, 1.4, 2.35], [s * 1.55, 1.15, 2.05]], [0.12, 0.15, 0.1], new THREE.MeshStandardMaterial({ color: 0x1a0a06 })));
  const lips = blob(0.62, 0.32, 0.35, glossMat(0xd0204a)); lips.position.set(0, -1.25, 2.25);
  const nose = blob(0.35, 0.45, 0.35, skin); nose.position.set(0, -0.35, 2.45);
  const cheeks = [-1, 1].map(s => { const c = blob(0.55, 0.4, 0.2, new THREE.MeshStandardMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.45, roughness: 0.6 })); c.position.set(s * 1.45, -0.55, 2.0); return c; });
  const cap = blob(2.75, 2.85, 2.8, hairMat, v => 1 + 0.06 * Math.sin(v.x * 14)); cap.position.set(0, 0.55, -0.45);
  const bangs = blob(2.4, 1.0, 1.2, hairMat, v => 1 + 0.12 * Math.sin(v.x * 10)); bangs.position.set(0, 2.1, 1.4); bangs.rotation.x = 0.3;
  head.add(face, cap, bangs, lips, nose, ...eyes, ...lashes, ...cheeks);
  // long flowing hair
  const locks = [];
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + (i / 6) * 2.4;
    const x = Math.sin(a) * 2.2, z = -Math.cos(a) * 1.8 - 0.4;
    const pivot = joint(x, 0.5, z);
    pivot.add(taper([[0, 0, 0], [x * 0.15, -3.5, -0.5], [x * 0.25, -7.5, -0.6]], [0.9, 0.8, 0.35], hairMat));
    head.add(pivot);
    locks.push(pivot);
  }
  g.add(head);

  const arms = [-1, 1].map(s => {
    const sh = joint(s * 2.8, 4.6, 0);
    sh.add(taper([[0, 0, 0], [0, -2.3, 0], [0, -4.4, 0.2]], [0.62, 0.55, 0.48], skin));
    const hand = blob(0.62, 0.75, 0.42, skin); hand.position.set(0, -4.9, 0.2);
    sh.add(hand);
    g.add(sh);
    return sh;
  });

  return {
    group: g,
    update(obj, { t }) {
      // waving for help with one arm, the other on her chest
      arms[1].rotation.z = 2.5 + Math.sin(t * 9) * 0.4;
      arms[0].rotation.z = -0.35;
      arms[0].rotation.x = -0.6;
      head.rotation.z = Math.sin(t * 3) * 0.1;
      head.rotation.x = -0.1;
      g.rotation.y = obj.hflip ? 0.55 : -0.55;
      for (const [i, l] of locks.entries()) {
        l.rotation.x = 0.15 + Math.sin(t * 3 + i) * 0.06;
        l.rotation.z = Math.sin(t * 2.2 + i * 0.7) * 0.08;
      }
      for (let i = 0; i < sp.count; i++) {
        const y = base[i * 3 + 1];
        const k = Math.max(0, (0.8 - y) / 10);
        const a = Math.atan2(base[i * 3 + 2], base[i * 3]);
        const w = 1 + k * (0.05 * Math.sin(a * 8 + t * 4));
        sp.array[i * 3] = base[i * 3] * w;
        sp.array[i * 3 + 2] = base[i * 3 + 2] * w;
      }
      sp.needsUpdate = true;
      for (const e of eyes) e.scale.y = 1.3 * ((t % 3.1) < 0.12 ? 0.15 : 1);
    },
  };
}
