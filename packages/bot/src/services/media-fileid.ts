/**
 * 从 Telegram 返回的 Message 中按媒体类型提取 file_id。
 * sender / sender-direct / relay-fileid 共用。
 */
export function extractFileId(message: any, mediaType: string): string | null {
  if (mediaType === 'photo' && message?.photo?.length) {
    // photo 是数组,取最大尺寸(最后一个)
    return message.photo[message.photo.length - 1].file_id;
  }
  if (mediaType === 'video' && message?.video) {
    return message.video.file_id;
  }
  if (message?.document) {
    return message.document.file_id;
  }
  return null;
}
