import type { Context } from 'grammy';
import prisma from '../prisma';
import { resetSession } from '../services/session';
import { sendResource, buildContentKeyboard } from '../services/sender';
import { getGlobalButtons } from '../services/bot-global-buttons';
import { isLiked } from '../services/resource-like';
import { searchResources } from '../services/resource-search';
import { markPending } from '../services/search-pending';

const MAX_KEYWORD_LEN = 100;

/**
 * 🔍 搜索入口:回复提示 + 标记 pending,等用户下一条文本作为关键词
 */
export async function handleSearchEntry(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  markPending(botId, from.id);
  await ctx.reply('🔍 请发送你要搜索的关键词(任意一句文本即可)');
}

/**
 * 搜索查询执行:由 message handler 在 consume 掉 pending 后调用
 */
export async function handleSearchQuery(ctx: Context, botId: number, keyword: string) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) return;

  const trimmed = keyword.trim().slice(0, MAX_KEYWORD_LEN);
  if (!trimmed) {
    await ctx.reply('关键词不能为空,请重新点 🔍 搜索其他资源');
    return;
  }

  const ids = await searchResources(trimmed);
  if (ids.length === 0) {
    await ctx.reply(`没找到包含「${trimmed}」的资源,换个关键词试试`);
    return;
  }

  const session = await resetSession(botUser.id, {
    mode: 'search',
    payload: { keyword: trimmed, resourceIds: ids },
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

  await ctx.reply(`🔍 找到 ${ids.length} 条相关资源,开始浏览`);

  // 搜索路径不带「🔍 搜索更多资源」按钮(避免视觉重复)
  let keyboard;
  if (ids.length > 1) {
    keyboard = buildContentKeyboard(null, session.id, 1, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  } else {
    keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  }

  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, first.id, mediaCounts);
  } catch (err: any) {
    console.error('[search] 发送资源失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}
