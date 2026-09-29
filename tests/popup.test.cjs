const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function element(tagName) {
  const handlers = new Map();
  return {
    tagName, children: [], textContent: '',
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
  const wordList = element('ul');
  const wordCount = element('span');
  const emptyState = element('p');
  emptyState.hidden = true;
  const listStatus = element('p');
  const elements = {
    '#collection-toggle': toggle, '#status': status, '#word-list': wordList,
    '#word-count': wordCount, '#empty-state': emptyState, '#list-status': listStatus
  };
  const chrome = { storage: { local: {
    async get(key) {
      if (fail.read) throw Error('read failed');
      return key === null ? { ...storage } : { [key]: storage[key] };
    },
    async set(values) { if (fail.write) throw Error('write failed'); Object.assign(storage, values); },
    async remove(key) { if (fail.remove) throw Error('remove failed'); delete storage[key]; }
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), {
    document: { querySelector(selector) { return elements[selector]; }, createElement: element }, chrome
  });
  return {
    toggle, status, wordList, wordCount, emptyState, listStatus, storage,
    change: () => toggle.dispatch('change'), ready: () => new Promise(setImmediate)
  };
}

test('MV3 popup manifest needs only storage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(html, /id="collection-toggle"/);
  assert.match(html, /id="status"/);
  for (const id of ['word-list', 'word-count', 'empty-state', 'list-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
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

  const p = popup({ 'word:last': 'last' }); await p.ready();
  await p.wordList.children[0].children[1].dispatch('click');
  assert.equal(p.wordList.children.length, 0);
  assert.equal(p.wordCount.textContent, '共 0 条');
  assert.equal(p.emptyState.hidden, false);
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
