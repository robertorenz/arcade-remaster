// Moon Patrol "Redrawn" models: the patrol buggy is rebuilt as a lunar rover whose wheels follow
// the arcade's own wheel sprites (so the suspension bounce is the real one), and shots become
// glowing plasma bolts.
import * as THREE from 'three';
import { bboxOf, dominantColor } from './rig-layer.js';
import { blob, taper, joint, glossMat, metalMat, damp, rock, rockMat } from './sculpt.js';

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

// ---- enemies, hazards and effects -------------------------------------------------------------
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
function noShadow(o) { o.traverse(m => { m.userData.noShadow = true; }); return o; }

function makeUfo() {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  g.add(tilt);
  const hull = metalMat(0xb8c0cc, { roughness: 0.2 });
  const accent = glossMat(0xe0a020, { metalness: 0.5 });
  // saucer: lathe profile with a sharp rim
  const prof = [[0, -2.2], [3.5, -2.0], [6.5, -1.0], [8.4, 0], [6.5, 0.9], [3.8, 1.5], [0, 1.6]].map(([x, y]) => new THREE.Vector2(x, y));
  tilt.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 40), hull));
  const band = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.45, 8, 40), accent); band.rotation.x = Math.PI / 2; tilt.add(band);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x80e0ff, roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, envMapIntensity: 1.5 }));
  dome.position.y = 1.4; tilt.add(dome);
  const alien = blob(1.3, 1.5, 1.3, glossMat(0x5ad040)); alien.position.y = 2.4; tilt.add(alien);
  for (const s of [-1, 1]) { const e = blob(0.45, 0.6, 0.3, glossMat(0x101010)); e.position.set(s * 0.55, 2.8, 1.1); tilt.add(e); }
  const lights = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), glow(0xffffff));
    l.position.set(Math.cos(a) * 7.2, -0.4, Math.sin(a) * 7.2);
    tilt.add(l);
    lights.push(l);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 0.6, 1.0, 20), glow(0x60ffd0, 0.8)); beam.position.y = -2.4; tilt.add(beam);
  noShadow(beam);
  const col = new THREE.Color();
  return {
    group: g, light: true,
    update(obj, { t, st }) {
      const s = Math.max(obj.x1 - obj.x0 + 1, 8) / 16;
      tilt.scale.setScalar(s);
      tilt.rotation.z = -st.vx * 0.08 + Math.sin(t * 2) * 0.06;
      tilt.rotation.x = 0.35;
      tilt.rotation.y = t * 1.5;
      accent.color.setRGB(obj.tint[0] / 255, obj.tint[1] / 255, obj.tint[2] / 255, THREE.SRGBColorSpace);
      lights.forEach((l, i) => l.material.color.copy(col.setHSL(((i / 10) + t * 0.6) % 1, 1, 0.6)).multiplyScalar(1.6));
    },
  };
}

function makeOrbs() {
  const g = new THREE.Group();
  const orbs = [];
  for (let i = 0; i < 4; i++) {
    const o = new THREE.Group();
    o.add(new THREE.Mesh(new THREE.SphereGeometry(2.1, 18, 12), glossMat(0x40c040, { emissive: 0x104010 })));
    o.add(noShadow(new THREE.Mesh(new THREE.SphereGeometry(2.9, 14, 10), glow(0x80ff80, 0.25))));
    g.add(o);
    orbs.push(o);
  }
  const core = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), glow(0xd0ffb0)));
  g.add(core);
  return {
    group: g, light: true,
    update(obj, { t }) {
      orbs.forEach((o, i) => {
        const a = t * 3 + (i * Math.PI) / 2;
        o.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, Math.sin(a * 2) * 1.5);
      });
      core.rotation.set(t * 2, t * 3, 0);
    },
  };
}

function makeBomb() {
  const g = new THREE.Group();
  g.add(noShadow(new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), glow(0xffa040))));
  const trail = noShadow(blob(1.2, 4.5, 1.2, glow(0xff5020, 0.45)));
  trail.position.y = 4;
  g.add(trail);
  return { group: g, light: true, update(obj, { t }) { trail.scale.y = 0.8 + 0.3 * Math.sin(t * 30); } };
}

function makeBoulderMP() {
  const g = new THREE.Group();
  const mat = rockMat(0x9a8878);
  const r = rock(7, mat, 5.3, 2);
  g.add(r);
  return {
    group: g,
    update(obj) {
      const w = obj.x1 - obj.x0 + 1, h = obj.y1 - obj.y0 + 1;
      r.scale.set(w / 14, h / 14, Math.min(w, h) / 14);
      r.position.y = 0;
      mat.color.setRGB(obj.tint[0] / 255 * 0.5 + 0.3, obj.tint[1] / 255 * 0.45 + 0.27, obj.tint[2] / 255 * 0.4 + 0.24, THREE.SRGBColorSpace);
    },
  };
}

function makeMine() {
  const g = new THREE.Group();
  const shell = metalMat(0x8a2a20, { roughness: 0.4 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  dome.position.y = -3;
  g.add(dome);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, el = 0.5 + (i % 2) * 0.5;
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 6), metalMat(0xc0c4c8));
    sp.position.set(Math.cos(a) * 4.4 * Math.cos(el), -3 + 4.4 * Math.sin(el) + 0.4, Math.sin(a) * 4.4 * Math.cos(el));
    sp.lookAt(sp.position.clone().multiplyScalar(2).setY(sp.position.y * 2 + 3));
    sp.rotateX(Math.PI / 2);
    g.add(sp);
  }
  const lamp = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), glow(0xff2010)));
  lamp.position.y = 2.2;
  g.add(lamp);
  return { group: g, light: true, update(obj, { t }) { lamp.visible = (t * 3) % 1 < 0.5; } };
}

function makeTank() {
  const g = new THREE.Group();
  const flip = new THREE.Group();
  g.add(flip);
  const armor = metalMat(0x6a7a4a, { roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 });
  flip.add(blob(9, 2.6, 5, armor, v => 1 - 0.2 * Math.max(0, -v.y)).translateY(0.5));
  for (const z of [-4.6, 4.6]) {
    const tread = new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 14, 6, 12), dark);
    tread.rotation.z = Math.PI / 2; tread.position.set(0, -2.6, z);
    flip.add(tread);
    for (let i = 0; i < 5; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.6, 14), metalMat(0x8a8a90)); w.rotation.x = Math.PI / 2; w.position.set(-6 + i * 3, -2.6, z + Math.sign(z) * 0.5); flip.add(w); }
  }
  const turret = joint(0, 3.4, 0);
  turret.add(blob(4.0, 2.0, 3.6, armor));
  const barrel = taper([[2, 0.6, 0], [11, 1.4, 0]], [0.75, 0.6], armor);
  turret.add(barrel);
  flip.add(turret);
  let face = -1;
  return {
    group: g,
    update(obj, { t, st }) {
      if (Math.abs(st.vx) > 0.05) face = st.vx > 0 ? 1 : -1;
      flip.scale.x = face;
      flip.rotation.y = -face * 0.3;
      turret.rotation.z = 0.15 + Math.sin(t * 1.3) * 0.08;
    },
  };
}

function makeMissile() {
  const g = new THREE.Group();
  const aim = new THREE.Group();
  g.add(aim);
  aim.add(taper([[-5, 0, 0], [3, 0, 0], [6, 0, 0]], [1.1, 1.1, 0.2], metalMat(0xd0d4dc)));
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.0), glossMat(0xc02020)); f.position.x = -4.2; f.rotation.x = (i * Math.PI) / 2; f.translateZ(1.2); aim.add(f); }
  const flame = noShadow(blob(2.6, 0.8, 0.8, glow(0xffb040, 0.85)));
  flame.position.x = -7.5;
  aim.add(flame);
  let ang = Math.PI;
  return {
    group: g, light: true,
    update(obj, { t, dt, st }) {
      if (Math.abs(st.vx) + Math.abs(st.vy) > 0.2) ang = Math.atan2(-st.vy, st.vx);
      aim.rotation.z = damp(aim.rotation.z, ang, 15, dt);
      flame.scale.x = 0.8 + 0.3 * Math.sin(t * 40);
    },
  };
}

function makeRing() {
  const g = new THREE.Group();
  const r = noShadow(new THREE.Mesh(new THREE.TorusGeometry(5, 0.5, 8, 32), glow(0x60e0ff)));
  g.add(r);
  return { group: g, update(obj, { t }) { r.rotation.set(t * 3, t * 2, 0); r.scale.setScalar(0.8 + 0.2 * Math.sin(t * 8)); } };
}

// explosion: white-hot core, flying shards and an expanding smoke shell, sized to the arcade blast
function makeBlast() {
  const g = new THREE.Group();
  const core = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(3, 2), glow(0xfff0b0)));
  const fire = noShadow(new THREE.Mesh(new THREE.IcosahedronGeometry(4.5, 2), glow(0xff6a10, 0.6)));
  const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(5.5, 2), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false, flatShading: true }));
  noShadow(smoke);
  g.add(smoke, fire, core);
  const shards = [];
  for (let i = 0; i < 12; i++) {
    const s = noShadow(new THREE.Mesh(new THREE.TetrahedronGeometry(0.9), glow(i % 2 ? 0xffa030 : 0xffe080)));
    const a = (i / 12) * Math.PI * 2, b = (i % 3 - 1) * 0.6;
    s.userData.dir = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b) * 0.8 + 0.3, Math.sin(b));
    g.add(s);
    shards.push(s);
  }
  return {
    group: g, light: true,
    update(obj, { t, st }) {
      const size = Math.max(obj.x1 - obj.x0 + 1, obj.y1 - obj.y0 + 1) / 16;
      const age = (st.age * 1.6) % 1;
      g.scale.setScalar(Math.max(0.35, size));
      core.scale.setScalar(Math.max(0.05, 1 - age * 1.4));
      fire.scale.setScalar(0.6 + age * 0.9);
      fire.material.opacity = 0.75 * (1 - age);
      smoke.scale.setScalar(0.4 + age * 1.2);
      smoke.material.opacity = 0.55 * (1 - age * 0.8);
      smoke.rotation.y = t;
      for (const s of shards) {
        s.position.copy(s.userData.dir).multiplyScalar(2 + age * 11);
        s.rotation.set(t * 7, t * 5, 0);
        s.scale.setScalar(1 - age * 0.6);
      }
    },
  };
}

// ---- classification --------------------------------------------------------------------------
const isBody = c => c >= 1 && c <= 4;
const isWheel = c => c >= 5 && c <= 8;
const KIND = new Map();
const put = (type, a, b = a) => { for (let c = a; c <= b; c++) KIND.set(c, type); };
put('blast', 0x09, 0x24); put('bolt', 0x25, 0x27); put('vbolt', 0x28, 0x29); put('blast', 0x2a, 0x2c);
put('boulder', 0x2d, 0x37); put('tank', 0x38); put('bolt', 0x39); put('tank', 0x3b); put('blast', 0x3d, 0x41);
put('ufo', 0x42); put('orbs', 0x43, 0x44); put('ufo', 0x45, 0x47); put('blast', 0x48, 0x4a); put('bomb', 0x4b, 0x4d);
put('mine', 0x4e); put('blast', 0x61, 0x6f); put('ring', 0x7a); put('missile', 0x7b, 0x7c);
const MERGE = new Set(['blast', 'boulder', 'tank', 'ufo', 'orbs']);

function clusters(list, gap) {
  const out = [], bbs = list.map(s => bboxOf([s])), used = new Array(list.length).fill(false);
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

export function mpRigSet(view) {
  let tracks = [], nextId = 1;
  return {
    scale: 1,
    classify(sprites) {
      const objects = [], rest = [];
      const body = [], wheels = [], groups = new Map();
      for (const s of sprites) {
        if (isBody(s.code)) body.push(s);
        else if (isWheel(s.code)) wheels.push(s);
        else {
          const k = KIND.get(s.code);
          if (!k) { rest.push(s); continue; }
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(s);
        }
      }
      if (body.length) {
        const bb = bboxOf(body);
        const all = bboxOf([...body, ...wheels]);
        const cx = (all.x0 + all.x1 + 1) / 2, cy = (all.y0 + all.y1 + 1) / 2;
        const wl = wheels.map(w => { const b = bboxOf([w]); return [(b.x0 + b.x1 + 1) / 2 - cx, cy - (b.y0 + b.y1 + 1) / 2]; })
          .sort((a, b) => a[0] - b[0]);
        objects.push({ type: 'buggy', id: 'buggy', ...all, wheels: wl, bodyY: cy - (bb.y0 + bb.y1 + 1) / 2 - 1, z: 4, player: true });
      } else if (wheels.length) {
        if (!groups.has('blast')) groups.set('blast', []);
        groups.get('blast').push(...wheels);
      }
      const next = [];
      for (const [type, list] of groups) {
        const cs = MERGE.has(type) ? clusters(list, 2) : list.map(s => [s]);
        for (const c of cs) {
          const bb = bboxOf(c);
          if (bb.x1 < bb.x0) continue;
          const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
          let best = null, bd = 20;
          for (const tr of tracks) {
            if (tr.type !== type || tr.used) continue;
            const d = Math.hypot(tr.cx - cx, tr.cy - cy);
            if (d < bd) { bd = d; best = tr; }
          }
          const id = best ? best.id : nextId++;
          if (best) best.used = true;
          next.push({ id, type, cx, cy });
          objects.push({ type: type === 'vbolt' ? 'bolt' : type, id: `${type}${id}`, ...bb, vertical: type === 'vbolt', tint: dominantColor(view, c), z: type === 'boulder' || type === 'mine' ? 2.5 : 3.5 });
        }
      }
      tracks = next;
      return { objects, rest };
    },
    create(type) {
      switch (type) {
        case 'buggy': return makeBuggy();
        case 'bolt': return makeBolt();
        case 'ufo': return makeUfo();
        case 'orbs': return makeOrbs();
        case 'bomb': return makeBomb();
        case 'boulder': return makeBoulderMP();
        case 'mine': return makeMine();
        case 'tank': return makeTank();
        case 'missile': return makeMissile();
        case 'ring': return makeRing();
        default: return makeBlast();
      }
    },
  };
}
