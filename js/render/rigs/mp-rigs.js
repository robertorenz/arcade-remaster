// Moon Patrol "Redrawn" models: the patrol buggy is rebuilt as a lunar rover whose wheels follow
// the arcade's own wheel sprites (so the suspension bounce is the real one), and shots become
// glowing plasma bolts.
import * as THREE from 'three';
import { bboxOf } from './rig-layer.js';
import { blob, taper, joint, glossMat, metalMat, damp } from './sculpt.js';

function makeWheel() {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.85 });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(3.2, 1.25, 12, 28), rubber);
  spin.add(tire);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 2.6), rubber);
    lug.position.set(Math.cos(a) * 4.35, Math.sin(a) * 4.35, 0);
    lug.rotation.z = a;
    spin.add(lug);
  }
  const rim = metalMat(0xc8ccd4);
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.6, 20), rim).rotateX(Math.PI / 2));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 0.5), metalMat(0x7a808c));
    sp.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 1.0);
    sp.rotation.z = a - Math.PI / 2;
    spin.add(sp);
  }
  const hub = blob(0.8, 0.8, 0.6, glossMat(0xff5a2a)); hub.position.z = 1.2;
  spin.add(hub);
  return { g, spin };
}

function makeBuggy() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const paint = glossMat(0xc83c9c, { clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.3, roughness: 0.3 });
  const darkPaint = glossMat(0x6a1a58, { metalness: 0.3 });
  const steel = metalMat(0xb0b6c0);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x60d0ff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.5 });
  // chassis: a long wedge with rounded edges
  const hull = blob(14, 3.2, 6.0, paint, v => 1 + 0.18 * v.x * Math.max(0, v.y) - 0.1 * Math.max(0, -v.y));
  hull.position.y = 1.5;
  const skirt = blob(14.5, 1.4, 6.4, darkPaint); skirt.position.y = -0.8;
  body.add(hull, skirt);
  // cockpit dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.position.set(4.5, 3.8, 0); dome.scale.set(1.25, 0.95, 0.95);
  const pilot = blob(1.5, 1.7, 1.5, glossMat(0xf0f0f0)); pilot.position.set(4.2, 5.4, 0);
  const visor = blob(0.9, 0.7, 1.0, glossMat(0x203060)); visor.position.set(5.4, 5.5, 0);
  body.add(dome, pilot, visor);
  // anti-air cannon (vertical) at the back, forward cannon at the nose
  const turret = joint(-8.5, 4.2, 0);
  turret.add(blob(2.2, 1.4, 2.2, steel));
  turret.add(taper([[0, 0.5, 0], [0, 7.5, 0]], [0.75, 0.55], steel));
  turret.add(blob(0.9, 0.5, 0.9, glossMat(0xff5a2a)).translateY(7.6));
  body.add(turret);
  const gun = taper([[11, 1.6, 0], [17, 1.8, 0]], [0.9, 0.6], steel);
  body.add(gun);
  // antenna with a blinking tip
  body.add(taper([[-3, 4.2, -2.5], [-4, 11, -2.5]], [0.2, 0.1], steel));
  const tip = blob(0.55, 0.55, 0.55, new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
  tip.position.set(-4, 11.2, -2.5); tip.userData.noShadow = true;
  body.add(tip);
  // headlights + exhaust glow
  for (const z of [-3.5, 3.5]) {
    const hl = blob(0.8, 0.6, 0.8, new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false }));
    hl.position.set(13.6, 1.5, z); hl.userData.noShadow = true;
    body.add(hl);
  }
  const flame = blob(2.2, 0.9, 0.9, new THREE.MeshBasicMaterial({ color: 0x40b8ff, toneMapped: false, transparent: true, opacity: 0.7, depthWrite: false }));
  flame.position.set(-15, 0.6, 0); flame.userData.noShadow = true;
  body.add(flame);
  // three wheels per side, placed from the arcade wheel sprites every frame
  const wheels = [0, 1, 2].map(() => {
    const pair = new THREE.Group();
    const front = makeWheel(), back = makeWheel();
    front.g.position.z = 5.6; back.g.position.z = -5.6;
    front.g.scale.setScalar(0.85); back.g.scale.setScalar(0.85);
    pair.add(front.g, back.g);
    const strut = taper([[0, 0, 5], [0, 4, 4]], [0.45, 0.45], steel, { caps: false });
    pair.add(strut);
    g.add(pair);
    return { pair, spins: [front.spin, back.spin] };
  });
  let roll = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      roll += st.vx * 0.3 + dt * 2.2;   // the buggy always rolls forward at road speed
      const ws = obj.wheels.slice(0, 3);
      wheels.forEach((w, i) => {
        const p = ws[i];
        w.pair.visible = !!p;
        if (!p) return;
        w.pair.position.set(p[0], p[1], 0);
        for (const s of w.spins) s.rotation.z = -roll;
      });
      // body pitch follows the wheel heights
      if (ws.length >= 2) {
        const a = ws[0], b = ws[ws.length - 1];
        body.rotation.z = damp(body.rotation.z, Math.atan2(b[1] - a[1], b[0] - a[0]) * 0.8, 10, dt);
      }
      body.position.y = obj.bodyY;
      tip.visible = (t % 1) < 0.5;
      flame.scale.set(0.8 + 0.3 * Math.sin(t * 40), 1, 1);
    },
  };
}

function makeBolt() {
  const g = new THREE.Group();
  const core = blob(2.6, 0.7, 0.7, new THREE.MeshBasicMaterial({ color: 0xfff0a0, toneMapped: false }));
  const halo = blob(3.6, 1.4, 1.4, new THREE.MeshBasicMaterial({ color: 0xff6a20, toneMapped: false, transparent: true, opacity: 0.45, depthWrite: false }));
  core.userData.noShadow = halo.userData.noShadow = true;
  g.add(core, halo);
  return {
    group: g, light: true,
    update(obj, { t }) {
      g.rotation.z = obj.vertical ? Math.PI / 2 : 0;
      halo.scale.setScalar(1 + 0.15 * Math.sin(t * 50));
    },
  };
}

const isBody = c => c >= 1 && c <= 4;
const isWheel = c => c >= 5 && c <= 8;
const isBolt = c => c === 0x25 || c === 0x26 || c === 0x27 || c === 0x2b;

export function mpRigSet() {
  return {
    scale: 1,
    classify(sprites) {
      const objects = [], rest = [];
      const body = [], wheels = [];
      for (const s of sprites) {
        if (isBody(s.code)) body.push(s);
        else if (isWheel(s.code)) wheels.push(s);
        else if (isBolt(s.code)) {
          const bb = bboxOf([s]);
          objects.push({ type: 'bolt', id: `bolt${s.x >> 4}:${s.y >> 4}:${s.code}`, ...bb, vertical: s.code === 0x2b, z: 3 });
        } else rest.push(s);
      }
      if (body.length) {
        const bb = bboxOf(body);
        const all = bboxOf([...body, ...wheels]);
        const cx = (all.x0 + all.x1 + 1) / 2, cy = (all.y0 + all.y1 + 1) / 2;
        const wl = wheels.map(w => { const b = bboxOf([w]); return [(b.x0 + b.x1 + 1) / 2 - cx, cy - (b.y0 + b.y1 + 1) / 2]; })
          .sort((a, b) => a[0] - b[0]);
        objects.push({ type: 'buggy', id: 'buggy', ...all, wheels: wl, bodyY: cy - (bb.y0 + bb.y1 + 1) / 2 - 1, z: 4, player: true });
      } else rest.push(...wheels);
      return { objects, rest };
    },
    create(type) { return type === 'buggy' ? makeBuggy() : makeBolt(); },
  };
}
