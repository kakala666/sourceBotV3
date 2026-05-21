import type { Context } from 'grammy';
import prisma from '../prisma';
import { advanceSession, completeSession, loadSequenceForSession } from '../services/session';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent, getSearchMoreUrl } from '../services/content';
import { sendResource, sendAd, sendEndContent, buildPageKeyboard, buildContentKeyboard } from '../services/sender';
import { getGlobalButtons } from '../services/bot-global-buttons';
import { ensureSubscribed, getGateConfig } from '../services/subscription-check';
import { sendSubscriptionPrompt } from '../services/subscription-prompt';
import { handleResourceAssignment, handleMediaVisibilityToggle, handleMediaVisibilitySave, handleResetPage, handleResetPick } from '../services/channel-collector';
import { handleRandomBrowse, handleFavoriteBrowse } from './home-keyboard';
import { shouldThrottle, sendThrottledNotice } from '../services/click-throttle';

/** 这些 callback data 前缀对应用户业务按钮,需要 3s 节流(订阅复核 / 频道管理操作不限) */
const THROTTLED_CB_PREFIXES = ['next:', 'reveal:', 'fav:'];

/** 防重复点击：记录正在处理中的 sessionId */
const processingSet = new Set<number>();

/**
 * 异步写入 ButtonClick 埋点(失败仅日志,不影响主流程)
 */
function recordButtonClick(params: {
  botId: number;
  inviteLinkId: number;
  botUserId: number;
  buttonType: 'next' | 'reveal';
  latencyMs: number;
}) {
  prisma.buttonClick
    .create({ data: params })
    .catch((e: any) => console.error('[buttonClick] write failed:', e.message));
}

/**
 * 处理翻页回调 next:{sessionId}:{nextIndex}
 */
export async function handleCallback(ctx: Context, botId: number) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // 业务按钮 3 秒节流:命中 throttle 时清 loading + 发自删提示
  if (THROTTLED_CB_PREFIXES.some((p) => data.startsWith(p))) {
    const tgId = ctx.from?.id;
    if (tgId && shouldThrottle(botId, tgId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      sendThrottledNotice(ctx, botId, tgId);
      return;
    }
  }

  // 订阅校验回调
  const checkMatch = data.match(/^check_sub:(\d+):(\d+)$/);
  if (checkMatch) {
    const sessionId = parseInt(checkMatch[1], 10);
    const nextIndex = parseInt(checkMatch[2], 10);
    try {
      await handleSubscriptionRecheck(ctx, botId, sessionId, nextIndex);
    } catch (err: any) {
      console.error('[callback] check_sub 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '验证失败,请重试', show_alert: true }).catch(() => {});
    }
    return;
  }

  // check_random:订阅校验后重新跑「随便看看」
  const checkRandomMatch = data.match(/^check_random:\d+:\d+$/);
  if (checkRandomMatch) {
    try {
      await ctx.answerCallbackQuery();
      await handleRandomBrowse(ctx, botId);
    } catch (err: any) {
      console.error('[callback] check_random 处理失败:', err.message);
    }
    return;
  }

  // check_favorite:订阅校验后重新跑「我的收藏」
  const checkFavMatch = data.match(/^check_favorite:\d+:\d+$/);
  if (checkFavMatch) {
    try {
      await ctx.answerCallbackQuery();
      await handleFavoriteBrowse(ctx, botId);
    } catch (err: any) {
      console.error('[callback] check_favorite 处理失败:', err.message);
    }
    return;
  }

  // 资源归属选择(频道采集后)
  const reassignMatch = data.match(/^resassign:(\d+):(\d+|new)$/);
  if (reassignMatch) {
    const newResourceId = parseInt(reassignMatch[1], 10);
    try {
      await handleResourceAssignment(ctx, botId, newResourceId, reassignMatch[2]);
    } catch (err: any) {
      console.error('[callback] resassign 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '操作失败', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 媒体可见性切换
  const visToggleMatch = data.match(/^medvis:(\d+):(\d+)$/);
  if (visToggleMatch) {
    try {
      await handleMediaVisibilityToggle(ctx, parseInt(visToggleMatch[1], 10), parseInt(visToggleMatch[2], 10));
    } catch (err: any) {
      console.error('[callback] medvis 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '操作失败', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 媒体可见性保存
  const visSaveMatch = data.match(/^medsave:(\d+)$/);
  if (visSaveMatch) {
    try {
      await handleMediaVisibilitySave(ctx, parseInt(visSaveMatch[1], 10));
    } catch (err: any) {
      console.error('[callback] medsave 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '操作失败', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 重设:翻页
  const resetPageMatch = data.match(/^reset_page:(\d+):(\d+)$/);
  if (resetPageMatch) {
    try {
      await handleResetPage(ctx, parseInt(resetPageMatch[1], 10), parseInt(resetPageMatch[2], 10));
    } catch (err: any) {
      console.error('[callback] reset_page 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '操作失败', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 重设:选某条
  const resetPickMatch = data.match(/^reset_pick:(\d+)$/);
  if (resetPickMatch) {
    try {
      await handleResetPick(ctx, botId, parseInt(resetPickMatch[1], 10));
    } catch (err: any) {
      console.error('[callback] reset_pick 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '操作失败', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 重设键盘的占位按钮(当前页 / 边界)
  if (data === 'reset_noop') {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  // 收藏当前资源
  const favMatch = data.match(/^fav:(\d+):(\d+)$/);
  if (favMatch) {
    const sessionId = parseInt(favMatch[1], 10);
    const resourceId = parseInt(favMatch[2], 10);
    try {
      const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        include: { botUser: true },
      });
      if (!session) {
        await ctx.answerCallbackQuery({ text: '会话已失效' }).catch(() => {});
        return;
      }
      const existing = await prisma.favoriteResource.findUnique({
        where: { botUserId_resourceId: { botUserId: session.botUser.id, resourceId } },
      });
      if (existing) {
        await ctx.answerCallbackQuery({ text: '⭐ 已收藏过该资源' }).catch(() => {});
      } else {
        await prisma.favoriteResource.create({
          data: { botUserId: session.botUser.id, resourceId },
        });
        await ctx.answerCallbackQuery({ text: '⭐ 收藏成功' }).catch(() => {});
      }
    } catch (err: any) {
      console.error('[callback] fav 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '收藏失败,请重试' }).catch(() => {});
    }
    return;
  }

  // 展开当前页的隐藏 mediaFile(先校验订阅)
  const revealMatch = data.match(/^reveal:(\d+):(\d+)$/);
  if (revealMatch) {
    const sessionId = parseInt(revealMatch[1], 10);
    const currentIndex = parseInt(revealMatch[2], 10);
    const startTime = Date.now();
    let trackedBotUserId: number | null = null;
    let trackedInviteLinkId: number | null = null;
    try {
      await ctx.answerCallbackQuery();
      const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        include: { botUser: true },
      });
      if (!session) return;
      trackedBotUserId = session.botUser.id;
      trackedInviteLinkId = session.botUser.inviteLinkId;
      // 展开"第 N 个资源"中 N = currentIndex + 1
      const gateResult = await ensureSubscribed(
        session.botUser.inviteLinkId,
        session.botUser.telegramId,
        ctx.api,
        currentIndex + 1,
      );
      if (!gateResult.ok) {
        const config = getGateConfig(session.botUser.inviteLinkId);
        await sendSubscriptionPrompt(
          ctx,
          config?.promptTemplate,
          sessionId,
          currentIndex,
          gateResult.missing,
          'check_reveal',
        );
        return;
      }
      await processReveal(ctx, botId, sessionId, currentIndex);
    } catch (err: any) {
      console.error('[callback] reveal 处理失败:', err.message);
    } finally {
      if (trackedBotUserId !== null && trackedInviteLinkId !== null) {
        recordButtonClick({
          botId,
          inviteLinkId: trackedInviteLinkId,
          botUserId: trackedBotUserId,
          buttonType: 'reveal',
          latencyMs: Date.now() - startTime,
        });
      }
    }
    return;
  }

  // 展开请求的订阅复核
  const checkRevealMatch = data.match(/^check_reveal:(\d+):(\d+)$/);
  if (checkRevealMatch) {
    const sessionId = parseInt(checkRevealMatch[1], 10);
    const currentIndex = parseInt(checkRevealMatch[2], 10);
    try {
      await handleRevealRecheck(ctx, botId, sessionId, currentIndex);
    } catch (err: any) {
      console.error('[callback] check_reveal 处理失败:', err.message);
      await ctx.answerCallbackQuery({ text: '验证失败,请重试', show_alert: true }).catch(() => {});
    }
    return;
  }

  // 解析翻页回调
  const match = data.match(/^next:(\d+):(\d+)$/);
  if (!match) {
    await ctx.answerCallbackQuery();
    return;
  }

  const sessionId = parseInt(match[1], 10);
  const nextIndex = parseInt(match[2], 10);

  // 防重复点击
  if (processingSet.has(sessionId)) {
    await ctx.answerCallbackQuery({ text: '正在处理中...' });
    return;
  }

  processingSet.add(sessionId);

  try {
    // 先消除 loading 动画
    await ctx.answerCallbackQuery();

    await processNextPage(ctx, botId, sessionId, nextIndex);
  } catch (err: any) {
    console.error('[callback] 翻页处理失败:', err.message);
  } finally {
    processingSet.delete(sessionId);
  }
}

/**
 * 处理翻页逻辑：广告 → 等待 → 下一条资源
 */
async function processNextPage(
  ctx: Context,
  botId: number,
  sessionId: number,
  nextIndex: number,
) {
  const startTime = Date.now();
  let trackedBotUserId: number | null = null;
  let trackedInviteLinkId: number | null = null;
  try {
    return await _processNextPageInner();
  } finally {
    if (trackedBotUserId !== null && trackedInviteLinkId !== null) {
      recordButtonClick({
        botId,
        inviteLinkId: trackedInviteLinkId,
        botUserId: trackedBotUserId,
        buttonType: 'next',
        latencyMs: Date.now() - startTime,
      });
    }
  }

  async function _processNextPageInner() {
  // 查询会话
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });

  if (!session || session.isCompleted) return;

  const { botUser } = session;
  trackedBotUserId = botUser.id;
  trackedInviteLinkId = botUser.inviteLinkId;

  // 强制订阅拦截:翻页"从第 N 翻到 N+1" → position = nextIndex
  const gateResult = await ensureSubscribed(botUser.inviteLinkId, botUser.telegramId, ctx.api, nextIndex);
  if (!gateResult.ok) {
    const config = getGateConfig(botUser.inviteLinkId);
    await sendSubscriptionPrompt(ctx, config?.promptTemplate, sessionId, nextIndex, gateResult.missing);
    return;
  }

  // 查询邀请链接的内容和广告
  const sequence = await loadSequenceForSession({
    id: session.id, mode: session.mode, payload: session.payload, botUser,
  });
  const adBindings = await loadAdBindings(botUser.inviteLinkId);
  const totalContent = sequence.length;

  // 索引越界 → 预览结束
  if (nextIndex >= sequence.length) {
    await completeSession(sessionId);
    if (session.mode === 'favorite') {
      await ctx.reply('你的收藏全部看完了 🎯');
    } else {
      const endContent = await getEndContent();
      await sendEndContent(ctx, endContent);
    }
    return;
  }

  // 发送广告（如果有配置）
  if (adBindings.length > 0) {
    // 广告按顺序轮询：用 (nextIndex - 1) 对广告数量取模
    const adIndex = (nextIndex - 1) % adBindings.length;
    const adBinding = adBindings[adIndex];

    if (adBinding?.resource) {
      const adDisplaySeconds = await getAdDisplaySeconds();

      try {
        await sendAd(ctx, botId, adBinding, adDisplaySeconds);

        // 记录广告曝光
        await prisma.adImpression.create({
          data: {
            botId,
            inviteLinkId: botUser.inviteLinkId,
            adBindingId: adBinding.id,
            telegramId: botUser.telegramId,
          },
        });

        // 等待广告展示时间
        await new Promise((r) => setTimeout(r, adDisplaySeconds * 1000));
      } catch (err: any) {
        console.error('[callback] 广告发送失败:', err.message);
      }
    }
  }

  // 更新会话索引
  await advanceSession(sessionId, nextIndex);

  // 发送下一条资源
  const binding = sequence[nextIndex];
  if (!binding?.resource) return;

  // 隐藏 mediaFile 默认不发,有隐藏的就在键盘加"展开更多"
  const allMediaFiles = binding.resource.mediaFiles;
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...binding.resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId, currentIndex: nextIndex } : null;
  const mediaCounts = {
    total: allMediaFiles.length,
    visible: visibleMediaFiles.length,
    hidden: allMediaFiles.length - visibleMediaFiles.length,
  };

  const isLast = nextIndex >= totalContent - 1;

  const favoriteInfo = { sessionId, resourceId: binding.resource.id };

  if (isLast) {
    // 最后一条资源，不带翻页按钮，但可能有内容按钮 / 展开更多按钮 / 收藏
    const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;
    const keyboard = buildContentKeyboard(contentButtons, undefined, undefined, revealInfo, undefined, favoriteInfo, getGlobalButtons(botId));
    try {
      await sendResource(ctx, botId, filteredResource, keyboard, binding.resource.id, mediaCounts);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 资源加载失败，请稍后重试');
      return;
    }
    await completeSession(sessionId);
    if (session.mode === 'favorite') {
      await ctx.reply('你的收藏全部看完了 🎯');
    } else {
      const endContent = await getEndContent();
      await sendEndContent(ctx, endContent);
    }
  } else {
    // 还有更多资源，带翻页按钮(可能也带展开更多)
    const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;
    const searchMoreUrl = await getSearchMoreUrl();
    const keyboard = buildContentKeyboard(contentButtons, sessionId, nextIndex + 1, revealInfo, searchMoreUrl, favoriteInfo, getGlobalButtons(botId));
    try {
      await sendResource(ctx, botId, filteredResource, keyboard, binding.resource.id, mediaCounts);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      const fallbackKb = buildPageKeyboard(sessionId, nextIndex + 1, searchMoreUrl);
      await ctx.reply('⚠️ 当前资源加载失败', { reply_markup: fallbackKb });
    }
  }
  }
}

/**
 * 处理「🔽 展开更多」:发送当前页的 hidden mediaFiles(不带 caption,不带 keyboard),
 * 并把原消息上的「展开更多」按钮去掉防重复点击。
 */
async function processReveal(
  ctx: Context,
  _botId: number,
  sessionId: number,
  currentIndex: number,
) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });
  if (!session) return;

  const sequence = await loadSequenceForSession({
    id: session.id, mode: session.mode, payload: session.payload, botUser: session.botUser,
  });
  const binding = sequence[currentIndex];
  if (!binding?.resource) return;

  const hiddenMediaFiles = binding.resource.mediaFiles.filter((mf: any) => mf.isHidden);
  if (hiddenMediaFiles.length === 0) return;

  // type 按数量决定:多个走 media_group,单个走 photo/video
  let revealType: string;
  if (hiddenMediaFiles.length > 1) {
    revealType = 'media_group';
  } else {
    revealType = hiddenMediaFiles[0].type === 'video' ? 'video' : 'photo';
  }

  const revealResource = {
    type: revealType,
    caption: null,
    mediaFiles: hiddenMediaFiles,
  };

  // 发隐藏部分,不带 keyboard
  try {
    await sendResource(ctx, _botId, revealResource);
  } catch (err: any) {
    console.error('[callback] reveal 发送失败:', err.message);
  }

  // 删除原带 keyboard 的"👆 以上是当前资源"文本消息(只有 media_group 才有 reveal,所以这条
  // 一定是独立文本,不会连带丢失媒体内容)。失败时降级为清空按钮,保证体验不退化。
  try {
    await ctx.deleteMessage();
  } catch {
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      // 双重失败不影响主流程
    }
  }

  // 在底部重新发一条 keyboard 锚定消息,keyboard 去掉「🔽 展开更多」(已展开过)
  const totalContent = sequence.length;
  const isLast = currentIndex >= totalContent - 1;
  const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;
  const favoriteInfo = { sessionId, resourceId: binding.resource.id };

  let newKeyboard;
  if (isLast) {
    newKeyboard = buildContentKeyboard(contentButtons, undefined, undefined, null, undefined, favoriteInfo, getGlobalButtons(_botId));
  } else {
    const searchMoreUrl = await getSearchMoreUrl();
    newKeyboard = buildContentKeyboard(contentButtons, sessionId, currentIndex + 1, null, searchMoreUrl, favoriteInfo, getGlobalButtons(_botId));
  }

  if (newKeyboard) {
    try {
      await ctx.reply(
        '👆👆所有资源已经发送完毕👆\n喜欢的此类资源 可以点击下方收藏按钮进行收藏\n后续这个妹子有新的影片更新 将会通知你\n后续同类型资源上架会自动进行推送',
        { reply_markup: newKeyboard },
      );
    } catch (err: any) {
      console.error('[callback] reveal 后重发 keyboard 失败:', err.message);
    }
  }
}

/**
 * 处理订阅校验回调 check_sub:{sessionId}:{nextIndex}
 */
async function handleSubscriptionRecheck(
  ctx: Context,
  botId: number,
  sessionId: number,
  nextIndex: number,
) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });
  if (!session) {
    await ctx.answerCallbackQuery({ text: '会话已失效', show_alert: true });
    return;
  }

  // 复核翻页:同 processNextPage 的 position
  const result = await ensureSubscribed(
    session.botUser.inviteLinkId,
    session.botUser.telegramId,
    ctx.api,
    nextIndex,
  );
  if (!result.ok) {
    await ctx.answerCallbackQuery({
      text: '还有未订阅的频道,请检查后再试',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ 验证通过' });
  await ctx.deleteMessage().catch(() => {});

  if (processingSet.has(sessionId)) return;
  processingSet.add(sessionId);
  try {
    await processNextPage(ctx, botId, sessionId, nextIndex);
  } finally {
    processingSet.delete(sessionId);
  }
}

/**
 * 处理「展开更多」的订阅复核 check_reveal:{sessionId}:{currentIndex}
 * 通过则删除订阅提示并直接展开隐藏部分。
 */
async function handleRevealRecheck(
  ctx: Context,
  botId: number,
  sessionId: number,
  currentIndex: number,
) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });
  if (!session) {
    await ctx.answerCallbackQuery({ text: '会话已失效', show_alert: true });
    return;
  }

  // 复核展开:同 reveal 的 position = currentIndex + 1
  const result = await ensureSubscribed(
    session.botUser.inviteLinkId,
    session.botUser.telegramId,
    ctx.api,
    currentIndex + 1,
  );
  if (!result.ok) {
    await ctx.answerCallbackQuery({
      text: '还有未订阅的频道,请检查后再试',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: '✅ 验证通过' });
  await ctx.deleteMessage().catch(() => {});

  await processReveal(ctx, botId, sessionId, currentIndex);
}
