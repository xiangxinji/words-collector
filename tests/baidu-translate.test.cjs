const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClient() {
  const context = { TextEncoder, URLSearchParams, AbortSignal, crypto: { randomUUID: () => '123' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'baidu-translate.js'), 'utf8'), context);
  return context.BaiduTranslate;
}

test('MD5 signs UTF-8 text, including emoji and multiple blocks', () => {
  const { md5Utf8 } = loadClient();
  for (const input of ['', 'abc', 'APP你\n好😀123SECRET', '字'.repeat(80)]) {
    assert.equal(md5Utf8(input), createHash('md5').update(input, 'utf8').digest('hex'));
  }
});

test('translation sends a signed POST form only to Baidu and returns the translation', async () => {
  const { translate } = loadClient();
  const input = '你\n好😀';
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ trans_result: [{ dst: '你好' }, { dst: '您好' }] }) };
  };
  assert.equal(await translate(input, 'APP', 'SECRET', fetchImpl, '123'), '你好\n您好');
  assert.equal(captured.url, 'https://fanyi-api.baidu.com/api/trans/vip/translate');
  assert.equal(captured.options.method, 'POST');
  assert.match(captured.options.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(captured.options.body);
  assert.equal(form.get('q'), input);
  assert.equal(form.get('from'), 'auto');
  assert.equal(form.get('to'), 'zh');
  assert.equal(form.get('appid'), 'APP');
  assert.equal(form.get('salt'), '123');
  assert.equal(form.get('sign'), createHash('md5').update('APP' + input + '123SECRET').digest('hex'));
  assert.equal(captured.url.includes(input), false);
  assert.equal(captured.options.body.includes('SECRET'), false);
  assert.ok(captured.options.signal instanceof AbortSignal);
});

test('error response, blank translation and rejected network call never return a partial translation', async () => {
  const { translate } = loadClient();
  for (const response of [
    { ok: false },
    { ok: true, json: async () => ({ error_code: '54003' }) },
    { ok: true, json: async () => ({ trans_result: [] }) },
    { ok: true, json: async () => ({ trans_result: [{ dst: ' ' }] }) },
    { ok: true, json: async () => ({ trans_result: [{ dst: 'ok' }, { dst: null }] }) }
  ]) {
    await assert.rejects(translate('hello', 'APP', 'SECRET', async () => response, '123'));
  }
  await assert.rejects(translate('hello', 'APP', 'SECRET', async () => { throw Error('network'); }, '123'));
});