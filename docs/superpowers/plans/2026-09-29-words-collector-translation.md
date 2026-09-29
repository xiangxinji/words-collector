# Words Collector 百度翻译接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户明确开启在线翻译并点击「收集」时，经百度翻译后将原文和简体中文译文持久保存；关闭翻译时保持完全本地收集。

**Architecture:** `content.js` 只负责选区与用户点击，通过 `chrome.runtime.sendMessage` 请求后台；`background.js` 负责可信存储访问、开关与发送者校验、调用独立 `baidu-translate.js`、原子保存；`popup.js` 管理本地配置与兼容展示旧数据。Service Worker 使用受限的百度 host permission，不引入构建器、第三方依赖或自建服务。

**Tech Stack:** Chrome Manifest V3、原生 JavaScript、`chrome.storage.local`、`chrome.runtime`、`fetch`、Node.js 20+ 的 `node:test`/`vm`。

**Spec:** `docs/superpowers/specs/2026-09-29-words-collector-translation-design.md`

## Global Constraints

- 保留 `collectionEnabled` 默认 `false`；新增 `translationEnabled` 默认 `false`。仅用户点击「收集」且双开关开启时发送该次选中文字到百度；不可记录选中文字或密钥。
- 使用已有 `word:<text>` 键；关闭翻译时仍可保存原文字符串，绝不能覆盖该键已有译文；新版译文值为 `{ text, translation }`，旧字符串值仍可展示及删除。
- 翻译失败、缺凭据、超时或存储失败时，不保存本次新词条、保留按钮供重试；收集开关在请求期间关闭时不写入。
- 根目录可直接作为未打包扩展加载，不新增 bundler、远程服务或运行时依赖；UI 不执行远程脚本；实现遵守 Chrome MV3。`chrome.storage.local.setAccessLevel` 要求 Chrome 103+，在 manifest 中标注最小版本。
- 更新 `README.md` 和 `AGENTS.md`：在线请求触发条件、凭据与条款风险、历史记录兼容；完成前必须执行 `node --test`。
- 百度公开协议限制客户端缓存译文；X 已知情并要求保存，但未确认额外书面许可。不要声称本实现合规；实际使用前由 X 核对授权。

## Review Focus

1. 中文、emoji 和换行的选区：MD5 对原始 UTF-8 字节签名、表单编码正确，不吞掉中间空白；Task 1 的 Unicode 对照测试。
2. 百度返回 `200` 但 `trans_result` 缺失/译文为空：不得写入半成品；Task 1 的异常响应测试。
3. 伪造后台消息或 6000 UTF-8 字节以上的选区：不得触发网络和存储；Task 2 的发送者/长度测试。
4. 百度请求未完成时用户关闭收集：先前请求不再落盘，页面反馈状态一致；Task 2 的竞态测试。
5. 用户关闭翻译后重复收集已翻译的同词：旧译文保留，弹窗显示且删除仅移除该键；Task 2 和 Task 3 的数据兼容测试。

---

## File ownership map

- 新增 `baidu-translate.js`：仅签名、POST 到百度固定 HTTPS 接口、解析译文；不接触 DOM/Chrome storage。
- 新增 `background.js`：注册消息监听，隔离内容脚本与本地配置、校验点击时状态、保存词条。
- 修改 `manifest.json`：后台脚本、百度 host permission、最低 Chrome 版本。
- 修改 `content.js`：以消息代替直接访问 storage；保留既有选区与浮窗行为。
- 修改 `popup.html`/`popup.js`：独立翻译开关、App ID/密钥输入和保存、列表显示译文。
- 新增 `tests/baidu-translate.test.cjs`、`tests/background.test.cjs`；修改 `tests/content.test.cjs`、`tests/popup.test.cjs`。
- 修改 `README.md`、`AGENTS.md`：反映用户同意的受限在线发送行为及协议风险。

### Task 1: 百度 API 客户端与签名

**Files:**
- Create: `baidu-translate.js`
- Test: `tests/baidu-translate.test.cjs`

**Interfaces:**
- Consumes: 原文字符串、用户 App ID/密钥；全局 `fetch`、`crypto.randomUUID`、`TextEncoder`、`URLSearchParams`、`AbortSignal`。
- Produces: `globalThis.BaiduTranslate = { md5Utf8(text), translate(text, appId, secret, fetchImpl = fetch, salt = crypto.randomUUID()) }`，`translate` 返回非空译文字符串，否则抛出不含原文/密钥的错误。

- [ ] **Step 1: 编写签名、请求和异常响应的失败测试。** 使用 `vm.runInNewContext` 加载模块，注入浏览器内建 API；预置 `salt = '123'`，比较 `md5Utf8('APP你好😀123SECRET')` 与 `node:crypto.createHash('md5').update(..., 'utf8').digest('hex')`。mock `fetchImpl` 读取 `URLSearchParams(options.body)`，断言 `q === '你\n好😀'`、`from === 'auto'`、`to === 'zh'`、`sign` 与 Node crypto 一致、`options.method === 'POST'`，返回 `{ ok: true, json: async () => ({ trans_result: [{ dst: '你好' }] }) }`。另分别返回 `{ error_code: '54003' }`、`{ trans_result: [] }`、`{ trans_result: [{ dst: ' ' }] }` 和 `{ ok: false }`，断言全部拒绝；不要在断言输出中打印密钥。

```js
const expected = require('node:crypto').createHash('md5')
  .update('APP你\n好😀123SECRET', 'utf8').digest('hex');
assert.equal(api.md5Utf8('APP你\n好😀123SECRET'), expected);
const form = new URLSearchParams(captured.options.body);
assert.equal(form.get('q'), '你\n好😀');
assert.equal(form.get('sign'), expected);
```

- [ ] **Step 2: 运行 `node --test tests/baidu-translate.test.cjs`，确认因文件或函数缺失而失败。**

```sh
node --test tests/baidu-translate.test.cjs
```

- [ ] **Step 3: 实现 RFC 1321 的 UTF-8 MD5（浏览器 Web Crypto 不提供 MD5），并通过 HTTPS 表单 POST。** 固定 URL `https://api.fanyi.baidu.com/api/trans/vip/translate`（实现时再对照百度官方接入文档），超时使用 `AbortSignal.timeout(12000)`；仅接受数组中非空字符串译文，拼接时使用 `\n`。禁止将原文或密钥放入 URL、throw 错误、console 或返回给网页；不要使用远程库。完整实现结构如下；对照百度官方接入文档确认接口字段：

```js
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
function md5Utf8(text) {
  const input = new TextEncoder().encode(text);
  const size = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(size);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bits = input.length * 8;
  view.setUint32(size - 8, bits >>> 0, true);
  view.setUint32(size - 4, Math.floor(bits / 0x100000000), true);
  let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < size; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i] + view.getUint32(offset + g * 4, true)) >>> 0;
      [a, b, c, d] = [d, (b + rotl(sum, shifts[Math.floor(i / 16)][i % 4])) >>> 0, b, c];
    }
    state = [(state[0] + a) >>> 0, (state[1] + b) >>> 0, (state[2] + c) >>> 0, (state[3] + d) >>> 0];
  }
  return state.map(value => Array.from({ length: 4 }, (_, i) =>
    ((value >>> (8 * i)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
async function translate(text, appId, secret, fetchImpl = fetch, salt = crypto.randomUUID()) {
  const sign = md5Utf8(appId + text + salt + secret);
  const body = new URLSearchParams({ q: text, from: 'auto', to: 'zh', appid: appId, salt, sign });
  const response = await fetchImpl('https://api.fanyi.baidu.com/api/trans/vip/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(), signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('translation_failed');
  const result = await response.json();
  if (result.error_code || !Array.isArray(result.trans_result) || !result.trans_result.length ||
      result.trans_result.some(item => typeof item?.dst !== 'string' || !item.dst.trim())) {
    throw new Error('translation_failed');
  }
  return result.trans_result.map(item => item.dst).join('\n').trim();
}
globalThis.BaiduTranslate = Object.freeze({ md5Utf8, translate });
```

- [ ] **Step 4: 运行客户端单测（补一个换行、多段译文与 Unicode 输入测试），确认通过。**

```sh
node --test tests/baidu-translate.test.cjs
```

- [ ] **Step 5: 只提交客户端与测试。**

```sh
git add baidu-translate.js tests/baidu-translate.test.cjs
git diff --cached --check
git commit -m "feat: add signed Baidu translation client"
```

### Task 2: Service Worker 和内容脚本共同完成安全收集

**Files:**
- Create: `background.js`
- Modify: `manifest.json`, `content.js`, `tests/content.test.cjs`
- Test: `tests/background.test.cjs`

**Interfaces:**
- Consumes: `globalThis.BaiduTranslate.translate(text, appId, secret)`；`chrome.runtime.onMessage`、`chrome.storage.local`；仅来自普通 HTTP/HTTPS 内容脚本的消息 `{ type: 'getEnabled' }` 和 `{ type: 'collect', text }`。
- Produces: `getEnabled` 回 `{ enabled: boolean }`；`collect` 成功回 `{ ok: true }`，失败回 `{ ok: false, code: 'disabled' | 'failed' }`。`content.js` 只使用这两类消息，不直接访问 `chrome.storage.local`；无配置、接口失败或保存失败统一 `failed`，不把文本/凭据及 API 原始错误返回页面。

- [ ] **Step 1: 写后台和内容脚本的失败测试。** `vm` 沙箱内 `importScripts` 载入 Task 1 文件，mock `chrome.storage.local`（含 `setAccessLevel`）、`runtime.onMessage.addListener`、`fetch`、`crypto.randomUUID`、`TextEncoder`；`send(message, sender = { tab: { id: 7 }, url: 'https://example.com/article' })` 使用 `sendResponse` Promise 模拟；mock 的 storage.set 和 sendResponse 以 `JSON.parse(JSON.stringify(value))` 归一化跨 VM realm 对象，避免 Node deepStrictEqual 的原型误报。分别测试：`getEnabled` 仅布尔值、默认关闭；无点击无请求；仅 collectionEnabled=true/translationEnabled=true 才请求；翻译关闭保存字符串；已有对象时关闭翻译重复收集仍保留译文；缺凭据、API error/超时、storage.set 拒绝均无新键；请求中关闭 collectionEnabled 不保存；伪造 `type`/非页面 `sender`/`'中'.repeat(2001)`（6003 个 UTF-8 字节）不触发 fetch 或写入。检查 `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` 在读取任何设置前完成。将原有 `tests/content.test.cjs` 的 `page()` mock 改为 runtime 消息：`getEnabled` 仅返回布尔值，`collect` 模拟写入；增加只显示按钮不发送原文、单击后发送 trimmed 原文、失败保留可重试按钮、禁用期间无法重复请求、请求中关闭收集及 `chrome.storage.local` getter 一触即抛的用例。

```js
const result = await send({ type: 'collect', text: '  hello  ' });
assert.deepEqual(result, { ok: true });
assert.deepEqual(data['word:hello'], { text: 'hello', translation: '你好' });
assert.equal(fetchCalls.length, 1);
assert.equal((await send({ type: 'collect', text: '中'.repeat(2001) })).ok, false);
```

- [ ] **Step 2: 运行 `node --test tests/background.test.cjs tests/content.test.cjs`，确认后台模块缺失及现有内容脚本直接读写 storage 导致失败。**

```sh
node --test tests/background.test.cjs tests/content.test.cjs
```

- [ ] **Step 3: 添加 manifest 后台声明，并实现后台消息处理。** Service Worker 顶层同步注册 `onMessage`，处理函数内 `await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` 的初始化 Promise；拒绝非 `sender.tab`、非 HTTP/HTTPS 来源及未定义消息种类；白名单 `getEnabled` 仅返回 `collectionEnabled === true`；`collect` trim 并校验 UTF-8 长度，不接受可控 URL；翻译开启时先检查 App ID/密钥，再请求，之后重新读取 `collectionEnabled` 才写入。关闭翻译时先读取已有键，若 `{ text, translation }` 有非空译文则保留，否则写原文字符串。所有异常返回 `{ ok: false, code: 'failed' }`；关闭开关返回 `disabled`，不记录异常详情。

```js
importScripts('baidu-translate.js');
const accessReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
async function handle(message, sender) {
  await accessReady;
  if (!sender.tab || !/^https?:\/\//.test(sender.url || '')) return { ok: false, code: 'failed' };
  if (message?.type === 'getEnabled') {
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    return { enabled: collectionEnabled === true };
  }
  if (message?.type !== 'collect' || typeof message.text !== 'string') return { ok: false, code: 'failed' };
  const text = message.text.trim();
  if (!text || new TextEncoder().encode(text).length > 6000) return { ok: false, code: 'failed' };
  const config = await chrome.storage.local.get(['collectionEnabled', 'translationEnabled', 'baiduAppId', 'baiduSecret']);
  if (config.collectionEnabled !== true) return { ok: false, code: 'disabled' };
  const key = 'word:' + text;
  if (config.translationEnabled === true) {
    if (typeof config.baiduAppId !== 'string' || !config.baiduAppId.trim() ||
        typeof config.baiduSecret !== 'string' || !config.baiduSecret.trim()) return { ok: false, code: 'failed' };
    const translation = await BaiduTranslate.translate(text, config.baiduAppId, config.baiduSecret);
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled !== true) return { ok: false, code: 'disabled' };
    await chrome.storage.local.set({ [key]: { text, translation } });
  } else {
    const existing = (await chrome.storage.local.get(key))[key];
    const { collectionEnabled } = await chrome.storage.local.get('collectionEnabled');
    if (collectionEnabled !== true) return { ok: false, code: 'disabled' };
    if (!(existing && typeof existing === 'object' && typeof existing.translation === 'string' &&
          existing.translation.trim())) await chrome.storage.local.set({ [key]: text });
  }
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse, () => sendResponse({ ok: false, code: 'failed' }));
  return true;
});
```

`manifest.json` 保留 `"permissions": ["storage"]`，增加 `"minimum_chrome_version": "103"`、`"background": { "service_worker": "background.js" }` 与 `"host_permissions": ["https://api.fanyi.baidu.com/*"]`，不新增广泛域名权限。同步修改 `content.js`：`showPopover` 仅用 `chrome.runtime.sendMessage({ type: 'getEnabled' })` 查布尔开关，点击时仅用 `chrome.runtime.sendMessage({ type: 'collect', text })` 提交；仅 `{ ok: true }` 才关闭，`code === 'disabled'` 关闭，其余情况显示固定「重试」及「保存失败，请重试」，finally 解除 disabled；保留原有选区、editable 和浮窗逻辑。

```js
const { enabled } = await chrome.runtime.sendMessage({ type: 'getEnabled' });
if (!enabled || currentRequest !== requestId) return;
// Existing click listener's try block:
const result = await chrome.runtime.sendMessage({ type: 'collect', text });
if (result?.ok || result?.code === 'disabled') return closePopover();
button.textContent = '重试';
button.title = '保存失败，请重试';
// Existing catch uses the same fixed retry text; existing finally resets button.disabled.
```

- [ ] **Step 4: 运行后台、内容和现有弹窗测试；逐一补齐网络中断、按钮请求并发的断言。此任务完成时收集功能必须仍然可用，不允许中间提交破坏已有测试。**

```sh
node --test tests/background.test.cjs tests/content.test.cjs tests/popup.test.cjs
```

- [ ] **Step 5: 提交后台、清单、内容脚本与对应测试。**

```sh
git add background.js manifest.json content.js tests/background.test.cjs tests/content.test.cjs
git diff --cached --check
git commit -m "feat: route secure collection through extension worker"
```

### Task 3: 弹窗配置、词表译文、文档和全量验证

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `tests/popup.test.cjs`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: chrome.storage.local trusted context，现有 `collectionEnabled`、`word:<text>` 旧字符串、Task 2 的 `{ text, translation }` 新值；`translationEnabled`、`baiduAppId`、`baiduSecret` 配置键。
- Produces: 页面中独立的翻译开关和凭据输入、保存状态、译文与原文安全展示；README/AGENTS 更新。

- [ ] **Step 1: 先扩充 popup 测试。** 增加 `#translation-toggle`、`#baidu-app-id`、`#baidu-secret`、`#save-credentials`、`#translation-status` 的模拟元素，`popup()` mock 加 `setAccessLevel` 并记录其完成时序，`get([...])` mock 必须对数组键返回对应对象（原有 mock 只支持单键）。断言翻译默认关闭；点开关只写布尔值、绝不发 fetch；填写凭据并点击保存后存入 storage；重开仍正确显示 App ID（密钥 input `type=password`、译文/密钥仅以 `textContent`/`input.value` 处理）；配置读取/写入失败给出泛化错误；旧字符串、新对象混用的列表显示及删除；译文为 `<img src=x>` 时作为文字显示而不插入 HTML。原有测试不得因元素层级变化误判 `删除` 按钮。

```js
const p = popup({ 'word:hello': 'hello', 'word:world': { text: 'world', translation: '世界' } });
await p.ready();
assert.equal(p.translationToggle.checked, false);
assert.equal(p.wordList.children.length, 2);
assert.equal(p.wordList.children.find(x => x.children[0].textContent === 'world').children[1].textContent, '世界');
assert.equal(p.secret.type, 'password');
```

- [ ] **Step 2: 运行 `node --test tests/popup.test.cjs`，确认新设置和译文展示用例失败。**

```sh
node --test tests/popup.test.cjs
```

- [ ] **Step 3: 最小实现弹窗。** `popup.html` 新增设置区且提示“只有主动点击收集才发送原文给百度”，其中 secret 输入为 `type="password"`；`popup.js` 初始化时先 `await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，再读取开关与 App ID，翻译开关 handler 按原 collection toggle 模式失败回滚；凭据保存事件对 App ID/密钥 `.trim()` 后写入配置键；重开弹窗密钥框留空但保留原有已存密钥，若更换 App ID 则要求重新填写密钥；失败显示通用错误且不改已存配置；词条从键得原文，只有对象有非空 `translation` 才创建译文 `span` 且用 `textContent`，删除按钮仍是当前 li 最后一个 child。设置区不渲染密钥明文；关闭翻译后保存已翻译词条仍保留译文。

```js
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const { translationEnabled = false, baiduAppId = '' } = await chrome.storage.local.get(['translationEnabled', 'baiduAppId']);
translationToggle.checked = translationEnabled;
appIdInput.value = baiduAppId;
// For list rendering, keep original text from key, not untrusted value.
const translation = data[key]?.translation;
if (typeof translation === 'string' && translation.trim()) {
  const translated = document.createElement('span');
  translated.textContent = translation;
  item.appendChild(translated);
}
item.appendChild(removeButton);
```

- [ ] **Step 4: 更新 README 和 AGENTS。** README 说明两开关默认关闭、配置 App ID/密钥（不要粘贴到聊天/仓库）、真正上传时机、auto→zh、仅成功保存、断网/失败重试、旧数据兼容、扩展离线模式、权限/本地密钥保护限制、百度协议缓存风险及用户本地手动验证。将旧“扩展不会上传数据”改为“仅关闭翻译时不上传；开启后点击收集会发送该次原文给百度”。移除 README 现有的 `chrome.storage.local.get(null).then(console.log)` 示例（会在手工验证时把原文和密钥都打印到控制台），改为在扩展 DevTools 的存储面板手动核对，不展示密钥。AGENTS 明确受限例外，删除无条件“never send it over the network”；保留无 bundler、collection 默认关、编辑区过滤、无日志、`node --test` 规则。修改示例词条值以匹配新版对象，同时注明旧字符串。

```markdown
- Keep collection and translation off by default; ignore editable fields; never log selected text.
- Only when both switches are enabled and the user clicks Collect may the current selection be sent to Baidu for translation; otherwise keep collection local. Never commit or log API credentials.
```

- [ ] **Step 5: 运行全部测试并检查 diff/敏感信息，再提交。** 若存在单测失败先修复，不以未运行真实 API 为由宣称已端到端验证。

```sh
node --test
git diff --check
git status --short
git add popup.html popup.js tests/popup.test.cjs README.md AGENTS.md
git diff --cached --check
git commit -m "feat: configure and display translated words"
```

## 完工检查

- `node --test` 最近一次运行全部通过，`git status --short` 清洁；检查 manifest 仅百度 host permission、无远程脚本和硬编码密钥、无向网页暴露词条/配置的消息路径。
- 将实际 API 端到端浏览器验证留给 X 在本机提供自己的凭据；不能代填或记录。百度缓存译文的适用协议与所需授权仍由 X 核对，不在项目文档中宣称已获许可。
