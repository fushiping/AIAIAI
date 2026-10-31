import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_super INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slogan TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    highlights TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    category_id INTEGER,
    cover_url TEXT NOT NULL DEFAULT '',
    sort_weight INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('software', 'document')),
    original_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    wechat TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    project_id INTEGER,
    source_file_id INTEGER,
    privacy_consent INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'done')),
    is_read INTEGER NOT NULL DEFAULT 0,
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (source_file_id) REFERENCES project_files(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL CHECK (event_type IN ('visit', 'project_view', 'download_software', 'download_document')),
    project_id INTEGER,
    file_id INTEGER,
    ip_hash TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS download_tickets (
    token_hash TEXT PRIMARY KEY,
    file_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id);
  CREATE INDEX IF NOT EXISTS idx_projects_published_sort ON projects(published, sort_weight DESC);
  CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
  CREATE INDEX IF NOT EXISTS idx_links_project ON project_links(project_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, is_read);
  CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_project ON analytics_events(project_id, event_type);
  CREATE INDEX IF NOT EXISTS idx_tickets_expiry ON download_tickets(expires_at);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function one(sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function parseJson(value, fallback = []) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function json(value) {
  return JSON.stringify(value ?? []);
}

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((row) => {
    try {
      return [row.key, JSON.parse(row.value)];
    } catch {
      return [row.key, row.value];
    }
  }));
}

export function saveSettings(values) {
  const timestamp = nowIso();
  const statement = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      statement.run(key, JSON.stringify(value), timestamp);
    }
  });
}
