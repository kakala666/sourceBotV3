/**
 * grammy API transformer:在所有发送 / 转发 / 复制类调用上强制注入 protect_content=true,
 * 禁止用户转发、保存、截图分享 bot 发出的消息(客户端层面限制)。
 *
 * 注册方式: bot.api.config.use(protectContentTransformer)
 */

const PROTECT_METHODS = new Set<string>([
  'sendMessage',
  'sendPhoto',
  'sendAudio',
  'sendDocument',
  'sendVideo',
  'sendAnimation',
  'sendVoice',
  'sendVideoNote',
  'sendPaidMedia',
  'sendMediaGroup',
  'sendLocation',
  'sendVenue',
  'sendContact',
  'sendPoll',
  'sendDice',
  'sendSticker',
  'sendInvoice',
  'sendGame',
  'forwardMessage',
  'forwardMessages',
  'copyMessage',
  'copyMessages',
]);

export const protectContentTransformer = async (
  prev: any,
  method: string,
  payload: any,
  signal?: any,
) => {
  if (PROTECT_METHODS.has(method)) {
    payload = { ...payload, protect_content: true };
  }
  return prev(method, payload, signal);
};
