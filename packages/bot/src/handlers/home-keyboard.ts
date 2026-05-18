import type { Context } from 'grammy';
import prisma from '../prisma';
import { resetSession } from '../services/session';
import { sendResource, buildContentKeyboard } from '../services/sender';
import { pickRandomContentResource } from '../services/random-resource';
import { loadFavoriteList } from '../services/favorite-list';
import { ensureSubscribed, getGateConfig } from '../services/subscription-check';
import { sendSubscriptionPrompt } from '../services/subscription-prompt';
import { getSearchMoreUrl } from '../services/content';

/**
 * 🎲 随便看看:订阅检查 → 随机 1 资源 → 单条发送(带展开?+ 收藏,无翻页/搜索更多)
 */
export async function handleRandomBrowse(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const gateResult = await ensureSubscribed(botUser.inviteLinkId, botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botUser.inviteLinkId);
    await sendSubscriptionPrompt(
      ctx, config?.promptTemplate, 0, 0, gateResult.missing, 'check_random',
    );
    return;
  }

  const resource = await pickRandomContentResource();
  if (!resource) {
    await ctx.reply('暂无可用资源,请稍后再试');
    return;
  }

  const session = await resetSession(botUser.id, { mode: 'single', payload: { resourceId: resource.id } });

  const allMediaFiles = resource.mediaFiles ?? [];
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId: session.id, currentIndex: 0 } : null;
  const favoriteInfo = { sessionId: session.id, resourceId: resource.id };
  const mediaCounts = {
    total: allMediaFiles.length,
    visible: visibleMediaFiles.length,
    hidden: allMediaFiles.length - visibleMediaFiles.length,
  };

  const keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo);
  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, resource.id, mediaCounts);
  } catch (err: any) {
    console.error('[home] random 发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}

/**
 * ⭐ 我的收藏:订阅检查 → favorites 序列(按收藏时间 desc)→ 翻页浏览
 */
export async function handleFavoriteBrowse(ctx: Context, botId: number) {
  const from = ctx.from;
  if (!from) return;

  const botUser = await prisma.botUser.findFirst({
    where: { telegramId: BigInt(from.id), botId },
  });
  if (!botUser) {
    await ctx.reply('请先通过邀请链接 /start 一次');
    return;
  }

  const gateResult = await ensureSubscribed(botUser.inviteLinkId, botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botUser.inviteLinkId);
    await sendSubscriptionPrompt(
      ctx, config?.promptTemplate, 0, 0, gateResult.missing, 'check_favorite',
    );
    return;
  }

  const favorites = await loadFavoriteList(botUser.id);
  if (favorites.length === 0) {
    await ctx.reply('你还没收藏过任何资源,在资源消息上点 ⭐ 收藏');
    return;
  }

  const session = await resetSession(botUser.id, { mode: 'favorite' });
  const first = favorites[0];

  const allMediaFiles = first.resource.mediaFiles ?? [];
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...first.resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId: session.id, currentIndex: 0 } : null;
  const favoriteInfo = { sessionId: session.id, resourceId: first.resource.id };
  const mediaCounts = {
    total: allMediaFiles.length,
    visible: visibleMediaFiles.length,
    hidden: allMediaFiles.length - visibleMediaFiles.length,
  };

  let keyboard;
  if (favorites.length > 1) {
    const searchMoreUrl = await getSearchMoreUrl();
    keyboard = buildContentKeyboard(null, session.id, 1, revealInfo, searchMoreUrl, favoriteInfo);
  } else {
    keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo);
  }

  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, first.resource.id, mediaCounts);
  } catch (err: any) {
    console.error('[home] favorite 发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}
