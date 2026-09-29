const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function element(tagName) {
  const handlers = new Map();
  return {
    tagName, children: [], textContent: '', dataset: {},
    addEventListener(type, fn) { handlers.set(type, fn); },
    setAttribute(name, value) { this[name] = value; },
    dispatch(type) { return handlers.get(type)?.(); },
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = []; nodes.forEach(node => this.appendChild(node)); },
    remove() { this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  };
}

function popup(storage = {}, fail = {}) {
  const toggle = element('input');
  toggle.checked = false;
  toggle.disabled = true;
  const status = element('p');
  const translationToggle = element('input');
  translationToggle.checked = false;
  translationToggle.disabled = true;
  const appId = element('input');
  appId.value = '';
  const secret = element('input');
  secret.value = '';
  const saveCredentials = element('button');
  saveCredentials.disabled = true;
  const translationStatus = element('p');
  const levels = [];
  const wordList = element('ul');
  const exportButton = element('button');
  exportButton.disabled = true;
  const importButton = element('button');
  importButton.disabled = true;
  const importFile = element('input');
  importFile.files = [];
  importFile.value = '';
  let pickerClicks = 0;
  importFile.click = () => { pickerClicks++; };
  const writes = [];
  const downloads = [];
  const urls = new Map();
  const revoked = [];
  const wordCount = element('span');
  const emptyState = element('p');
  emptyState.hidden = true;
  const listStatus = element('p');
  const importStatus = element('p');
  const elements = {
    '#collection-toggle': toggle, '#status': status, '#translation-toggle': translationToggle,
    '#baidu-app-id': appId, '#baidu-secret': secret, '#save-credentials': saveCredentials,
    '#translation-status': translationStatus, '#word-list': wordList, '#export-words': exportButton,
    '#import-words': importButton, '#import-file': importFile, '#import-status': importStatus,
    '#word-count': wordCount, '#empty-state': emptyState, '#list-status': listStatus
  };
  const chrome = { storage: { local: {
    async setAccessLevel(level) { if (fail.access) throw Error('access failed'); levels.push({ ...level }); },
    async get(key) {
      if (fail.read) throw Error('read failed');
      if (key === null) return { ...storage };
      if (Array.isArray(key)) return Object.fromEntries(key.map(item => [item, storage[item]]));
      return { [key]: storage[key] };
    },
    async set(values) { if (fail.write) throw Error('write failed');
      const copy = JSON.parse(JSON.stringify(values)); writes.push(copy); Object.assign(storage, copy); },
    async remove(key) { if (fail.remove) throw Error('remove failed'); delete storage[key]; }
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), {
    document: { querySelector(selector) { return elements[selector]; }, createElement(tag) {
      const node = element(tag);
      if (tag === 'a') node.click = () => downloads.push({ name: node.download, blob: urls.get(node.href) });
      return node;
    } }, chrome, Blob, TextEncoder, URL: {
      createObjectURL(blob) { const url = 'blob:local-' + urls.size; urls.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    }
  });
  return {
    toggle, status, translationToggle, appId, secret, saveCredentials, translationStatus, levels,
    wordList, wordCount, emptyState, listStatus, exportButton, importButton, importFile, importStatus,
    downloads, revoked, writes, storage, pickerClicks: () => pickerClicks,
    change: () => toggle.dispatch('change'),
    changeTranslation: () => translationToggle.dispatch('change'),
    saveSettings: () => saveCredentials.dispatch('click'),
    export: () => exportButton.dispatch('click'),
    openImport: () => importButton.dispatch('click'),
    chooseCsv(text, { name = 'words-collector.csv', size = new Blob([text]).size } = {}) {
      importFile.files = [{ name, size, text: async () => text }];
      importFile.value = name;
      return importFile.dispatch('change');
    },
    ready: () => new Promise(setImmediate)
  };
}

test('MV3 popup manifest needs only storage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(html, /id="collection-toggle"/);
  assert.match(html, /id="export-words"[^>]*disabled/);
  assert.match(html, /id="import-words"[^>]*disabled/);
  assert.match(html, /id="import-file"[^>]*type="file"[^>]*hidden/);
  assert.match(html, /id="status"/);
  for (const id of ['word-list', 'word-count', 'empty-state', 'list-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('popup prioritizes collection and words while credentials stay behind a disclosure', () => {
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.ok(html.indexOf('id="collection-toggle"') < html.indexOf('id="word-list"'));
  assert.ok(html.indexOf('id="word-list"') < html.indexOf('id="translation-toggle"'));
  assert.match(html, /<details[^>]*class="credentials"[^>]*>\s*<summary>配置百度凭据<\/summary>/);
  assert.ok(html.indexOf('<details') < html.indexOf('id="baidu-app-id"'));
  assert.ok(html.indexOf('id="baidu-secret"') < html.indexOf('</details>'));
  assert.ok(html.indexOf('只有点击「收集」') < html.indexOf('<details'));
  assert.match(html, /id="collection-toggle"[^>]*disabled/);
  assert.match(html, /id="translation-toggle"[^>]*disabled/);
});

test('missing setting defaults off; toggling saves and reopens on', async () => {
  const state = {};
  const first = popup(state); await first.ready();
  assert.equal(first.toggle.checked, false);
  first.toggle.checked = true; await first.change();
  assert.equal(state.collectionEnabled, true);
  const second = popup(state); await second.ready();
  assert.equal(second.toggle.checked, true);
});

test('failed write reverts checkbox and reports error', async () => {
  const p = popup({ collectionEnabled: false }, { write: true }); await p.ready();
  p.toggle.checked = true; await p.change();
  assert.equal(p.toggle.checked, false);
  assert.match(p.status.textContent, /失败/);
});

test('failed read stays off and reports error', async () => {
  const p = popup({}, { read: true }); await p.ready();
  assert.equal(p.toggle.checked, false);
  assert.match(p.status.textContent, /失败/);
});

test('popup lists saved words without showing the setting or unrelated keys', async () => {
  const p = popup({ collectionEnabled: true, 'word:Hello': 'Hello', 'word:世界': '世界', unrelated: 'hidden' });
  await p.ready();
  assert.deepEqual(p.wordList.children.map(item => item.children[0].textContent).sort(), ['Hello', '世界']);
  assert.equal(p.wordCount.textContent, '共 2 条');
  assert.equal(p.emptyState.hidden, true);
});

test('delete button removes only its word and updates the list immediately', async () => {
  const p = popup({ collectionEnabled: true, 'word:one': 'one', 'word:two': 'two' });
  await p.ready();
  const item = p.wordList.children.find(row => row.children[0].textContent === 'one');
  assert.equal(item.children[1]?.textContent, '删除');
  await item.children[1].dispatch('click');
  assert.equal(p.storage['word:one'], undefined);
  assert.equal(p.storage['word:two'], 'two');
  assert.equal(p.storage.collectionEnabled, true);
  assert.deepEqual(p.wordList.children.map(row => row.children[0].textContent), ['two']);
  assert.equal(p.wordCount.textContent, '共 1 条');
  const reopened = popup(p.storage); await reopened.ready();
  assert.deepEqual(reopened.wordList.children.map(row => row.children[0].textContent), ['two']);
});


test('empty collection shows a helpful message; removing the last word restores it', async () => {
  const empty = popup({ collectionEnabled: false }); await empty.ready();
  assert.equal(empty.wordList.children.length, 0);
  assert.equal(empty.wordCount.textContent, '共 0 条');
  assert.equal(empty.emptyState.hidden, false);
  assert.equal(empty.exportButton.disabled, true);
  assert.equal(empty.importButton.disabled, false);

  const p = popup({ 'word:last': 'last' }); await p.ready();
  await p.wordList.children[0].children[1].dispatch('click');
  assert.equal(p.wordList.children.length, 0);
  assert.equal(p.wordCount.textContent, '共 0 条');
  assert.equal(p.emptyState.hidden, false);
  assert.equal(p.exportButton.disabled, true);
});

test('failed deletion keeps the word and allows a retry', async () => {
  const fail = { remove: true };
  const p = popup({ 'word:keep': 'keep' }, fail); await p.ready();
  const button = p.wordList.children[0].children[1];
  await button.dispatch('click');
  assert.equal(p.storage['word:keep'], 'keep');
  assert.equal(p.wordList.children.length, 1);
  assert.equal(button.disabled, false);
  assert.match(p.listStatus.textContent, /失败/);
  fail.remove = false;
  await button.dispatch('click');
  assert.equal(p.storage['word:keep'], undefined);
  assert.equal(p.listStatus.textContent, '');
});

test('failed list read reports an error without affecting the toggle', async () => {
  const p = popup({}, { read: true }); await p.ready();
  assert.match(p.listStatus.textContent, /失败/);
  assert.equal(p.wordList.children.length, 0);
  assert.equal(p.toggle.checked, false);
});

test('translation is off by default and popup only requests trusted storage access', async () => {
  const p = popup({ collectionEnabled: true }); await p.ready();
  assert.equal(p.translationToggle.checked, false);
  assert.equal(p.translationToggle.disabled, false);
  assert.deepEqual(p.levels, [{ accessLevel: 'TRUSTED_CONTEXTS' }]);
  p.translationToggle.checked = true; await p.changeTranslation();
  assert.equal(p.storage.translationEnabled, true);
  assert.equal(p.storage.collectionEnabled, true);
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  for (const id of ['translation-toggle', 'baidu-app-id', 'baidu-secret', 'save-credentials', 'translation-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="baidu-secret"[^>]*type="password"|type="password"[^>]*id="baidu-secret"/);
  assert.match(html, /id="save-credentials"[^>]*disabled/);
});

test('credentials save locally, and reopening never displays the saved secret in the password input', async () => {
  const data = {};
  const p = popup(data); await p.ready();
  p.appId.value = ' APP ';
  p.secret.value = ' SECRET ';
  await p.saveSettings();
  assert.equal(data.baiduAppId, 'APP');
  assert.equal(data.baiduSecret, 'SECRET');
  assert.equal(p.secret.value, '');
  const next = popup(data); await next.ready();
  assert.equal(next.appId.value, 'APP');
  assert.equal(next.secret.value, '');
  await next.saveSettings();
  assert.equal(data.baiduSecret, 'SECRET');
  next.appId.value = 'OTHER';
  await next.saveSettings();
  assert.equal(data.baiduAppId, 'APP');
  assert.match(next.translationStatus.textContent, /密钥/);
});

test('setting write failure reverts the translation switch and keeps credentials intact', async () => {
  const data = { translationEnabled: false, baiduAppId: 'APP', baiduSecret: 'SECRET' };
  const fail = { write: true };
  const p = popup(data, fail); await p.ready();
  p.translationToggle.checked = true; await p.changeTranslation();
  assert.equal(p.translationToggle.checked, false);
  assert.match(p.translationStatus.textContent, /失败/);
  p.secret.value = 'NEW'; await p.saveSettings();
  assert.equal(data.baiduSecret, 'SECRET');
  assert.doesNotMatch(p.translationStatus.textContent, /SECRET/);
});

test('failed trusted access keeps the translation switch disabled and displays an error', async () => {
  const p = popup({}, { access: true }); await p.ready();
  assert.equal(p.translationToggle.checked, false);
  assert.equal(p.translationToggle.disabled, true);
  assert.equal(p.saveCredentials.disabled, true);
  p.appId.value = 'APP'; p.secret.value = 'SECRET';
  await p.saveSettings();
  assert.equal(p.storage.baiduSecret, undefined);
  assert.match(p.translationStatus.textContent, /失败/);
});

test('legacy words and translated objects show both texts safely and delete only one key', async () => {
  const p = popup({ 'word:old': 'old', 'word:world': { text: 'world', translation: '<img src=x>' } });
  await p.ready();
  const item = p.wordList.children.find(row => row.children[0].textContent === 'world');
  assert.equal(item.children[0].textContent, 'world');
  assert.equal(item.children[1].tagName, 'span');
  assert.equal(item.children[1].textContent, '<img src=x>');
  await item.children.at(-1).dispatch('click');
  assert.equal(p.storage['word:world'], undefined);
  assert.equal(p.storage['word:old'], 'old');
  assert.equal(p.wordCount.textContent, '共 1 条');
});
test('credential feedback distinguishes saved credentials from an error', async () => {
  const p = popup(); await p.ready();
  p.appId.value = 'APP';
  p.secret.value = 'SECRET';
  await p.saveSettings();
  assert.equal(p.translationStatus.textContent, '凭据已保存');
  assert.equal(p.translationStatus.dataset?.tone, 'success');

  p.appId.value = 'OTHER';
  await p.saveSettings();
  assert.match(p.translationStatus.textContent, /密钥/);
  assert.equal(p.translationStatus.dataset?.tone, 'error');
});

test('failed translation switch update is an error even after saving credentials', async () => {
  const fail = { write: false };
  const p = popup({}, fail); await p.ready();
  p.appId.value = 'APP'; p.secret.value = 'SECRET';
  await p.saveSettings();
  assert.equal(p.translationStatus.dataset.tone, 'success');
  fail.write = true;
  p.translationToggle.checked = true;
  await p.changeTranslation();
  assert.match(p.translationStatus.textContent, /失败/);
  assert.equal(p.translationStatus.dataset.tone, 'error');
});

test('newest successfully collected words appear first and unknown legacy dates appear last', async () => {
  const p = popup({
    'word:z-old': 'z-old', 'word:a-old': { text: 'a-old', translation: '旧词' },
    'word:first': { text: 'first', collectedAt: 1750000001000 },
    'word:latest': { text: 'latest', translation: '最新', collectedAt: 1750000003000 },
    'word:invalid': { text: 'invalid', collectedAt: 'yesterday' }
  });
  await p.ready();
  assert.deepEqual(p.wordList.children.map(item => item.children[0].textContent),
    ['latest', 'first', 'a-old', 'invalid', 'z-old']);
  assert.equal(p.exportButton.disabled, false);
});

test('export downloads only words in newest-first UTF-8 CSV with legacy and spreadsheet safety', async () => {
  const p = popup({
    baiduAppId: 'DO_NOT_EXPORT_ID', baiduSecret: 'DO_NOT_EXPORT_SECRET', translationEnabled: true,
    'word:old': 'old',
    'word:=1+2': { text: '=1+2', translation: '+SUM(1,1)', collectedAt: 1750000003000 },
    'word:phrase,\n"quoted"': { text: 'phrase,\n"quoted"', collectedAt: 1750000002000 }
  });
  await p.ready();
  await p.export();
  assert.equal(p.downloads.length, 1);
  assert.match(p.downloads[0].name, /^words-collector.*\.csv$/);
  assert.equal(p.downloads[0].blob.type, 'text/csv;charset=utf-8');
  const bytes = new Uint8Array(await p.downloads[0].blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = await p.downloads[0].blob.text();
  assert.ok(csv.startsWith('原文,译文,最近收集时间（本地）\r\n'));
  assert.match(csv, /"\t=1\+2","\t\+SUM\(1,1\)","2025-/);
  assert.ok(csv.includes('"phrase,\n""quoted"""'));
  assert.ok(csv.endsWith('"old","","未知（旧数据）"\r\n'));
  assert.ok(csv.indexOf('\t=1+2') < csv.indexOf('phrase,') && csv.indexOf('phrase,') < csv.indexOf('"old"'));
  assert.doesNotMatch(csv, /DO_NOT_EXPORT|translationEnabled/);
  assert.equal(p.revoked.length, 1);
});

test('empty or unreadable word lists do not download anything', async () => {
  const empty = popup(); await empty.ready();
  await empty.export();
  assert.equal(empty.downloads.length, 0);
  const failed = popup({ 'word:keep': 'keep' }, { read: true }); await failed.ready();
  await failed.export();
  assert.equal(failed.downloads.length, 0);
  assert.equal(failed.exportButton.disabled, true);
});

test('failed export read reports an error and allows retry without creating a partial file', async () => {
  const fail = { read: false };
  const p = popup({ 'word:keep': 'keep' }, fail); await p.ready();
  fail.read = true;
  await p.export();
  assert.match(p.listStatus.textContent, /导出失败/);
  assert.equal(p.downloads.length, 0);
  assert.equal(p.exportButton.disabled, false);
  fail.read = false;
  await p.export();
  assert.equal(p.downloads.length, 1);
  assert.equal(p.listStatus.textContent, '');
});

test('exported CSV imports as local words with timestamps, quoted text and formula guards', async () => {
  const collectedAt = new Date(2026, 8, 29, 14, 5, 6).getTime();
  const from = popup({
    'word:=1+2': { text: '=1+2', translation: '+结果', collectedAt },
    'word:phrase,\n"quoted"': { text: 'phrase,\n"quoted"', collectedAt: collectedAt - 1000 },
    'word:old': 'old'
  });
  await from.ready(); await from.export();
  const csv = '\uFEFF' + await from.downloads[0].blob.text();
  const to = popup({ collectionEnabled: false, translationEnabled: false, baiduAppId: 'LOCAL_ID', baiduSecret: 'LOCAL_SECRET',
    'word:=1+2': { text: '=1+2', translation: '旧译文', collectedAt: 1 } });
  await to.ready();
  assert.equal(to.importButton.disabled, false);
  await to.openImport();
  assert.equal(to.pickerClicks(), 1);
  await to.chooseCsv(csv);
  assert.deepEqual(to.storage['word:=1+2'], { text: '=1+2', translation: '+结果', collectedAt });
  assert.deepEqual(to.storage['word:phrase,\n"quoted"'], { text: 'phrase,\n"quoted"', collectedAt: collectedAt - 1000 });
  assert.deepEqual(to.storage['word:old'], { text: 'old' });
  assert.equal(to.storage.collectionEnabled, false);
  assert.equal(to.storage.translationEnabled, false);
  assert.equal(to.storage.baiduAppId, 'LOCAL_ID');
  assert.equal(to.storage.baiduSecret, 'LOCAL_SECRET');
  assert.deepEqual(to.wordList.children.map(item => item.children[0].textContent), ['=1+2', 'phrase,\n"quoted"', 'old']);
  assert.equal(to.wordCount.textContent, '共 3 条');
  assert.equal(to.writes.length, 1);
  assert.equal(to.importFile.value, '');
  assert.match(to.importStatus.textContent, /导入 3 条/);
  assert.equal(to.importStatus.dataset.tone, 'success');
  await to.export();
  const reexported = await to.downloads[0].blob.text();
  assert.ok(reexported.includes('"old","","未知（旧数据）"'));
  assert.ok(reexported.includes('"\t=1+2"'));
});

test('CSV import checks every row before writing and rejects unsupported files', async () => {
  const header = '\uFEFF原文,译文,最近收集时间（本地）\r\n';
  const invalid = [
    { csv: header, name: 'header-only.csv' },
    { csv: '原文,译文,日期\r\n"x","",""', name: 'bad.csv' },
    { csv: header + '"unterminated', name: 'bad.csv' },
    { csv: header + '"valid","",""\r\n"broken","x","2026-02-30 10:00:00"', name: 'bad.csv' },
    { csv: header + '"x","","",extra', name: 'bad.csv' },
    { csv: header + '" ","",""', name: 'bad.csv' },
    { csv: header + '"x","",""', name: 'backup.xlsx' },
    { csv: header + '"x","",""', name: 'huge.csv', size: 10 * 1024 * 1024 + 1 }
  ];
  for (const input of invalid) {
    const p = popup({ collectionEnabled: true, 'word:keep': 'keep' }); await p.ready();
    await p.chooseCsv(input.csv, { name: input.name, size: input.size ?? new Blob([input.csv]).size });
    assert.equal(p.writes.length, 0, input.name);
    assert.equal(p.storage['word:keep'], 'keep');
    assert.equal(p.storage['word:valid'], undefined);
    assert.match(p.importStatus.textContent, /导入失败/, input.name);
    assert.equal(p.importStatus.dataset.tone, 'error');
    assert.equal(p.importFile.value, '');
  }
});

test('duplicate CSV rows resolve to the final row without adding a second storage key', async () => {
  const p = popup({ 'word:same': { text: 'same', translation: '旧译', collectedAt: 1 } }); await p.ready();
  await p.chooseCsv('原文,译文,最近收集时间（本地）\r\n"same","第一条","2026-09-29 12:00:00"\r\n"same","第二条","未知（旧数据）"\r\n');
  assert.deepEqual(p.storage['word:same'], { text: 'same', translation: '第二条' });
  assert.equal(Object.keys(p.storage).filter(key => key.startsWith('word:')).length, 1);
  assert.equal(p.wordCount.textContent, '共 1 条');
  assert.match(p.importStatus.textContent, /导入 1 条/);
});

test('a storage write failure does not replace existing words and import can be retried', async () => {
  const fail = { write: true };
  const p = popup({ 'word:keep': { text: 'keep', collectedAt: 1 } }, fail); await p.ready();
  const csv = '原文,译文,最近收集时间（本地）\r\n"keep","新译","未知（旧数据）"\r\n';
  await p.chooseCsv(csv);
  assert.deepEqual(p.storage['word:keep'], { text: 'keep', collectedAt: 1 });
  assert.match(p.importStatus.textContent, /导入失败/);
  fail.write = false;
  await p.chooseCsv(csv);
  assert.deepEqual(p.storage['word:keep'], { text: 'keep', translation: '新译' });
  assert.equal(p.importStatus.dataset.tone, 'success');
});

test('import remains disabled when trusted storage access cannot be established', async () => {
  const p = popup({}, { access: true }); await p.ready();
  assert.equal(p.importButton.disabled, true);
  await p.openImport();
  assert.equal(p.pickerClicks(), 0);
  await p.chooseCsv('原文,译文,最近收集时间（本地）\r\n"x","",""\r\n');
  assert.equal(p.storage['word:x'], undefined);
});

test('an older exported CSV with an empty time imports as an undated word', async () => {
  const p = popup(); await p.ready();
  await p.chooseCsv('原文,译文,最近收集时间（本地）\r\n"earlier","过去",""\r\n');
  assert.deepEqual(p.storage['word:earlier'], { text: 'earlier', translation: '过去' });
  await p.export();
  assert.ok((await p.downloads[0].blob.text()).includes('"earlier","过去","未知（旧数据）"'));
});
