import type { Api } from 'grammy';
import realPrisma from '../prisma';

export interface ChannelCfg {
  id: number;
  chatId: bigint;
  /** 公开频道才有;私有频道为 null */
  username: string | null;
  title: string;
  inviteUrl: string;
  status: string;
}

export interface GateConfig {
  isEnabled: boolean;
  promptTemplate: string | null;
  primaryChannels: ChannelCfg[];   // kind = 'primary',每次都查
  sponsorChannels: ChannelCfg[];   // kind = 'sponsor',按 sortOrder 排序
  sponsorPositions: number[];      // 与 sponsorChannels 按 index 配对
}

export type CheckResult =
  | { ok: true }
  | { ok: false; missing: { username: string | null; title: string; inviteUrl: string }[] };

// key 为 inviteLinkId
let configCache = new Map<number, GateConfig>();       // key: inviteLinkId
let botGateCache = new Map<number, GateConfig>();      // key: botId
let linkToBotMap = new Map<number, number>();          // inviteLinkId → botId
let prismaRef: any = realPrisma;

/** 仅供测试使用 */
export function _setCacheForTests(c: Map<number, GateConfig>) {
  configCache = c;
  botGateCache = new Map();
  linkToBotMap = new Map();
}
/** 仅供测试使用 */
export function _setBotGateCacheForTests(c: Map<number, GateConfig>, ltb: Map<number, number>) {
  botGateCache = c;
  linkToBotMap = ltb;
}
/** 仅供测试使用 */
export function _setPrismaForTests(p: any) { prismaRef = p; }

export async function reloadAllGateConfigs(): Promise<void> {
  // 1. link → bot 映射
  const links = await prismaRef.inviteLink.findMany({
    select: { id: true, botId: true },
  });
  const nextLinkToBot = new Map<number, number>();
  for (const l of links) nextLinkToBot.set(l.id, l.botId);

  // 2. 加载 link gates
  const gates = await prismaRef.subscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const nextLinkCache = new Map<number, GateConfig>();
  for (const g of gates) {
    nextLinkCache.set(g.inviteLinkId, buildGateConfig(g));
  }

  // 3. 加载 bot gates
  const botGates = await prismaRef.botSubscriptionGate.findMany({
    include: { channels: { orderBy: { sortOrder: 'asc' } } },
  });
  const nextBotCache = new Map<number, GateConfig>();
  for (const g of botGates) {
    nextBotCache.set(g.botId, buildGateConfig(g));
  }

  configCache = nextLinkCache;
  botGateCache = nextBotCache;
  linkToBotMap = nextLinkToBot;
}

function buildGateConfig(g: any): GateConfig {
  const primaryChannels: ChannelCfg[] = [];
  const sponsorChannels: ChannelCfg[] = [];
  for (const c of g.channels) {
    const cfg: ChannelCfg = {
      id: c.id,
      chatId: c.chatId,
      username: c.username,
      title: c.title,
      inviteUrl: c.inviteUrl,
      status: c.status,
    };
    if (c.kind === 'sponsor') sponsorChannels.push(cfg);
    else primaryChannels.push(cfg);
  }
  return {
    isEnabled: g.isEnabled,
    promptTemplate: g.promptTemplate,
    primaryChannels,
    sponsorChannels,
    sponsorPositions: g.sponsorPositions ?? [],
  };
}

/**
 * 新职责拆分:
 *   - link 级 gate 只贡献 primaryChannels (该 link 独立的主频道)
 *   - bot 级 gate 只贡献 sponsorChannels + sponsorPositions (同 bot 全局赞助)
 *
 * 任一启用且有 channels 就需要拦截。promptTemplate 优先 link,fallback bot。
 * 历史脏数据(link gate 有 sponsor / bot gate 有 primary)会被这里过滤掉。
 */
export function getGateConfig(inviteLinkId: number): GateConfig | undefined {
  const linkGate = configCache.get(inviteLinkId);
  const botId = linkToBotMap.get(inviteLinkId);
  const botGate = botId !== undefined ? botGateCache.get(botId) : undefined;

  const primaryChannels = linkGate?.isEnabled ? linkGate.primaryChannels : [];
  const sponsorChannels = botGate?.isEnabled ? botGate.sponsorChannels : [];
  const sponsorPositions = botGate?.isEnabled ? botGate.sponsorPositions : [];

  if (primaryChannels.length === 0 && sponsorChannels.length === 0) return undefined;

  return {
    isEnabled: true,
    promptTemplate: linkGate?.promptTemplate ?? botGate?.promptTemplate ?? null,
    primaryChannels,
    sponsorChannels,
    sponsorPositions,
  };
}

function isMember(status: string): boolean {
  return status === 'creator' || status === 'administrator' || status === 'member';
}

function classifyApiError(err: any): 'bot_not_admin' | 'channel_gone' | 'transient' {
  const msg: string = (err?.message || '').toLowerCase();
  if (msg.includes('not a member') || msg.includes('forbidden') || msg.includes('bot is not')) return 'bot_not_admin';
  if (msg.includes('chat not found') || msg.includes('chat_not_found')) return 'channel_gone';
  return 'transient';
}

/**
 * 检查指定 channel:返回 true 已订阅,false 未订阅(或频道失效则跳过本次)。
 * 副作用:失效频道会被标记 status 并 update DB。
 */
async function checkChannelMembership(
  inviteLinkId: number,
  channel: ChannelCfg,
  telegramId: bigint,
  botApi: Api,
): Promise<boolean | 'skipped'> {
  if (channel.status !== 'ok') return 'skipped';
  try {
    const member = await botApi.getChatMember(channel.chatId.toString() as any, Number(telegramId));
    return isMember(member.status);
  } catch (err: any) {
    const kind = classifyApiError(err);
    if (kind === 'transient') {
      console.error(`[gate] api_error inviteLinkId=${inviteLinkId} channelId=${channel.id} err=${err.message}`);
      return 'skipped';
    }
    channel.status = kind;
    await prismaRef.subscriptionGateChannel.update({
      where: { id: channel.id },
      data: { status: kind, lastCheckAt: new Date() },
    });
    return 'skipped';
  }
}

/**
 * 每次都调 Telegram API 查订阅:
 *  - 主频道:始终全部检查
 *  - 赞助商:position 给定且匹配 sponsorPositions[idx] 时,检查 sponsorChannels[idx]
 */
export async function ensureSubscribed(
  inviteLinkId: number,
  telegramId: bigint,
  botApi: Api,
  position?: number,
): Promise<CheckResult> {
  const config = getGateConfig(inviteLinkId);
  if (!config?.isEnabled) return { ok: true };

  const missing: { username: string | null; title: string; inviteUrl: string }[] = [];

  // 主频道:始终查
  for (const channel of config.primaryChannels) {
    const res = await checkChannelMembership(inviteLinkId, channel, telegramId, botApi);
    if (res === false) {
      missing.push({ username: channel.username, title: channel.title, inviteUrl: channel.inviteUrl });
    }
  }

  // 赞助商:仅匹配位置时查一个
  if (position !== undefined) {
    const idx = config.sponsorPositions.indexOf(position);
    if (idx >= 0 && idx < config.sponsorChannels.length) {
      const channel = config.sponsorChannels[idx];
      const res = await checkChannelMembership(inviteLinkId, channel, telegramId, botApi);
      if (res === false) {
        missing.push({ username: channel.username, title: channel.title, inviteUrl: channel.inviteUrl });
      }
    }
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
