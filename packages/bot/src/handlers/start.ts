import type { Context } from 'grammy';
import prisma from '../prisma';
import { upsertBotUser, resetSession } from '../services/session';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent, getSearchMoreUrl, getWelcomeText } from '../services/content';
import { sendResource, sendAd, sendEndContent, buildPageKeyboard, buildContentKeyboard, buildHomeReplyKeyboard } from '../services/sender';
import { getGlobalButtons } from '../services/bot-global-buttons';
import { isLiked } from '../services/resource-like';
import { buildShareSequence } from '../services/share-sequence';
import { handleSearchQuery } from './search';
import { HOT_KEYWORDS } from './hot';

/**
 * 处理 /start 命令
 * 用户通过 t.me/botname?start=abc123 进入
 */
export async function handleStart(ctx: Context, botId: number) {
  const payload = (ctx as any).match as string | undefined;

  // 无参数 → 不回复
  if (!payload) return;

  // 分享 deep link: /start share_{resourceId}
  const shareMatch = payload.match(/^share_(\d+)$/);
  if (shareMatch) {
    await handleShareStart(ctx, botId, parseInt(shareMatch[1], 10));
    return;
  }

  // 热搜词 deep link: /start search_<1-based-index>
  // 由 🔥 热搜 按钮发出的 [词](t.me/<bot>?start=search_N) 链接触发。
  // 用编号(ASCII-safe)而非 URL-encoded 中文, 因 Telegram start payload
  // 仅允许 [A-Za-z0-9_-]。
  const searchMatch = payload.match(/^search_(\d+)$/);
  if (searchMatch) {
    const idx = parseInt(searchMatch[1], 10) - 1;
    const keyword = HOT_KEYWORDS[idx];
    if (keyword) {
      await handleSearchQuery(ctx, botId, keyword);
    }
    return;
  }

  // 查询邀请链接
  const inviteLink = await prisma.inviteLink.findUnique({
    where: { botId_code: { botId, code: payload } },
  });

  // 无效链接 → 不回复
  if (!inviteLink) return;

  // 加载内容绑定
  const contentBindings = await loadContentBindings(inviteLink.id);

  // 链接未配置内容 → 不回复
  if (!contentBindings.length) return;

  const from = ctx.from;
  if (!from) return;

  const telegramId = BigInt(from.id);

  // 记录/更新 BotUser
  const botUser = await upsertBotUser(
    telegramId,
    botId,
    inviteLink.id,
    from.first_name,
    from.last_name ?? undefined,
    from.username ?? undefined,
  );

  // 创建新会话（重置旧会话）
  const session = await resetSession(botUser.id);

  // 发欢迎文本 + reply keyboard(Telegram 客户端会持续显示)
  try {
    const welcomeText = await getWelcomeText();
    await ctx.reply(welcomeText, { reply_markup: buildHomeReplyKeyboard() });
  } catch (err: any) {
    console.error('[start] 发欢迎键盘失败:', err.message);
  }

  // 发送第一条资源
  await sendFirstResource(ctx, botId, inviteLink.id, session.id, botUser.id, contentBindings);
}

/**
 * 发送第一条资源（index=0）
 */
async function sendFirstResource(
  ctx: Context,
  botId: number,
  inviteLinkId: number,
  sessionId: number,
  botUserId: number,
  contentBindings: Awaited<ReturnType<typeof loadContentBindings>>,
) {
  const binding = contentBindings[0];
  if (!binding?.resource) return;

  const totalContent = contentBindings.length;

  // 隐藏 mediaFile 不发,有隐藏的就在键盘加「🔽 展开更多」(currentIndex=0)
  const allMediaFiles = binding.resource.mediaFiles;
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...binding.resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId, currentIndex: 0 } : null;

  const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;

  const favoriteInfo = { sessionId, resourceId: binding.resource.id };
  const liked = await isLiked(botUserId, binding.resource.id);
  const likeInfo = { sessionId, resourceId: binding.resource.id, liked };
  const shareInfo = { botId, resourceId: binding.resource.id };

  const mediaCounts = {
    total: allMediaFiles.length,
    visible: visibleMediaFiles.length,
    hidden: allMediaFiles.length - visibleMediaFiles.length,
  };

  // 如果只有一条资源，发完即结束
  if (totalContent <= 1) {
    const keyboard = buildContentKeyboard(contentButtons, undefined, undefined, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
    try {
      await sendResource(ctx, botId, filteredResource, keyboard, binding.resource.id, mediaCounts);
    } catch (err: any) {
      console.error('[start] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 资源加载失败，请稍后重试');
      return;
    }
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
    return;
  }

  // 多条资源，带翻页按钮
  const searchMoreUrl = await getSearchMoreUrl();
  const keyboard = buildContentKeyboard(contentButtons, sessionId, 1, revealInfo, searchMoreUrl, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  try {
    await sendResource(ctx, botId, filteredResource, keyboard, binding.resource.id, mediaCounts);
  } catch (err: any) {
    console.error('[start] 发送资源失败:', err.message);
    // 发送失败时仍然提供翻页键盘，让用户可以跳到下一页
    const fallbackKb = buildPageKeyboard(sessionId, 1, searchMoreUrl);
    await ctx.reply('⚠️ 当前资源加载失败', { reply_markup: fallbackKb });
  }
}

/**
 * 分享 deep link 入口: /start share_{resourceId}
 *   - 用 bot 第一个 inviteLink 作 fallback 创建/更新 BotUser
 *   - 序列 = [origin, ...top99 按 likes/favs/views/id desc 排序去掉 origin]
 */
async function handleShareStart(ctx: Context, botId: number, originResourceId: number) {
  const from = ctx.from;
  if (!from) return;

  const origin = await prisma.resource.findUnique({
    where: { id: originResourceId },
    select: { id: true, type: true },
  });
  if (!origin || origin.type !== 'media_group') {
    await ctx.reply('⚠️ 资源不存在或已下线');
    return;
  }

  // 该 bot 必须至少有一个 inviteLink 作为 BotUser 关联 fallback
  const fallbackLink = await prisma.inviteLink.findFirst({
    where: { botId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!fallbackLink) {
    await ctx.reply('⚠️ 暂时无法访问,请稍后再试');
    return;
  }

  const botUser = await upsertBotUser(
    BigInt(from.id),
    botId,
    fallbackLink.id,
    from.first_name,
    from.last_name ?? undefined,
    from.username ?? undefined,
  );

  const resourceIds = await buildShareSequence(originResourceId);
  if (resourceIds.length === 0) {
    await ctx.reply('⚠️ 暂无可用资源');
    return;
  }

  const session = await resetSession(botUser.id, {
    mode: 'share',
    payload: { originResourceId, resourceIds },
  });

  // 发欢迎键盘 + 首条资源(=origin)
  try {
    await ctx.reply('🔗 通过分享进入,以下是分享的资源', { reply_markup: buildHomeReplyKeyboard() });
  } catch (err: any) {
    console.error('[start] share 欢迎键盘失败:', err.message);
  }

  const first = await prisma.resource.findUnique({
    where: { id: originResourceId },
    include: { mediaFiles: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!first) return;

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

  // 分享路径不带「🔍 搜索更多资源」按钮
  let keyboard;
  if (resourceIds.length > 1) {
    keyboard = buildContentKeyboard(null, session.id, 1, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  } else {
    keyboard = buildContentKeyboard(null, undefined, undefined, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId), likeInfo, shareInfo);
  }

  try {
    await sendResource(ctx, botId, filteredResource as any, keyboard, first.id, mediaCounts);
  } catch (err: any) {
    console.error('[start] share 首条发送失败:', err.message);
    await ctx.reply('⚠️ 资源加载失败,请稍后重试');
  }
}
