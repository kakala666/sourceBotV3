import prisma from '../prisma';

/**
 * 加载邀请链接关联的内容绑定列表（按 sortOrder 排序）
 */
export async function loadContentBindings(inviteLinkId: number) {
  return prisma.contentBinding.findMany({
    where: { inviteLinkId },
    orderBy: { sortOrder: 'asc' },
    include: {
      resource: {
        include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });
}

/**
 * 加载邀请链接关联的广告绑定列表（按 sortOrder 排序）
 */
export async function loadAdBindings(inviteLinkId: number) {
  return prisma.adBinding.findMany({
    where: { inviteLinkId },
    orderBy: { sortOrder: 'asc' },
    include: {
      resource: {
        include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });
}

/**
 * 从 SystemSetting 读取指定 key 的值
 */
export async function getSystemSetting<T>(key: string, defaultValue: T): Promise<T> {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  if (!setting) return defaultValue;
  return setting.value as T;
}

/**
 * 获取广告展示秒数
 */
export async function getAdDisplaySeconds(): Promise<number> {
  return getSystemSetting<number>('adDisplaySeconds', 5);
}

/**
 * 获取预览结束内容
 */
export async function getEndContent(): Promise<{
  text: string;
  buttons?: { text: string; url: string }[];
}> {
  return getSystemSetting('endContent', { text: '预览结束，感谢观看！' });
}

/**
 * 获取统计群组 ID
 */
export async function getStatsGroupId(): Promise<string> {
  return getSystemSetting<string>('statsGroupId', '');
}

/**
 * 「🔍 搜索更多资源」URL 跳转按钮总开关
 * 设为 true 可恢复显示(链接仍从 SystemSetting.searchMoreUrl 读取)
 */
const SEARCH_MORE_URL_ENABLED = false;

/**
 * 获取「搜索更多资源」按钮跳转链接
 * 开关关闭时返回空串,所有键盘构建处按 falsy 跳过该按钮
 */
export async function getSearchMoreUrl(): Promise<string> {
  if (!SEARCH_MORE_URL_ENABLED) return '';
  return getSystemSetting<string>('searchMoreUrl', 'https://t.me/ssejqr88bot');
}

/**
 * 获取欢迎语(/start 时显示在 reply keyboard 旁边)
 */
export async function getWelcomeText(): Promise<string> {
  return getSystemSetting<string>('welcomeText', '欢迎使用 👋\n使用下方按钮开启探索');
}

/**
 * 获取自动回复文本（未启用或未配置时返回 null）
 */
export async function getAutoReplyAd(): Promise<string | null> {
  const config = await getSystemSetting<any>('autoReplyAd', null);
  if (!config || !config.enabled || !config.text) return null;
  return config.text;
}
