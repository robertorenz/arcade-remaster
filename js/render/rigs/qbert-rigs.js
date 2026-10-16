// Hand-built 3D models for Q*bert ("Redrawn" mode): Q*bert, Coily, the bouncing balls,
// Ugg and Wrongway, Slick and Sam, and the spinning escape discs.
// Every model stands on the pyramid's tilted top faces: the outer group carries the same 30 degree
// tilt as the cubes, the inner group turns to face one of the four diagonal hop directions.
import * as THREE from 'three';
import { bboxOf, dominantColor } from './rig-layer.js';
import { blob, taper, eye, glossMat, damp, furNormal } from './sculpt.js';
import { QB_TILT, qbSurfaceZ } from '../structures/qbert-structs.js';

// yaw for a model built facing +x: down-right, down-left, up-right, up-left (screen diagonals)
const YAW = { dr: -Math.PI / 4, dl: -Math.PI * 3 / 4, ur: Math.PI / 4, ul: Math.PI * 3 / 4 };
// Q*bert's sprite pairs: 0xcc up-right, 0xce up-left, 0xd0 down-right, 0xd2 down-left
const QB_FACING = ['ur', 'ul', 'dr', 'dl'];

function plushMat(color, sheen) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6, sheen: 0.35, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(sheen ?? color).multiplyScalar(0.45), normalMap: furNormal(), normalScale: new THREE.Vector2(0.35, 0.35),
  });
}

const tmp = new THREE.Color();
const setTint = (m, rgb, k = 1) => { tmp.setRGB(rgb[0] / 255 * k, rgb[1] / 255 * k, rgb[2] / 255 * k, THREE.SRGBColorSpace); m.color.copy(tmp); };

// facing from motion on screen (dy > 0 is down)
function facingFrom(st, prev) {
  if (Math.abs(st.vx) + Math.abs(st.vy) < 0.08) return prev;
  return (st.vy > 0 ? 'd' : 'u') + (st.vx >= 0 ? 'r' : 'l');
}

function shell() {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = QB_TILT;
  const yaw = new THREE.Group();
  const body = new THREE.Group();
  g.add(tilt); tilt.add(yaw); yaw.add(body);
  return { g, tilt, yaw, body };
}

// ---- Q*bert ----------------------------------------------------------------------------------
function makeQbert() {
  const { g, yaw, body } = shell();
  const orange = plushMat(0xe24a00, 0xff9a40);
  const dark = new THREE.MeshStandardMaterial({ color: 0x120402, roughness: 0.7 });
  const torso = blob(5.4, 5.1, 5.1, orange, v => 1 + 0.06 * v.y - 0.05 * Math.max(0, -v.y) ** 2);
  body.add(torso);
  // the trumpet snout: a tube that dips and flares open at the end
  const snout = taper([[3.2, -0.6, 0], [6.0, -1.7, 0], [8.2, -1.6, 0], [9.6, -0.9, 0]], [2.3, 1.6, 1.65, 2.0], orange, { radial: 18, caps: false });
  body.add(snout);
  // flared bell at the tip with a dark opening facing forward
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 1.95, 1.6, 28, 1, true), orange);
  bell.position.set(10.1, -0.7, 0);
  bell.rotation.z = -Math.PI / 2 + 0.3;
  body.add(bell);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.42, 10, 28), orange);
  lip.position.set(10.85, -0.45, 0);
  lip.rotation.y = Math.PI / 2;
  lip.rotation.x = 0.3;
  body.add(lip);
  const nostril = new THREE.Mesh(new THREE.CircleGeometry(2.4, 28), dark);
  nostril.position.set(10.55, -0.55, 0);
  nostril.rotation.y = Math.PI / 2;
  nostril.rotation.x = 0.3;
  body.add(nostril);
  // big round eyes looking forward along +x
  const eyes = [-1, 1].map(s => {
    const e = eye(2.0, 0x050505, { scaleY: 1.2 });
    e.userData.look.scale.setScalar(1.25);
    e.children[0].material.color.set(0xdedad2);
    e.position.set(3.4, 2.4, s * 2.0);
    e.rotation.y = Math.PI / 2 + s * 0.28;
    body.add(e);
    return e;
  });
  // stubby legs with big feet pointing forward
  const legs = [-1, 1].map(s => {
    const hip = new THREE.Group();
    hip.position.set(0.2, -3.6, s * 2.1);
    const leg = taper([[0, 0, 0], [0.3, -2.6, 0], [0.4, -4.2, 0]], [1.25, 1.0, 0.95], orange);
    const foot = blob(2.5, 1.05, 1.45, orange, v => 1 + 0.25 * Math.max(0, v.x));
    foot.position.set(1.4, -4.6, 0);
    hip.add(leg, foot);
    body.add(hip);
    return hip;
  });
  let yawNow = YAW.dr, hop = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      const want = YAW[obj.facing];
      let d = want - yawNow;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawNow += d * (1 - Math.exp(-dt * 18));
      yaw.rotation.y = yawNow;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.15;
      hop = damp(hop, moving ? 1 : 0, 14, dt);
      // tuck the legs and stretch the body mid-hop, squash when landing
      for (const [i, l] of legs.entries()) l.rotation.z = hop * (0.9 + 0.1 * i);
      body.scale.set(1 - hop * 0.06, 1 + hop * 0.1, 1 - hop * 0.06);
      body.position.y = hop * 1.2;
      for (const e of eyes) e.scale.y = 1.2 * (Math.sin(t * 0.9 + obj.slot) > 0.985 ? 0.15 : 1);
    },
  };
}

// ---- Coily -------------------------------------------------------------------------------------
function makeCoily() {
  const { g, yaw, body } = shell();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x8a10a8, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.4 });
  const belly = new THREE.MeshPhysicalMaterial({ color: 0xe060d0, roughness: 0.4, clearcoat: 0.4 });
  // a springy coil: helix tube, compressed or stretched every frame
  const coil = new THREE.Group();
  const pts = [];
  const turns = 3.6, steps = 80;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2;
    pts.push([Math.cos(a) * 3.6, -15.5 + (i / steps) * 14, -Math.sin(a) * 3.6]);
  }
  coil.add(taper(pts, [1.4, 1.8, 1.8, 1.65], skin, { radial: 12, seg: 140 }));
  // the turns would shadow each other into a grey blur; the coil only casts shadows
  coil.traverse(o => { o.userData.noReceive = true; });
  body.add(coil);
  // snake head: long snout with a gaping mouth and big bulging eyes
  const head = new THREE.Group();
  head.position.set(0.6, 4.5, 0);
  const skull = blob(4.6, 2.7, 3.3, skin, v => 1 + 0.12 * Math.max(0, v.x) - 0.12 * Math.max(0, -v.y));
  head.add(skull);
  const jaw = blob(3.9, 1.0, 2.8, belly, v => 1 + 0.1 * Math.max(0, v.x));
  jaw.position.set(1.2, -2.3, 0);
  jaw.rotation.z = -0.22;
  head.add(jaw);
  const mouth = blob(3.1, 0.5, 2.4, new THREE.MeshStandardMaterial({ color: 0x3a0010, roughness: 0.7 }));
  mouth.position.set(1.9, -1.55, 0);
  mouth.rotation.z = -0.12;
  head.add(mouth);
  const fangMat = glossMat(0xffffff);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.3, 8), fangMat);
    f.position.set(4.3, -1.5, s * 1.1);
    f.rotation.z = Math.PI;
    head.add(f);
  }
  const eyes = [-1, 1].map(s => {
    const e = eye(1.6, 0x050505, { scaleY: 1.2 });
    e.position.set(1.2, 2.2, s * 1.5);
    e.rotation.y = Math.PI / 2 + s * 0.3;
    e.children[0].material.color.set(0xdedad2);
    head.add(e);
    return e;
  });
  body.add(head);
  let yawNow = YAW.dl, facing = 'dl', bounce = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      facing = obj.facing || facingFrom(st, facing);
      let d = YAW[facing] - yawNow;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawNow += d * (1 - Math.exp(-dt * 12));
      yaw.rotation.y = yawNow;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.15;
      bounce = damp(bounce, moving ? 1 : 0, 10, dt);
      const spring = 1 + bounce * 0.22 + Math.sin(t * 9) * 0.04;
      coil.scale.y = spring;
      coil.position.y = (1 - spring) * -15.5;
      head.position.y = 4.5 + (spring - 1) * 14;
      head.rotation.z = Math.sin(t * 3) * 0.08;
      jaw.rotation.z = -0.22 - Math.max(0, Math.sin(t * 5)) * 0.15;
      for (const e of eyes) e.userData.look.position.x = Math.sin(t * 1.7) * 0.25;
    },
  };
}

// ---- balls (Coily's egg, red balls, green freeze ball) -------------------------------------------
function makeBall() {
  const { g, body } = shell();
  const m = glossMat(0xff2020, { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3 });
  const ball = blob(1, 1, 1, m, null, 40, 28);
  body.add(ball);
  let squash = 0;
  return {
    group: g,
    update(obj, { dt, st }) {
      setTint(m, obj.tint, 1.05);
      m.emissive.copy(m.color).multiplyScalar(obj.kind === 'green' ? 0.35 : 0.08);
      const r = obj.radius;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.15;
      squash = damp(squash, moving ? 0 : 1, 16, dt);
      ball.scale.set(r * (1 + squash * 0.08), r * (1 - squash * 0.12), r * (1 + squash * 0.08));
      ball.position.y = -squash * r * 0.12;
      ball.rotation.z -= st.vx * 0.08;
    },
  };
}

// ---- Ugg and Wrongway: purple critters that run along the sides of the cubes --------------------
function makeCritter(oneEye) {
  const { g, yaw, body } = shell();
  const fur = plushMat(0xa000b0, 0xff70ff);
  const torso = blob(4.4, 4.0, 3.9, fur, v => 1 + 0.12 * Math.sin(v.x * 9) * Math.sin(v.z * 7) * 0.4);
  body.add(torso);
  // spiky tufts
  // a shock of wild hair: tufts fanned out over the crown
  for (let i = 0; i < 9; i++) {
    const phi = (i / 8 - 0.5) * 2.4, lean = 0.5 + (i % 3) * 0.25;
    const dir = [-Math.cos(phi) * lean, 1, Math.sin(phi) * lean * 1.3];
    const tuft = taper([[0, 0, 0], [dir[0] * 1.3, 1.6, dir[2] * 1.3], [dir[0] * 2.4 + 0.4, 2.8 + (i % 2) * 0.6, dir[2] * 2.4]], [0.5, 0.3, 0.07], fur, { caps: false });
    tuft.position.set(-0.8 + Math.cos(phi) * 0.6, 3.0, Math.sin(phi) * 2.2);
    body.add(tuft);
  }
  if (oneEye) {
    const e = eye(2.7, 0x101010, { scaleY: 1.1 });
    e.position.set(2.8, 0.8, 0);
    e.rotation.y = Math.PI / 2;
    body.add(e);
  } else {
    for (const s of [-1, 1]) {
      const e = eye(1.35, 0x101010);
      e.position.set(3.3, 1.5, s * 1.5);
      e.rotation.y = Math.PI / 2 + s * 0.3;
      body.add(e);
    }
    const nose = blob(1.6, 1.2, 1.7, glossMat(0xff70c0));
    nose.position.set(4.3, -0.4, 0);
    body.add(nose);
  }
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1, fb = i % 2 ? 1 : -1;
    const hip = new THREE.Group();
    hip.position.set(fb * 1.8, -2.8, side * 2.4);
    hip.add(taper([[0, 0, 0], [fb * 1.2, -2.0, side * 0.9], [fb * 1.6, -4.0, side * 1.0]], [0.75, 0.55, 0.5], fur));
    body.add(hip);
    legs.push(hip);
  }
  let yawNow = 0, facing = 'dr';
  return {
    group: g,
    update(obj, { t, dt, st }) {
      facing = facingFrom(st, facing);
      let d = YAW[facing] - yawNow;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawNow += d * (1 - Math.exp(-dt * 12));
      yaw.rotation.y = yawNow;
      setTint(fur, obj.tint);
      const run = Math.abs(st.vx) + Math.abs(st.vy) > 0.1 ? 1 : 0.2;
      legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 16 + i * Math.PI / 2) * 0.5 * run; });
      body.position.y = Math.abs(Math.sin(t * 16)) * 0.5 * run;
    },
  };
}

// ---- Slick and Sam: green gremlins with orange crew cuts ---------------------------------------
function makeGremlin(shades) {
  const { g, yaw, body } = shell();
  const green = plushMat(0x18a020, 0x80ff80);
  const torso = blob(4.2, 4.8, 4.0, green, v => 1 - 0.08 * Math.max(0, v.y));
  body.add(torso);
  const hairMat = plushMat(0xff7a10, 0xffc070);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 8), hairMat);
    spike.position.set(Math.cos(a) * 1.8 - 0.4, 4.6, Math.sin(a) * 1.8);
    spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    body.add(spike);
  }
  const top = blob(2.6, 1.0, 2.6, hairMat);
  top.position.set(-0.3, 4.1, 0);
  body.add(top);
  if (shades) {
    const lens = new THREE.MeshPhysicalMaterial({ color: 0x050508, roughness: 0.05, metalness: 0.4, clearcoat: 1 });
    for (const s of [-1, 1]) {
      const l = blob(0.6, 1.1, 1.4, lens);
      l.position.set(3.9, 1.6, s * 1.5);
      body.add(l);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 4.6), lens);
    bridge.position.set(3.95, 1.9, 0);
    body.add(bridge);
  } else {
    for (const s of [-1, 1]) {
      const e = eye(1.45, 0x101010, { scaleY: 1.25 });
      e.position.set(3.2, 1.6, s * 1.5);
      e.rotation.y = Math.PI / 2 + s * 0.3;
      body.add(e);
    }
  }
  const mouth = taper([[4.0, -0.9, -1.2], [4.25, -1.3, 0], [4.0, -0.9, 1.2]], [0.25, 0.25], new THREE.MeshStandardMaterial({ color: 0x0a2008 }));
  body.add(mouth);
  const legs = [-1, 1].map(s => {
    const hip = new THREE.Group();
    hip.position.set(0, -3.8, s * 1.7);
    hip.add(taper([[0, 0, 0], [0.2, -2.6, 0]], [0.9, 0.8], green));
    const foot = blob(1.8, 0.8, 1.1, green);
    foot.position.set(0.9, -3.0, 0);
    hip.add(foot);
    body.add(hip);
    return hip;
  });
  let yawNow = 0, facing = 'dr', hop = 0;
  return {
    group: g,
    update(obj, { dt, st }) {
      facing = facingFrom(st, facing);
      let d = YAW[facing] - yawNow;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yawNow += d * (1 - Math.exp(-dt * 12));
      yaw.rotation.y = yawNow;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.15;
      hop = damp(hop, moving ? 1 : 0, 14, dt);
      for (const l of legs) l.rotation.z = hop * 0.8;
      body.scale.set(1, 1 + hop * 0.08, 1);
    },
  };
}

// ---- escape disc ----------------------------------------------------------------------------------
function makeDisc() {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = QB_TILT;
  g.add(tilt);
  const spin = new THREE.Group();
  tilt.add(spin);
  const cols = [0xff2a2a, 0xffd21a, 0x22c040, 0x3a6aff];
  for (let i = 0; i < 4; i++) {
    const m = glossMat(cols[i], { roughness: 0.2, emissive: cols[i], emissiveIntensity: 0.25 });
    const q = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 1.6, 12, 1, false, i * Math.PI / 2, Math.PI / 2), m);
    spin.add(q);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.0, 20), glossMat(0xffffff));
  spin.add(hub);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.45, 8, 48), new THREE.MeshStandardMaterial({ color: 0x9ad8e0, metalness: 0.8, roughness: 0.2 }));
  rim.rotation.x = Math.PI / 2;
  spin.add(rim);
  const glow = new THREE.Mesh(new THREE.RingGeometry(5, 10, 40), new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -1.6;
  glow.userData.noShadow = true;
  tilt.add(glow);
  return {
    group: g,
    light: true,
    update(obj, { t }) {
      spin.rotation.y = t * 6;
      spin.position.y = Math.sin(t * 3 + obj.slot) * 0.6;
      glow.material.opacity = 0.25 + 0.15 * Math.sin(t * 7);
    },
  };
}

// ---- classification ------------------------------------------------------------------------------
function kindOf(code) {
  if (code >= 0xcc && code <= 0xd3) return 'qbert';
  if (code >= 0xd4 && code <= 0xd9) return 'ball';
  if (code >= 0xda && code <= 0xe1) return 'ugg';
  if (code >= 0xe2 && code <= 0xe9) return 'wrongway';
  if (code >= 0xea && code <= 0xf1) return 'slick';
  if (code >= 0xf2 && code <= 0xf9) return 'sam';
  if (code >= 0xfa && code <= 0xfd) return 'disc';
  return null;
}

export function qbRigSet(view) {
  return {
    scale: 1.0,
    classify(sprites) {
      const objects = [], rest = [];
      // Coily is two sprites: a head (0xbd-0xc3) above a coil (0xc4-0xcb); pair them up
      const coils = sprites.filter(s => s.code >= 0xc4 && s.code <= 0xcb);
      const paired = new Set();
      for (const s of sprites) {
        if (s.code < 0xbc || s.code > 0xc3) continue;
        const body = coils.find(c => !paired.has(c) && Math.abs(c.x - s.x) <= 2 && Math.abs(c.y - (s.y + 16)) <= 2);
        const parts = body ? [s, body] : [s];
        if (body) paired.add(body);
        paired.add(s);
        const bb = bboxOf(parts);
        if (bb.x1 < bb.x0) continue;
        objects.push({ type: 'coily', id: `coily${s.slot}`, ...bb, code: s.code, slot: s.slot, z: qbSurfaceZ(bb.y1 + 1) + 7,
          tint: dominantColor(view, parts), facing: QB_FACING[((s.code - 0xbc) >> 1) & 3] });
      }
      for (const s of sprites) {
        if (paired.has(s)) continue;
        const type = kindOf(s.code);
        if (!type) { rest.push(s); continue; }
        const bb = bboxOf([s]);
        if (bb.x1 < bb.x0) continue;
        // sprites parked off the edge of the picture are not in play
        const mx = (bb.x0 + bb.x1) / 2, my = (bb.y0 + bb.y1) / 2;
        if (mx < 2 || my < 2 || mx > 238 || my > 246) continue;
        // stand on the pyramid surface under the sprite's feet, a little in front of it
        const z = qbSurfaceZ(bb.y1 + 1) + (type === 'disc' ? 2 : 7);
        const o = { type, id: `${type}${s.slot}`, ...bb, code: s.code, slot: s.slot, z, tint: dominantColor(view, [s]) };
        if (type === 'qbert') { o.facing = QB_FACING[(s.code - 0xcc) >> 1]; o.player = true; o.id = 'qbert'; }
        if (type === 'ball') {
          o.kind = s.code >= 0xd8 ? 'green' : s.code >= 0xd6 ? 'red' : 'egg';
          o.radius = Math.max(3, Math.min(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1) / 2 + 0.6);
        }
        objects.push(o);
      }
      return { objects, rest };
    },
    create(type) {
      switch (type) {
        case 'qbert': return makeQbert();
        case 'coily': return makeCoily();
        case 'ball': return makeBall();
        case 'ugg': return makeCritter(false);
        case 'wrongway': return makeCritter(true);
        case 'slick': return makeGremlin(true);
        case 'sam': return makeGremlin(false);
        default: return makeDisc();
      }
    },
  };
}
