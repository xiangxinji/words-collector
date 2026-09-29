document.addEventListener('dblclick', async event => {
  if (event.target?.closest?.('input, textarea, [contenteditable]')) return;
  const text = window.getSelection()?.toString().trim();
  if (!text) return;
  try {
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled) await chrome.storage.local.set({ ['word:' + text]: text });
  } catch {
    // An unavailable extension store must not interfere with the webpage.
  }
});
