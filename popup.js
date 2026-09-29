const toggle = document.querySelector('#collection-toggle');
const status = document.querySelector('#status');
const translationToggle = document.querySelector('#translation-toggle');
const appIdInput = document.querySelector('#baidu-app-id');
const secretInput = document.querySelector('#baidu-secret');
const saveCredentials = document.querySelector('#save-credentials');
const translationStatus = document.querySelector('#translation-status');
let savedAppId = '';
let hasSavedSecret = false;

async function initialize() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    saveCredentials.disabled = false;
  } catch {
    status.textContent = '读取设置失败';
    translationStatus.textContent = '读取翻译设置失败';
    return;
  }
  try {
    const { collectionEnabled = false, translationEnabled = false, baiduAppId = '', baiduSecret } =
      await chrome.storage.local.get(['collectionEnabled', 'translationEnabled', 'baiduAppId', 'baiduSecret']);
    toggle.checked = collectionEnabled;
    translationToggle.checked = translationEnabled;
    savedAppId = baiduAppId;
    hasSavedSecret = typeof baiduSecret === 'string' && !!baiduSecret.trim();
    appIdInput.value = baiduAppId;
  } catch {
    toggle.checked = false;
    translationToggle.checked = false;
    status.textContent = '读取设置失败';
    translationStatus.textContent = '读取翻译设置失败';
  } finally {
    toggle.disabled = false;
    translationToggle.disabled = false;
  }
}

toggle.addEventListener('change', async () => {
  const previous = !toggle.checked;
  toggle.disabled = true;
  status.textContent = '';
  try {
    await chrome.storage.local.set({ collectionEnabled: toggle.checked });
  } catch {
    toggle.checked = previous;
    status.textContent = '保存设置失败，请重试';
  } finally {
    toggle.disabled = false;
  }
});

translationToggle.addEventListener('change', async () => {
  const previous = !translationToggle.checked;
  translationToggle.disabled = true;
  translationStatus.textContent = '';
  translationStatus.dataset.tone = 'error';
  try {
    await chrome.storage.local.set({ translationEnabled: translationToggle.checked });
  } catch {
    translationToggle.checked = previous;
    translationStatus.textContent = '保存翻译设置失败，请重试';
  } finally {
    translationToggle.disabled = false;
  }
});

saveCredentials.addEventListener('click', async () => {
  if (saveCredentials.disabled) return;
  const appId = appIdInput.value.trim();
  const secret = secretInput.value.trim();
  translationStatus.textContent = '';
  translationStatus.dataset.tone = 'error';
  if (!appId || (!secret && (!hasSavedSecret || appId !== savedAppId))) {
    translationStatus.textContent = '请填写 App ID 和密钥';
    return;
  }
  saveCredentials.disabled = true;
  try {
    await chrome.storage.local.set({ baiduAppId: appId, ...(secret ? { baiduSecret: secret } : {}) });
    savedAppId = appId;
    hasSavedSecret = true;
    secretInput.value = '';
    translationStatus.dataset.tone = 'success';
    translationStatus.textContent = '凭据已保存';
  } catch {
    translationStatus.textContent = '保存凭据失败，请重试';
  } finally {
    saveCredentials.disabled = false;
  }
});
const wordList = document.querySelector('#word-list');
const wordCount = document.querySelector('#word-count');
const emptyState = document.querySelector('#empty-state');
const listStatus = document.querySelector('#list-status');

async function loadWords() {
  try {
    const data = await chrome.storage.local.get(null);
    const keys = Object.keys(data).filter(key => key.startsWith('word:')).sort((a, b) => a.localeCompare(b));
    wordList.replaceChildren();
    for (const key of keys) {
      const item = document.createElement('li');
      const word = document.createElement('span');
      word.textContent = key.slice(5);
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '删除';
      removeButton.setAttribute('aria-label', `删除 ${word.textContent}`);
      removeButton.addEventListener('click', async () => {
        if (removeButton.disabled) return;
        removeButton.disabled = true;
        listStatus.textContent = '';
        try {
          await chrome.storage.local.remove(key);
          item.remove();
          wordCount.textContent = `共 ${wordList.children.length} 条`;
          emptyState.hidden = wordList.children.length !== 0;
        } catch {
          listStatus.textContent = '删除失败，请重试';
        } finally {
          removeButton.disabled = false;
        }
      });
      item.appendChild(word);
      const translation = data[key]?.translation;
      if (typeof translation === 'string' && translation.trim()) {
        const translated = document.createElement('span');
        translated.textContent = translation;
        item.appendChild(translated);
      }
      item.appendChild(removeButton);
      wordList.appendChild(item);
    }
    wordCount.textContent = `共 ${keys.length} 条`;
    emptyState.hidden = keys.length !== 0;
  } catch {
    listStatus.textContent = '读取词表失败';
  }
}

void initialize();
void loadWords();
