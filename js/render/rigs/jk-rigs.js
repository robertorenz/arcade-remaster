// Jungle King "Redrawn" models. The hero (two stacked hardware sprites) becomes a sculpted jungle
// man who hangs, runs, leaps and swims; the vine (a chain of thin sprites) becomes a leafy rope
// that swings through the same points as the arcade's.
import * as THREE from 'three';
import { bboxOf, canvasTexture } from './rig-layer.js';
import { blob, taper, eye, joint, damp, skinMat } from './sculpt.js';

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

const opaqueCount = s => { let n = 0; for (const p of s.pixels) if (p) n++; return n; };

export function jkRigSet(view) {
  return {
    scale: 1.05,
    classify(sprites) {
      const objects = [], rest = [];
      const bySlot = new Map(sprites.map(s => [s.slot, s]));
      const a = bySlot.get(0), b = bySlot.get(1);
      const hero = a && b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 20 ? [a, b] : null;
      // vines: chains of thin sprites in consecutive slots that touch one another
      const thin = sprites.filter(s => s.slot >= 2 && opaqueCount(s) <= 70).map(s => ({ s, bb: bboxOf([s]) }))
        .filter(o => o.bb.y1 - o.bb.y0 >= 6).sort((p, q) => p.s.slot - q.s.slot);
      const chains = [];
      for (const o of thin) {
        const c = chains[chains.length - 1];
        const last = c && c[c.length - 1];
        const touching = last && o.s.slot === last.s.slot + 1 &&
          o.bb.x0 <= last.bb.x1 + 6 && o.bb.x1 >= last.bb.x0 - 6 && o.bb.y0 <= last.bb.y1 + 6 && o.bb.y1 >= last.bb.y0 - 6;
        if (touching) c.push(o); else chains.push([o]);
      }
      const vines = chains.filter(c => c.length >= 2).map(c => c.map(o => o.s));
      const ends = s => {
        let top = null, bot = null;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          if (!s.pixels[y * 16 + x]) continue;
          if (!top) top = [s.x + x + 0.5, s.y + y + 0.5];
          bot = [s.x + x + 0.5, s.y + y + 0.5];
        }
        return [top, bot];
      };
      const vinePts = [];
      vines.forEach((vine, vi) => {
        const bb = bboxOf(vine);
        const cx = (bb.x0 + bb.x1 + 1) / 2, cy = (bb.y0 + bb.y1 + 1) / 2;
        const segs = vine.map(ends).filter(e => e[0]).sort((p, q) => p[0][1] - q[0][1]);
        const pts = segs.map(e => e[0]);
        if (segs.length) pts.push(segs[segs.length - 1][1]);
        vinePts.push(pts);
        objects.push({ type: 'vine', id: `vine${vi}`, ...bb, points: pts.map(([x, y]) => [x - cx, cy - y]), z: view.profile.spriteZ('other', vine[0].order) - 0.5 });
      });
      if (hero) {
        const bb = bboxOf(hero);
        const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
        let mode = 'idle', angle = 0;
        const top = [(bb.x0 + bb.x1) / 2, bb.y0];
        for (const pts of vinePts) {
          // hanging when the hands are at the end of a vine
          const end = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 3)];
          if (Math.hypot(end[0] - top[0], end[1] - top[1]) < 16) {
            mode = 'hang';
            angle = -Math.atan2(end[0] - prev[0], end[1] - prev[1]);
          }
        }
        if (mode === 'idle' && w > h + 4) mode = 'swim';
        objects.push({ type: 'hero', id: 'hero', ...bb, mode, angle, flipx: hero[0].flipx, z: view.profile.spriteZ('other', hero[0].order), player: true });
      }
      const used = new Set([...(hero || []), ...vines.flat()]);
      for (const s of sprites) if (!used.has(s)) rest.push(s);
      return { objects, rest };
    },
    create(type) { return type === 'hero' ? makeHero() : makeVine(); },
  };
}

// motion state is derived in the rig from velocity; refine 'idle' into run/jump there
export function heroMode(obj, st) {
  if (obj.mode !== 'idle') return obj.mode;
  if (Math.abs(st.vy) > 0.35) return 'jump';
  if (Math.abs(st.vx) > 0.12) return 'run';
  return 'idle';
}
