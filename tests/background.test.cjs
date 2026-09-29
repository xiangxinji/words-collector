const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function worker(initial = {}, options = {}) {
  const data = { ...initial };
  const fetchCalls = [];
  const writes = [];
  const levels = [];
  let listener;
  let restricted = false;
  const context = {
    TextEncoder, URLSearchParams, AbortSignal,
    crypto: { randomUUID: () => '123' },
    fetch: async (url, request) => {
      fetchCalls.push({ url, request });
      if (options.fetch) return options.fetch(url, request);
      return { ok: true, json: async () => ({ trans_result: [{ dst: '你好' }] }) };
    },
    chrome: {
      storage: { local: {
        async setAccessLevel(level) { levels.push({ ...level }); restricted = true; },
        async get(keys) {
          assert.equal(restricted, true, 'storage must be restricted before reading');
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, data[key]]));
          if (keys === null) return { ...data };
          return { [keys]: data[keys] };
        },
        async set(values) {
          if (options.failWrite) throw Error('write failed');
          const normalized = JSON.parse(JSON.stringify(values));
          writes.push(normalized);
          Object.assign(data, normalized);
        }
      } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } }
    }
  };
  context.importScripts = file => vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const webSender = { tab: { id: 7 }, url: 'https://example.com/article' };
  return { data, fetchCalls, writes, levels,
    send(message, sender = webSender) {
      return new Promise(resolve => {
        assert.equal(listener(message, sender, result => resolve(JSON.parse(JSON.stringify(result)))), true);
      });
    }
  };
}

test('manifest grants only Baidu API origin, not all sites, and registers a service worker', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.host_permissions, ['https://fanyi-api.baidu.com/*']);
  assert.deepEqual(manifest.permissions, ['storage']);
});

test('defaults to off, restricts content script storage and sends no text before click', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'getEnabled' }), { enabled: false });
  assert.deepEqual(await w.send({ type: 'collect', text: 'hello' }), { ok: false, code: 'disabled' });
  assert.deepEqual(w.levels, [{ accessLevel: 'TRUSTED_CONTEXTS' }]);
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.writes.length, 0);
});

test('collection without translation stays local and preserves an existing translation', async () => {
  const w = worker({ collectionEnabled: true, 'word:hello': { text: 'hello', translation: '旧译文' } });
  assert.deepEqual(await w.send({ type: 'getEnabled' }), { enabled: true });
  assert.deepEqual(await w.send({ type: 'collect', text: '  hello  ' }), { ok: true });
  assert.deepEqual(w.data['word:hello'], { text: 'hello', translation: '旧译文' });
  assert.deepEqual(await w.send({ type: 'collect', text: 'offline' }), { ok: true });
  assert.equal(w.data['word:offline'], 'offline');
  assert.equal(w.fetchCalls.length, 0);
});

test('opt-in collection saves a trimmed word and the successful translation atomically', async () => {
  const w = worker({ collectionEnabled: true, translationEnabled: true, baiduAppId: 'APP', baiduSecret: 'SECRET' });
  assert.deepEqual(await w.send({ type: 'getEnabled' }), { enabled: true });
  assert.equal(w.fetchCalls.length, 0);
  assert.deepEqual(await w.send({ type: 'collect', text: '  hello  ' }), { ok: true });
  assert.deepEqual(w.data['word:hello'], { text: 'hello', translation: '你好' });
  assert.deepEqual(w.writes, [{ 'word:hello': { text: 'hello', translation: '你好' } }]);
  assert.equal(w.fetchCalls.length, 1);
});

test('missing credentials and API rejection do not save original text', async () => {
  const noCredentials = worker({ collectionEnabled: true, translationEnabled: true });
  assert.deepEqual(await noCredentials.send({ type: 'collect', text: 'missing' }), { ok: false, code: 'failed' });
  assert.equal(noCredentials.fetchCalls.length, 0);
  assert.equal(noCredentials.data['word:missing'], undefined);
  const rejected = worker({ collectionEnabled: true, translationEnabled: true, baiduAppId: 'APP', baiduSecret: 'SECRET' }, {
    fetch: async () => ({ ok: true, json: async () => ({ error_code: '54003' }) })
  });
  assert.deepEqual(await rejected.send({ type: 'collect', text: 'rejected' }), { ok: false, code: 'failed' });
  assert.equal(rejected.data['word:rejected'], undefined);
});

test('network timeout and failed storage writes do not create a word', async () => {
  const state = { collectionEnabled: true, translationEnabled: true, baiduAppId: 'APP', baiduSecret: 'SECRET' };
  const timeout = worker(state, { fetch: async () => { throw Error('timeout'); } });
  assert.deepEqual(await timeout.send({ type: 'collect', text: 'timeout' }), { ok: false, code: 'failed' });
  assert.equal(timeout.data['word:timeout'], undefined);
  const failed = worker(state, { failWrite: true });
  assert.deepEqual(await failed.send({ type: 'collect', text: 'cannot-save' }), { ok: false, code: 'failed' });
  assert.equal(failed.data['word:cannot-save'], undefined);
});

test('turning collection off while awaiting Baidu prevents a stale save', async () => {
  let respond;
  const w = worker({ collectionEnabled: true, translationEnabled: true, baiduAppId: 'APP', baiduSecret: 'SECRET' }, {
    fetch: () => new Promise(resolve => { respond = resolve; })
  });
  const pending = w.send({ type: 'collect', text: 'slow' });
  for (let i = 0; i < 20 && !respond; i++) await new Promise(setImmediate);
  assert.equal(typeof respond, 'function');
  w.data.collectionEnabled = false;
  respond({ ok: true, json: async () => ({ trans_result: [{ dst: '慢' }] }) });
  assert.deepEqual(await pending, { ok: false, code: 'disabled' });
  assert.equal(w.data['word:slow'], undefined);
});

test('rejects forged messages, non-web senders and oversized UTF-8 selections', async () => {
  const w = worker({ collectionEnabled: true, translationEnabled: true, baiduAppId: 'APP', baiduSecret: 'SECRET' });
  assert.deepEqual(await w.send({ type: 'collect', text: 'secret', url: 'https://attacker/' }, { url: 'https://example.com' }), { ok: false, code: 'failed' });
  assert.deepEqual(await w.send({ type: 'collect', text: 'secret' }, { tab: { id: 7 }, url: 'chrome-extension://test/' }), { ok: false, code: 'failed' });
  assert.deepEqual(await w.send({ type: 'inject', text: 'secret', url: 'https://attacker/' }), { ok: false, code: 'failed' });
  assert.deepEqual(await w.send({ type: 'collect', text: '中'.repeat(2001) }), { ok: false, code: 'failed' });
  assert.equal(w.fetchCalls.length, 0);
  assert.equal(w.writes.length, 0);
});