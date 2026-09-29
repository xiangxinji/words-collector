# Words Collector Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a load-unpacked Manifest V3 Chrome extension that optionally saves double-clicked webpage selections to local extension storage.

**Architecture:** A popup owns one persisted boolean switch. A static HTTP/HTTPS content script snapshots each double-click selection synchronously, then consults the switch and stores nonempty selections under individual `word:` keys. No service worker, bundler, backend, or remote calls.

**Tech Stack:** Chrome Manifest V3, browser JavaScript/HTML/CSS, Node.js 20+ built-in `node:test` and `node:vm` for tests (no installed dependencies).

**Spec:** `docs/superpowers/specs/2026-09-29-words-collector-extension-design.md`

## Global Constraints

- Plain extension loaded from the repository root with no build step; initial switch value is `false`.
- One entry per exactly matching, case-sensitive, trimmed selection; preserve multiword text; don't store blanks or editable/input selections.
- `chrome.storage.local` only; no network, vocabulary UI, extra permission, framework, or backend.
- Browser coverage: ordinary HTTP/HTTPS pages only; unsupported browser-internal pages and form-control selections are documented.
- A toggle write error restores the previous checked state and displays an error; collection errors never obstruct a webpage or log selected text.

## Review Focus

- Another selection is made before an async settings read completes: store the text from the original double-click, not the later selection (Task 2 delayed-read test).
- Two tabs save different words together: each word gets an independent storage key instead of a shared list (Task 2 distinct-key test).
- A user double-clicks input or editable text: neither editable selection nor a stale page selection is saved (Task 2 editable-target test).
- Storage fails while the user turns collection on: the popup reverts the checkbox and shows an error (Task 1 write-failure test).
- Popup opens before any setting was stored or the setting cannot be read: it stays off and reports read errors rather than silently showing on (Task 1 initialization tests).

---

## File map

- `manifest.json`: Chrome entry points and minimal `storage` permission; Task 2 adds HTTP/HTTPS script matches.
- `popup.html`: small accessible switch and live error/status region; inline minimal styling.
- `popup.js`: read and persist the switch; report failures and revert attempted changes.
- `content.js`: snapshot on double-click, filter editable targets, read enabled state, write an independent word key.
- `tests/popup.test.cjs`: manifest assertions and VM-powered popup tests with mocked browser APIs.
- `tests/content.test.cjs`: VM-powered content-script tests with mocked document, selection and storage.
- `README.md`: no-build installation and manual verification instructions.

### Task 1: Extension shell and persisted popup switch

**Files:**
- Create: `manifest.json`, `popup.html`, `popup.js`, `tests/popup.test.cjs`

**Interfaces:**
- Consumes: Chrome `chrome.storage.local.get('collectionEnabled')` and `.set({ collectionEnabled: boolean })`.
- Produces: a persisted key named `collectionEnabled` (boolean), DOM IDs `collection-toggle` and `status`; Task 2 adds a content script to the manifest.

- [ ] **Step 1: Write failing tests**

Create `tests/popup.test.cjs` with browser shims; keep the DOM shim narrow (only the APIs used by the real popup). Include the following tests, using `setImmediate` to wait for `void init()`:

```js
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
```

- [ ] **Step 2: Verify RED** — run `node --test tests/popup.test.cjs`; expect ENOENT for missing popup/manifest.

- [ ] **Step 3: Implement the manifest**

```json
{
  "manifest_version": 3,
  "name": "Words Collector",
  "version": "0.1.0",
  "description": "Save selected webpage text locally when collection is enabled.",
  "permissions": ["storage"],
  "action": { "default_popup": "popup.html" }
}
```

- [ ] **Step 4: Implement popup UI and controller**

Use `popup.html` with `<!doctype html>`, `lang="zh-CN"`, UTF-8 metadata, a labelled `<input id="collection-toggle" type="checkbox" disabled>` and `<p id="status" role="status" aria-live="polite">`; reference `<script src="popup.js"></script>` after markup. Set a readable small width and spacing with inline CSS, and render only the switch + short explanation/error (no word list). Use this controller in `popup.js`:

```js
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
```

- [ ] **Step 5: Verify GREEN** — run `node --test tests/popup.test.cjs`; expect 4 passing tests. Also run `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`; expect exit code 0. This interim extension can already load in Chrome, but cannot collect until Task 2.
- [ ] **Step 6: Commit** — `git add manifest.json popup.html popup.js tests/popup.test.cjs && git commit -m "feat: add Chrome extension switch and manifest"` (on PowerShell, separate commands with `;` if necessary).

### Task 2: Selection collection, concurrency-safe storage, and user instructions

**Files:**
- Create: `content.js`, `tests/content.test.cjs`
- Modify: `manifest.json`, `README.md`

**Interfaces:**
- Consumes: `collectionEnabled` from Task 1, `window.getSelection().toString()` and `document.addEventListener('dblclick', listener)`.
- Produces: `chrome.storage.local` entries keyed `word:` + trimmed text, value = trimmed text; e.g. `{ 'word:hello': 'hello' }`.

- [ ] **Step 1: Write failing content-script tests**

Create `tests/content.test.cjs`. Reuse the following small VM harness so events can be awaited without mounting Chrome:

```js
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
```

- [ ] **Step 2: Verify RED** — run `node --test tests/content.test.cjs`; expect a failure for missing content-script registration and ENOENT for missing `content.js`.

- [ ] **Step 3: Implement the smallest content script and register it**

Add `"content_scripts": [{ "matches": ["http://*/*", "https://*/*"], "js": ["content.js"] }]` to `manifest.json`. Use `content.js` as a single listener; snapshot text before the asynchronous settings check. No logs that include selected text, no `preventDefault` and no background worker:

```js
document.addEventListener('dblclick', async event => {
  if (event.target?.closest?.('input, textarea, [contenteditable]')) return;
  const text = window.getSelection()?.toString().trim();
  if (!text) return;
  try {
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled) await chrome.storage.local.set({ ['word:' + text]: text });
  } catch {
    // An unavailable extension store must not interfere with the webpage.
  }
});
```

- [ ] **Step 4: Verify GREEN** — run `node --test tests/content.test.cjs` and `node --test`; expect both test files pass. Run `git diff --check`; expect no whitespace errors.

- [ ] **Step 5: Update README**

Document: `chrome://extensions` → Developer mode → Load unpacked → repository root; open a normal HTTP/HTTPS site (reload any tab opened before installing), open the popup and turn collection on, double-click a word, verify via popup inspection console `chrome.storage.local.get(null).then(console.log)` or Chrome extension storage inspector; turn off, double-click a different word and verify its `word:` key was not added. Mention per-word key, exact-case dedupe, no word list, no network, unsupported internal pages/form fields. Testing: Node.js 20+ `node --test`. No package install or build command.

- [ ] **Step 6: Manual Chrome smoke test if Chrome is available** — follow README with a local page served at `http://localhost:PORT` or any safe HTTP/HTTPS page. Record whether tested or unavailable; don't claim manual browser verification from VM tests alone.
- [ ] **Step 7: Commit** — `git add content.js tests/content.test.cjs manifest.json README.md; git commit -m "feat: collect double-click selections locally"`.

## Final verification

- [ ] Run `node --test` fresh, `git diff --check`, `git status --short --branch`, and inspect loaded extension in Chrome if available.
- [ ] Compare spec and plan: no word-list UI, no remote calls, only HTTP/HTTPS pages, exact-case dedupe and disabled-by-default toggle.
