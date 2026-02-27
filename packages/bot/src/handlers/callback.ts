import type { Context } from 'grammy';
import prisma from '../prisma';
import { getActiveSession, advanceSession, completeSession } from '../services/session';
import { loadContentBindings, loadAdBindings, getAdDisplaySeconds, getEndContent } from '../services/content';
import { sendResource, sendAd, sendEndContent, buildPageKeyboard } from '../services/sender';

/** 防重复点击：记录正在处理中的 sessionId */
const processingSet = new Set<number>();

/**
 * 处理翻页回调 next:{sessionId}:{nextIndex}
 */
export async function handleCallback(ctx: Context, botId: number) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // 解析回调数据
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

  const isLast = nextIndex >= totalContent - 1;

  if (isLast) {
    // 最后一条资源，不带翻页按钮
    try {
      await sendResource(ctx, botId, binding.resource);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 资源加载失败，请稍后重试');
      return;
    }
    await completeSession(sessionId);
    const endContent = await getEndContent();
    await sendEndContent(ctx, endContent);
  } else {
    // 还有更多资源，带翻页按钮
    const keyboard = buildPageKeyboard(sessionId, nextIndex + 1);
    try {
      await sendResource(ctx, botId, binding.resource, keyboard);
    } catch (err: any) {
      console.error('[callback] 发送资源失败:', err.message);
      await ctx.reply('⚠️ 当前资源加载失败', { reply_markup: keyboard });
    }
  }
}
