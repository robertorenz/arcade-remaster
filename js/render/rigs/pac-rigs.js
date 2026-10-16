// Hand-built 3D models for Ms. Pac-Man ("Redrawn" mode).
import * as THREE from 'three';
import { bboxOf, dominantColor } from './rig-layer.js';
import { blob, taper, eye, glossMat, damp } from './sculpt.js';

function makeBow() {
  const red = glossMat(0xe0102e, { clearcoat: 1, sheen: 0.4, sheenColor: new THREE.Color(0xff8090) });
  const bow = new THREE.Group();
  for (const s of [-1, 1]) {
    // each loop is a pinched teardrop pointing at the knot
    const lobe = blob(2.3, 1.7, 1.1, red, v => 1 - 0.45 * Math.max(0, -v.x * s) ** 2 + 0.08 * Math.max(0, v.x * s));
    lobe.position.x = s * 2.0;
    lobe.rotation.z = s * 0.12;
    bow.add(lobe);
    const tail = taper([[s * 0.3, -0.4, 0.2], [s * 1.0, -2.0, 0.4], [s * 1.6, -3.0, 0.2]], [0.55, 0.5, 0.25], red);
    bow.add(tail);
  }
  bow.add(blob(0.95, 1.05, 0.9, red));
  return bow;
}

function makeMsPac() {
  const g = new THREE.Group();
  const face = new THREE.Group();
  g.add(face);
  const yellow = glossMat(0xffcc12, { sheen: 0.6, sheenColor: new THREE.Color(0xffee88), roughness: 0.3 });
  const mouthMat = new THREE.MeshPhysicalMaterial({ color: 0x4a0612, roughness: 0.6, side: THREE.DoubleSide });
  const tongue = new THREE.MeshPhysicalMaterial({ color: 0xd84060, roughness: 0.4, clearcoat: 0.6 });
  const R = 6.6;
  // two hinged hemispheres make the chomping jaws (mouth opens toward +x)
  const jaw = up => {
    const j = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2), yellow);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.985, 48), mouthMat);
    cap.rotation.x = up ? Math.PI / 2 : -Math.PI / 2;
    j.add(shell, cap);
    face.add(j);
    return j;
  };
  const upper = jaw(true), lower = jaw(false);
  const tng = blob(3.2, 0.7, 2.6, tongue); tng.position.set(2.2, 0.15, 0);
  lower.add(tng);
  const bow = makeBow();
  bow.position.set(-1.6, 6.3, 1.8);
  bow.rotation.set(0.25, 0, 0.45);
  upper.add(bow);
  // eye with lashes looking forward, lipstick, beauty mark
  const e = eye(1.45, 0x2a5ad0, { scaleY: 1.3 });
  e.position.set(2.0, 3.1, 5.0); e.rotation.y = 0.55;
  upper.add(e);
  const lashMat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.5;
    const l = taper([[0, 0, 0], [Math.sin(a) * 1.0, 1.0, 0.2], [Math.sin(a) * 1.6, 1.5, 0.5]], [0.2, 0.15, 0.05], lashMat, { caps: false });
    l.position.set(2.2 + Math.sin(a) * 0.9, 4.7, 5.0);
    upper.add(l);
  }
  const lipMat = glossMat(0xe0103a);
  const lipU = blob(1.25, 0.55, 0.95, lipMat); lipU.position.set(6.1, 0.5, 2.6); lipU.rotation.y = 0.6;
  const lipL = blob(1.25, 0.6, 0.95, lipMat); lipL.position.set(6.1, -0.55, 2.6); lipL.rotation.y = 0.6;
  upper.add(lipU); lower.add(lipL);
  const mole = blob(0.38, 0.38, 0.2, new THREE.MeshStandardMaterial({ color: 0x2a1408 })); mole.position.set(4.3, -2.6, 4.9);
  lower.add(mole);

  let chomp = 0, turnY = 0, roll = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.05;
      const target = moving ? 0.28 + 0.28 * Math.sin(t * 24) : 0.3;
      chomp = damp(chomp, target, 30, dt);
      upper.rotation.z = chomp;
      lower.rotation.z = -chomp;
      // face the direction of travel; tilt a little toward the camera so the face shows
      const ax = Math.abs(st.vx), ay = Math.abs(st.vy);
      let want = roll;
      if (moving) {
        if (ax >= ay) { want = 0; face.scale.x = st.vx < 0 ? -1 : 1; }
        else { want = st.vy < 0 ? Math.PI / 2 : -Math.PI / 2; face.scale.x = 1; }
      }
      roll = want;
      turnY = damp(turnY, 0.4, 8, dt);
      face.rotation.set(0, turnY * face.scale.x, roll * face.scale.x);
      g.position.z += Math.abs(Math.sin(t * 12)) * 0.3 * (moving ? 1 : 0);
    },
  };
}

function ghostBodyGeometry() {
  // lathe profile: dome on top, straight sides, wavy hem animated in update
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.sin(a) * 6.4, 1.6 + Math.cos(a) * 5.4));
  }
  pts.push(new THREE.Vector2(6.5, -3.0));
  pts.push(new THREE.Vector2(6.6, -4.8));
  pts.push(new THREE.Vector2(6.2, -6.2));
  return new THREE.LatheGeometry(pts.reverse(), 48);
}

function makeGhost() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xff2020, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.6, emissive: 0x000000, transparent: true, opacity: 0.94 });
  const geo = ghostBodyGeometry();
  const base = geo.attributes.position.array.slice();
  const body = new THREE.Mesh(geo, bodyMat);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false }));
  inner.position.y = 0.5;
  inner.userData.noShadow = true;
  const white = glossMat(0xffffff), blue = glossMat(0x1830d8);
  const eyes = [-1, 1].map(x => {
    const e = blob(1.95, 2.4, 1.3, white); e.position.set(x * 2.4, 2.4, 5.4);
    const p = blob(1.05, 1.05, 0.6, blue); p.position.z = 1.0; e.add(p);
    g.add(e);
    return { e, p };
  });
  // frightened face: small peach eyes and a zig-zag mouth
  const scared = new THREE.Group();
  const peach = glossMat(0xffc0a8);
  for (const x of [-1, 1]) { const d = blob(0.85, 0.85, 0.5, peach); d.position.set(x * 2.2, 2.2, 5.9); scared.add(d); }
  const zz = [];
  for (let i = 0; i <= 6; i++) zz.push([-3.6 + i * 1.2, -1.4 + (i % 2) * 0.9, 6.0]);
  scared.add(taper(zz, [0.35, 0.35], peach));
  g.add(body, inner, scared);
  const tint = new THREE.Color();
  return {
    group: g,
    update(obj, { t, st }) {
      const frightened = obj.frightened;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.05;
      const look = moving ? (Math.abs(st.vx) >= Math.abs(st.vy) ? [Math.sign(st.vx), 0] : [0, -Math.sign(st.vy)]) : obj.look;
      body.visible = inner.visible = !obj.eyesOnly;
      tint.setRGB(obj.tint[0] / 255, obj.tint[1] / 255, obj.tint[2] / 255, THREE.SRGBColorSpace);
      bodyMat.color.copy(tint);
      bodyMat.emissive.copy(tint).multiplyScalar(0.22);
      inner.material.color.copy(tint);
      scared.visible = frightened && !obj.eyesOnly;
      for (const { e, p } of eyes) {
        e.visible = !frightened || obj.eyesOnly;
        const [dx, dy] = look;
        p.position.set(dx * 0.75, dy * 0.95, 1.0);
        e.rotation.y = dx * 0.25;
      }
      g.position.y += Math.sin(t * 5 + obj.slot) * 0.5;
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y0 = base[i * 3 + 1];
        if (y0 < -4.5) {
          const a = Math.atan2(base[i * 3 + 2], base[i * 3]);
          pos.array[i * 3 + 1] = y0 + Math.sin(a * 7 + t * 12) * 0.9 - 0.4;
        }
      }
      pos.needsUpdate = true;
    },
  };
}

// ghost sprite codes 0x20-0x27: pairs of animation frames looking right, down, left, up
const LOOK = [[1, 0], [0, -1], [-1, 0], [0, 1]];

export function pacRigSet(view) {
  return {
    scale: 1.25,
    classify(sprites) {
      const objects = [], rest = [];
      for (const s of sprites) {
        const bb = bboxOf([s]);
        if (s.slot === 5 && (s.code >= 0x2c || s.code === 0x0f)) {
          objects.push({ type: 'mspac', id: 'mspac', ...bb, code: s.code, z: 6, player: true });
        } else if (s.slot >= 1 && s.slot <= 4 && ((s.code >= 0x20 && s.code <= 0x27) || s.code === 0x1c || s.code === 0x1d)) {
          let opaque = 0;
          for (const p of s.pixels) if (p) opaque++;
          const frightened = s.code === 0x1c || s.code === 0x1d;
          const look = frightened ? [0, 0] : LOOK[(s.code - 0x20) >> 1];
          objects.push({ type: 'ghost', id: `ghost${s.slot}`, ...bb, code: s.code, slot: s.slot, z: 6, frightened, eyesOnly: opaque < 70, look, tint: dominantColor(view, [s]) });
        } else rest.push(s);
      }
      return { objects, rest };
    },
    create(type) { return type === 'mspac' ? makeMsPac() : makeGhost(); },
  };
}
