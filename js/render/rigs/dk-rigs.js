// Hand-built 3D models for Donkey Kong ("Redrawn" mode), posed from the arcade sprite codes.
import * as THREE from 'three';
import { mat, glowMat, sphere, capsule, box, cyl, limb, canvasTexture, dominantColor, bboxOf } from './rig-layer.js';

const SKIN = 0xffc49a;

// ---------------------------------------------------------------------------------------------
function makeHammer() {
  const g = new THREE.Group();
  const handle = cyl(0.55, 0.55, 9, mat(0xb07a3c, { roughness: 0.7 }));
  handle.position.y = 4.5;
  const head = box(5.5, 3, 3, mat(0x9aa4ae, { metalness: 0.7, roughness: 0.3 }));
  head.position.y = 9.5;
  g.add(handle, head);
  return g;
}

function makeMario() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const red = mat(0xd8261c), blue = mat(0x2a49c8), skin = mat(SKIN), brown = mat(0x5a2d12, { roughness: 0.6 }), dark = mat(0x2a1408);
  // legs + shoes
  const legs = [-1.5, 1.5].map(x => {
    const shoe = sphere(1.7, brown); shoe.scale.set(1, 0.7, 1.4); shoe.position.z = 0.6;
    const l = limb(1.3, 2.4, blue, shoe);
    l.position.set(x, -2.2, 0);
    body.add(l);
    return l;
  });
  // overalls and shirt
  const hips = capsule(3.1, 1.2, blue); hips.position.y = -0.6; hips.scale.set(1, 1, 0.85);
  const chest = sphere(3.3, red); chest.position.y = 2; chest.scale.set(1, 0.8, 0.85);
  const bib = box(3.6, 2.4, 1, blue); bib.position.set(0, 1.4, 2.4);
  const buttons = [-1.1, 1.1].map(x => { const b = sphere(0.45, mat(0xffd84a, { metalness: 0.6 })); b.position.set(x, 2.3, 2.9); return b; });
  body.add(hips, chest, bib, ...buttons);
  // arms
  const arms = [-1, 1].map(side => {
    const hand = sphere(1.25, skin);
    const a = limb(1.05, 2.6, red, hand);
    a.position.set(side * 3.4, 2.9, 0);
    a.rotation.z = side * 0.25;
    body.add(a);
    return a;
  });
  // head
  const head = new THREE.Group();
  head.position.y = 6.3;
  const skull = sphere(3.1, skin);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(3.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), red);
  cap.position.y = 0.4;
  const brim = box(3.4, 0.55, 2.6, red); brim.position.set(0, 0.55, 2.6);
  const emblem = cyl(0.9, 0.9, 0.3, mat(0xffffff)); emblem.rotation.x = Math.PI / 2 - 0.4; emblem.position.set(0, 2.3, 2.5);
  const nose = sphere(1.05, skin); nose.position.set(0, -0.3, 3.1);
  const stache = box(3.2, 0.9, 1, dark); stache.position.set(0, -1.15, 2.7);
  const eyes = [-1, 1].map(x => { const e = sphere(0.45, dark); e.position.set(x * 1.05, 0.5, 2.85); e.scale.y = 1.5; return e; });
  const hair = box(4.4, 1.6, 1.5, dark); hair.position.set(0, -0.6, -2.3);
  head.add(skull, cap, brim, emblem, nose, stache, hair, ...eyes);
  body.add(head);
  // hammer (shown in hammer frames)
  const hammer = makeHammer();
  hammer.visible = false;
  arms[1].add(hammer);
  hammer.position.y = -3.6;
  hammer.rotation.x = Math.PI;

  const pose = { leg: 0, arm: 0 };
  return {
    group: g,
    update(obj, { t, dt, st }) {
      const code = obj.code;
      const climbing = code >= 0x03 && code <= 0x06;
      const hammerFrame = code >= 0x08 && code <= 0x0f;
      const dying = code >= 0x78 && code <= 0x7a;
      const facing = obj.hflip ? 1 : -1;
      const k = 1 - Math.exp(-dt * 25);
      let legT = 0, armT = 0;
      if (code === 0x01 || code === 0x09 || code === 0x0d) legT = 0.6;
      if (code === 0x02 || code === 0x0b || code === 0x0f) legT = -0.6;
      if (climbing) { legT = (code & 1) ? 0.5 : -0.5; armT = -2.6; }
      pose.leg += (legT - pose.leg) * k;
      pose.arm += (armT - pose.arm) * k;
      legs[0].rotation.x = pose.leg; legs[1].rotation.x = -pose.leg;
      if (climbing) {
        arms[0].rotation.x = -2.6 + pose.leg * 0.6; arms[1].rotation.x = -2.6 - pose.leg * 0.6;
        body.rotation.y = Math.PI;
      } else {
        arms[0].rotation.x = -pose.leg * 0.8; arms[1].rotation.x = pose.leg * 0.8;
        body.rotation.y = facing * 0.95;
      }
      hammer.visible = hammerFrame;
      if (hammerFrame) {
        // two hammer positions: raised overhead / swung down in front
        const up = ((code >> 1) & 1) === 0;
        arms[1].rotation.x = up ? -3.0 : -1.3;
        arms[1].rotation.z = up ? 0.2 : 0.4;
      } else arms[1].rotation.z = 0.25;
      body.rotation.z = dying ? (code === 0x7a ? Math.PI / 2 : Math.sin(t * 20) * 0.3) : 0;
      body.position.y = Math.abs(pose.leg) * 0.6 - 0.4;
    },
  };
}

function makeKong() {
  const g = new THREE.Group();
  const fur = mat(0x4e1e08, { roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0x8a4a20), clearcoat: 0 });
  const tan = mat(0xb87a44, { roughness: 0.65, clearcoat: 0 });
  const dark = mat(0x1c0b04);
  const torso = sphere(11, fur, 32, 24); torso.scale.set(1.25, 1, 0.85); torso.position.y = -1;
  const belly = sphere(7.5, tan); belly.scale.set(1.1, 1.05, 0.5); belly.position.set(0, -1.5, 7);
  g.add(torso, belly);
  const head = new THREE.Group(); head.position.set(0, 10.5, 2);
  const skull = sphere(7, fur); skull.scale.set(1.1, 1, 1);
  const muzzle = sphere(4.6, tan); muzzle.scale.set(1.25, 0.85, 0.8); muzzle.position.set(0, -2.2, 4.5);
  const brow = box(10, 1.6, 2.6, fur); brow.position.set(0, 1.6, 5.6);
  const eyes = [-1, 1].map(x => {
    const e = sphere(1.3, mat(0xffffff)); e.position.set(x * 2.4, 0.4, 6);
    const p = sphere(0.6, dark); p.position.set(0, 0, 1.05); e.add(p);
    return e;
  });
  const nostrils = [-1, 1].map(x => { const n = sphere(0.5, dark); n.position.set(x * 1.1, -1.2, 8); return n; });
  const mouth = box(4.6, 0.6, 0.6, dark); mouth.position.set(0, -4, 7.6);
  const teeth = box(4, 0.8, 0.4, mat(0xffffff)); teeth.position.set(0, -3.4, 7.8);
  head.add(skull, muzzle, brow, mouth, teeth, ...eyes, ...nostrils);
  g.add(head);
  const arms = [-1, 1].map(side => {
    const fist = sphere(3.3, tan);
    const a = limb(3.1, 9, fur, fist);
    a.position.set(side * 12, 5, 1);
    a.rotation.z = side * 0.35;
    g.add(a);
    return a;
  });
  const legs = [-1, 1].map(side => {
    const foot = sphere(3, tan); foot.scale.set(1.3, 0.6, 1.4);
    const l = limb(3.4, 4, fur, foot);
    l.position.set(side * 6.5, -8.5, 0);
    l.rotation.z = side * 0.3;
    g.add(l);
    return l;
  });
  let lastSig = '', beat = 0, beatTarget = 0;
  return {
    group: g,
    update(obj, { t, dt }) {
      const sig = obj.codes.join(',');
      if (sig !== lastSig) { lastSig = sig; beatTarget = beatTarget ? 0 : 1; }
      beat += (beatTarget - beat) * (1 - Math.exp(-dt * 14));
      // alternate fists pounding the chest; breathing in between
      arms[0].rotation.x = -1.2 - beat * 0.9;
      arms[1].rotation.x = -1.2 - (1 - beat) * 0.9;
      arms[0].rotation.z = -0.9 + beat * 0.5;
      arms[1].rotation.z = 0.9 - (1 - beat) * 0.5;
      const breathe = Math.sin(t * 2.4) * 0.03;
      torso.scale.set(1.25 + breathe, 1 + breathe, 0.85);
      head.rotation.y = Math.sin(t * 0.9) * 0.2;
      head.position.y = 10.5 + Math.abs(beat - 0.5) * 0.8;
      g.scale.setScalar(obj.scale || 1);
    },
  };
}

function makePauline() {
  const g = new THREE.Group();
  const dress = mat(0xd84a8a, { roughness: 0.55, clearcoat: 0.1 });
  const skirt = cyl(2.4, 6.2, 9.5, dress, 28); skirt.position.y = -4.5;
  const waist = sphere(2.6, dress); waist.position.y = 1.2; waist.scale.set(1, 1.1, 0.85);
  const head = new THREE.Group(); head.position.y = 5.6;
  const face = sphere(2.6, mat(SKIN));
  const hair = sphere(3, mat(0xc4521a, { roughness: 0.7 })); hair.position.set(0, 0.4, -0.8); hair.scale.set(1.1, 1.05, 1);
  const tail = capsule(1.6, 5, mat(0xc4521a)); tail.position.set(0, -3, -2.2);
  const eyes = [-1, 1].map(x => { const e = sphere(0.4, mat(0x1a1a40)); e.position.set(x * 0.9, 0.3, 2.4); return e; });
  const lips = sphere(0.5, mat(0xd01848)); lips.position.set(0, -1, 2.4); lips.scale.x = 1.6;
  head.add(face, hair, tail, lips, ...eyes);
  const arms = [-1, 1].map(side => {
    const a = limb(0.8, 3.2, mat(SKIN), sphere(0.9, mat(SKIN)));
    a.position.set(side * 2.6, 2.2, 0);
    g.add(a);
    return a;
  });
  g.add(skirt, waist, head);
  return {
    group: g,
    update(obj, { t }) {
      // waving for help
      arms[1].rotation.z = 2.4 + Math.sin(t * 9) * 0.45;
      arms[0].rotation.z = -0.3;
      head.rotation.z = Math.sin(t * 3) * 0.1;
      g.rotation.y = obj.hflip ? 0.6 : -0.6;
      skirt.rotation.y = Math.sin(t * 4) * 0.15;
    },
  };
}

let woodTex = null;
function woodTexture() {
  if (woodTex) return woodTex;
  woodTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#9b5a26';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = i * w / 8;
      g.fillStyle = i % 2 ? '#a8652c' : '#8e5020';
      g.fillRect(x, 0, w / 8, h);
      g.strokeStyle = '#4a2410'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + 4 + k * 4, 0); g.bezierCurveTo(x + 10 + k * 3, h * 0.3, x + k * 4, h * 0.6, x + 6 + k * 4, h); g.stroke();
      }
    }
  });
  return woodTex;
}

function makeBarrel() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.6, clearcoat: 0.3 });
  const geo = new THREE.CylinderGeometry(5.2, 5.2, 8.5, 24, 6);
  // bulge the staves outward in the middle like a real barrel
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = 1 + 0.12 * (1 - (y / 4.25) ** 2);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, woodMat);
  const hoopMat = mat(0x3a3f46, { metalness: 0.8, roughness: 0.35 });
  const hoops = [-3.2, 3.2].map(y => { const h = new THREE.Mesh(new THREE.TorusGeometry(5.35, 0.45, 8, 32), hoopMat); h.rotation.x = Math.PI / 2; h.position.y = y; return h; });
  spin.add(body, ...hoops);
  return {
    group: g,
    update(obj, { st }) {
      const upright = obj.y1 - obj.y0 > obj.x1 - obj.x0 + 2;
      if (upright) { spin.rotation.set(Math.PI / 2, 0, 0); spin.rotateY(st.y * 0.25); }
      else { spin.rotation.set(Math.PI / 2, 0, 0); spin.rotation.y = -st.x / 5.5; }
      woodMat.color.setRGB(obj.tint[0] / 255 * 0.5 + 0.5, obj.tint[1] / 255 * 0.5 + 0.5, obj.tint[2] / 255 * 0.5 + 0.5, THREE.SRGBColorSpace);
    },
  };
}

function makeFireball() {
  const g = new THREE.Group();
  const core = sphere(3.6, glowMat(0xffd25a)); core.userData.noShadow = true;
  const flames = [];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff6a18 : 0xff9a2a, toneMapped: false, transparent: true, opacity: 0.85 }));
    f.userData.noShadow = true;
    f.userData.a = (i / 7) * Math.PI * 2;
    g.add(f);
    flames.push(f);
  }
  const eyes = [-1, 1].map(x => {
    const e = sphere(0.9, mat(0xffffff)); e.position.set(x * 1.3, 0.5, 3.2); e.userData.noShadow = true;
    const p = sphere(0.45, mat(0x101010)); p.position.z = 0.6; e.add(p);
    return e;
  });
  g.add(core, ...eyes);
  return {
    group: g, light: true,
    update(obj, { t }) {
      for (const f of flames) {
        const a = f.userData.a + t * 3;
        const s = 0.8 + 0.3 * Math.sin(t * 17 + f.userData.a * 3);
        f.position.set(Math.cos(a) * 2.2, 2.5 + Math.sin(a) * 0.8, Math.sin(a) * 1.5);
        f.scale.set(s, s * 1.2, s);
        f.rotation.z = Math.cos(a) * -0.5;
      }
      core.scale.setScalar(1 + 0.08 * Math.sin(t * 23));
    },
  };
}

function makeFlame() {
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(1.4 + (i % 3) * 0.5, 7 + (i % 4) * 1.5, 8),
      new THREE.MeshBasicMaterial({ color: [0xffe27a, 0xffa22a, 0xff5a10][i % 3], toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }));
    f.userData.noShadow = true;
    f.userData.seed = i * 1.7;
    g.add(f);
    parts.push(f);
  }
  return {
    group: g, light: true,
    update(obj, { t }) {
      for (const f of parts) {
        const s = f.userData.seed;
        const life = (t * 1.8 + s) % 1;
        f.position.set(Math.sin(s * 3) * 4, -3 + life * 6, Math.cos(s * 2) * 2);
        f.scale.setScalar(1.1 - life * 0.7);
        f.material.opacity = 0.9 - life * 0.6;
      }
    },
  };
}

function makeOilDrum() {
  const g = new THREE.Group();
  const label = canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#1e5fd1'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.font = 'bold 40px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('OIL', w * 0.5, h * 0.55);
  });
  // theta starts at -PI so the middle of the label faces the viewer
  const side = new THREE.MeshPhysicalMaterial({ map: label, metalness: 0.5, roughness: 0.35, clearcoat: 0.6 });
  const caps = mat(0x1a4fae, { metalness: 0.6, roughness: 0.4 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 15, 32, 1, false, -Math.PI, Math.PI * 2), [side, caps, caps]);
  const rims = [-6.8, 0, 6.8].map(y => { const r = new THREE.Mesh(new THREE.TorusGeometry(6.7, 0.5, 8, 32), mat(0x153d8a, { metalness: 0.7 })); r.rotation.x = Math.PI / 2; r.position.y = y; return r; });
  g.add(drum, ...rims);
  return { group: g, update() {} };
}

function makeHammerPickup() {
  const g = makeHammer();
  g.position.y = -5;
  const root = new THREE.Group();
  root.add(g);
  return { group: root, update(obj, { t }) { g.rotation.y = t * 1.5; } };
}

// ---------------------------------------------------------------------------------------------
const isMario = c => c <= 0x0f || (c >= 0x78 && c <= 0x7a);
const isPauline = c => c >= 0x10 && c <= 0x14;
const isBarrel = c => c >= 0x15 && c <= 0x1b;
const isHammer = c => c === 0x1e || c === 0x1f;
const isKong = c => c >= 0x20 && c <= 0x38;
const isFireball = c => c === 0x3d || c === 0x3e || c === 0x4d || c === 0x4e;
const isFlame = c => c >= 0x40 && c <= 0x43;

export function dkRigSet(view) {
  return {
    classify(sprites) {
      const objects = [], rest = [];
      const kong = [], pauline = [], flames = [];
      let mario = null;
      for (const s of sprites) {
        const c = s.code;
        if (isKong(c)) kong.push(s);
        else if (isPauline(c)) pauline.push(s);
        else if (isMario(c) && !mario) mario = s;
        else if (isFlame(c)) flames.push(s);
      }
      const near = (a, b, d) => Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d;
      for (const s of sprites) {
        const c = s.code;
        if (isKong(c) || isPauline(c) || isFlame(c) || s === mario) continue;
        const bb = bboxOf([s]);
        if (isBarrel(c)) objects.push({ type: 'barrel', id: `barrel${s.slot}`, ...bb, code: c, tint: dominantColor(view, [s]), z: 1 });
        else if (isFireball(c)) objects.push({ type: 'fireball', id: `fire${s.slot}`, ...bb, code: c, z: 2 });
        else if (c === 0x49) objects.push({ type: 'oildrum', id: 'oildrum', ...bb, code: c, z: 0 });
        else if (isHammer(c)) {
          if (mario && near(s, mario, 20) && mario.code >= 0x08 && mario.code <= 0x0f) continue;   // held by Mario
          objects.push({ type: 'hammer', id: `hammer${s.slot}`, ...bb, code: c, z: 1 });
        } else rest.push(s);
      }
      if (mario) objects.push({ type: 'mario', id: 'mario', ...bboxOf([mario]), code: mario.code, hflip: mario.hflip, z: 3, player: true });
      if (kong.length) {
        const bb = bboxOf(kong);
        objects.push({ type: 'kong', id: 'kong', ...bb, codes: kong.map(s => s.code).sort(), scale: (bb.y1 - bb.y0 + 1) / 32, z: 0 });
      }
      if (pauline.length) objects.push({ type: 'pauline', id: 'pauline', ...bboxOf(pauline), hflip: pauline[0].hflip, z: 1 });
      if (flames.length) objects.push({ type: 'flame', id: 'flame', ...bboxOf(flames), z: 1 });
      return { objects, rest };
    },
    create(type) {
      switch (type) {
        case 'mario': return makeMario();
        case 'kong': return makeKong();
        case 'pauline': return makePauline();
        case 'barrel': return makeBarrel();
        case 'fireball': return makeFireball();
        case 'flame': return makeFlame();
        case 'oildrum': return makeOilDrum();
        default: return makeHammerPickup();
      }
    },
  };
}
