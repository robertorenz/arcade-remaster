// Hand-built 3D models for Donkey Kong ("Redrawn" mode), posed from the arcade sprite codes.
import * as THREE from 'three';
import { mat, glowMat, sphere, canvasTexture, dominantColor, bboxOf } from './rig-layer.js';
import { makeMario, makeKong, makePauline, makeHammer } from './dk-chars.js';

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
    scale: 1.15,
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
