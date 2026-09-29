let popover;
let requestId = 0;

function closePopover() {
  requestId++;
  popover?.remove();
  popover = undefined;
}

async function showPopover(event) {
  if (popover && (event.target === popover || event.composedPath?.().includes(popover))) return;
  closePopover();
  if (event.target?.closest?.('input, textarea, [contenteditable]')) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!text || !selection.rangeCount) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const currentRequest = requestId;

  try {
    const { enabled } = await chrome.runtime.sendMessage({ type: 'getEnabled' });
    if (!enabled || currentRequest !== requestId) return;
  } catch {
    return; // An unavailable extension store must not interfere with the webpage.
  }

  const host = document.createElement('div');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.boxSizing = 'border-box';
  host.style.width = '88px';
  host.style.padding = '4px';
  host.style.border = '1px solid #e3e8f0';
  host.style.borderRadius = '12px';
  host.style.backgroundColor = '#fff';
  host.style.boxShadow = '0 4px 16px #16244326';
  const left = rect.right + 96 <= window.innerWidth ? rect.right + 8 : rect.left - 96;
  host.style.left = `${Math.min(Math.max(8, left), Math.max(8, window.innerWidth - 80))}px`;
  host.style.top = `${Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 52))}px`;

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = 'button { all: initial; box-sizing: border-box; display: block; width: 100%; min-height: 36px; text-align: center; border-radius: 8px; background: #315dd1; color: white; font: 600 13px/20px system-ui, sans-serif; cursor: pointer; } button:hover { background: #2448af; } button:focus-visible { outline: 2px solid #315dd1; outline-offset: 3px; } button:disabled { opacity: .6; cursor: wait; }';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '收集';
  shadow.appendChild(style);
  shadow.appendChild(button);
  document.body.appendChild(host);
  popover = host;

  button.addEventListener('click', async event => {
    if (!event.isTrusted || popover !== host || button.disabled) return;
    button.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'collect', text });
      if (popover !== host) return;
      if (result?.ok || result?.code === 'disabled') return closePopover();
      button.textContent = '重试';
      button.title = '保存失败，请重试';
    } catch {
      button.textContent = '重试';
      button.title = '保存失败，请重试';
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener('dblclick', showPopover);

let dragStart;
document.addEventListener('mousedown', event => {
  dragStart = event.button === 0 && !event.target?.closest?.('input, textarea, [contenteditable]')
    ? { x: event.clientX, y: event.clientY }
    : undefined;
}, true);
document.addEventListener('mouseup', event => {
  const start = dragStart;
  dragStart = undefined;
  if (!start || event.button !== 0 || event.detail > 1) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
  return showPopover(event);
}, true);

document.addEventListener('pointerdown', event => {
  if (popover && (event.target === popover || event.composedPath?.().includes(popover))) return;
  closePopover();
}, true);
window.addEventListener('scroll', closePopover, true);
window.addEventListener('resize', closePopover);
