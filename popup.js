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

void initialize();
