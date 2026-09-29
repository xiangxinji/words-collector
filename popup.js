const toggle = document.querySelector('#collection-toggle');
const status = document.querySelector('#status');

async function initialize() {
  try {
    const { collectionEnabled = false } = await chrome.storage.local.get('collectionEnabled');
    toggle.checked = collectionEnabled;
  } catch {
    toggle.checked = false;
    status.textContent = '读取设置失败';
  } finally {
    toggle.disabled = false;
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
