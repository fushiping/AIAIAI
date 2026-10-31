import fs from 'node:fs/promises';
import path from 'node:path';
import { FILES_DIR, COVERS_DIR, MAX_COVER_FILE_MB, MAX_PROJECT_FILE_MB } from '../config.js';

export const COVER_TYPES = new Map([
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.webp', new Set(['image/webp'])]
]);

export const PROJECT_FILE_TYPES = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.zip', '.rar', '.7z',
  '.exe', '.msi', '.dmg', '.pkg'
]);

export function resolveStoragePath(storageKey) {
  const normalized = String(storageKey || '').replaceAll('\\', '/');
  const [storageType] = normalized.split('/');
  const base = storageType === 'covers' ? COVERS_DIR : FILES_DIR;
  const filename = path.basename(normalized);
  const target = path.resolve(base, filename);
  if (!target.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('非法存储路径');
  }
  return target;
}

export async function removeStoredFile(storageKey) {
  if (!storageKey) return;
  try {
    await fs.unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('删除文件失败:', error);
  }
}

export function coverVariantUrl(url, variant = 'card') {
  const value = String(url || '');
  if (!value.startsWith('/media/covers/') || !value.endsWith('.webp')) return value;
  if (variant === 'cover') return value;
  return value.replace(/\.webp$/, `.${variant}.webp`);
}

export function assertCoverType(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!COVER_TYPES.has(ext) || !COVER_TYPES.get(ext).has(file.mimetype)) {
    const error = new Error(`封面仅支持 JPG、PNG、WEBP，且不超过 ${MAX_COVER_FILE_MB}MB`);
    error.status = 422;
    error.code = 'INVALID_COVER_TYPE';
    throw error;
  }
}

export function assertProjectFileType(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!PROJECT_FILE_TYPES.has(ext)) {
    const error = new Error('不支持此文件格式');
    error.status = 422;
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }
}

/*
 * 本地存储保持与对象存储相同的“storage_key -> 文件”抽象。
 * 迁移 OSS/COS 时，可在上传完成后将 storage_key 换成对象键，并在
 * 下载路由中改为生成带时效的对象存储签名 URL；数据库与前端无需改动。
 */
export const storageProvider = {
  name: 'local',
  resolve: resolveStoragePath,
  remove: removeStoredFile,
  maxFileBytes: MAX_PROJECT_FILE_MB * 1024 * 1024
};
