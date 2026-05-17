import { strict as assert } from 'node:assert';
import {
  ensureSubscribed,
  _setCacheForTests,
  _setPrismaForTests,
  type ChannelCfg,
  type GateConfig,
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

function makeConfig(opts: Partial<GateConfig> & Pick<GateConfig, 'isEnabled'>): GateConfig {
  return {
    isEnabled: opts.isEnabled,
    promptTemplate: opts.promptTemplate ?? null,
    primaryChannels: opts.primaryChannels ?? [],
    sponsorChannels: opts.sponsorChannels ?? [],
    sponsorPositions: opts.sponsorPositions ?? [],
  };
}

(async () => {
  let r: CheckResult;

  // case 1: gate 未启用 → ok
  _setCacheForTests(new Map([[1, makeConfig({ isEnabled: false })]]));
  r = await ensureSubscribed(1, 100n, makeBotApi({}));
  assert.equal(r.ok, true);

  // case 2: 启用 + 用户已订阅唯一主频道 → ok
  const primaryChannel: ChannelCfg = {
    id: 11, chatId: -1001n, username: 'c1', title: 'C1', inviteUrl: 'https://t.me/c1', status: 'ok',
  };
  _setCacheForTests(new Map([[2, makeConfig({ isEnabled: true, primaryChannels: [primaryChannel] })]]));
  r = await ensureSubscribed(2, 200n, makeBotApi({ '-1001:200': 'member' }));
  assert.equal(r.ok, true);

  // case 3: 主频道未订阅 → missing
  r = await ensureSubscribed(2, 300n, makeBotApi({ '-1001:300': 'left' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].username, 'c1');
  }

  // case 4: 不传 position,赞助商不参与检查
  const sponsor1: ChannelCfg = { id: 21, chatId: -2001n, username: 's1', title: 'S1', inviteUrl: 'x1', status: 'ok' };
  const sponsor2: ChannelCfg = { id: 22, chatId: -2002n, username: 's2', title: 'S2', inviteUrl: 'x2', status: 'ok' };
  _setCacheForTests(new Map([[3, makeConfig({
    isEnabled: true,
    primaryChannels: [primaryChannel],
    sponsorChannels: [sponsor1, sponsor2],
    sponsorPositions: [3, 6],
  })]]));
  // 主频道订阅 + 不传 position → 不查赞助商 → ok
  r = await ensureSubscribed(3, 400n, makeBotApi({ '-1001:400': 'member' }));
  assert.equal(r.ok, true);

  // case 5: position=3 命中 → 同时查主频道 + sponsor1
  r = await ensureSubscribed(3, 500n, makeBotApi({
    '-1001:500': 'member',
    '-2001:500': 'left',
  }), 3);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].username, 's1');
  }

  // case 6: position=6 命中 sponsor2
  r = await ensureSubscribed(3, 600n, makeBotApi({
    '-1001:600': 'member',
    '-2002:600': 'left',
  }), 6);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].username, 's2');
  }

  // case 7: position=4 不在 sponsorPositions → 仅查主频道
  r = await ensureSubscribed(3, 700n, makeBotApi({ '-1001:700': 'member' }), 4);
  assert.equal(r.ok, true);

  // case 8: position=3 命中 sponsor1,主频道也未订阅 → 合并 missing
  r = await ensureSubscribed(3, 800n, makeBotApi({
    '-1001:800': 'left',
    '-2001:800': 'left',
  }), 3);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.missing.length, 2);
    const names = r.missing.map((m) => m.username).sort();
    assert.deepEqual(names, ['c1', 's1']);
  }

  // case 9: API 抛权限错误 → 标 channel status 跳过(本次按通过算)
  prismaChannelUpdates = [];
  const broken: ChannelCfg = { id: 99, chatId: -9n, username: 'broken', title: 'X', inviteUrl: 'x', status: 'ok' };
  _setCacheForTests(new Map([[4, makeConfig({ isEnabled: true, primaryChannels: [broken] })]]));
  r = await ensureSubscribed(4, 900n, makeBotApi({ '-9:900': new Error('Forbidden: bot is not a member') }));
  assert.equal(r.ok, true);
  assert.equal(prismaChannelUpdates.length, 1);
  assert.equal(prismaChannelUpdates[0].data.status, 'bot_not_admin');

  console.log('✓ ensureSubscribed tests passed (primary + sponsor)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
