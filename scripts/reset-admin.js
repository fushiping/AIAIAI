import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const username = String(process.argv[2] || '').trim();
const password = String(process.argv[3] || '');
const displayName = String(process.argv[4] || '超级管理员').trim();

if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) {
  console.error('账号必须为 3-40 位字母、数字、点、下划线或短横线');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('密码至少 8 位，并同时包含字母和数字');
  process.exit(1);
}

const db = new DatabaseSync(path.join(ROOT_DIR, 'data', 'app.db'));
db.exec('PRAGMA busy_timeout = 5000');
const passwordHash = bcrypt.hashSync(password, 12);
const timestamp = new Date().toISOString();
const existing = db.prepare('SELECT id FROM admins WHERE is_super = 1 ORDER BY id LIMIT 1').get();

if (existing) {
  db.prepare(`
    UPDATE admins SET username = ?, password_hash = ?, display_name = ?,
      active = 1, token_version = token_version + 1, updated_at = ?
    WHERE id = ?
  `).run(username, passwordHash, displayName, timestamp, existing.id);
} else {
  db.prepare(`
    INSERT INTO admins
      (username, password_hash, display_name, is_super, permissions, active, token_version, created_at, updated_at)
    VALUES (?, ?, ?, 1, '[]', 1, 1, ?, ?)
  `).run(username, passwordHash, displayName, timestamp, timestamp);
}

db.close();
console.log(JSON.stringify({ success: true, username }));
