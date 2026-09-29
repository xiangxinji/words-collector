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
    importButton.disabled = false;
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
    importButton.disabled = false;
  }
});
const wordList = document.querySelector('#word-list');
const wordCount = document.querySelector('#word-count');
const exportButton = document.querySelector('#export-words');
const importButton = document.querySelector('#import-words');
const importFile = document.querySelector('#import-file');
const importStatus = document.querySelector('#import-status');
const emptyState = document.querySelector('#empty-state');
const listStatus = document.querySelector('#list-status');

function wordEntries(data) {
  return Object.keys(data).filter(key => key.startsWith('word:')).map(key => {
    const value = data[key];
    const timestamp = value?.collectedAt;
    const collectedAt = Number.isInteger(timestamp) && timestamp > 0 && timestamp <= 8640000000000000
      ? timestamp : null;
    return { key, text: key.slice(5), translation: typeof value?.translation === 'string' ? value.translation : '', collectedAt };
  }).sort((a, b) => (b.collectedAt ?? -1) - (a.collectedAt ?? -1) || a.text.localeCompare(b.text));
}

const spreadsheetFormula = /^[\u0000-\u0020\u007f-\u009f\uFEFF]*[=+\-@＝＋－＠]/u;

function csvCell(value) {
  const safe = spreadsheetFormula.test(value) ? `\t${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function localDateTime(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class CsvImportError extends Error {}

function parseCsvRows(content) {
  const rows = [];
  const source = content.replace(/^\uFEFF/, '');
  let row = [], field = '', quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === '"') {
      if (field || closedQuote) throw new CsvImportError('CSV 引号格式错误');
      quoted = true;
    } else if (char === ',' || char === '\r' || char === '\n') {
      row.push(field);
      field = '';
      closedQuote = false;
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && source[i + 1] === '\n') i++;
      }
    } else {
      if (closedQuote) throw new CsvImportError('CSV 引号格式错误');
      field += char;
    }
  }
  if (quoted) throw new CsvImportError('CSV 引号未闭合');
  if (row.length || field || closedQuote) rows.push([...row, field]);
  return rows;
}

function parseLocalTime(value) {
  if (value === '' || value === '未知（旧数据）') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new CsvImportError('收集时间格式错误');
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second ||
      date.getTime() <= 0) throw new CsvImportError('收集时间无效');
  return date.getTime();
}

function parseWordCsv(content) {
  const rows = parseCsvRows(content);
  if (rows.length < 2 || rows[0].length !== 3 ||
      rows[0].join(',') !== '原文,译文,最近收集时间（本地）') throw new CsvImportError('CSV 表头不匹配或没有词条');
  const words = {};
  for (const row of rows.slice(1)) {
    if (row.length !== 3) throw new CsvImportError('CSV 列数不正确');
    const restore = value => value.startsWith('\t') && spreadsheetFormula.test(value.slice(1)) ? value.slice(1) : value;
    const text = restore(row[0]).trim();
    const translation = restore(row[1]);
    if (!text || new TextEncoder().encode(text).length > 6000) throw new CsvImportError('原文为空或过长');
    const collectedAt = parseLocalTime(row[2]);
    words['word:' + text] = { text, ...(translation.trim() ? { translation } : {}),
      ...(collectedAt === null ? {} : { collectedAt }) };
  }
  return words;
}

async function loadWords() {
  try {
    const data = await chrome.storage.local.get(null);
    const entries = wordEntries(data);
    wordList.replaceChildren();
    for (const { key, text, translation } of entries) {
      const item = document.createElement('li');
      const word = document.createElement('span');
      word.textContent = text;
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
          exportButton.disabled = wordList.children.length === 0;
        } catch {
          listStatus.textContent = '删除失败，请重试';
        } finally {
          removeButton.disabled = false;
        }
      });
      item.appendChild(word);
      if (typeof translation === 'string' && translation.trim()) {
        const translated = document.createElement('span');
        translated.textContent = translation;
        item.appendChild(translated);
      }
      item.appendChild(removeButton);
      wordList.appendChild(item);
    }
    wordCount.textContent = `共 ${entries.length} 条`;
    emptyState.hidden = entries.length !== 0;
    exportButton.disabled = entries.length === 0;
  } catch {
    exportButton.disabled = true;
    listStatus.textContent = '读取词表失败';
  }
}

exportButton.addEventListener('click', async () => {
  if (exportButton.disabled) return;
  exportButton.disabled = true;
  listStatus.textContent = '';
  let canExport = true;
  try {
    const entries = wordEntries(await chrome.storage.local.get(null));
    if (!entries.length) {
      canExport = false;
      return;
    }
    const rows = entries.map(({ text, translation, collectedAt }) =>
      [text, translation, collectedAt === null ? '未知（旧数据）' : localDateTime(collectedAt)]
        .map(csvCell).join(',') + '\r\n');
    const blob = new Blob(['\uFEFF', '原文,译文,最近收集时间（本地）\r\n', ...rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'words-collector.csv';
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    listStatus.textContent = '导出失败，请重试';
  } finally {
    exportButton.disabled = !canExport;
  }
});

importButton.addEventListener('click', () => {
  if (!importButton.disabled) importFile.click();
});

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (importButton.disabled || !file) {
    importFile.value = '';
    return;
  }
  importButton.disabled = true;
  importStatus.textContent = '';
  importStatus.dataset.tone = 'error';
  try {
    if (!/\.csv$/i.test(file.name)) throw new CsvImportError('仅支持 CSV 文件');
    if (file.size > 10 * 1024 * 1024) throw new CsvImportError('CSV 文件超过 10 MB');
    const words = parseWordCsv(await file.text());
    await chrome.storage.local.set(words);
    await loadWords();
    importStatus.dataset.tone = 'success';
    importStatus.textContent = `已导入 ${Object.keys(words).length} 条词条`;
  } catch (error) {
    importStatus.textContent = error instanceof CsvImportError
      ? `导入失败：${error.message}` : '导入失败：读取文件或保存词条失败，请重试';
  } finally {
    importFile.value = '';
    importButton.disabled = false;
  }
});

void initialize();
void loadWords();
