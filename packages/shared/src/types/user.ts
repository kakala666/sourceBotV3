// 用户和统计类型
export interface BotUserInfo {
  id: number;
  telegramId: string;
  botId: number;
  inviteLinkId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface BotUserLookupResult {
  id: number;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  bot: { id: number; name: string };
  inviteLink: { id: number; name: string; code: string };
}

/** /api/users/lookup 响应:不存在则为 null;多条匹配只返回 firstSeenAt 最新一条 */
export type BotUserLookupResponse = BotUserLookupResult | null;

export interface StatsOverview {
  todayNewUsers: number;
  totalUsers: number;
  todayAdImpressions: number;
}

export interface DailyStat {
  date: string;
  newUsers: number;
  adImpressions: number;
}

export interface LinkStat {
  linkId: number;
  linkName: string;
  linkCode: string;
  botName: string;
  totalUsers: number;
  todayUsers: number;
  totalAdImpressions: number;
}

export type ButtonType = 'next' | 'reveal';

export interface ButtonClickStat {
  buttonType: ButtonType;
  totalClicks: number;        // 非去重(每次点击都算)
  uniqueClickers: number;     // 按 (botUserId × inviteLinkId × buttonType) 去重的用户数
}

export interface SecondaryOpRateStat {
  linkId: number;
  linkName: string;
  linkCode: string;
  botName: string;
  newUsers: number;           // 时间范围内新增用户
  activatedUsers: number;     // 这些新增用户中点过 next/reveal 的人数
  rate: number;               // activatedUsers / newUsers, 0-1
}

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  avg: number;
}

export interface LatencyItem {
  id: number;
  botName: string;
  linkName: string;
  linkCode: string;
  buttonType: ButtonType;
  latencyMs: number;
  clickedAt: string;
}
