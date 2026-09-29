importScripts('baidu-translate.js');

const accessReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function handleMessage(message, sender) {
  await accessReady;
  if (!sender.tab || !/^https?:\/\//.test(sender.url || '')) return { ok: false, code: 'failed' };

  if (message?.type === 'getEnabled') {
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    return { enabled: collectionEnabled === true };
  }
  if (message?.type !== 'collect' || typeof message.text !== 'string') return { ok: false, code: 'failed' };
  const text = message.text.trim();
  if (!text || new TextEncoder().encode(text).length > 6000) return { ok: false, code: 'failed' };

  const config = await chrome.storage.local.get(['collectionEnabled', 'translationEnabled', 'baiduAppId', 'baiduSecret']);
  if (config.collectionEnabled !== true) return { ok: false, code: 'disabled' };
  const key = 'word:' + text;
  if (config.translationEnabled === true) {
    if (typeof config.baiduAppId !== 'string' || !config.baiduAppId.trim() ||
        typeof config.baiduSecret !== 'string' || !config.baiduSecret.trim()) return { ok: false, code: 'failed' };
    const translation = await BaiduTranslate.translate(text, config.baiduAppId, config.baiduSecret);
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled !== true) return { ok: false, code: 'disabled' };
    await chrome.storage.local.set({ [key]: { text, translation } });
  } else {
    const existing = (await chrome.storage.local.get(key))[key];
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled !== true) return { ok: false, code: 'disabled' };
    if (!(existing && typeof existing === 'object' && typeof existing.translation === 'string' &&
          existing.translation.trim())) await chrome.storage.local.set({ [key]: text });
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, () => sendResponse({ ok: false, code: 'failed' }));
  return true;
});