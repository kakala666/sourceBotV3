import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * server 端 S3 操作:浏览器走 presigned URL 直传,server 仅做:
 *   - getPresignedPutUrl: 让 client 直接 PUT 到 S3
 *   - headSize: 校验 client 真的传了某个 key (防伪造)
 *   - deleteFromS3: 删除时清 S3 对象
 *   - downloadToTmp / uploadLocalFile / cleanupTmp: 视频生成缩略图时,server 端
 *     从 S3 把视频拉到 tmp, ffmpeg 处理后把缩略图上传
 *
 * 跟 bot 端的 packages/bot/src/services/storage.ts 各自独立维护 (实际逻辑一致)。
 */

const ENDPOINT = process.env.WASABI_ENDPOINT;
const REGION = process.env.WASABI_REGION;
const BUCKET = process.env.WASABI_BUCKET;
const ACCESS_KEY = process.env.WASABI_ACCESS_KEY;
const SECRET_KEY = process.env.WASABI_SECRET_KEY;

let _s3: S3Client | null = null;

function getClient(): S3Client {
  if (_s3) return _s3;
  if (!ENDPOINT || !REGION || !BUCKET || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error('Wasabi env 未配置(WASABI_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY)');
  }
  _s3 = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: false,
    requestHandler: new NodeHttpHandler({
      httpsAgent: new HttpsAgent({ maxSockets: 200, keepAlive: true }),
    }),
  });
  return _s3;
}

export function getBucket(): string {
  if (!BUCKET) throw new Error('WASABI_BUCKET 未配置');
  return BUCKET;
}

export const S3_PREFIX = 's3:';
export const S3_MEDIA_PREFIX = 'media/';

export function isS3Path(stored: string): boolean {
  return stored.startsWith(S3_PREFIX);
}

export function parseS3Key(stored: string): string {
  return stored.slice(S3_PREFIX.length);
}

export function makeS3Path(key: string): string {
  return `${S3_PREFIX}${key}`;
}

/** 生成 presigned PUT URL (浏览器直传用),默认 10 分钟有效 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn = 600,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

/** S3 对象大小;不存在返回 null */
export async function headSize(key: string): Promise<number | null> {
  try {
    const res = await getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return res.ContentLength ?? null;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

/** 下载 S3 对象到 /tmp 临时文件,返回本地绝对路径(调用方负责 cleanupTmp) */
export async function downloadToTmp(key: string): Promise<string> {
  const ext = path.extname(key) || '';
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-server-'));
  const tmpPath = path.join(tmpDir, `media${ext}`);

  const res = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  if (!res.Body) throw new Error(`S3 GetObject 返回空 Body: ${key}`);

  await pipeline(res.Body as Readable, fs.createWriteStream(tmpPath));
  return tmpPath;
}

/** 上传本地小文件到 S3(缩略图,KB 级,不走 multipart) */
export async function uploadLocalFile(
  localPath: string,
  key: string,
  contentType?: string,
): Promise<void> {
  const body = await fs.promises.readFile(localPath);
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** 删除 S3 对象 */
export async function deleteFromS3(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** 删除 tmp 文件及其所在目录 */
export async function cleanupTmp(tmpPath: string): Promise<void> {
  const dir = path.dirname(tmpPath);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (err: any) {
    console.error('[server-storage] cleanupTmp 失败:', dir, err?.message || err);
  }
}
