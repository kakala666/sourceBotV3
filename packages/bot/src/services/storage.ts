import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * S3 / Wasabi 媒体存储抽象。
 * DB 里 MediaFile.filePath / thumbnailPath 用 's3:<key>' 前缀标记 S3 存储,
 * 否则视为本地 uploads/ 下的文件名(迁移过渡期共存)。
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
    // 默认 maxSockets=50 在高并发(多人同时翻页/random)时会排队雪崩,提到 200
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

/** DB 字段是否标记为 S3 存储 */
export function isS3Path(stored: string): boolean {
  return stored.startsWith(S3_PREFIX);
}

/** 's3:media/foo.mp4' -> 'media/foo.mp4' */
export function parseS3Key(stored: string): string {
  return stored.slice(S3_PREFIX.length);
}

/** 'media/foo.mp4' -> 's3:media/foo.mp4' */
export function makeS3Path(key: string): string {
  return `${S3_PREFIX}${key}`;
}

/** 上传本地文件到 S3(自动 multipart,大文件友好) */
export async function uploadLocalFile(localPath: string, key: string, contentType?: string): Promise<void> {
  const stream = fs.createReadStream(localPath);
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: getBucket(),
      Key: key,
      Body: stream,
      ContentType: contentType,
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
  });
  await upload.done();
}

/** 从 stream 上传到 S3(适用于 fetch.body 直传等场景) */
export async function uploadStream(key: string, body: Readable, contentType?: string): Promise<void> {
  const upload = new Upload({
    client: getClient(),
    params: { Bucket: getBucket(), Key: key, Body: body, ContentType: contentType },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
  });
  await upload.done();
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

/** 下载 S3 对象到 /tmp 临时文件,返回本地绝对路径(调用方负责 unlink) */
export async function downloadToTmp(key: string): Promise<string> {
  const ext = path.extname(key) || '';
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sb-'));
  const tmpPath = path.join(tmpDir, `media${ext}`);

  const res = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  if (!res.Body) throw new Error(`S3 GetObject 返回空 Body: ${key}`);

  await pipeline(res.Body as Readable, fs.createWriteStream(tmpPath));
  return tmpPath;
}

/** 删除 S3 上的对象 */
export async function deleteFromS3(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** 删除 tmp 文件及其所在目录(downloadToTmp 配套清理) */
export async function cleanupTmp(tmpPath: string): Promise<void> {
  try {
    await fs.promises.unlink(tmpPath);
    await fs.promises.rmdir(path.dirname(tmpPath));
  } catch {
    /* ignore */
  }
}
