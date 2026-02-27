import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

/**
 * 用 ffprobe 提取视频元数据
 */
export async function getVideoMeta(filePath: string): Promise<VideoMeta> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0',
    filePath,
  ]);

  const info = JSON.parse(stdout);
  const stream = info.streams?.[0];
  if (!stream) throw new Error('无法读取视频流信息');

  const duration = Math.round(parseFloat(stream.duration || '0'));
  const width = parseInt(stream.width || '0', 10);
  const height = parseInt(stream.height || '0', 10);

  return { duration, width, height };
}

/**
 * 用 ffmpeg 截取第一帧生成缩略图
 * 输出 JPEG，最大 320x320，保持比例
 */
export async function generateThumbnail(
  videoPath: string,
  outputDir: string,
): Promise<string> {
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const thumbName = `${baseName}_thumb.jpg`;
  const thumbPath = path.join(outputDir, thumbName);

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vframes', '1',
    '-vf', 'scale=320:320:force_original_aspect_ratio=decrease',
    '-q:v', '5',
    thumbPath,
  ]);

  return thumbName;
}
