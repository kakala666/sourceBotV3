import prisma from './prisma';
import type { BotAutoSyncConfigInfo, BotAutoSyncConfigUpdateInput } from 'shared';

/**
 * 每个 bot 的"自动同步"配置 + 立即执行入口。
 * 真正定时调度在 bot-runner 进程,这里只提供 CRUD + runSync 供 server / bot 复用。
 */
export class BotAutoSyncService {
  static async getConfig(botId: number): Promise<BotAutoSyncConfigInfo> {
    const cfg = await prisma.botAutoSyncConfig.findUnique({
      where: { botId },
      include: { targetBot: { select: { id: true, name: true } } },
    });
    if (!cfg) {
      return {
        botId,
        enabled: false,
        targetBotId: null,
        targetBotName: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncMessage: null,
      };
    }
    return {
      botId: cfg.botId,
      enabled: cfg.enabled,
      targetBotId: cfg.targetBotId,
      targetBotName: cfg.targetBot?.name ?? null,
      lastSyncAt: cfg.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: cfg.lastSyncStatus as BotAutoSyncConfigInfo['lastSyncStatus'],
      lastSyncMessage: cfg.lastSyncMessage,
    };
  }

  static async upsertConfig(
    botId: number,
    input: BotAutoSyncConfigUpdateInput,
  ): Promise<BotAutoSyncConfigInfo> {
    if (input.enabled && !input.targetBotId) {
      throw new Error('启用自动同步必须选择目标机器人');
    }
    if (input.targetBotId === botId) {
      throw new Error('不能把自己设为同步目标');
    }
    if (input.targetBotId) {
      const target = await prisma.bot.findUnique({ where: { id: input.targetBotId } });
      if (!target) throw new Error('目标机器人不存在');
    }
    await prisma.botAutoSyncConfig.upsert({
      where: { botId },
      create: { botId, enabled: input.enabled, targetBotId: input.targetBotId },
      update: { enabled: input.enabled, targetBotId: input.targetBotId },
    });
    return this.getConfig(botId);
  }

  /**
   * 执行一次同步。完全覆盖:对每对同名 (本 bot 链接, target bot 链接),
   * 清空本 bot 链接的 ContentBinding,然后按 target 的 sortOrder 复制(仅 resourceId + sortOrder,
   * 不复制 buttons / 订阅 / 赞助商)。
   * 返回值会被写入 lastSyncMessage。
   */
  static async runSync(botId: number): Promise<{
    status: 'success' | 'failed' | 'partial';
    message: string;
  }> {
    const cfg = await prisma.botAutoSyncConfig.findUnique({ where: { botId } });
    if (!cfg || !cfg.enabled || !cfg.targetBotId) {
      return { status: 'failed', message: '未启用或未配置目标' };
    }

    const targetBotId = cfg.targetBotId;
    try {
      const [ownLinks, targetLinks] = await Promise.all([
        prisma.inviteLink.findMany({ where: { botId }, select: { id: true, name: true } }),
        prisma.inviteLink.findMany({
          where: { botId: targetBotId },
          select: {
            id: true,
            name: true,
            contentBindings: {
              orderBy: { sortOrder: 'asc' },
              select: { resourceId: true, sortOrder: true },
            },
          },
        }),
      ]);

      // 同名匹配:多个同名取第一个(name 不带唯一约束,理论上可能重名,实际罕见)
      const ownByName = new Map<string, { id: number; name: string }>();
      for (const l of ownLinks) if (!ownByName.has(l.name)) ownByName.set(l.name, l);

      let matchedLinks = 0;
      let totalCopied = 0;
      let totalSkipped = 0;
      const errors: string[] = [];

      for (const tLink of targetLinks) {
        const own = ownByName.get(tLink.name);
        if (!own) continue;
        matchedLinks++;
        try {
          await prisma.$transaction(async (tx) => {
            await tx.contentBinding.deleteMany({ where: { inviteLinkId: own.id } });
            if (tLink.contentBindings.length === 0) return;
            await tx.contentBinding.createMany({
              data: tLink.contentBindings.map((cb) => ({
                inviteLinkId: own.id,
                resourceId: cb.resourceId,
                sortOrder: cb.sortOrder,
              })),
            });
          });
          totalCopied += tLink.contentBindings.length;
        } catch (err: any) {
          totalSkipped += tLink.contentBindings.length;
          errors.push(`「${tLink.name}」失败: ${err?.message || err}`);
        }
      }

      const status: 'success' | 'failed' | 'partial' =
        errors.length === 0 ? 'success' : matchedLinks === 0 ? 'failed' : 'partial';
      const message =
        status === 'failed' && matchedLinks === 0
          ? '没有匹配到任何同名链接'
          : `同步 ${matchedLinks} 链接 / ${totalCopied} 资源` +
            (errors.length ? ` · ${errors.length} 失败` : '');

      await prisma.botAutoSyncConfig.update({
        where: { botId },
        data: { lastSyncAt: new Date(), lastSyncStatus: status, lastSyncMessage: message },
      });
      return { status, message };
    } catch (err: any) {
      const message = `同步失败: ${err?.message || err}`;
      await prisma.botAutoSyncConfig
        .update({
          where: { botId },
          data: { lastSyncAt: new Date(), lastSyncStatus: 'failed', lastSyncMessage: message },
        })
        .catch(() => {});
      return { status: 'failed', message };
    }
  }

  /** 启动调度器要用:返回所有启用自动同步的 botId */
  static async listEnabledBotIds(): Promise<number[]> {
    const rows = await prisma.botAutoSyncConfig.findMany({
      where: { enabled: true, targetBotId: { not: null } },
      select: { botId: true },
    });
    return rows.map((r) => r.botId);
  }
}
