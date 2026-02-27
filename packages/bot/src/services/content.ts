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
