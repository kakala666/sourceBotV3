import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import {
  MAX_PHOTO_SIZE,
  MAX_VIDEO_SIZE,
  ALLOWED_PHOTO_TYPES,
  ALLOWED_VIDEO_TYPES,
} from 'shared';

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads'));

// 确保上传目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

const allAllowedTypes = [...ALLOWED_PHOTO_TYPES, ...ALLOWED_VIDEO_TYPES];

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}`));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_VIDEO_SIZE, // 使用最大限制，具体在 service 层校验
  },
});

export { uploadDir, MAX_PHOTO_SIZE, MAX_VIDEO_SIZE, ALLOWED_PHOTO_TYPES, ALLOWED_VIDEO_TYPES };
