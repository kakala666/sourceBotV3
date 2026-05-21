import type { Context } from 'grammy';
import prisma from '../prisma';
import { resetSession } from '../services/session';
import { sendResource, buildContentKeyboard } from '../services/sender';
import { getGlobalButtons } from '../services/bot-global-buttons';
import { isLiked } from '../services/resource-like';
import { buildHotSequence } from '../services/hot-sequence';

/**
 * 🔥 热搜:按观看量降序拉前 100 条 → 创建 mode='hot' session → 发首条 + 翻页
 */
export async function handleHotBrowse(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const ids = await buildHotSequence();
  if (ids.length === 0) {
    await ctx.reply('暂无可用资源');
    return;
  }

  const session = await resetSession(botUser.id, {
    mode: 'hot',
    payload: { resourceIds: ids },
  });

  const first = await prisma.resource.findUnique({
    where: { id: ids[0] },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!first) {
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
    return;
  }

  const allMediaFiles = first.mediaFiles ?? [];
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...first, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId: session.id, currentIndex: 0 } : null;
  const favoriteInfo = { sessionId: session.id, resourceId: first.id };
  const liked = await isLiked(botUser.id, first.id);
  const likeInfo = { sessionId: session.id, resourceId: first.id, liked };
  const shareInfo = { botId, resourceId: first.id };
  const mediaCounts = {
    total: allMediaFiles.length,
    visible: visibleMediaFiles.length,
    hidden: allMediaFiles.length - visibleMediaFiles.length,
  };

  await ctx.reply(`🔥 热搜榜共 ${ids.length} 条,开始浏览`);

  let keyboard;
  if (ids.length > 1) {
    keyboard = buildContentKeyboard(null, session.id, 1, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  } else {
    keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  }

  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, first.id, mediaCounts);
  } catch (err: any) {
    console.error('[hot] 发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}
