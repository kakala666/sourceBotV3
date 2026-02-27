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
