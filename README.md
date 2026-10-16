# Arcade Remaster

Arcade Remaster runs the **original arcade ROMs** on emulated CPUs, so the game logic, timing, randomness and difficulty match the original exactly. Each frame is then rebuilt as a **2.5D scene** with real lighting, shadows, bloom and depth.

The program code is unchanged and only the graphics are reinterpreted, which means the game plays exactly like the arcade original.

## Supported games

| Game | ROM set | Hardware emulated | Status |
|---|---|---|---|
| Donkey Kong (US set 1) | `dkong.zip` | Z80 main CPU, i8035 sound CPU, 8257 DMA, tile/sprite video, discrete sounds (approximated) | Playable, remastered |
| Jungle King | `junglek.zip` | Taito SJ (Z80 ×2, AY-3-8910 ×4, 3 scrolling playfields) | In progress |

ROMs are **not included**. Put your own MAME-format zips next to `index.html`, or load them through the in-app dialog. A ZIP you load in the dialog is cached in your browser's IndexedDB and never uploaded.

## Running

```bash
node serve.mjs        # then open http://localhost:8080/
```

On Windows you can double-click `start.bat`. The app has no dependencies or build step. Three.js is loaded from a CDN for the 3D view.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Move, climb |
| Space / Z | Jump |
| 5 or C | Insert coin |
| 1 / 2 | Start 1P / 2P |
| V | Cycle Remastered / Classic / Split view |
| P / M / F / H | Pause / mute / fullscreen / help |

Gamepads are supported: D-pad or stick to move, A to jump, Select for coin, Start to start.

## How the remaster works

```
ROM program (Z80) ─► video RAM + sprite RAM every frame
                          │
                          ▼
     machine.displayScene(): tiles + sprites in screen orientation, with semantic kinds
                          │
                          ▼
  RemasterView (Three.js)
   • struct tiles  → voxel steel: full-depth flanges + front/back truss walls, ladders between them
   • slope solver  → shears girder tiles so 1-px steps become continuous sloped beams
   • sprites       → connected clusters, Scale2x ×2, distance-field "inflation" → rounded figurines
   • mask sprites  → all-black sprites cut the tiles under them (as on the CRT)
   • fire sprites  → glowing material + flickering point lights
   • HUD tiles     → emissive voxel text with bloom
   • theme         → night construction site, city skyline, scaffolding, crane, moon
```

The sprite figurines are cached by content hash, so each animation frame is sculpted only once.

## Project layout

```
index.html, css/app.css      UI shell (modals, settings, view modes)
js/cpu/z80.js                Z80 core (passes ZEXDOC)
js/cpu/i8035.js              MCS-48 core (Donkey Kong sound CPU)
js/machines/dkong.js         Donkey Kong hardware + scene description
js/audio/                    DAC/discrete synthesis, AudioWorklet output
js/render/classic.js         pixel-exact view
js/render/remaster.js        2.5D renderer (tiles, sprites, lights, camera, post-processing)
js/render/inflate.js         pixel art → rounded mesh
js/render/voxel.js           tile → voxel mesh
js/render/profiles.js        per-game tile classification and materials
js/render/themes/            per-game backdrops
serve.mjs, start.bat         local static server
```

## Legal

This project contains no ROM data. Donkey Kong and Jungle King are trademarks of their respective owners. Only use ROM images you are legally entitled to.
