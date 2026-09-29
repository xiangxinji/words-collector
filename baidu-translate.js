const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const MD5_SHIFTS = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];

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
      const sum = (a + f + MD5_K[i] + view.getUint32(offset + g * 4, true)) >>> 0;
      const shift = MD5_SHIFTS[Math.floor(i / 16)][i % 4];
      [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0, b, c];
    }
    state = [(state[0] + a) >>> 0, (state[1] + b) >>> 0, (state[2] + c) >>> 0, (state[3] + d) >>> 0];
  }

  return state.map(value => Array.from({ length: 4 }, (_, i) =>
    ((value >>> (8 * i)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

async function translate(text, appId, secret, fetchImpl = fetch, salt = crypto.randomUUID()) {
  const sign = md5Utf8(appId + text + salt + secret);
  const body = new URLSearchParams({ q: text, from: 'auto', to: 'zh', appid: appId, salt, sign });
  const response = await fetchImpl('https://fanyi-api.baidu.com/api/trans/vip/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
    signal: AbortSignal.timeout(12000)
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