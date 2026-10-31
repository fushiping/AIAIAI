import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export const isProduction = process.env.NODE_ENV === 'production';
export const PORT = Number.parseInt(process.env.PORT || '18930', 10);
export const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
export const APP_BASE_PATH = (() => {
  const raw = (process.env.APP_BASE_PATH || '/').trim();
  if (!raw || raw === '/') return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
})();
export const SESSION_HOURS = Math.max(1, Number.parseInt(process.env.SESSION_HOURS || '12', 10));
export const MAX_PROJECT_FILE_MB = Math.max(1, Number.parseInt(process.env.MAX_PROJECT_FILE_MB || '200', 10));
export const MAX_COVER_FILE_MB = Math.max(1, Number.parseInt(process.env.MAX_COVER_FILE_MB || '5', 10));

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
export const FILES_DIR = path.join(STORAGE_DIR, 'files');
export const COVERS_DIR = path.join(STORAGE_DIR, 'covers');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DB_PATH = path.join(DATA_DIR, 'app.db');

for (const dir of [DATA_DIR, STORAGE_DIR, FILES_DIR, COVERS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function getPersistentSecret() {
  if (process.env.JWT_SECRET?.trim()) return process.env.JWT_SECRET.trim();
  const secretPath = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

export const JWT_SECRET = getPersistentSecret();

export const DEFAULT_ADMIN = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'FushiVIP@2026',
  displayName: process.env.ADMIN_DISPLAY_NAME || '超级管理员'
};

export const ADMIN_PERMISSIONS = [
  'projects',
  'categories',
  'analytics',
  'inquiries',
  'settings',
  'admins'
];
