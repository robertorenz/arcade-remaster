// Per-game remaster profiles: how tiles become 3D, materials, lighting and the backdrop theme.
import * as THREE from 'three';
import { buildConstruction } from './themes/construction.js';
import { buildJungle } from './themes/jungle.js';
import { buildMoon } from './themes/moon.js';
import { buildNeon } from './themes/neon.js';
import { buildCavern } from './themes/cavern.js';
import { dkRigSet } from './rigs/dk-rigs.js';
import { pacRigSet } from './rigs/pac-rigs.js';
import { dkStructures } from './structures/dk-structs.js';
import { pacStructures } from './structures/pac-structs.js';
import { joustStructures } from './structures/joust-structs.js';
import { joustRigSet } from './rigs/joust-rigs.js';
import { mpRigSet } from './rigs/mp-rigs.js';
import { mpStructures } from './structures/mp-structs.js';
import { jkRigSet } from './rigs/jk-rigs.js';
import { buildCosmos } from './themes/cosmos.js';
import { qbRigSet } from './rigs/qbert-rigs.js';
import { qbStructures } from './structures/qbert-structs.js';

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
    structures: dkStructures,
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
function junglekProfile(view) {
  const LAYER_GAP = 14;
  const materials = {
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.35 }),
  };
  const redrawn = view.style === 'redrawn';
  let water = null;
  if (redrawn) {
    materials.leaf = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, clearcoat: 0.2, sheen: 0.3, sheenColor: new THREE.Color(0x3a6020), envMapIntensity: 0.3 });
    materials.bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true, envMapIntensity: 0.25 });
    materials.ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, envMapIntensity: 0.25 });
    // water: glossy, slightly see-through, and rippling (vertex waves driven by a time uniform)
    water = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9, envMapIntensity: 0.5 });
    water.userData.castShadow = false;
    water.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 };
      water.userData.shader = sh;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
        #else
          vec4 wp = vec4(transformed, 1.0);
        #endif
        transformed.z += sin(wp.x * 0.16 + uTime * 2.0) * 1.1 + sin(wp.y * 0.21 - uTime * 1.4) * 0.8;`);
    };
    materials.water = water;
  }
  // deterministic per-pixel jitter (tile geometry is cached by content, so hash local coords)
  const jit = (t, x, y, k = 0) => {
    let h = Math.imul((t.code | 0) + 0x9e37 * k, 2654435761) ^ Math.imul(x + 1, 40503) ^ Math.imul(y + 7, 9973);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h ^ (h >>> 13)) & 0xffff) / 65535;
  };
  const redrawnTile = (t, x, y, p, c) => {
    const [r, g, b] = c;
    const sum = r + g + b;
    if (sum > 2.2) return [{ group: 'foliage', z0: -2, z1: 2, color: c }];   // text and highlights
    if (b > r * 1.15 && b > g * 1.05 && sum > 0.25) {
      const k = 0.72 + 0.16 * jit(t, x, y);
      return [{ group: 'water', z0: -1, z1: 1, color: [r * k, g * k, b * k] }];
    }
    if (g > r * 1.1 && g > b) {
      // foliage: every pixel a leaf of its own depth, so canopies read as bushy clumps
      const d = 2 + jit(t, x, y) * 6;
      const k = 0.75 + 0.45 * jit(t, x, y, 1);
      return [{ group: 'leaf', z0: -d, z1: d * 0.7, color: [r * k, g * k, b * k] }];
    }
    if (r > g && g > b * 1.2 && sum < 1.6) {
      // bark: vertical grain stripes and deep relief
      const k = 0.7 + 0.35 * (0.5 + 0.5 * Math.sin(x * 1.9 + jit(t, x, 0) * 6)) * (0.8 + 0.2 * jit(t, x, y));
      return [{ group: 'bark', z0: -5 - jit(t, x, y, 2) * 1.5, z1: 5, color: [r * k, g * k, b * k] }];
    }
    const k = 0.7 + 0.24 * jit(t, x, y, 3);
    return [{ group: 'ground', z0: -4, z1: 3 + jit(t, x, y, 4) * 1.2, color: [r * k, g * k, b * k] }];
  };
  const zOf = pos => (pos - 3) * LAYER_GAP;
  return {
    materials,
    backdrop: buildJungle,
    rigs: jkRigSet,
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
      if (redrawn) return redrawnTile(t, x, y, p, color);
      return [{ group: 'foliage', z0: -2, z1: 2, color }];
    },
    animate(time) { if (water?.userData.shader) water.userData.shader.uniforms.uTime.value = time; },
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
    rigs: mpRigSet,
    structures: mpStructures,
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
    structures: pacStructures,
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
    structures: joustStructures,
    rigs: joustRigSet,
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

// Q*bert: the pyramid floats in space; cube art is sculpted thick and glossy, HUD text glows.
function qbertProfile() {
  const materials = {
    cube: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 0.35 }),
    hud: hudMaterial(),
  };
  return {
    materials,
    backdrop: buildCosmos,
    rigs: qbRigSet,
    structures: qbStructures,
    margin: 0.54,
    cameraTilt: 48,
    inflate: { thickness: 0.85, minDepth: 5, maxDepth: 18 },
    lighting: {
      hemiSky: 0xbfd8ff, hemiGround: 0x1a2030, hemiIntensity: 0.75,
      sunColor: 0xfff2e0, sunIntensity: 2.0, sunPos: [-170, 250, 300],
      rimColor: 0x5ad0ff, rimIntensity: 0.8, exposure: 1.0, bloomStrength: 0.35, bloomThreshold: 0.93,
    },
    spriteZ: kind => (kind === 'hud' ? 6 : 12),
    classifyTile(t, x, y, p, color) {
      if (t.kind === 'cube') return [{ group: 'cube', z0: -8, z1: 8, color }];
      return [{ group: 'hud', z0: -1, z1: 1.5, color }];
    },
  };
}

const PROFILES = { dkong: dkongProfile, junglek: junglekProfile, mpatrolw: mpatrolProfile, mspacman: mspacmanProfile, joust: joustProfile, qbert: qbertProfile };

export function getProfile(id, view) {
  const make = PROFILES[id];
  if (!make) throw new Error(`No remaster profile for ${id}`);
  return make(view);
}

export function registerProfile(id, factory) { PROFILES[id] = factory; }
