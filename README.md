# Arcade Remaster

Arcade Remaster runs the **original arcade ROMs** on emulated CPUs, so the game logic, timing, randomness and difficulty match the original exactly. Each frame is then rebuilt as a **2.5D scene** with real lighting, shadows, bloom and depth.

The program code is unchanged and only the graphics are reinterpreted, which means the game plays exactly like the arcade original.

**Play online:** https://robertorenz.github.io/arcade-remaster/ — no ROMs are hosted; the first time you start a game you are asked for its MAME zip (e.g. `dkong.zip`), which stays in your browser and is never uploaded.

## Supported games

| Game | ROM set | Hardware emulated | Status |
|---|---|---|---|
| Donkey Kong (US set 1) | `dkong.zip` | Z80 main CPU, i8035 sound CPU, 8257 DMA, tile/sprite video, discrete sounds (approximated) | Playable, remastered |
| Jungle King (Japan) | `junglek.zip` | Taito SJ: Z80 ×2, AY-3-8910 ×4 + DAC, char RAM, 3 column-scrolled playfields, PROM priority, hardware collision detection | Playable, remastered |
| Ms. Pac-Man | `mspacman.zip` | Namco Pac-Man board + Midway aux board (encrypted ROM overlay with trap-address bank switching), Namco WSG 3-voice wavetable | Playable, remastered |
| Joust | `joust.zip` | Williams: MC6809E, M6808 sound + DAC, 3x 6821 PIA, SC1 blitter, 4bpp bitmap, CMOS (saved per browser), watchdog | Playable, remastered |
| Moon Patrol (Williams) | `mpatrolw.zip` | Irem M52: Z80, M6803 sound CPU, AY-3-8910 ×2, MSM5205 ADPCM, 3 parallax bitmap backgrounds, scroll-board protection | Playable, remastered |
| Q*bert (US set 2) | `qberta.zip` | Gottlieb System 80: Intel 8088, 6502 sound CPU + 6532 RIOT, DAC, Votrax SC-01 speech (synthesised from the chip's phoneme ROM), cabinet knocker, palette RAM | Playable, remastered |

ROMs are **not included**. Put your own MAME-format zips next to `index.html`, or load them through the in-app dialog. A ZIP you load in the dialog is cached in your browser's IndexedDB and never uploaded.

## Running

```bash
node serve.mjs        # then open http://localhost:8080/
```

On Windows you can double-click `start.bat`. The app has no dependencies or build step. Three.js is loaded from a CDN for the 3D view.

## View modes

| Mode | What you see |
|---|---|
| **Remastered** | The original pixel art sculpted into 3D (voxel scenery, rounded figurines) inside a themed diorama |
| **Redrawn** | Everything is rebuilt rather than sculpted from the pixels. **Characters**: sculpted, animated 3D models posed from the game's own animation data — Mario, Donkey Kong (fur), Pauline, barrels and fireballs; Ms. Pac-Man and the ghosts; Joust knights on ostriches and buzzards, pterodactyls and eggs; the Moon Patrol rover (its six wheels ride on the arcade's own suspension), flying saucers, orb bombers, bombs, boulders, land mines, tanks, missiles, plasma shots and particle explosions; the Jungle King hero (hangs, runs, leaps, swims), leafy vines, crocodiles with snapping jaws, rolling boulders, monkeys, skull-masked natives with spears, Jane, the cauldron fire and bubbles (Jungle King loads its graphics into RAM at run time, so objects are recognised by matching each sprite's content hash against a catalogue decoded from the graphics ROMs). **Playfields**: Donkey Kong truss girders and round-rail ladders, Ms. Pac-Man dark-glass walls with neon rims and glowing pearls, Joust carved stone ledges, Moon Patrol faceted 3D mountain and hill ranges that scroll with the hardware and a 3D regolith road whose craters follow the arcade ground line; Jungle King bushy layered foliage, grained bark, textured ground and rippling glossy water; the Q*bert pyramid rebuilt from real bevelled cubes stacked edge to edge, whose tops change colour exactly when the game changes them. Q*bert's cast is modelled too: Q*bert with his trumpet snout, Coily on a springing coil, the bouncing balls, Ugg and Wrongway, Slick and Sam, and the spinning escape discs. **Scenery**: deluxe backdrops (searchlights, rain, neon signs and lightning; synthwave sun; shooting stars and a satellite; lava geysers; birds; a ringed planet and flying discs) |
| **Classic** | Pixel-exact original output, optional scanlines |
| **Split** | Classic and 3D side by side |

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Move, climb |
| Space / Z | Jump (Moon Patrol: jump) |
| X / K | Second button (Moon Patrol: fire) |
| 5 or C | Insert coin |
| 1 / 2 | Start 1P / 2P |
| V | Cycle Remastered / Redrawn / Classic / Split view |
| P / M / F / H | Pause / mute / fullscreen / controls |

Q*bert's joystick is mounted at 45°, so the arrow keys are turned a quarter turn: Up hops up-right, Right hops down-right, Down hops down-left and Left hops up-left.

All game keys can be changed: open **Controls** (H or the ? button), click a key slot and press the new key (two keys per action; Backspace clears a slot, Reset restores the defaults). Bindings are saved in the browser.

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
   • layers        → each playfield at its own depth, scaled so it projects exactly where the arcade drew it
   • clip planes   → camera-frustum planes keep scrolling playfields inside the original picture
   • themes        → DK: night construction site, city, crane · Jungle King: rainforest frame, light shafts, clouds · Moon Patrol: lunar plain, Earth, starfield, base domes · Ms. Pac-Man: lacquered board over a neon synth grid · Joust: volcanic cavern, lava sea, embers · Q*bert: deep space, nebulae, drifting cubes
```

The sprite figurines are cached by content hash, so each animation frame is sculpted only once.

Joust has no sprite hardware (everything is drawn into a bitmap by the blitter), so the scene is reconstructed: every pixel remembers whether the blitter last wrote it from a small object image (riders, birds, eggs, pterodactyls, the respawn silhouette). Those pixels stay a moving object until they are erased, however long the object stands still. Everything else, including the ledges the game keeps redrawing, is scenery cut into content-keyed tiles. Each rider is drawn as a knight blit followed by a mount blit, and both carry one object number, so riders that touch or overlap are still told apart. The picture is latched scanline by scanline as the beam reaches it, because the game erases and redraws objects just behind the beam.

## Project layout

```
index.html, css/app.css      UI shell (modals, settings, view modes)
js/cpu/z80.js                Z80 core (passes ZEXDOC)
js/cpu/i8035.js              MCS-48 core (Donkey Kong sound CPU)
js/cpu/m6803.js              MC6803 core with on-chip timer/ports (Irem sound); 6800/6808 mode (Williams sound)
js/cpu/m6809.js              MC6809 core (Williams main CPU)
js/cpu/i8088.js              Intel 8088 core (Gottlieb main CPU)
js/cpu/m6502.js              NMOS 6502 core (Gottlieb sound CPU)
js/cpu/pia6821.js            6821 PIA
js/machines/dkong.js         Donkey Kong hardware + scene description
js/machines/junglek.js       Taito SJ hardware (Jungle King)
js/machines/mpatrol.js       Irem M52 hardware (Moon Patrol)
js/machines/mspacman.js      Pac-Man board + Ms. Pac-Man aux board, Namco WSG
js/machines/joust.js         Williams Joust (blitter, PIAs, CMOS)
js/machines/qbert.js         Gottlieb Q*bert (video, 6532 RIOT sound board, knocker)
js/audio/ay8910.js           AY-3-8910 PSG
js/audio/msm5205.js          MSM5205 ADPCM
js/audio/votrax.js           Votrax SC-01 speech synthesiser (phoneme ROM, formant filters)
js/audio/                    DAC/discrete synthesis, AudioWorklet output
js/render/classic.js         pixel-exact view
js/render/remaster.js        2.5D renderer (tiles, sprites, lights, camera, post-processing)
js/render/inflate.js         pixel art → rounded mesh
js/render/voxel.js           tile → voxel mesh
js/render/profiles.js        per-game tile classification and materials
js/render/themes/            per-game backdrops (with deluxe extras for Redrawn mode)
js/render/rigs/              Redrawn mode: object classification, sculpting toolkit and 3D character models
js/render/structures/        Redrawn mode: rebuilt playfields (girders, maze walls, ledges, mountain ranges, cube pyramid)
serve.mjs, start.bat         local static server
```

## Legal

This project contains no ROM data. Donkey Kong, Jungle King, Moon Patrol, Ms. Pac-Man, Joust and Q*bert are trademarks of their respective owners. Only use ROM images you are legally entitled to.
