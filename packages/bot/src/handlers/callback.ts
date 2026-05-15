import type { Context } from 'grammy';
import prisma from '../prisma';
import { getActiveSession, advanceSession, completeSession } from '../services/session';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent } from '../services/content';
import { sendResource, sendAd, sendEndContent, buildPageKeyboard, buildContentKeyboard } from '../services/sender';
import { ensureSubscribed, getGateConfig } from '../services/subscription-check';
import { sendSubscriptionPrompt } from '../services/subscription-prompt';
import { handleResourceAssignment, handleMediaVisibilityToggle, handleMediaVisibilitySave } from '../services/channel-collector';

/** 防重复点击：记录正在处理中的 sessionId */
const processingSet = new Set<number>();

/**
 * 处理翻页回调 next:{sessionId}:{nextIndex}
 */
export async function handleCallback(ctx: Context, botId: number) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

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

  // 展开当前页的隐藏 mediaFile(先校验订阅)
  const revealMatch = data.match(/^reveal:(\d+):(\d+)$/);
  if (revealMatch) {
    const sessionId = parseInt(revealMatch[1], 10);
    const currentIndex = parseInt(revealMatch[2], 10);
    try {
      await ctx.answerCallbackQuery();
      const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        include: { botUser: true },
      });
      if (!session) return;
      const gateResult = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
      if (!gateResult.ok) {
        const config = getGateConfig(botId);
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
  // 查询会话
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { botUser: true },
  });

  if (!session || session.isCompleted) return;

  const { botUser } = session;

  // 强制订阅拦截
  const gateResult = await ensureSubscribed(botId, botUser.telegramId, ctx.api);
  if (!gateResult.ok) {
    const config = getGateConfig(botId);
    await sendSubscriptionPrompt(ctx, config?.promptTemplate, sessionId, nextIndex, gateResult.missing);
    return;
  }

  // 查询邀请链接的内容和广告
  const contentBindings = await loadContentBindings(botUser.inviteLinkId);
  const adBindings = await loadAdBindings(botUser.inviteLinkId);
  const totalContent = contentBindings.length;

  // 索引越界 → 预览结束
  if (nextIndex >= totalContent) {
    await completeSession(sessionId);
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
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
  const binding = contentBindings[nextIndex];
  if (!binding?.resource) return;

  // 隐藏 mediaFile 默认不发,有隐藏的就在键盘加"展开更多"
  const allMediaFiles = binding.resource.mediaFiles;
  const visibleMediaFiles = allMediaFiles.filter((mf: any) => !mf.isHidden);
  const hasHidden = visibleMediaFiles.length < allMediaFiles.length;
  const filteredResource = { ...binding.resource, mediaFiles: visibleMediaFiles };
  const revealInfo = hasHidden ? { sessionId, currentIndex: nextIndex } : null;

  const isLast = nextIndex >= totalContent - 1;

  if (isLast) {
    // 最后一条资源，不带翻页按钮，但可能有内容按钮 / 展开更多按钮
    const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;
    const keyboard = buildContentKeyboard(contentButtons, undefined, undefined, revealInfo);
    try {
      await sendResource(ctx, botId, filteredResource, keyboard);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 资源加载失败，请稍后重试');
      return;
    }
    await completeSession(sessionId);
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
  } else {
    // 还有更多资源，带翻页按钮(可能也带展开更多)
    const contentButtons = (binding as any).buttons as { text: string; url: string }[] | null;
    const keyboard = buildContentKeyboard(contentButtons, sessionId, nextIndex + 1, revealInfo);
    try {
      await sendResource(ctx, botId, filteredResource, keyboard);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      const fallbackKb = buildPageKeyboard(sessionId, nextIndex + 1);
      await ctx.reply('⚠️ 当前资源加载失败', { reply_markup: fallbackKb });
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

  const contentBindings = await loadContentBindings(session.botUser.inviteLinkId);
  const binding = contentBindings[currentIndex];
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

  // 从原消息键盘里移除「展开更多」按钮,保留其他(下一页等)
  try {
    const origMarkup = ctx.callbackQuery?.message?.reply_markup;
    if (origMarkup?.inline_keyboard) {
      const filtered = origMarkup.inline_keyboard
        .map((row) => row.filter((btn: any) => !(typeof btn.callback_data === 'string' && btn.callback_data.startsWith('reveal:'))))
        .filter((row) => row.length > 0);
      await ctx.editMessageReplyMarkup({
        reply_markup: { inline_keyboard: filtered } as any,
      });
    }
  } catch (err: any) {
    // 编辑失败不影响主流程(可能是消息已删除/超时等)
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

  const result = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
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

  const result = await ensureSubscribed(botId, session.botUser.telegramId, ctx.api);
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
