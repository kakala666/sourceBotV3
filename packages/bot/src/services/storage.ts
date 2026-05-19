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
    // 默认 maxSockets=50 在高并发时会排队雪崩,触发 S3 签名超过 15 分钟时间窗口报错
    // ("The difference between the request time and the current time is too large")
    // 提到 500;同时缩短 connectionTimeout 让卡住的 socket 早释放
    requestHandler: new NodeHttpHandler({
      httpsAgent: new HttpsAgent({ maxSockets: 500, keepAlive: true }),
      connectionTimeout: 10_000,
      requestTimeout: 120_000,
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
  const dir = path.dirname(tmpPath);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (err: any) {
    // 失败要让调用方知道,以便排查(之前 silent catch 导致 /tmp 累积 166G)
    console.error('[storage] cleanupTmp 失败:', dir, err?.message || err);
  }
}

/**
 * bot 启动时调用一次:清掉 /tmp 下所有 sb-* / sb-ingest-* 孤儿目录。
 * bot 重启意味着所有 in-flight 的下载/入库请求都已断开,这些 tmp 必然是泄漏。
 * fire-and-forget;失败仅日志,不影响启动。
 */
export function cleanupOrphanedTmpsOnStartup(): void {
  (async () => {
    try {
      const entries = await fs.promises.readdir(os.tmpdir(), { withFileTypes: true });
      const targets = entries.filter(
        (e) => e.isDirectory() && (e.name.startsWith('sb-') || e.name.startsWith('sb-ingest-')),
      );
      if (targets.length === 0) return;
      let removed = 0;
      for (const e of targets) {
        try {
          await fs.promises.rm(path.join(os.tmpdir(), e.name), { recursive: true, force: true });
          removed++;
        } catch (err: any) {
          console.error('[storage] startup tmp 清理失败:', e.name, err?.message || err);
        }
      }
      console.log(`[storage] startup 清理孤儿 tmp: ${removed} / ${targets.length}`);
    } catch (err: any) {
      console.error('[storage] startup tmp 扫描失败:', err?.message || err);
    }
  })();
}
