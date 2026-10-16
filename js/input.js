// Keyboard + gamepad input mapped to an arcade control state.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'b1', KeyZ: 'b1', ControlLeft: 'b1', KeyJ: 'b1',
  KeyX: 'b2', AltLeft: 'b2', KeyK: 'b2',
  Digit5: 'coin', KeyC: 'coin',
  Digit1: 'start1', Enter: 'start1',
  Digit2: 'start2',
};

export class Input {
  constructor() {
    this.keys = {};
    this.pulses = {};   // button -> frames remaining (on-screen buttons)
    this.enabled = true;
    addEventListener('keydown', e => {
      const b = KEYMAP[e.code];
      if (!b || !this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys[b] = true;
      e.preventDefault();
    });
    addEventListener('keyup', e => {
      const b = KEYMAP[e.code];
      if (b) this.keys[b] = false;
    });
    addEventListener('blur', () => { this.keys = {}; });
  }

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
