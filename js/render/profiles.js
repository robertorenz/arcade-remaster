// Per-game remaster profiles: how tiles become 3D, materials, lighting and the backdrop theme.
import * as THREE from 'three';
import { buildConstruction } from './themes/construction.js';
import { buildJungle } from './themes/jungle.js';
import { buildMoon } from './themes/moon.js';
import { buildNeon } from './themes/neon.js';
import { buildCavern } from './themes/cavern.js';
import { dkRigSet } from './rigs/dk-rigs.js';
import { pacRigSet } from './rigs/pac-rigs.js';

function hudMaterial() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  m.userData.castShadow = false;
  return m;
}

function dkongProfile(view) {
  const materials = {
    girder: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.34, envMapIntensity: 0.7 }),
    ladder: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.28, envMapIntensity: 0.8 }),
    hud: hudMaterial(),
    art: view.materials.art,
  };
  return {
    materials,
    backdrop: buildConstruction,
    rigs: dkRigSet,
    maskSprites: true,       // the game hides ladder tops with all-black sprites
    skipBlackTiles: true,    // black tile pixels are background on this hardware
    inflate: { thickness: 0.8, minDepth: 5, maxDepth: 22 },
    spriteZ: kind => (kind === 'hud' ? 12 : 1),
    // steel pixels used to find beam slopes (ladder pixels excluded)
    slopePixel: (t, p) => t.kind === 'struct' && p !== 3,
    // flange rows (full-width steel lines) span the girder's whole depth; the rest is a truss
    tileContext(t) {
      if (t.kind !== 'struct') return null;
      const flange = new Uint8Array(t.h);
      for (let y = 0; y < t.h; y++) {
        let full = true;
        for (let x = 0; x < t.w; x++) {
          const p = t.pixels[y * t.w + x];
          if (!p || p === 3) { full = false; break; }
        }
        flange[y] = full ? 1 : 0;
      }
      return flange;
    },
    classifyTile(t, x, y, p, color, flange) {
      switch (t.kind) {
        case 'hud': return [{ group: 'hud', z0: -1, z1: 1.5, color }];
        case 'art': return [{ group: 'art', z0: -3, z1: 3, color }];
        default:
          if (p === 3) return [{ group: 'ladder', z0: -1.6, z1: 1.6, color }];
          if (flange[y]) return [{ group: 'girder', z0: -9, z1: 9, color }];
          return [{ group: 'girder', z0: 6.5, z1: 9, color }, { group: 'girder', z0: -9, z1: -6.5, color }];
      }
    },
  };
}

// Taito SJ (Jungle King): three playfields + sprites whose stacking order is chosen by the
// game every frame. Each plane sits at its own depth; the topmost is nearest the viewer.
function junglekProfile() {
  const LAYER_GAP = 14;
  const materials = {
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.35 }),
  };
  const zOf = pos => (pos - 3) * LAYER_GAP;
  return {
    materials,
    backdrop: buildJungle,
    clip: true,
    margin: 0.56,
    cameraTilt: 34,
    inflate: { thickness: 0.75, minDepth: 4, maxDepth: 18 },
    lighting: {
      hemiSky: 0xe6f6ff, hemiGround: 0x4d3d1f, hemiIntensity: 1.25,
      sunColor: 0xfff0cf, sunIntensity: 2.1, sunPos: [-200, 300, 260],
      rimColor: 0x9fe6b0, rimIntensity: 0.45, exposure: 1.05, bloomStrength: 0.3, bloomThreshold: 0.96,
    },
    layerZ: (id, scene) => zOf(scene.order ? scene.order.indexOf(id) : 3),
    spriteZ: (kind, order) => zOf(order ?? 3) + 1,
    classifyTile(t, x, y, p, color) {
      return [{ group: 'foliage', z0: -2, z1: 2, color }];
    },
  };
}

// Irem M52 (Moon Patrol): distant mountains, nearer hills/city, the character layer (HUD panel,
// lunar road) and sprites, each at increasing depth for real parallax.
function mpatrolProfile() {
  const materials = {
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, flatShading: true, envMapIntensity: 0.25 }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.3 }),
    tile: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }),
    panel: hudMaterial(),
  };
  const LAYER_Z = { 1: -140, 2: -75, 3: 0 };
  return {
    materials,
    backdrop: buildMoon,
    clip: true,
    margin: 0.56,
    cameraTilt: 40,
    inflate: { thickness: 0.75, minDepth: 4, maxDepth: 18 },
    lighting: {
      hemiSky: 0x9fb4cc, hemiGround: 0x2a2622, hemiIntensity: 0.75,
      sunColor: 0xfff4e2, sunIntensity: 2.6, sunPos: [260, 220, 240],
      rimColor: 0x7fb8ff, rimIntensity: 0.7, exposure: 1.0, bloomStrength: 0.35, bloomThreshold: 0.93,
    },
    layerZ: id => LAYER_Z[id] ?? 0,
    spriteZ: () => 2,
    classifyTile(t, x, y, p, color) {
      switch (t.kind) {
        case 'mountain': return [{ group: 'rock', z0: -10, z1: 6, color }];
        case 'hill': return [{ group: 'rock', z0: -7, z1: 5, color }];
        case 'ground': return [{ group: 'ground', z0: -16, z1: 16, color }];
        case 'panel': return [{ group: 'panel', z0: -1, z1: 1.5, color }];
        default: return [{ group: 'tile', z0: -2, z1: 2, color }];
      }
    },
  };
}

// Ms. Pac-Man: glossy candy-coloured maze walls on a floating board, glowing dots.
function mspacmanProfile() {
  const materials = {
    wall: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.3 }),
    dot: hudMaterial(),
    hud: hudMaterial(),
  };
  materials.dot.userData.castShadow = true;
  return {
    materials,
    backdrop: buildNeon,
    rigs: pacRigSet,
    cameraTilt: 70,
    margin: 0.54,
    inflate: { thickness: 0.9, minDepth: 5, maxDepth: 20 },
    lighting: {
      hemiSky: 0xb9d4ff, hemiGround: 0x101624, hemiIntensity: 0.6,
      sunColor: 0xffffff, sunIntensity: 1.6, sunPos: [-140, 200, 320],
      rimColor: 0x48c8ff, rimIntensity: 1.0, exposure: 0.9, bloomStrength: 0.35, bloomThreshold: 0.95,
    },
    spriteZ: kind => (kind === 'hud' ? 8 : 5),
    classifyTile(t, x, y, p, color) {
      switch (t.kind) {
        case 'wall': return [{ group: 'wall', z0: -2, z1: 7, color }];
        case 'dot': return [{ group: 'dot', z0: 0, z1: 2.5, color }];
        default: return [{ group: 'hud', z0: -1, z1: 1.5, color }];
      }
    },
  };
}

// Joust: the bitmap is split into scenery (rock ledges, lava) and blitter-drawn riders.
function joustProfile() {
  const materials = {
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.3 }),
    lava: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
  materials.lava.userData.castShadow = false;
  return {
    materials,
    backdrop: buildCavern,
    margin: 0.55,
    cameraTilt: 45,
    inflate: { thickness: 0.8, minDepth: 4, maxDepth: 16 },
    lighting: {
      hemiSky: 0x7a8aa8, hemiGround: 0x5a2010, hemiIntensity: 0.55,
      sunColor: 0xffe2c4, sunIntensity: 1.7, sunPos: [-160, 260, 280],
      rimColor: 0xff6a20, rimIntensity: 1.4, exposure: 1.0, bloomStrength: 0.5, bloomThreshold: 0.88,
    },
    spriteZ: () => 3,
    classifyTile(t, x, y, p, color) {
      if (t.kind === 'lava') return [{ group: 'lava', z0: -6, z1: 6, color }];
      return [{ group: 'rock', z0: -7, z1: 7, color }];
    },
  };
}

const PROFILES = { dkong: dkongProfile, junglek: junglekProfile, mpatrolw: mpatrolProfile, mspacman: mspacmanProfile, joust: joustProfile };

export function getProfile(id, view) {
  const make = PROFILES[id];
  if (!make) throw new Error(`No remaster profile for ${id}`);
  return make(view);
}

export function registerProfile(id, factory) { PROFILES[id] = factory; }
