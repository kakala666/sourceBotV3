import { strict as assert } from 'node:assert';
import {
  ensureSubscribed,
  _setCacheForTests,
  _setPrismaForTests,
  type ChannelCfg,
  type CheckResult,
} from './subscription-check';

function makeBotApi(memberStatuses: Record<string, string | Error>) {
  return {
    async getChatMember(chatId: string, userId: number) {
      const key = `${chatId}:${userId}`;
      const v = memberStatuses[key];
      if (v instanceof Error) throw v;
      return { status: v ?? 'left' };
    },
  } as any;
}

let prismaChannelUpdates: any[] = [];
const fakePrisma = {
  subscriptionGateChannel: {
    update: async ({ where, data }: any) => {
      prismaChannelUpdates.push({ id: where.id, data });
    },
  },
};

_setPrismaForTests(fakePrisma);

(async () => {
  let r: CheckResult;

  // case 1: gate 未启用 → ok
  _setCacheForTests(new Map([[1, { isEnabled: false, promptTemplate: null, channels: [] }]]));
  r = await ensureSubscribed(1, 100n, makeBotApi({}));
  assert.equal(r.ok, true);

  // case 2: 启用 + 用户已订阅唯一频道 → ok
  const channels: ChannelCfg[] = [
    { id: 11, chatId: -1001n, username: 'c1', title: 'C1', inviteUrl: 'https://t.me/c1', status: 'ok' },
  ];
  _setCacheForTests(new Map([[2, { isEnabled: true, promptTemplate: null, channels }]]));
  r = await ensureSubscribed(2, 200n, makeBotApi({ '-1001:200': 'member' }));
  assert.equal(r.ok, true);

  // case 3: 启用 + 重复调用都打 API(确认无缓存短路)
  let apiCallCount = 0;
  const spyApi = {
    async getChatMember() { apiCallCount++; return { status: 'member' }; },
  } as any;
  await ensureSubscribed(2, 200n, spyApi);
  await ensureSubscribed(2, 200n, spyApi);
  assert.equal(apiCallCount, 2);

  // case 4: 一频道未订阅 → 返回 missing
  r = await ensureSubscribed(2, 300n, makeBotApi({ '-1001:300': 'left' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].username, 'c1');
  }

  // case 5: API 抛权限错误 → 标 channel status 并跳过(本次该频道按通过算)
  prismaChannelUpdates = [];
  const channels5: ChannelCfg[] = [
    { id: 11, chatId: -1001n, username: 'c1', title: 'C1', inviteUrl: 'https://t.me/c1', status: 'ok' },
  ];
  _setCacheForTests(new Map([[2, { isEnabled: true, promptTemplate: null, channels: channels5 }]]));
  const permError: any = new Error('Forbidden: bot is not a member');
  r = await ensureSubscribed(2, 400n, makeBotApi({ '-1001:400': permError }));
  assert.equal(r.ok, true);
  assert.equal(prismaChannelUpdates.length, 1);
  assert.equal(prismaChannelUpdates[0].data.status, 'bot_not_admin');

  // case 6: status !== 'ok' 的频道直接跳过(不调 API)
  const channels2: ChannelCfg[] = [
    { id: 12, chatId: -2n, username: 'dead', title: 'D', inviteUrl: 'x', status: 'bot_not_admin' },
    { id: 13, chatId: -3n, username: 'live', title: 'L', inviteUrl: 'y', status: 'ok' },
  ];
  _setCacheForTests(new Map([[3, { isEnabled: true, promptTemplate: null, channels: channels2 }]]));
  r = await ensureSubscribed(3, 500n, makeBotApi({ '-3:500': 'member' }));
  assert.equal(r.ok, true);

  console.log('✓ ensureSubscribed tests passed (no-cache mode)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
