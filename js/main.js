import { readZip } from './zip.js';
import { MACHINES, findMachine } from './machines/index.js';
import { Input } from './input.js';
import { AudioOut } from './audio/output.js';
import { ClassicView } from './render/classic.js';
import { openModal, modalOpen, showError } from './ui/modal.js';

const $ = id => document.getElementById(id);
const stage = $('stage');

// ---- persisted preferences (per browser convenience only) -------------------
const PREF_KEY = 'arcade-remaster-prefs';
const prefs = Object.assign(
  { mode: 'remaster', game: MACHINES[0].info.id, volume: 0.8, muted: false, crt: true, bloom: true, camera: 'dynamic', shadows: true },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })(),
);
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } };

// ---- ROM cache in IndexedDB -------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('arcade-remaster', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('roms');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise(res => {
      const r = db.transaction('roms').objectStore('roms').get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}
async function cachePut(key, buf) {
  try {
    const db = await idb();
    db.transaction('roms', 'readwrite').objectStore('roms').put(buf, key);
  } catch { /* ignore */ }
}

// ---- state --------------------------------------------------------------------
const input = new Input();
const audio = new AudioOut();
audio.volume = prefs.volume;
audio.muted = prefs.muted;
const classic = new ClassicView($('viewClassic'), $('classicCanvas'));
let remaster = null, remasterFailed = false;
let machine = null;
let paused = false;
let acc = 0, last = performance.now();
let fpsFrames = 0, fpsTime = 0;

function validateRoms(Machine, files) {
  const missing = Machine.info.files.filter(f => !files.has(f));
  if (missing.length) throw new Error(`The ZIP is missing ${missing.length} file(s): ${missing.join(', ')}`);
}

async function askForZip(Machine) {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>Choose your <strong>${Machine.info.zip}</strong> ROM set (MAME format). It stays in this browser and is never uploaded anywhere.</p>
    <label class="dropzone" id="dz"><strong>Drop ${Machine.info.zip} here</strong><br>or click to browse<input type="file" accept=".zip" hidden></label>
    <p class="err" style="color:var(--danger);min-height:1.5em;margin:0"></p>`;
  return openModal({
    title: `Load ${Machine.info.title}`,
    body,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (modal, close) => {
      const dz = modal.querySelector('#dz'), fi = dz.querySelector('input'), err = modal.querySelector('.err');
      const take = async file => {
        if (!file) return;
        try {
          const buf = await file.arrayBuffer();
          const files = await readZip(buf);
          validateRoms(Machine, files);
          await cachePut(Machine.info.zip, buf);
          close(files);
        } catch (e) { err.textContent = e.message; }
      };
      fi.addEventListener('change', () => take(fi.files[0]));
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); take(e.dataTransfer.files[0]); });
    },
  });
}

async function getRoms(Machine) {
  const zip = Machine.info.zip;
  // 1) served next to the app  2) cached in this browser  3) ask the player
  try {
    const r = await fetch(zip, { cache: 'no-store' });
    if (r.ok) {
      const files = await readZip(await r.arrayBuffer());
      validateRoms(Machine, files);
      return files;
    }
  } catch { /* not served */ }
  const cached = await cacheGet(zip);
  if (cached) {
    try { const files = await readZip(cached); validateRoms(Machine, files); return files; } catch { /* stale */ }
  }
  return askForZip(Machine);
}

async function ensureRemaster() {
  if (remaster || remasterFailed) return remaster;
  const badge = document.createElement('div');
  badge.className = 'loading-badge';
  badge.textContent = 'Loading 3D renderer…';
  $('viewRemaster').appendChild(badge);
  try {
    const mod = await import('./render/remaster.js');
    remaster = new mod.RemasterView($('viewRemaster'));
    remaster.setSettings({ bloom: prefs.bloom, camera: prefs.camera, shadows: prefs.shadows });
  } catch (e) {
    console.error(e);
    remasterFailed = true;
    showError('Remastered view unavailable', `The 3D renderer could not start (${e.message}). Showing the classic view instead.`);
    setMode('classic');
  } finally {
    badge.remove();
  }
  return remaster;
}

async function loadGame(id) {
  const Machine = findMachine(id) || MACHINES[0];
  const files = await getRoms(Machine);
  if (!files) return false;
  try {
    machine = new Machine(files, audio.sampleRate);
  } catch (e) {
    showError('Could not start the game', e.message);
    return false;
  }
  prefs.game = Machine.info.id; savePrefs();
  classic.setMachine(machine);
  if (prefs.mode !== 'classic') {
    const r = await ensureRemaster();
    if (r) r.setMachine(machine);
  }
  document.querySelectorAll('#gameTabs button').forEach(b => b.classList.toggle('active', b.dataset.id === Machine.info.id));
  $('statusGame').textContent = Machine.info.title;
  $('statusInfo').textContent = `${Machine.info.zip} · ${Machine.info.fps.toFixed(2)} Hz`;
  acc = 0;
  return true;
}

async function setMode(mode) {
  prefs.mode = mode; savePrefs();
  stage.dataset.mode = mode;
  document.querySelectorAll('#viewMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode !== 'classic' && machine) {
    const r = await ensureRemaster();
    if (r && r.machine !== machine) r.setMachine(machine);
  }
  requestAnimationFrame(() => { classic.resize(); remaster?.resize(); });
}

function setPaused(p) {
  paused = p;
  $('btnPause').classList.toggle('on', p);
  $('btnPause').innerHTML = p
    ? '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}

function setMuted(m) {
  prefs.muted = m; savePrefs();
  audio.setMuted(m);
  $('btnMute').classList.toggle('muted', m);
}

// ---- main loop ------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!machine) return;
  if (!paused && !modalOpen()) {
    const step = 1 / machine.info.fps;
    acc += dt;
    let n = 0;
    while (acc >= step && n < 4) {
      machine.setInput(input.state());
      machine.runFrame();
      const samples = machine.takeAudio();
      if (audio.ctx) audio.push(samples);
      acc -= step;
      n++;
    }
    if (n === 4) acc = 0;
  }
  const mode = prefs.mode;
  if (mode !== 'remaster') classic.render();
  if (mode !== 'classic' && remaster && remaster.machine === machine) remaster.render(dt);

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    $('statusFps').textContent = `${Math.round(fpsFrames / fpsTime)} fps${paused ? ' · paused' : ''}`;
    fpsFrames = 0; fpsTime = 0;
  }
}

// ---- dialogs --------------------------------------------------------------------
function showHelp() {
  openModal({
    title: 'Controls',
    body: `
      <div class="keys">
        <span><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></span><span>Move / climb (WASD also works)</span>
        <span><kbd>Space</kbd> <kbd>Z</kbd></span><span>Jump / action</span>
        <span><kbd>X</kbd></span><span>Second button (games that use it)</span>
        <span><kbd>5</kbd> <kbd>C</kbd></span><span>Insert coin</span>
        <span><kbd>1</kbd> <kbd>2</kbd></span><span>Start 1 or 2 players</span>
        <span><kbd>V</kbd></span><span>Cycle Remastered / Classic / Split view</span>
        <span><kbd>P</kbd> <kbd>M</kbd> <kbd>F</kbd></span><span>Pause, mute, fullscreen</span>
      </div>
      <p>Gamepads work too: D-pad or stick to move, A to jump, Select for coin, Start to start.</p>`,
  });
}

function showSettings() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>Camera<small>How the 2.5D camera behaves</small></label>
      <select id="setCamera"><option value="dynamic">Dynamic (follows player)</option><option value="fixed">Fixed diorama</option><option value="flat">Flat (straight on)</option></select></div>
    <div class="field"><label>Bloom &amp; glow<small>Light bloom on fire, lamps and text</small></label><label class="switch"><input type="checkbox" id="setBloom"><span></span></label></div>
    <div class="field"><label>Shadows<small>Real-time shadows from the moon light</small></label><label class="switch"><input type="checkbox" id="setShadows"><span></span></label></div>
    <div class="field"><label>CRT scanlines<small>Scanline overlay in the classic view</small></label><label class="switch"><input type="checkbox" id="setCrt"><span></span></label></div>
    <div class="field"><label>Volume</label><input type="range" id="setVolume" min="0" max="1" step="0.05"></div>`;
  openModal({
    title: 'Settings',
    body,
    buttons: [{ label: 'Done', primary: true }],
    onOpen: modal => {
      const q = s => modal.querySelector(s);
      q('#setCamera').value = prefs.camera;
      q('#setBloom').checked = prefs.bloom;
      q('#setShadows').checked = prefs.shadows;
      q('#setCrt').checked = prefs.crt;
      q('#setVolume').value = prefs.volume;
      const apply = () => {
        prefs.camera = q('#setCamera').value;
        prefs.bloom = q('#setBloom').checked;
        prefs.shadows = q('#setShadows').checked;
        prefs.crt = q('#setCrt').checked;
        prefs.volume = +q('#setVolume').value;
        savePrefs();
        stage.classList.toggle('crt', prefs.crt);
        audio.setVolume(prefs.volume);
        remaster?.setSettings({ bloom: prefs.bloom, camera: prefs.camera, shadows: prefs.shadows });
      };
      modal.querySelectorAll('select,input').forEach(el => el.addEventListener('input', apply));
    },
  });
}

// ---- wiring ---------------------------------------------------------------------
function buildTabs() {
  const tabs = $('gameTabs');
  for (const M of MACHINES) {
    const b = document.createElement('button');
    b.textContent = M.info.title;
    b.dataset.id = M.info.id;
    b.addEventListener('click', async () => {
      if (machine && machine.info.id === M.info.id) return;
      await audio.init();
      await loadGame(M.info.id);
    });
    tabs.appendChild(b);
  }
}

async function start() {
  await audio.init().catch(e => console.warn('audio', e));
  const ok = await loadGame(prefs.game);
  if (ok) $('splash').classList.add('hidden');
}

function init() {
  buildTabs();
  stage.dataset.mode = prefs.mode;
  stage.classList.toggle('crt', prefs.crt);
  document.querySelectorAll('#viewMode button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === prefs.mode);
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
  setMuted(prefs.muted);
  $('btnPlay').addEventListener('click', start);
  $('btnCoin').addEventListener('click', () => input.pulse('coin', 22));
  $('btnStart').addEventListener('click', () => input.pulse('start1', 8));
  $('btnPause').addEventListener('click', () => setPaused(!paused));
  $('btnMute').addEventListener('click', () => setMuted(!prefs.muted));
  $('btnHelp').addEventListener('click', showHelp);
  $('btnSettings').addEventListener('click', showSettings);
  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.();
  });
  addEventListener('keydown', e => {
    if (modalOpen() || e.repeat) return;
    switch (e.code) {
      case 'KeyP': setPaused(!paused); break;
      case 'KeyM': setMuted(!prefs.muted); break;
      case 'KeyH': showHelp(); break;
      case 'KeyF': $('btnFull').click(); break;
      case 'KeyV': {
        const modes = ['remaster', 'classic', 'split'];
        setMode(modes[(modes.indexOf(prefs.mode) + 1) % modes.length]);
        break;
      }
    }
    if (!audio.ctx && machine) audio.init();
  });
  const ro = new ResizeObserver(() => { classic.resize(); remaster?.resize(); });
  ro.observe(stage);
  addEventListener('resize', () => { classic.resize(); remaster?.resize(); });
  requestAnimationFrame(loop);
}

init();

// debugging handle for the console
window.arcade = { get machine() { return machine; }, get remaster() { return remaster; }, input, audio };
