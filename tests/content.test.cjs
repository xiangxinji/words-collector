const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = () => fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

test('manifest injects script on ordinary HTTP/HTTPS pages only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);
});

function page(storage = {}, options = {}) {
  let listener;
  let selection = options.selection ?? '';
  const writes = [];
  const chrome = { storage: { local: {
    async get() { if (options.read) return options.read(); return { collectionEnabled: storage.collectionEnabled }; },
    async set(value) { if (options.failWrite) throw Error('write failed'); writes.push(value); Object.assign(storage, value); }
  } } };
  vm.runInNewContext(source(), {
    chrome,
    document: { addEventListener(type, fn) { assert.equal(type, 'dblclick'); listener = fn; } },
    window: { getSelection() { return { toString: () => selection }; } }
  });
  return { fire: (editable = false) => listener({ target: { closest: () => editable ? {} : null } }),
    select: value => { selection = value; }, writes, storage };
}

test('off and blank selections do not write', async () => {
  const p = page({}, { selection: 'word' }); await p.fire();
  p.storage.collectionEnabled = true; p.select('  '); await p.fire();
  assert.equal(p.writes.length, 0);
});

test('trim, preserve phrases and case; identical selections overwrite the same key', async () => {
  const p = page({ collectionEnabled: true }, { selection: '  Hello world  ' });
  await p.fire(); await p.fire(); p.select('hello world'); await p.fire();
  assert.deepEqual(Object.keys(p.storage).sort(), ['collectionEnabled', 'word:Hello world', 'word:hello world']);
  assert.equal(p.storage['word:Hello world'], 'Hello world');
  assert.equal(p.writes.length, 3);
});

test('editable target never stores a stale page selection', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'private' });
  await p.fire(true); assert.equal(p.writes.length, 0);
});

test('selection is snapshotted before a delayed storage read', async () => {
  let release;
  const p = page({}, { selection: 'first', read: () => new Promise(resolve => { release = resolve; }) });
  const pending = p.fire(); p.select('second');
  release({ collectionEnabled: true }); await pending;
  assert.equal(p.storage['word:first'], 'first');
  assert.equal(p.storage['word:second'], undefined);
});

test('simultaneous pages use separate keys; storage failures do not affect events', async () => {
  const shared = { collectionEnabled: true };
  const first = page(shared, { selection: 'one' });
  const second = page(shared, { selection: 'two' });
  await Promise.all([first.fire(), second.fire()]);
  assert.equal(shared['word:one'], 'one'); assert.equal(shared['word:two'], 'two');
  const writeFailure = page(shared, { selection: 'error', failWrite: true });
  const readFailure = page(shared, { selection: 'error', read: async () => { throw Error('read failed'); } });
  await assert.doesNotReject(writeFailure.fire());
  await assert.doesNotReject(readFailure.fire());
});
