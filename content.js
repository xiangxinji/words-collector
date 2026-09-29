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
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (!collectionEnabled || currentRequest !== requestId) return;
  } catch {
    return; // An unavailable extension store must not interfere with the webpage.
  }

  const host = document.createElement('div');
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647';
  host.style.boxSizing = 'border-box';
  host.style.width = '76px';
  host.style.padding = '5px';
  host.style.border = '1px solid #dce1ea';
  host.style.borderRadius = '10px';
  host.style.backgroundColor = '#fff';
  host.style.boxShadow = '0 5px 18px #0003';
  const left = rect.right + 80 <= window.innerWidth ? rect.right + 8 : rect.left - 80;
  host.style.left = `${Math.min(Math.max(8, left), Math.max(8, window.innerWidth - 80))}px`;
  host.style.top = `${Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 52))}px`;

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = 'button { all: initial; box-sizing: border-box; display: block; width: 100%; padding: 6px 0; text-align: center; border-radius: 6px; background: #315dd1; color: white; font: 14px/20px system-ui, sans-serif; cursor: pointer; box-shadow: 0 3px 12px #0003; } button:hover { background: #2448af; } button:focus-visible { outline: 2px solid #172c7c; outline-offset: 2px; } button:disabled { opacity: .6; cursor: wait; }';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '收集';
  shadow.appendChild(style);
  shadow.appendChild(button);
  document.body.appendChild(host);
  popover = host;

  button.addEventListener('click', async () => {
    if (popover !== host) return;
    button.disabled = true;
    try {
      const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
      if (popover !== host) return;
      if (!collectionEnabled) return closePopover();
      await chrome.storage.local.set({ ['word:' + text]: text });
      if (popover === host) closePopover();
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
