// Lightweight modal dialogs (used instead of alert/confirm).

const root = () => document.getElementById('modalRoot');
let stack = [];

export function openModal({ title, body, buttons = [{ label: 'OK', primary: true }], tone = '', dismissible = true, onOpen }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = `modal ${tone}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <header><h2></h2>${dismissible ? '<button class="icon-btn close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' : ''}</header>
      <div class="body"></div>
      <footer></footer>`;
    modal.querySelector('h2').textContent = title;
    const bodyEl = modal.querySelector('.body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const footer = modal.querySelector('footer');
    const close = value => {
      backdrop.remove();
      stack = stack.filter(s => s !== entry);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn${b.primary ? ' btn-primary' : ''}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => close(b.value ?? b.label));
      footer.appendChild(btn);
    }
    if (!buttons.length) footer.remove();
    if (dismissible) {
      modal.querySelector('.close').addEventListener('click', () => close(null));
      backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(null); });
    }
    const onKey = e => {
      if (stack[stack.length - 1] !== entry) return;
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && buttons.length && !(e.target instanceof HTMLSelectElement)) {
        const primary = buttons.find(b => b.primary) || buttons[0];
        e.preventDefault(); e.stopPropagation(); close(primary.value ?? primary.label);
      }
      else e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.appendChild(modal);
    root().appendChild(backdrop);
    const entry = { close };
    stack.push(entry);
    if (onOpen) onOpen(modal, close);
    const focusBtn = footer.querySelector('.btn-primary') || footer.querySelector('.btn');
    if (focusBtn) focusBtn.focus();
  });
}

export function modalOpen() { return stack.length > 0; }

export function showError(title, message) {
  const p = document.createElement('p');
  p.textContent = message;
  return openModal({ title, body: p, tone: 'error' });
}
