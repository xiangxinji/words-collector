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

function element(tagName) {
  const listeners = {};
  const children = [];
  return {
    tagName, style: {}, children, disabled: false,
    addEventListener(type, fn) { listeners[type] = fn; },
    dispatch(type, event = { isTrusted: true }) { return listeners[type]?.(event); },
    appendChild(child) { children.push(child); return child; },
    remove() { this.removed = true; },
    attachShadow() { this.shadowRoot = element('shadow'); return this.shadowRoot; }
  };
}

function page(storage = {}, options = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const body = element('body');
  let selection = options.selection ?? '';
  let rect = options.rect ?? { left: 25, right: 75, top: 40, bottom: 58 };
  const writes = [];
  const messages = [];
  const chrome = {
    get storage() { throw Error('content script must not read storage directly'); },
    runtime: { async sendMessage(message) {
      messages.push(JSON.parse(JSON.stringify(message)));
      if (message.type === 'getEnabled') {
        if (options.read) return options.read();
        return { enabled: storage.collectionEnabled === true };
      }
      if (message.type !== 'collect') throw Error('unexpected message');
      if (!storage.collectionEnabled) return { ok: false, code: 'disabled' };
      if (options.collect) return options.collect(message);
      if (options.failWrite) return { ok: false, code: 'failed' };
      const value = { ['word:' + message.text]: message.text };
      writes.push(value);
      Object.assign(storage, value);
      return { ok: true };
    } }
  };
  vm.runInNewContext(source(), {
    chrome,
    document: {
      body,
      createElement: element,
      addEventListener(type, fn) { documentListeners[type] = fn; }
    },
    window: {
      innerWidth: options.innerWidth ?? 800,
      innerHeight: options.innerHeight ?? 600,
      addEventListener(type, fn) { windowListeners[type] = fn; },
      getSelection() { return { toString: () => selection, rangeCount: 1,
        getRangeAt() { return { getBoundingClientRect: () => rect }; } }; }
    }
  });
  const currentHost = () => body.children.findLast(node => !node.removed);
  const button = () => currentHost()?.shadowRoot.children.find(node => node.tagName === 'button');
  return {
    fire(editable = false) { return documentListeners.dblclick({ target: { closest: () => editable ? {} : null } }); },
    drag({ startX = 10, startY = 10, endX = 60, endY = 10, detail = 1, button = 0, editableStart = false, editableEnd = false } = {}) {
      documentListeners.mousedown?.({ button, clientX: startX, clientY: startY,
        target: { closest: () => editableStart ? {} : null } });
      return documentListeners.mouseup?.({ button, detail, clientX: endX, clientY: endY,
        target: { closest: () => editableEnd ? {} : null } });
    },
    outside() { documentListeners.pointerdown({ target: body }); },
    inside() { documentListeners.pointerdown({ target: currentHost() }); },
    scroll() { windowListeners.scroll(); },
    resize() { windowListeners.resize(); },
    select(value) { selection = value; },
    setRect(value) { rect = value; },
    currentHost, button, writes, messages, storage
  };
}

test('double-click only shows a button beside selected text; it does not save', async () => {
  const p = page({ collectionEnabled: true }, { selection: '  Hello world  ' });
  await p.fire();
  assert.equal(p.writes.length, 0);
  assert.equal(p.button()?.textContent, '收集');
  assert.equal(p.currentHost()?.style.left, '83px');
  assert.equal(p.currentHost()?.style.top, '40px');
  assert.equal(p.currentHost()?.style.backgroundColor, '#fff');
});

test('selection action uses the same compact blue visual language as the popup', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'word' });
  await p.fire();
  const host = p.currentHost();
  const buttonStyle = host.shadowRoot.children.find(node => node.tagName === 'style').textContent;
  assert.equal(host.style.width, '88px');
  assert.equal(host.style.borderRadius, '12px');
  assert.match(buttonStyle, /min-height: 36px/);
  assert.match(buttonStyle, /background: #315dd1/);
  assert.match(buttonStyle, /:focus-visible/);
});
test('clicking 收集 saves the snapshotted selection and closes the window', async () => {
  const p = page({ collectionEnabled: true }, { selection: '  Hello world  ' });
  await p.fire(); p.select('another word');
  await p.button().dispatch('click');
  assert.equal(p.storage['word:Hello world'], 'Hello world');
  assert.equal(p.storage['word:another word'], undefined);
  assert.equal(p.currentHost(), undefined);
});

test('off, blank, and editable selections never show a button or save', async () => {
  const p = page({}, { selection: 'word' });
  await p.fire(); assert.equal(p.button(), undefined);
  p.storage.collectionEnabled = true;
  p.select('  '); await p.fire(); assert.equal(p.button(), undefined);
  p.select('private'); await p.fire(true); assert.equal(p.button(), undefined);
  assert.equal(p.writes.length, 0);
});

test('clicking elsewhere dismisses; selecting again replaces the old window', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'first' });
  await p.fire(); const first = p.currentHost();
  p.inside(); assert.equal(p.currentHost(), first);
  p.select('second'); await p.fire(); assert.equal(first.removed, true);
  p.outside(); assert.equal(p.currentHost(), undefined);
  assert.equal(p.writes.length, 0);
});

test('double-click preserves phrases and case under separate keys', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'Hello world' });
  await p.fire(); await p.button().dispatch('click');
  await p.fire(); await p.button().dispatch('click');
  p.select('hello world'); await p.fire(); await p.button().dispatch('click');
  assert.deepEqual(Object.keys(p.storage).sort(), ['collectionEnabled', 'word:Hello world', 'word:hello world']);
  assert.equal(p.writes.length, 3);
});

test('slow settings read does not show a window after an outside click', async () => {
  let release;
  const p = page({}, { selection: 'first', read: () => new Promise(resolve => { release = resolve; }) });
  const pending = p.fire(); p.select('second'); p.outside();
  release({ enabled: true }); await pending;
  assert.equal(p.currentHost(), undefined);
  assert.equal(p.writes.length, 0);
});

test('turning collection off before clicking prevents saving', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'word' });
  await p.fire(); p.storage.collectionEnabled = false;
  await p.button().dispatch('click');
  assert.equal(p.writes.length, 0);
  assert.equal(p.currentHost(), undefined);
});

test('scroll and resize dismiss the window; near viewport edge the window stays visible', async () => {
  const p = page({ collectionEnabled: true, }, { selection: 'word', innerWidth: 200, innerHeight: 100,
    rect: { left: 175, right: 198, top: 90, bottom: 99 } });
  await p.fire();
  assert.ok(parseInt(p.currentHost().style.left) <= 128);
  assert.ok(parseInt(p.currentHost().style.top) <= 62);
  p.scroll(); assert.equal(p.currentHost(), undefined);
  await p.fire(); p.resize(); assert.equal(p.currentHost(), undefined);
});

test('storage read and write failures do not affect the page', async () => {
  const shared = { collectionEnabled: true };
  const readFailure = page(shared, { selection: 'error', read: async () => { throw Error('read failed'); } });
  await assert.doesNotReject(readFailure.fire()); assert.equal(readFailure.currentHost(), undefined);
  const writeFailure = page(shared, { selection: 'error', failWrite: true });
  await writeFailure.fire(); await assert.doesNotReject(writeFailure.button().dispatch('click'));
  assert.equal(shared['word:error'], undefined);
});

test('drag-selecting text shows the same button and saves only after clicking it', async () => {
  const p = page({ collectionEnabled: true }, { selection: '  dragged words  ' });
  await p.drag();
  assert.equal(p.button()?.textContent, '收集');
  assert.equal(p.writes.length, 0);
  await p.button().dispatch('click');
  assert.equal(p.storage['word:dragged words'], 'dragged words');
  assert.equal(p.currentHost(), undefined);
});

test('an ordinary click or tiny mouse movement does not reuse a stale selection', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'already selected' });
  await p.drag({ endX: 10, endY: 10 });
  await p.drag({ endX: 13, endY: 12 });
  assert.equal(p.button(), undefined);
  assert.equal(p.writes.length, 0);
});

test('dragging ignores disabled collection, blank selections, and editable fields', async () => {
  const p = page({}, { selection: 'word' });
  await p.drag(); assert.equal(p.button(), undefined);
  p.storage.collectionEnabled = true;
  p.select('  '); await p.drag(); assert.equal(p.button(), undefined);
  p.select('private'); await p.drag({ editableStart: true }); assert.equal(p.button(), undefined);
  await p.drag({ editableEnd: true }); assert.equal(p.button(), undefined);
  assert.equal(p.writes.length, 0);
});

test('the second mouseup of a double click does not create a competing window', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'word' });
  await p.drag({ detail: 2 });
  assert.equal(p.currentHost(), undefined);
  await p.fire();
  assert.equal(p.button()?.textContent, '收集');
  assert.equal(p.writes.length, 0);
});

test('only clicking Collect sends the trimmed text to the worker', async () => {
  const p = page({ collectionEnabled: true }, { selection: '  chosen word  ' });
  await p.fire();
  assert.deepEqual(p.messages, [{ type: 'getEnabled' }]);
  await p.button().dispatch('click');
  assert.deepEqual(p.messages[1], { type: 'collect', text: 'chosen word' });
});

test('translation failure leaves the button open for a later retry without leaking text', async () => {
  let attempts = 0;
  const p = page({ collectionEnabled: true }, { selection: 'private selected word', collect: async () => {
    if (++attempts === 1) return { ok: false, code: 'failed' };
    return { ok: true };
  } });
  await p.fire();
  await p.button().dispatch('click');
  assert.equal(p.button().textContent, '重试');
  assert.equal(p.button().disabled, false);
  assert.doesNotMatch(p.button().title, /private|selected/);
  assert.equal(p.messages.filter(m => m.type === 'collect').length, 1);
  await p.button().dispatch('click');
  assert.equal(p.currentHost(), undefined);
  assert.equal(attempts, 2);
});

test('a pending worker request blocks repeated clicks', async () => {
  let release;
  const p = page({ collectionEnabled: true }, { selection: 'queued', collect: () => new Promise(resolve => { release = resolve; }) });
  await p.fire();
  const button = p.button();
  const pending = button.dispatch('click');
  assert.equal(button.disabled, true);
  await button.dispatch('click');
  assert.equal(p.messages.filter(m => m.type === 'collect').length, 1);
  release({ ok: true }); await pending;
  assert.equal(p.currentHost(), undefined);
});
test('synthetic page clicks cannot collect text or trigger translation', async () => {
  const p = page({ collectionEnabled: true }, { selection: 'do not upload' });
  await p.fire();
  await p.button().dispatch('click', { isTrusted: false });
  assert.equal(p.messages.filter(message => message.type === 'collect').length, 0);
  assert.equal(p.storage['word:do not upload'], undefined);
  assert.equal(p.button().disabled, false);
});
