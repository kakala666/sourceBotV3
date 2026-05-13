import { strict as assert } from 'node:assert';
import {
  ensureSubscribed,
  _setCacheForTests,
  _setPrismaForTests,
  type ChannelCfg,
  type CheckResult,
} from './subscription-check';
import { formatShanghaiDate } from './local-date';

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

let prismaPass: any[] = [];
let prismaChannelUpdates: any[] = [];
const fakePrisma = {
  subscriptionCheckPass: {
    findUnique: async ({ where }: any) =>
      prismaPass.find((p) =>
        p.botId === where.botId_telegramId_passDate.botId &&
        p.telegramId === where.botId_telegramId_passDate.telegramId &&
        p.passDate === where.botId_telegramId_passDate.passDate
      ) ?? null,
    upsert: async ({ create }: any) => {
      prismaPass.push(create);
      return create;
    },
  },
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

  // case 2: 启用 + 用户已订阅唯一频道 → ok 并写入缓存
  prismaPass = [];
  const channels: ChannelCfg[] = [
    { id: 11, chatId: -1001n, username: 'c1', title: 'C1', inviteUrl: 'https://t.me/c1', status: 'ok' },
  ];
  _setCacheForTests(new Map([[2, { isEnabled: true, promptTemplate: null, channels }]]));
  r = await ensureSubscribed(2, 200n, makeBotApi({ '-1001:200': 'member' }));
  assert.equal(r.ok, true);
  assert.equal(prismaPass.length, 1);
  assert.equal(prismaPass[0].botId, 2);

  // case 3: 启用 + 缓存命中 → ok 不调 API
  prismaPass = [{ botId: 2, telegramId: 200n, passDate: formatShanghaiDate() }];
  let apiCalled = false;
  const spyApi = { async getChatMember() { apiCalled = true; return { status: 'member' }; } } as any;
  r = await ensureSubscribed(2, 200n, spyApi);
  assert.equal(r.ok, true);
  assert.equal(apiCalled, false);

  // case 4: 一频道未订阅 → 返回 missing
  prismaPass = [];
  r = await ensureSubscribed(2, 300n, makeBotApi({ '-1001:300': 'left' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].username, 'c1');
  }

  // case 5: API 抛权限错误 → 标 channel status 并跳过(本次该频道按通过算)
  prismaPass = [];
  prismaChannelUpdates = [];
  // 重新 set cache 以重置 channel.status(上一次可能改过)
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
  prismaPass = [];
  const channels2: ChannelCfg[] = [
    { id: 12, chatId: -2n, username: 'dead', title: 'D', inviteUrl: 'x', status: 'bot_not_admin' },
    { id: 13, chatId: -3n, username: 'live', title: 'L', inviteUrl: 'y', status: 'ok' },
  ];
  _setCacheForTests(new Map([[3, { isEnabled: true, promptTemplate: null, channels: channels2 }]]));
  r = await ensureSubscribed(3, 500n, makeBotApi({ '-3:500': 'member' }));
  assert.equal(r.ok, true);

  console.log('✓ ensureSubscribed tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
