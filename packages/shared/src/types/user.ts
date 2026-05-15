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
