import prisma from '../prisma';

/**
 * 每日 00:00 调度器:遍历所有 enabled 的 BotAutoSyncConfig,执行同步。
 *
 * 同步逻辑直接在 bot-runner 进程内做(读 BotAutoSyncConfig + 比对同名链接 +
 * 覆盖 ContentBinding),不通过 server,避免跨进程通信。
 *
 * 行为:
 *   - 启动时 setTimeout 到下一个 00:00
 *   - 触发后跑 runAllSyncs,然后 setInterval 24h
 *   - 服务时区 Asia/Shanghai(@env TZ),0 点按本地零点
 */

function msUntilNextMidnight(now = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // 下一个零点(已包含跨日)
  return next.getTime() - now.getTime();
}

async function runAllSyncs(): Promise<void> {
  console.log('[auto-sync] 开始执行每日同步');
  const startedAt = Date.now();
  const enabled = await prisma.botAutoSyncConfig.findMany({
    where: { enabled: true, targetBotId: { not: null } },
    select: { botId: true, targetBotId: true },
  });
  if (enabled.length === 0) {
    console.log('[auto-sync] 没有启用同步的 bot,本轮跳过');
    return;
  }

  let ok = 0, fail = 0;
  for (const cfg of enabled) {
    try {
      await syncOneBot(cfg.botId);
      ok++;
    } catch (err: any) {
      fail++;
      console.error(`[auto-sync] bot ${cfg.botId} 同步失败:`, err?.message || err);
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[auto-sync] 完成 ${ok} 成功 / ${fail} 失败 / 用时 ${elapsed}s`);
}

/**
 * 同步单个 bot(从 targetBotId 拉 ContentBinding 完全覆盖本 bot 同名链接)。
 * 与 server/services/bot-auto-sync.service.ts 的 runSync 等价,但跑在 bot 进程内
 * 不绕 HTTP。两侧逻辑独立维护(都很短)。
 */
async function syncOneBot(botId: number): Promise<void> {
  const cfg = await prisma.botAutoSyncConfig.findUnique({ where: { botId } });
  if (!cfg || !cfg.enabled || !cfg.targetBotId) return;

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

    const ownByName = new Map<string, { id: number; name: string }>();
    for (const l of ownLinks) if (!ownByName.has(l.name)) ownByName.set(l.name, l);

    let matchedLinks = 0;
    let totalCopied = 0;
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
        errors.push(`「${tLink.name}」: ${err?.message || err}`);
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
    console.log(`[auto-sync] bot ${botId}: ${status} - ${message}`);
  } catch (err: any) {
    const message = `同步异常: ${err?.message || err}`;
    await prisma.botAutoSyncConfig
      .update({
        where: { botId },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'failed', lastSyncMessage: message },
      })
      .catch(() => {});
    throw err;
  }
}

/**
 * 启动调度器。idempotent — 多次调用只有第一次生效。
 */
let started = false;
export function startAutoSyncScheduler(): void {
  if (started) return;
  started = true;
  const wait = msUntilNextMidnight();
  console.log(`[auto-sync] 调度器启动,下次执行: ${new Date(Date.now() + wait).toISOString()} (${(wait / 1000 / 60).toFixed(1)} 分钟后)`);
  setTimeout(() => {
    runAllSyncs().catch((err) => console.error('[auto-sync] 首次执行异常:', err?.message || err));
    setInterval(() => {
      runAllSyncs().catch((err) => console.error('[auto-sync] 定时执行异常:', err?.message || err));
    }, 24 * 60 * 60 * 1000);
  }, wait);
}
