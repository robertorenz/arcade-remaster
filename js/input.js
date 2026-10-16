// Keyboard + gamepad input mapped to an arcade control state. Keyboard bindings are
// user-configurable (two keys per action) and persisted in localStorage.

export const ACTIONS = ['left', 'right', 'up', 'down', 'b1', 'b2', 'coin', 'start1', 'start2'];

export const DEFAULT_BINDINGS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  b1: ['Space', 'KeyZ'],
  b2: ['KeyX', 'KeyK'],
  coin: ['Digit5', 'KeyC'],
  start1: ['Digit1', 'Enter'],
  start2: ['Digit2', null],
};

const BIND_KEY = 'arcade-remaster-keys';

// readable name for a KeyboardEvent.code
export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Win', MetaRight: 'R Win', Backquote: '`',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Tab: 'Tab', CapsLock: 'Caps',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor() {
    this.keys = {};
    this.pulses = {};   // button -> frames remaining (on-screen buttons)
    this.enabled = true;
    this.bindings = this.loadBindings();
    this.rebuildMap();
    addEventListener('keydown', e => {
      const b = this.map.get(e.code);
      if (!b || !this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys[b] = true;
      // some boards only accept a coin held for ~19 frames; a quick tap must still count
      if (b === 'coin' && !e.repeat) this.pulse('coin', 22);
      e.preventDefault();
    });
    addEventListener('keyup', e => {
      const b = this.map.get(e.code);
      if (b) { this.keys[b] = false; e.preventDefault(); }
    });
    addEventListener('blur', () => { this.keys = {}; });
  }

  loadBindings() {
    const b = structuredClone(DEFAULT_BINDINGS);
    try {
      const saved = JSON.parse(localStorage.getItem(BIND_KEY) || 'null');
      if (saved) for (const a of ACTIONS) if (Array.isArray(saved[a])) b[a] = [saved[a][0] ?? null, saved[a][1] ?? null];
    } catch { /* storage unavailable */ }
    return b;
  }

  saveBindings() {
    try { localStorage.setItem(BIND_KEY, JSON.stringify(this.bindings)); } catch { /* storage unavailable */ }
  }

  rebuildMap() {
    this.map = new Map();
    for (const a of ACTIONS) for (const code of this.bindings[a]) if (code) this.map.set(code, a);
    this.keys = {};
  }

  // assign a key to one slot of an action; a key can only drive one action, so it is
  // removed from wherever it was before
  bind(action, slot, code) {
    if (code) for (const a of ACTIONS) this.bindings[a] = this.bindings[a].map(c => (c === code ? null : c));
    this.bindings[action][slot] = code;
    this.rebuildMap();
    this.saveBindings();
  }

  resetBindings() {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.rebuildMap();
    this.saveBindings();
  }

  isBound(code) { return this.map.has(code); }

  pulse(button, frames = 6) { this.pulses[button] = frames; }

  state() {
    const s = { ...this.keys };
    for (const [b, n] of Object.entries(this.pulses)) {
      if (n > 0) { s[b] = true; this.pulses[b] = n - 1; }
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const btn = i => p.buttons[i] && p.buttons[i].pressed;
      if (ax < -0.45 || btn(14)) s.left = true;
      if (ax > 0.45 || btn(15)) s.right = true;
      if (ay < -0.45 || btn(12)) s.up = true;
      if (ay > 0.45 || btn(13)) s.down = true;
      if (btn(0) || btn(2)) s.b1 = true;
      if (btn(1) || btn(3)) s.b2 = true;
      if (btn(8)) s.coin = true;
      if (btn(9)) s.start1 = true;
    }
    if (!this.enabled) return {};
    return s;
  }
}
