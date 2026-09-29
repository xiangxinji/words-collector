const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function popup(storage = {}, fail = {}) {
  const handlers = new Map();
  const toggle = { checked: false, disabled: true, addEventListener(type, fn) { handlers.set(type, fn); } };
  const status = { textContent: '' };
  const chrome = { storage: { local: {
    async get() { if (fail.read) throw Error('read failed'); return { collectionEnabled: storage.collectionEnabled }; },
    async set(values) { if (fail.write) throw Error('write failed'); Object.assign(storage, values); }
  } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), {
    document: { querySelector(selector) { return selector === '#collection-toggle' ? toggle : status; } }, chrome
  });
  return { toggle, status, storage, change: () => handlers.get('change')(), ready: () => new Promise(setImmediate) };
}

test('MV3 popup manifest needs only storage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(html, /id="collection-toggle"/);
  assert.match(html, /id="status"/);
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
