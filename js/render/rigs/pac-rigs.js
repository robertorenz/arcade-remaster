// Hand-built 3D models for Ms. Pac-Man ("Redrawn" mode).
import * as THREE from 'three';
import { mat, sphere, box, dominantColor, bboxOf } from './rig-layer.js';

function makeMsPac() {
  const g = new THREE.Group();
  const face = new THREE.Group();
  g.add(face);
  const yellow = mat(0xffd21f, { roughness: 0.35, clearcoat: 0.8 });
  const inner = new THREE.MeshStandardMaterial({ color: 0x5a0a12, roughness: 0.8, side: THREE.DoubleSide });
  const R = 6.6;
  // two hinged hemispheres make the chomping jaws (mouth opens toward +x)
  const jaw = up => {
    const j = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2), yellow);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 32), inner);
    cap.rotation.x = up ? Math.PI / 2 : -Math.PI / 2;
    j.add(shell, cap);
    face.add(j);
    return j;
  };
  const upper = jaw(true), lower = jaw(false);
  // bow
  const red = mat(0xe8203a, { clearcoat: 0.8 });
  const bow = new THREE.Group();
  for (const s of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.6, 16), red);
    lobe.rotation.z = s * Math.PI / 2;
    lobe.position.x = s * 1.8;
    bow.add(lobe);
  }
  const knot = sphere(1.1, red);
  bow.add(knot);
  bow.position.set(-2.6, 5.6, 1.4);
  bow.rotation.z = 0.5;
  upper.add(bow);
  // eye with lashes, lipstick, beauty mark
  const eye = sphere(1.1, mat(0x101018)); eye.position.set(1.8, 3.2, 5.1); eye.scale.set(1, 1.3, 0.6);
  const lash = box(2.4, 0.35, 0.4, mat(0x101018)); lash.position.set(1.9, 4.8, 4.9); lash.rotation.z = -0.25;
  upper.add(eye, lash);
  const lip = sphere(0.9, red); lip.position.set(5.6, 0.6, 2.8); lip.scale.set(1.3, 0.6, 0.8);
  upper.add(lip);
  const lipLow = sphere(0.9, red); lipLow.position.set(5.6, -0.6, 2.8); lipLow.scale.set(1.3, 0.6, 0.8);
  lower.add(lipLow);
  const mole = sphere(0.35, mat(0x2a1a10)); mole.position.set(4.6, -2.4, 4.4);
  lower.add(mole);

  let chomp = 0;
  return {
    group: g,
    update(obj, { t, dt, st }) {
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.05;
      const target = moving ? 0.25 + 0.25 * Math.sin(t * 26) : 0.35;
      chomp += (target - chomp) * Math.min(1, dt * 30);
      upper.rotation.z = chomp;
      lower.rotation.z = -chomp;
      // face the direction of travel (screen space)
      const ax = Math.abs(st.vx), ay = Math.abs(st.vy);
      if (ax >= ay) { face.rotation.set(0, 0.35, 0); face.scale.x = st.vx < 0 ? -1 : 1; }
      else { face.scale.x = 1; face.rotation.set(0, 0.35, st.vy < 0 ? Math.PI / 2 : -Math.PI / 2); }
    },
  };
}

function ghostBodyGeometry() {
  // lathe profile: dome on top, straight sides, wavy hem added in update
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.sin(a) * 6.4, 1.6 + Math.cos(a) * 5.2));
  }
  pts.push(new THREE.Vector2(6.4, -4.6));
  pts.push(new THREE.Vector2(6.0, -6.2));
  const geo = new THREE.LatheGeometry(pts.reverse(), 36);
  return geo;
}

function makeGhost() {
  const g = new THREE.Group();
  const bodyMat = mat(0xff2020, { roughness: 0.4, clearcoat: 0.35 });
  const geo = ghostBodyGeometry();
  const base = geo.attributes.position.array.slice();
  const body = new THREE.Mesh(geo, bodyMat);
  const white = mat(0xffffff, { clearcoat: 0.2 }), blue = mat(0x1020c8);
  const eyes = [-1, 1].map(x => {
    const e = sphere(1.9, white); e.position.set(x * 2.4, 2.2, 5.6); e.scale.set(1, 1.3, 0.75);
    const p = sphere(1.0, blue); p.position.z = 1.2; e.add(p);
    g.add(e);
    return { e, p };
  });
  // frightened face
  const scared = new THREE.Group();
  const peach = mat(0xffb8a0);
  for (const x of [-1, 1]) { const d = sphere(0.8, peach); d.position.set(x * 2.2, 2, 5.6); scared.add(d); }
  for (let i = 0; i < 5; i++) { const seg = box(1.6, 0.45, 0.4, peach); seg.position.set(-3.2 + i * 1.6, -1.6 + (i % 2) * 0.7, 5.6); seg.rotation.z = i % 2 ? -0.5 : 0.5; scared.add(seg); }
  g.add(body, scared);
  return {
    group: g,
    update(obj, { t, st }) {
      const frightened = obj.frightened;
      const moving = Math.abs(st.vx) + Math.abs(st.vy) > 0.05;
      const look = moving ? (Math.abs(st.vx) >= Math.abs(st.vy) ? [Math.sign(st.vx), 0] : [0, -Math.sign(st.vy)]) : obj.look;
      body.visible = !obj.eyesOnly;
      bodyMat.color.setRGB(obj.tint[0] / 255, obj.tint[1] / 255, obj.tint[2] / 255, THREE.SRGBColorSpace);
      scared.visible = frightened && !obj.eyesOnly;
      for (const { e, p } of eyes) {
        e.visible = !frightened || obj.eyesOnly;
        const [dx, dy] = look;
        p.position.set(dx * 0.7, dy * 0.8, 1.2);
        e.rotation.y = dx * 0.25;
      }
      // wavy hem
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y0 = base[i * 3 + 1];
        if (y0 < -4) {
          const a = Math.atan2(base[i * 3 + 2], base[i * 3]);
          pos.array[i * 3 + 1] = y0 + Math.sin(a * 6 + t * 12) * 0.9 - 0.4;
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
    classify(sprites) {
      const objects = [], rest = [];
      for (const s of sprites) {
        const bb = bboxOf([s]);
        if (s.slot === 4 && (s.code >= 0x2c || s.code === 0x0f)) {
          objects.push({ type: 'mspac', id: 'mspac', ...bb, code: s.code, z: 6, player: true });
        } else if (s.slot < 4 && ((s.code >= 0x20 && s.code <= 0x27) || s.code === 0x1c || s.code === 0x1d)) {
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
