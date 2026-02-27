import prisma from '../prisma';

/**
 * 记录/更新 BotUser，返回 botUser 记录
 */
export async function upsertBotUser(
  telegramId: bigint,
  botId: number,
  inviteLinkId: number,
  firstName?: string,
  lastName?: string,
  username?: string,
) {
  return prisma.botUser.upsert({
    where: {
      telegramId_botId: { telegramId, botId },
    },
    create: {
      telegramId,
      botId,
      inviteLinkId,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      username: username ?? null,
    },
    update: {
      inviteLinkId,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      username: username ?? undefined,
      lastSeenAt: new Date(),
    },
  });
}

/**
 * 创建或重置用户会话（currentIndex=0）
 */
export async function resetSession(botUserId: number) {
  // 将该用户所有未完成会话标记为已完成
  await prisma.userSession.updateMany({
    where: { botUserId, isCompleted: false },
    data: { isCompleted: true },
  });

  // 创建新会话
  return prisma.userSession.create({
    data: { botUserId, currentIndex: 0 },
  });
}

/**
 * 获取用户当前活跃会话
 */
export async function getActiveSession(botUserId: number) {
  return prisma.userSession.findFirst({
    where: { botUserId, isCompleted: false },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * 更新会话的 currentIndex
 */
export async function advanceSession(sessionId: number, newIndex: number) {
  return prisma.userSession.update({
    where: { id: sessionId },
    data: { currentIndex: newIndex, updatedAt: new Date() },
  });
}

/**
 * 标记会话完成
 */
export async function completeSession(sessionId: number) {
  return prisma.userSession.update({
    where: { id: sessionId },
    data: { isCompleted: true, updatedAt: new Date() },
  });
}
