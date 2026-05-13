import { strict as assert } from 'node:assert';
import { parseChannelUrl, verifyChannelForBot, normalizePrivateChatId, verifyPrivateChannelForBot } from './telegram-channel';

// 接受形式
assert.equal(parseChannelUrl('@xxx').username, 'xxx');
assert.equal(parseChannelUrl('xxx').username, 'xxx');
assert.equal(parseChannelUrl('https://t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('http://t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('t.me/xxx').username, 'xxx');
assert.equal(parseChannelUrl('  @xxx  ').username, 'xxx');
assert.equal(parseChannelUrl('@a_b_c123').username, 'a_b_c123');

// 拒绝形式
assert.throws(() => parseChannelUrl('https://t.me/+abc123'),    /公开频道/);
assert.throws(() => parseChannelUrl('https://t.me/joinchat/x'), /公开频道/);
assert.throws(() => parseChannelUrl('https://t.me/xxx/123'),    /频道链接/);
assert.throws(() => parseChannelUrl(''),                        /链接为空/);
assert.throws(() => parseChannelUrl('  '),                      /链接为空/);
assert.throws(() => parseChannelUrl('@'),                       /用户名/);

console.log('✓ parseChannelUrl tests passed');

// normalizePrivateChatId
assert.equal(normalizePrivateChatId('1234567890'),     '-1001234567890');
assert.equal(normalizePrivateChatId('-1001234567890'), '-1001234567890');
assert.equal(normalizePrivateChatId('  1234567890  '), '-1001234567890');
assert.equal(normalizePrivateChatId('1001234567890'),  '-1001234567890');
assert.throws(() => normalizePrivateChatId(''),     /不能为空/);
assert.throws(() => normalizePrivateChatId('abc'),  /数字/);
assert.throws(() => normalizePrivateChatId('@xxx'), /数字/);
console.log('✓ normalizePrivateChatId tests passed');

// Mock fetch
const originalFetch = globalThis.fetch;
function mockFetch(handler: (url: string) => any) {
  globalThis.fetch = (async (url: any) => ({
    json: async () => handler(String(url)),
  })) as any;
}
function restore() { globalThis.fetch = originalFetch; }

(async () => {
  // case 1: 完整成功
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100, username: 'mybot' } };
    if (url.includes('/getChatMember')) return {
      ok: true,
      result: { status: 'administrator', user: { id: 100 } },
    };
    if (url.includes('/getChat')) return {
      ok: true,
      result: { id: -1001, type: 'channel', title: 'My Channel', username: 'mychan' },
    };
    return { ok: false };
  });

  const result = await verifyChannelForBot('TOKEN', 'mychan');
  assert.equal(result.chatId, '-1001');
  assert.equal(result.title, 'My Channel');
  assert.equal(result.username, 'mychan');
  restore();

  // case 2: 频道不存在
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    return { ok: false, error_code: 400, description: 'chat not found' };
  });
  await assert.rejects(verifyChannelForBot('TOKEN', 'nope'), /频道不存在/);
  restore();

  // case 3: 非频道(群组)
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    if (url.includes('/getChat')) return { ok: true, result: { id: -100, type: 'supergroup', title: 'g' } };
    return { ok: false };
  });
  await assert.rejects(verifyChannelForBot('TOKEN', 'gg'), /不是频道/);
  restore();

  // case 4: Bot 不是管理员
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    if (url.includes('/getChatMember')) return { ok: true, result: { status: 'member' } };
    if (url.includes('/getChat')) return { ok: true, result: { id: -1, type: 'channel', title: 't', username: 'u' } };
    return { ok: false };
  });
  await assert.rejects(verifyChannelForBot('TOKEN', 'u'), /管理员/);
  restore();

  console.log('✓ verifyChannelForBot tests passed');

  // verifyPrivateChannelForBot
  // case A: 成功 — chat_id 标准化 + 拿到 title + bot 是 admin
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    if (url.includes('/getChatMember')) return { ok: true, result: { status: 'administrator' } };
    if (url.includes('/getChat')) return {
      ok: true,
      result: { id: -1001234567890, type: 'channel', title: 'Private Channel' },
    };
    return { ok: false };
  });
  const priv = await verifyPrivateChannelForBot('TOKEN', '1234567890');
  assert.equal(priv.chatId, '-1001234567890');
  assert.equal(priv.title, 'Private Channel');
  assert.equal(priv.username, '');
  restore();

  // case B: 找不到频道
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    return { ok: false, error_code: 400, description: 'chat not found' };
  });
  await assert.rejects(verifyPrivateChannelForBot('TOKEN', '9999999999'), /找不到频道/);
  restore();

  // case C: Bot 不是管理员
  mockFetch((url) => {
    if (url.includes('/getMe')) return { ok: true, result: { id: 100 } };
    if (url.includes('/getChatMember')) return { ok: true, result: { status: 'member' } };
    if (url.includes('/getChat')) return { ok: true, result: { id: -1001234567890, type: 'channel', title: 'P' } };
    return { ok: false };
  });
  await assert.rejects(verifyPrivateChannelForBot('TOKEN', '1234567890'), /管理员/);
  restore();

  console.log('✓ verifyPrivateChannelForBot tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
