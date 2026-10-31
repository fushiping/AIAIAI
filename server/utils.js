import { all, parseJson } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function cleanString(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function cleanStringList(value, maxItems = 12, maxLength = 60) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems);
  }
  return String(value ?? '')
    .split(/[\n,，]/)
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function getRangeDays(value) {
  if (value === 'all') return null;
  const allowed = new Set([7, 30, 90]);
  const parsed = Number.parseInt(value || '30', 10);
  return allowed.has(parsed) ? parsed : 30;
}

export function rangeStart(days) {
  if (!days) return null;
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString();
}

export function fileMeta(row) {
  return {
    id: row.id,
    type: row.type,
    originalName: row.original_name,
    displayName: row.display_name,
    size: row.size,
    mimeType: row.mime_type,
    createdAt: row.created_at
  };
}

export function projectMeta(row, includeFiles = false) {
  const result = {
    id: row.id,
    name: row.name,
    slogan: row.slogan,
    description: row.description,
    highlights: parseJson(row.highlights, []),
    tags: parseJson(row.tags, []),
    categoryId: row.category_id,
    categoryName: row.category_name || '未分类',
    coverUrl: row.cover_url,
    sortWeight: row.sort_weight,
    published: Boolean(row.published),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    softwareCount: Number(row.software_count || 0),
    documentCount: Number(row.document_count || 0)
  };
  if (includeFiles) {
    result.files = all(
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY type DESC, id ASC',
      [row.id]
    ).map(fileMeta);
  }
  return result;
}

export function projectSelect(extraColumns = '') {
  return `
    SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id AND f.type = 'software') AS software_count,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id AND f.type = 'document') AS document_count
      ${extraColumns ? `, ${extraColumns}` : ''}
    FROM projects p
    LEFT JOIN categories c ON c.id = p.category_id
  `;
}

export function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
