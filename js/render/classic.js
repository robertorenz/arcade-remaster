// Pixel-exact renderer: draws the machine's native frame to a scaled canvas.

export class ClassicView {
  constructor(container, canvas) {
    this.container = container;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.machine = null;
  }

  setMachine(machine) {
    this.machine = machine;
    const { width, height } = machine.info;
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = this.ctx.createImageData(width, height);
    this.resize();
  }

  resize() {
    if (!this.machine) return;
    const { width, height } = this.machine.info;
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // integer scaling when it fits well, otherwise fractional
    let s = Math.min((r.width - 24) / width, (r.height - 24) / height);
    if (s >= 2) s = Math.floor(s);
    this.canvas.style.width = `${Math.floor(width * s)}px`;
    this.canvas.style.height = `${Math.floor(height * s)}px`;
  }

  render() {
    if (!this.machine) return;
    this.machine.renderClassic(this.image.data);
    this.ctx.putImageData(this.image, 0, 0);
  }
}
