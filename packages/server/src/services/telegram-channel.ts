export interface ParsedChannel {
  username: string;
}

export function parseChannelUrl(input: string): ParsedChannel {
  const trimmed = (input ?? '').trim();
  if (!trimmed) throw new Error('链接为空');

  // 拒绝私有邀请链接
  if (/t\.me\/\+/.test(trimmed) || /t\.me\/joinchat\//i.test(trimmed)) {
    throw new Error('本期仅支持公开频道,请提供 @username 或 t.me/username 形式');
  }

  // 提取 username 候选
  let candidate: string;
  if (trimmed.startsWith('@')) {
    candidate = trimmed.slice(1);
  } else if (/^https?:\/\//i.test(trimmed) || /^t\.me\//i.test(trimmed)) {
    const path = trimmed.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '');
    if (path.includes('/')) {
      throw new Error('请输入频道链接,不要包含消息路径');
    }
    candidate = path;
  } else {
    candidate = trimmed;
  }

  // username 校验:Telegram 规则 5-32,字母数字下划线,字母开头。简化为非空 + 仅合法字符。
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(candidate)) {
    throw new Error('频道用户名格式不合法');
  }

  return { username: candidate };
}

export interface VerifiedChannel {
  chatId: string;     // 序列化为字符串
  title: string;
  username: string;
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

async function callTg<T>(token: string, method: string, params: Record<string, any>): Promise<TgResponse<T>> {
  const qs = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {})
  );
  const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
  const res = await fetch(url);
  return (await res.json()) as TgResponse<T>;
}

export async function verifyChannelForBot(botToken: string, username: string): Promise<VerifiedChannel> {
  // 1. getMe 拿 bot 自己的 id
  const me = await callTg<{ id: number }>(botToken, 'getMe', {});
  if (!me.ok || !me.result) throw new Error('Bot Token 无效');
  const botId = me.result.id;

  // 2. getChat 验证频道存在 + 类型
  const chat = await callTg<{ id: number; type: string; title?: string; username?: string }>(
    botToken,
    'getChat',
    { chat_id: `@${username}` }
  );
  if (!chat.ok || !chat.result) {
    throw new Error('频道不存在或非公开频道');
  }
  if (chat.result.type !== 'channel') {
    throw new Error('目标不是频道(本期仅支持频道)');
  }

  // 3. getChatMember 验证 Bot 是管理员
  const member = await callTg<{ status: string }>(botToken, 'getChatMember', {
    chat_id: chat.result.id,
    user_id: botId,
  });
  if (!member.ok || !member.result) {
    throw new Error('无法查询 Bot 在频道的成员状态');
  }
  if (member.result.status !== 'administrator' && member.result.status !== 'creator') {
    throw new Error('请先把本 Bot 设为该频道的管理员');
  }

  return {
    chatId: String(chat.result.id),
    title: chat.result.title || username,
    username: chat.result.username || username,
  };
}
