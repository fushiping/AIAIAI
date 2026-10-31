import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import {
  ADMIN_PERMISSIONS,
  COVERS_DIR,
  FILES_DIR,
  MAX_COVER_FILE_MB,
  MAX_PROJECT_FILE_MB
} from '../config.js';
import {
  all,
  db,
  getSettings,
  json,
  nowIso,
  one,
  parseJson,
  run,
  saveSettings,
  transaction
} from '../db.js';
import {
  clearAdminCookie,
  createAdminToken,
  requireAdmin,
  requireAnyPermission,
  requirePermission,
  safeAdmin,
  setAdminCookie
} from '../security.js';
import {
  assertCoverType,
  assertProjectFileType,
  removeStoredFile,
  resolveStoragePath
} from '../services/storage.js';
import { broadcastSiteUpdate } from '../services/events.js';
import { mergeUiText, UI_TEXT_DEFAULTS, UI_TEXT_SCHEMA } from '../content.js';
import { optimizeCoverImage } from '../services/image-optimizer.js';
import {
  ApiError,
  asyncRoute,
  cleanString,
  cleanStringList,
  fileMeta,
  getRangeDays,
  linkMeta,
  parseId,
  projectMeta,
  projectSelect,
  rangeStart
} from '../utils.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_LOGIN_ATTEMPTS', message: '登录失败次数过多，请 15 分钟后再试' }
  }
});

function safeFilename(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

const coverStorage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, COVERS_DIR),
  filename: (req, file, callback) => callback(null, safeFilename(file))
});

const fileStorage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, FILES_DIR),
  filename: (req, file, callback) => callback(null, safeFilename(file))
});

const coverUpload = multer({
  storage: coverStorage,
  limits: { fileSize: MAX_COVER_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    try {
      assertCoverType(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  }
});

const projectFileUpload = multer({
  storage: fileStorage,
  limits: { fileSize: MAX_PROJECT_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    try {
      assertProjectFileType(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  }
});

function requireSuper(req, res, next) {
  if (req.admin.is_super) return next();
  return next(new ApiError(403, 'SUPER_ADMIN_REQUIRED', '仅总管理员可管理账号'));
}

function normalizeProjectBody(body, existing = null) {
  const name = cleanString(body.name ?? existing?.name, 100);
  const slogan = cleanString(body.slogan ?? existing?.slogan, 240);
  const description = cleanString(body.description ?? existing?.description, 12000);
  const highlights = cleanStringList(
    body.highlights ?? parseJson(existing?.highlights, []),
    10,
    120
  );
  const tags = cleanStringList(
    body.tags ?? parseJson(existing?.tags, []),
    8,
    30
  );
  let categoryId = body.categoryId === null || body.categoryId === ''
    ? null
    : parseId(body.categoryId ?? existing?.category_id);
  const coverUrl = cleanString(body.coverUrl ?? existing?.cover_url, 500);
  const sortWeight = Number.parseInt(body.sortWeight ?? existing?.sort_weight ?? 0, 10);
  const published = body.published === undefined
    ? Boolean(existing?.published ?? true)
    : Boolean(body.published);

  if (name.length < 2) throw new ApiError(422, 'INVALID_PROJECT_NAME', '项目名称至少需要 2 个字符');
  if (!slogan) throw new ApiError(422, 'INVALID_SLOGAN', '请填写项目一句话简介');
  if (!description) throw new ApiError(422, 'INVALID_DESCRIPTION', '请填写项目详细介绍');
  if (highlights.length === 0) throw new ApiError(422, 'INVALID_HIGHLIGHTS', '请至少填写一个项目亮点');
  if (tags.length < 2) throw new ApiError(422, 'INVALID_TAGS', '请至少填写两个项目标签');
  if (categoryId) {
    const category = one('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!category) throw new ApiError(422, 'INVALID_CATEGORY', '所属分类不存在');
  }
  if (coverUrl && (!coverUrl.startsWith('/') || coverUrl.startsWith('//'))) {
    throw new ApiError(422, 'INVALID_COVER_URL', '封面地址格式不正确');
  }
  if (!Number.isFinite(sortWeight) || sortWeight < -99999 || sortWeight > 99999) {
    throw new ApiError(422, 'INVALID_SORT_WEIGHT', '排序权重必须是 -99999 到 99999 之间的整数');
  }

  return {
    name,
    slogan,
    description,
    highlights,
    tags,
    categoryId,
    coverUrl,
    sortWeight,
    published
  };
}

function normalizeProjectLink(body, existing = null) {
  const displayName = cleanString(body.displayName ?? existing?.display_name, 120);
  const rawUrl = cleanString(body.url ?? existing?.url, 2000);
  const sortOrder = Number.parseInt(body.sortOrder ?? existing?.sort_order ?? 0, 10);
  if (displayName.length < 1) {
    throw new ApiError(422, 'INVALID_LINK_NAME', '请填写链接在前台展示的名称');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(422, 'INVALID_LINK_URL', '请填写完整的 http:// 或 https:// 链接');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError(422, 'INVALID_LINK_URL', '链接仅支持公开的 HTTP 或 HTTPS 地址');
  }
  if (!Number.isFinite(sortOrder) || sortOrder < -9999 || sortOrder > 9999) {
    throw new ApiError(422, 'INVALID_LINK_SORT', '链接排序必须是 -9999 到 9999 之间的整数');
  }
  return {
    displayName,
    url: parsed.toString(),
    sortOrder
  };
}

function getProjectRow(id) {
  return one(`${projectSelect()} WHERE p.id = ?`, [id]);
}

function fileStorageKey(file) {
  return `files/${path.basename(file.path)}`;
}

function coverStorageKey(file) {
  return `covers/${path.basename(file.path)}`;
}

function projectIdsFromBody(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(parseId).filter(Boolean))].slice(0, 100);
}

router.post('/auth/login', loginLimiter, asyncRoute(async (req, res, next) => {
  const username = cleanString(req.body?.username, 60);
  const password = String(req.body?.password || '');
  const admin = username ? one('SELECT * FROM admins WHERE username = ? COLLATE NOCASE', [username]) : null;
  const valid = admin?.active && password ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!valid) return next(new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码不正确'));

  const timestamp = nowIso();
  run('UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, admin.id]);
  admin.last_login_at = timestamp;
  admin.permissions = JSON.parse(admin.permissions || '[]');
  const token = createAdminToken(admin);
  setAdminCookie(res, token);
  res.json({ success: true, data: { user: safeAdmin(admin) } });
}));

router.use(requireAdmin);

router.post('/auth/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ success: true });
});

router.get('/auth/me', (req, res) => {
  res.json({ success: true, data: { user: safeAdmin(req.admin) } });
});

router.post('/auth/change-password', asyncRoute(async (req, res, next) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!await bcrypt.compare(currentPassword, req.admin.password_hash)) {
    return next(new ApiError(422, 'CURRENT_PASSWORD_INVALID', '当前密码不正确'));
  }
  if (newPassword.length < 8) {
    return next(new ApiError(422, 'WEAK_PASSWORD', '新密码至少需要 8 个字符'));
  }
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return next(new ApiError(422, 'WEAK_PASSWORD', '新密码需同时包含字母和数字'));
  }

  const timestamp = nowIso();
  run(`
    UPDATE admins
    SET password_hash = ?, token_version = token_version + 1, updated_at = ?
    WHERE id = ?
  `, [await bcrypt.hash(newPassword, 12), timestamp, req.admin.id]);
  const updated = one('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
  setAdminCookie(res, createAdminToken(updated));
  res.json({ success: true, data: { message: '密码已更新' } });
}));

router.get('/overview', requirePermission('analytics'), (req, res) => {
  const days = getRangeDays(req.query.range);
  const start = rangeStart(days);
  const where = start ? ' WHERE created_at >= ?' : '';
  const params = start ? [start] : [];
  const eventCounts = all(`
    SELECT event_type, COUNT(*) AS count
    FROM analytics_events ${where}
    GROUP BY event_type
  `, params);
  const eventMap = Object.fromEntries(eventCounts.map((item) => [item.event_type, Number(item.count)]));
  const inquiryCount = Number(one(`
    SELECT COUNT(*) AS count FROM inquiries ${where}
  `, params)?.count || 0);
  const unreadCount = Number(one('SELECT COUNT(*) AS count FROM inquiries WHERE is_read = 0')?.count || 0);
  const publishedProjects = Number(one('SELECT COUNT(*) AS count FROM projects WHERE published = 1')?.count || 0);

  const chartDays = days || 30;
  const chartStart = rangeStart(chartDays);
  const rawTrend = all(`
    SELECT date(created_at, 'localtime') AS day,
      SUM(CASE WHEN event_type = 'visit' THEN 1 ELSE 0 END) AS visits,
      SUM(CASE WHEN event_type IN ('download_software', 'download_document') THEN 1 ELSE 0 END) AS downloads
    FROM analytics_events
    WHERE created_at >= ?
    GROUP BY date(created_at, 'localtime')
    ORDER BY day ASC
  `, [chartStart]);
  const trendMap = Object.fromEntries(rawTrend.map((row) => [
    row.day,
    { visits: Number(row.visits), downloads: Number(row.downloads) }
  ]));
  const trend = [];
  const today = new Date();
  for (let index = chartDays - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    trend.push({ day, ...(trendMap[day] || { visits: 0, downloads: 0 }) });
  }

  const topProjects = all(`
    SELECT p.id, p.name,
      SUM(CASE WHEN e.event_type = 'project_view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN e.event_type IN ('download_software', 'download_document') THEN 1 ELSE 0 END) AS downloads
    FROM projects p
    LEFT JOIN analytics_events e ON e.project_id = p.id ${start ? 'AND e.created_at >= ?' : ''}
    GROUP BY p.id
    ORDER BY views DESC, downloads DESC, p.sort_weight DESC
    LIMIT 5
  `, start ? [start] : []).map((row) => ({
    id: row.id,
    name: row.name,
    views: Number(row.views),
    downloads: Number(row.downloads)
  }));

  const canViewInquiries = req.admin.is_super || req.admin.permissions.includes('inquiries');
  const recentInquiries = canViewInquiries ? all(`
      SELECT i.id, i.name, i.company, i.phone, i.wechat, i.message, i.status, i.is_read,
        i.created_at, p.name AS project_name
      FROM inquiries i
      LEFT JOIN projects p ON p.id = i.project_id
      ORDER BY i.created_at DESC LIMIT 5
    `).map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company,
    phone: row.phone,
    wechat: row.wechat,
    message: row.message,
    status: row.status,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    projectName: row.project_name
  })) : [];

  res.json({
    success: true,
    data: {
      range: req.query.range || '30',
      summary: {
        visits: eventMap.visit || 0,
        downloads: (eventMap.download_software || 0) + (eventMap.download_document || 0),
        softwareDownloads: eventMap.download_software || 0,
        documentDownloads: eventMap.download_document || 0,
        inquiries: inquiryCount,
        unreadInquiries: unreadCount,
        publishedProjects
      },
      trend,
      topProjects,
      recentInquiries
    }
  });
});

router.get('/analytics/projects', requirePermission('analytics'), (req, res) => {
  const days = getRangeDays(req.query.range);
  const start = rangeStart(days);
  const condition = start ? 'AND e.created_at >= ?' : '';
  const params = start ? [start] : [];
  const rows = all(`
    SELECT p.id, p.name, p.published,
      SUM(CASE WHEN e.event_type = 'project_view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN e.event_type = 'download_software' THEN 1 ELSE 0 END) AS software_downloads,
      SUM(CASE WHEN e.event_type = 'download_document' THEN 1 ELSE 0 END) AS document_downloads
    FROM projects p
    LEFT JOIN analytics_events e ON e.project_id = p.id ${condition}
    GROUP BY p.id
    ORDER BY views DESC, software_downloads DESC, p.sort_weight DESC
  `, params);
  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      published: Boolean(row.published),
      views: Number(row.views),
      softwareDownloads: Number(row.software_downloads),
      documentDownloads: Number(row.document_downloads),
      totalDownloads: Number(row.software_downloads) + Number(row.document_downloads)
    }))
  });
});

router.get('/projects', requirePermission('projects'), (req, res) => {
  const where = [];
  const params = [];
  const search = cleanString(req.query.search, 100);
  const categoryId = parseId(req.query.categoryId);
  const status = req.query.status;

  if (search) {
    where.push('(p.name LIKE ? OR p.slogan LIKE ? OR p.tags LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (status === 'published') where.push('p.published = 1');
  if (status === 'hidden') where.push('p.published = 0');

  const sortOptions = {
    updated_desc: 'p.updated_at DESC',
    sort_desc: 'p.sort_weight DESC, p.id DESC',
    name_asc: 'p.name ASC',
    oldest: 'p.created_at ASC'
  };
  const order = sortOptions[req.query.sort] || sortOptions.sort_desc;
  const rows = all(`${projectSelect()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`, params);
  res.json({ success: true, data: rows.map((row) => projectMeta(row)) });
});

router.get('/project-options', requirePermission('settings'), (req, res) => {
  const rows = all(`
    SELECT id, name, category_id
    FROM projects
    WHERE published = 1
    ORDER BY sort_weight DESC, id DESC
  `);
  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.category_id
    }))
  });
});

router.get('/projects/:id', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const row = id ? getProjectRow(id) : null;
  if (!row) return next(new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在'));
  res.json({ success: true, data: projectMeta(row, true) });
});

router.post('/projects', requirePermission('projects'), (req, res, next) => {
  let data;
  try {
    data = normalizeProjectBody(req.body);
  } catch (error) {
    return next(error);
  }
  const timestamp = nowIso();
  const result = run(`
    INSERT INTO projects
      (name, slogan, description, highlights, tags, category_id, cover_url, sort_weight, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    data.name,
    data.slogan,
    data.description,
    json(data.highlights),
    json(data.tags),
    data.categoryId,
    data.coverUrl,
    data.sortWeight,
    data.published ? 1 : 0,
    timestamp,
    timestamp
  ]);
  const row = getProjectRow(Number(result.lastInsertRowid));
  broadcastSiteUpdate('project-created');
  res.status(201).json({ success: true, data: projectMeta(row, true) });
});

router.patch('/projects/:id', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? getProjectRow(id) : null;
  if (!existing) return next(new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在'));
  let data;
  try {
    data = normalizeProjectBody(req.body, existing);
  } catch (error) {
    return next(error);
  }
  const timestamp = nowIso();
  run(`
    UPDATE projects SET
      name = ?, slogan = ?, description = ?, highlights = ?, tags = ?,
      category_id = ?, cover_url = ?, sort_weight = ?, published = ?, updated_at = ?
    WHERE id = ?
  `, [
    data.name,
    data.slogan,
    data.description,
    json(data.highlights),
    json(data.tags),
    data.categoryId,
    data.coverUrl,
    data.sortWeight,
    data.published ? 1 : 0,
    timestamp,
    id
  ]);
  broadcastSiteUpdate('project-updated');
  res.json({ success: true, data: projectMeta(getProjectRow(id), true) });
});

router.delete('/projects/:id', requirePermission('projects'), asyncRoute(async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return next(new ApiError(400, 'INVALID_ID', '项目编号无效'));
  const files = all('SELECT storage_key FROM project_files WHERE project_id = ?', [id]);
  const result = run('DELETE FROM projects WHERE id = ?', [id]);
  if (Number(result.changes) === 0) return next(new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在'));
  await Promise.all(files.map((file) => removeStoredFile(file.storage_key)));
  broadcastSiteUpdate('project-deleted');
  res.json({ success: true });
}));

router.post('/projects/batch', requirePermission('projects'), asyncRoute(async (req, res, next) => {
  const ids = projectIdsFromBody(req.body?.ids);
  const action = req.body?.action;
  if (ids.length === 0) return next(new ApiError(422, 'EMPTY_SELECTION', '请先选择项目'));
  if (!['publish', 'unpublish', 'delete'].includes(action)) {
    return next(new ApiError(422, 'INVALID_ACTION', '不支持的批量操作'));
  }

  const placeholders = ids.map(() => '?').join(',');
  if (action === 'delete') {
    const files = all(`SELECT storage_key FROM project_files WHERE project_id IN (${placeholders})`, ids);
    const result = run(`DELETE FROM projects WHERE id IN (${placeholders})`, ids);
    await Promise.all(files.map((file) => removeStoredFile(file.storage_key)));
    broadcastSiteUpdate('projects-batch-deleted');
    return res.json({ success: true, data: { affected: Number(result.changes) } });
  }

  const published = action === 'publish' ? 1 : 0;
  const result = run(`
    UPDATE projects SET published = ?, updated_at = ?
    WHERE id IN (${placeholders})
  `, [published, nowIso(), ...ids]);
  broadcastSiteUpdate('projects-batch-updated');
  res.json({ success: true, data: { affected: Number(result.changes) } });
}));

router.post(
  '/upload/cover',
  requirePermission('projects'),
  coverUpload.single('file'),
  asyncRoute(async (req, res, next) => {
    if (!req.file) return next(new ApiError(422, 'FILE_REQUIRED', '请选择封面图片'));
    try {
      const optimized = await optimizeCoverImage(req.file.path);
      const storageKey = `covers/${optimized.filename}`;
      const size = fs.statSync(resolveStoragePath(storageKey)).size;
      res.status(201).json({
        success: true,
        data: {
          url: optimized.urls.cover,
          mediumUrl: optimized.urls.medium,
          cardUrl: optimized.urls.card,
          storageKey,
          storagePaths: optimized.storagePaths,
          filename: req.file.originalname,
          size
        }
      });
    } catch (error) {
      console.error('封面图片处理失败:', error);
      await removeStoredFile(coverStorageKey(req.file));
      error.status = 422;
      error.code = 'INVALID_COVER_IMAGE';
      error.message = '封面图片无法解析，请上传有效的 JPG、PNG 或 WEBP 图片';
      next(error);
    }
  })
);

router.post('/upload/widget-image', requirePermission('settings'), coverUpload.single('file'), (req, res, next) => {
  if (!req.file) return next(new ApiError(422, 'FILE_REQUIRED', '请选择二维码或管理员标识图片'));
  const storageKey = coverStorageKey(req.file);
  res.status(201).json({
    success: true,
    data: {
      url: `/media/${storageKey}`,
      storageKey,
      filename: req.file.originalname,
      size: req.file.size
    }
  });
});

router.post('/projects/:projectId/links', requirePermission('projects'), (req, res, next) => {
  const projectId = parseId(req.params.projectId);
  if (!projectId || !one('SELECT id FROM projects WHERE id = ?', [projectId])) {
    return next(new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在'));
  }
  let data;
  try {
    data = normalizeProjectLink(req.body);
  } catch (error) {
    return next(error);
  }
  const timestamp = nowIso();
  const result = run(`
    INSERT INTO project_links (project_id, display_name, url, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [projectId, data.displayName, data.url, data.sortOrder, timestamp, timestamp]);
  const link = one('SELECT * FROM project_links WHERE id = ?', [Number(result.lastInsertRowid)]);
  broadcastSiteUpdate('project-link-created');
  res.status(201).json({ success: true, data: linkMeta(link) });
});

router.patch('/links/:id', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? one('SELECT * FROM project_links WHERE id = ?', [id]) : null;
  if (!existing) return next(new ApiError(404, 'LINK_NOT_FOUND', '链接不存在'));
  let data;
  try {
    data = normalizeProjectLink(req.body, existing);
  } catch (error) {
    return next(error);
  }
  run(`
    UPDATE project_links
    SET display_name = ?, url = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `, [data.displayName, data.url, data.sortOrder, nowIso(), id]);
  const link = one('SELECT * FROM project_links WHERE id = ?', [id]);
  broadcastSiteUpdate('project-link-updated');
  res.json({ success: true, data: linkMeta(link) });
});

router.delete('/links/:id', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const result = run('DELETE FROM project_links WHERE id = ?', [id || 0]);
  if (Number(result.changes) === 0) return next(new ApiError(404, 'LINK_NOT_FOUND', '链接不存在'));
  broadcastSiteUpdate('project-link-deleted');
  res.json({ success: true });
});

router.post('/projects/:projectId/files', requirePermission('projects'), projectFileUpload.single('file'), (req, res, next) => {
  const projectId = parseId(req.params.projectId);
  if (!projectId || !one('SELECT id FROM projects WHERE id = ?', [projectId])) {
    if (req.file) removeStoredFile(fileStorageKey(req.file));
    return next(new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在'));
  }
  if (!req.file) return next(new ApiError(422, 'FILE_REQUIRED', '请选择要上传的文件'));
  const type = req.body?.type;
  if (!['software', 'document'].includes(type)) {
    removeStoredFile(fileStorageKey(req.file));
    return next(new ApiError(422, 'INVALID_FILE_TYPE', '文件类型必须是软件包或项目资料'));
  }
  const displayName = cleanString(req.body?.displayName || req.file.originalname, 180);
  if (!displayName) {
    removeStoredFile(fileStorageKey(req.file));
    return next(new ApiError(422, 'INVALID_DISPLAY_NAME', '请填写文件展示名称'));
  }
  const timestamp = nowIso();
  const result = run(`
    INSERT INTO project_files
      (project_id, type, original_name, display_name, stored_name, storage_key, mime_type, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    projectId,
    type,
    req.file.originalname,
    displayName,
    path.basename(req.file.path),
    fileStorageKey(req.file),
    req.file.mimetype || 'application/octet-stream',
    req.file.size,
    timestamp,
    timestamp
  ]);
  const row = one('SELECT * FROM project_files WHERE id = ?', [Number(result.lastInsertRowid)]);
  broadcastSiteUpdate('project-file-created');
  res.status(201).json({ success: true, data: fileMeta(row) });
});

router.patch('/files/:id', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const file = id ? one('SELECT * FROM project_files WHERE id = ?', [id]) : null;
  if (!file) return next(new ApiError(404, 'FILE_NOT_FOUND', '文件不存在'));
  const displayName = cleanString(req.body?.displayName, 180);
  if (!displayName) return next(new ApiError(422, 'INVALID_DISPLAY_NAME', '文件展示名称不能为空'));
  run('UPDATE project_files SET display_name = ?, updated_at = ? WHERE id = ?', [displayName, nowIso(), id]);
  broadcastSiteUpdate('project-file-updated');
  res.json({ success: true, data: fileMeta(one('SELECT * FROM project_files WHERE id = ?', [id])) });
});

router.put('/files/:id/replace', requirePermission('projects'), projectFileUpload.single('file'), asyncRoute(async (req, res, next) => {
  const id = parseId(req.params.id);
  const file = id ? one('SELECT * FROM project_files WHERE id = ?', [id]) : null;
  if (!file) {
    if (req.file) await removeStoredFile(fileStorageKey(req.file));
    return next(new ApiError(404, 'FILE_NOT_FOUND', '文件不存在'));
  }
  if (!req.file) return next(new ApiError(422, 'FILE_REQUIRED', '请选择替换文件'));
  const displayName = cleanString(req.body?.displayName || file.display_name, 180);
  const timestamp = nowIso();
  run(`
    UPDATE project_files SET
      original_name = ?, display_name = ?, stored_name = ?, storage_key = ?,
      mime_type = ?, size = ?, updated_at = ?
    WHERE id = ?
  `, [
    req.file.originalname,
    displayName,
    path.basename(req.file.path),
    fileStorageKey(req.file),
    req.file.mimetype || 'application/octet-stream',
    req.file.size,
    timestamp,
    id
  ]);
  await removeStoredFile(file.storage_key);
  broadcastSiteUpdate('project-file-replaced');
  res.json({ success: true, data: fileMeta(one('SELECT * FROM project_files WHERE id = ?', [id])) });
}));

router.delete('/files/:id', requirePermission('projects'), asyncRoute(async (req, res, next) => {
  const id = parseId(req.params.id);
  const file = id ? one('SELECT * FROM project_files WHERE id = ?', [id]) : null;
  if (!file) return next(new ApiError(404, 'FILE_NOT_FOUND', '文件不存在'));
  run('DELETE FROM project_files WHERE id = ?', [id]);
  await removeStoredFile(file.storage_key);
  broadcastSiteUpdate('project-file-deleted');
  res.json({ success: true });
}));

router.get('/files/:id/download', requirePermission('projects'), (req, res, next) => {
  const id = parseId(req.params.id);
  const file = id ? one('SELECT * FROM project_files WHERE id = ?', [id]) : null;
  if (!file) return next(new ApiError(404, 'FILE_NOT_FOUND', '文件不存在'));
  res.download(resolveStoragePath(file.storage_key), file.display_name);
});

router.get('/categories', requireAnyPermission(['categories', 'projects']), (req, res) => {
  const rows = all(`
    SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id) AS project_count
    FROM categories c
    ORDER BY c.sort_order DESC, c.id ASC
  `);
  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      active: Boolean(row.active),
      projectCount: Number(row.project_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  });
});

router.post('/categories', requirePermission('categories'), (req, res, next) => {
  const name = cleanString(req.body?.name, 40);
  const description = cleanString(req.body?.description, 160);
  const sortOrder = Number.parseInt(req.body?.sortOrder || 0, 10);
  const active = req.body?.active !== false;
  if (name.length < 2) return next(new ApiError(422, 'INVALID_CATEGORY_NAME', '分类名称至少需要 2 个字符'));
  if (one('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', [name])) {
    return next(new ApiError(409, 'CATEGORY_EXISTS', '该分类名称已存在'));
  }
  const timestamp = nowIso();
  const result = run(`
    INSERT INTO categories (name, description, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, description, Number.isFinite(sortOrder) ? sortOrder : 0, active ? 1 : 0, timestamp, timestamp]);
  broadcastSiteUpdate('category-created');
  res.status(201).json({ success: true, data: { id: Number(result.lastInsertRowid) } });
});

router.patch('/categories/:id', requirePermission('categories'), (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? one('SELECT * FROM categories WHERE id = ?', [id]) : null;
  if (!existing) return next(new ApiError(404, 'CATEGORY_NOT_FOUND', '分类不存在'));
  const name = cleanString(req.body?.name ?? existing.name, 40);
  const description = cleanString(req.body?.description ?? existing.description, 160);
  const sortOrder = Number.parseInt(req.body?.sortOrder ?? existing.sort_order, 10);
  const active = req.body?.active === undefined ? Boolean(existing.active) : Boolean(req.body.active);
  if (name.length < 2) return next(new ApiError(422, 'INVALID_CATEGORY_NAME', '分类名称至少需要 2 个字符'));
  const duplicate = one('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?', [name, id]);
  if (duplicate) return next(new ApiError(409, 'CATEGORY_EXISTS', '该分类名称已存在'));
  run(`
    UPDATE categories SET name = ?, description = ?, sort_order = ?, active = ?, updated_at = ?
    WHERE id = ?
  `, [name, description, Number.isFinite(sortOrder) ? sortOrder : 0, active ? 1 : 0, nowIso(), id]);
  broadcastSiteUpdate('category-updated');
  res.json({ success: true });
});

router.delete('/categories/:id', requirePermission('categories'), (req, res, next) => {
  const id = parseId(req.params.id);
  const result = run('DELETE FROM categories WHERE id = ?', [id || 0]);
  if (Number(result.changes) === 0) return next(new ApiError(404, 'CATEGORY_NOT_FOUND', '分类不存在'));
  broadcastSiteUpdate('category-deleted');
  res.json({ success: true });
});

router.get('/inquiries', requirePermission('inquiries'), (req, res) => {
  const where = [];
  const params = [];
  const search = cleanString(req.query.search, 100);
  const status = req.query.status;
  const read = req.query.read;
  if (search) {
    where.push('(i.name LIKE ? OR i.phone LIKE ? OR i.company LIKE ? OR i.message LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (['new', 'processing', 'done'].includes(status)) {
    where.push('i.status = ?');
    params.push(status);
  }
  if (read === 'unread') where.push('i.is_read = 0');
  if (read === 'read') where.push('i.is_read = 1');

  const rows = all(`
    SELECT i.*, p.name AS project_name, f.display_name AS source_file_name
    FROM inquiries i
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN project_files f ON f.id = i.source_file_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY i.is_read ASC, i.created_at DESC
  `, params);
  const unreadCount = Number(one('SELECT COUNT(*) AS count FROM inquiries WHERE is_read = 0')?.count || 0);
  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      company: row.company,
      phone: row.phone,
      wechat: row.wechat,
      message: row.message,
      projectId: row.project_id,
      projectName: row.project_name,
      sourceFileId: row.source_file_id,
      sourceFileName: row.source_file_name,
      status: row.status,
      isRead: Boolean(row.is_read),
      adminNote: row.admin_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    meta: { unreadCount }
  });
});

router.patch('/inquiries/:id', requirePermission('inquiries'), (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? one('SELECT * FROM inquiries WHERE id = ?', [id]) : null;
  if (!existing) return next(new ApiError(404, 'INQUIRY_NOT_FOUND', '咨询记录不存在'));
  const status = req.body?.status ?? existing.status;
  if (!['new', 'processing', 'done'].includes(status)) {
    return next(new ApiError(422, 'INVALID_STATUS', '咨询状态无效'));
  }
  const isRead = req.body?.isRead === undefined ? Boolean(existing.is_read) : Boolean(req.body.isRead);
  const adminNote = req.body?.adminNote === undefined
    ? existing.admin_note
    : cleanString(req.body.adminNote, 2000);
  run(`
    UPDATE inquiries SET status = ?, is_read = ?, admin_note = ?, updated_at = ?
    WHERE id = ?
  `, [status, isRead ? 1 : 0, adminNote, nowIso(), id]);
  res.json({ success: true });
});

router.get('/inquiries/:id', requirePermission('inquiries'), (req, res, next) => {
  const id = parseId(req.params.id);
  const row = id ? one(`
    SELECT i.*, p.name AS project_name, f.display_name AS source_file_name
    FROM inquiries i
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN project_files f ON f.id = i.source_file_id
    WHERE i.id = ?
  `, [id]) : null;
  if (!row) return next(new ApiError(404, 'INQUIRY_NOT_FOUND', '咨询记录不存在'));
  res.json({
    success: true,
    data: {
      id: row.id,
      name: row.name,
      company: row.company,
      phone: row.phone,
      wechat: row.wechat,
      message: row.message,
      projectId: row.project_id,
      projectName: row.project_name,
      sourceFileId: row.source_file_id,
      sourceFileName: row.source_file_name,
      status: row.status,
      isRead: Boolean(row.is_read),
      adminNote: row.admin_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  });
});

router.delete('/inquiries/:id', requirePermission('inquiries'), (req, res, next) => {
  const id = parseId(req.params.id);
  const result = run('DELETE FROM inquiries WHERE id = ?', [id || 0]);
  if (Number(result.changes) === 0) return next(new ApiError(404, 'INQUIRY_NOT_FOUND', '咨询记录不存在'));
  res.json({ success: true });
});

router.get('/settings', requirePermission('settings'), (req, res) => {
  res.json({ success: true, data: getSettings() });
});

router.get('/content-schema', requirePermission('settings'), (req, res) => {
  res.json({
    success: true,
    data: {
      groups: UI_TEXT_SCHEMA,
      defaults: UI_TEXT_DEFAULTS
    }
  });
});

router.patch('/settings', requirePermission('settings'), (req, res, next) => {
  const input = req.body && typeof req.body === 'object' ? req.body : {};
  const current = getSettings();
  const nextSettings = { ...current };
  const stringFields = [
    'siteName', 'brandShort', 'documentTitle', 'heroEyebrow', 'heroTitle', 'heroSubtitle',
    'heroTrust', 'serviceStatement', 'trustHeading', 'trustSubtitle', 'processTitle',
    'contactEyebrow', 'contactSectionIndex', 'contactSectionLabel',
    'contactTitle', 'contactSubtitle', 'contactPhone', 'contactWechat',
    'contactHours', 'contactNotice', 'footerCopyright', 'icpNumber',
    'floatingContactLabel', 'floatingContactTitle', 'floatingContactDescription',
    'floatingContactEyebrow', 'floatingContactAdminName', 'floatingContactAdminTitle',
    'floatingContactBadge', 'floatingContactQrHint', 'floatingContactNote'
  ];
  for (const field of stringFields) {
    if (input[field] !== undefined) nextSettings[field] = cleanString(input[field], field === 'heroTitle' ? 200 : 1000);
  }
  if (!nextSettings.siteName || nextSettings.siteName.length < 2) {
    return next(new ApiError(422, 'INVALID_SITE_NAME', '站点名称至少需要 2 个字符'));
  }
  if (input.heroHighlights !== undefined) {
    nextSettings.heroHighlights = cleanStringList(input.heroHighlights, 6, 40);
  }
  if (input.trustPoints !== undefined) {
    if (!Array.isArray(input.trustPoints) || input.trustPoints.length > 6) {
      return next(new ApiError(422, 'INVALID_TRUST_POINTS', '信任保障内容格式不正确'));
    }
    nextSettings.trustPoints = input.trustPoints.map((item, index) => ({
      title: cleanString(item?.title, 80),
      description: cleanString(item?.description, 400),
      index: cleanString(item?.index || String(index + 1).padStart(2, '0'), 8)
    })).filter((item) => item.title || item.description);
  }
  if (input.processSteps !== undefined) {
    if (!Array.isArray(input.processSteps) || input.processSteps.length > 8) {
      return next(new ApiError(422, 'INVALID_PROCESS', '合作流程内容格式不正确'));
    }
    nextSettings.processSteps = input.processSteps.map((item) => ({
      title: cleanString(item?.title, 80),
      description: cleanString(item?.description, 300)
    })).filter((item) => item.title || item.description);
  }
  if (input.downloadRequireLead !== undefined) {
    nextSettings.downloadRequireLead = Boolean(input.downloadRequireLead);
  }
  if (input.downloadDailyLimit !== undefined) {
    const limit = Number.parseInt(input.downloadDailyLimit, 10);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
      return next(new ApiError(422, 'INVALID_DOWNLOAD_LIMIT', '单 IP 每日下载限制应为 0 到 1000'));
    }
    nextSettings.downloadDailyLimit = limit;
  }
  if (input.featuredProjectId !== undefined) {
    if (input.featuredProjectId === null || input.featuredProjectId === '' || input.featuredProjectId === 0) {
      nextSettings.featuredProjectId = null;
    } else {
      const projectId = parseId(input.featuredProjectId);
      const project = projectId
        ? one('SELECT id FROM projects WHERE id = ? AND published = 1', [projectId])
        : null;
      if (!project) {
        return next(new ApiError(422, 'INVALID_FEATURED_PROJECT', '精选项目不存在或尚未上架'));
      }
      nextSettings.featuredProjectId = projectId;
    }
  }
  if (input.floatingContactEnabled !== undefined) {
    nextSettings.floatingContactEnabled = Boolean(input.floatingContactEnabled);
  }
  if (input.floatingContactQrUrl !== undefined) {
    const url = cleanString(input.floatingContactQrUrl, 500);
    if (url && (!url.startsWith('/') || url.startsWith('//'))) {
      return next(new ApiError(422, 'INVALID_QR_URL', '二维码图片地址格式不正确'));
    }
    nextSettings.floatingContactQrUrl = url;
  }
  if (input.floatingContactAdminImageUrl !== undefined) {
    const url = cleanString(input.floatingContactAdminImageUrl, 500);
    if (url && (!url.startsWith('/') || url.startsWith('//'))) {
      return next(new ApiError(422, 'INVALID_ADMIN_IMAGE_URL', '管理员标识图片地址格式不正确'));
    }
    nextSettings.floatingContactAdminImageUrl = url;
  }
  if (input.uiText !== undefined) {
    if (!input.uiText || typeof input.uiText !== 'object' || Array.isArray(input.uiText)) {
      return next(new ApiError(422, 'INVALID_UI_TEXT', '全站文字配置格式不正确'));
    }
    const merged = mergeUiText({ ...(current.uiText || {}), ...input.uiText });
    for (const group of UI_TEXT_SCHEMA) {
      for (const field of group.fields) {
        if (input.uiText[field.key] !== undefined) {
          merged[field.key] = cleanString(input.uiText[field.key], field.max);
        }
      }
    }
    nextSettings.uiText = merged;
  }

  const changedKeys = Object.keys(nextSettings).filter((key) => (
    JSON.stringify(nextSettings[key]) !== JSON.stringify(current[key])
  ));
  saveSettings(Object.fromEntries(changedKeys.map((key) => [key, nextSettings[key]])));
  broadcastSiteUpdate('settings-updated');
  res.json({ success: true, data: getSettings() });
});

router.get('/admins', requirePermission('admins'), requireSuper, (req, res) => {
  const rows = all('SELECT * FROM admins ORDER BY is_super DESC, id ASC');
  res.json({
    success: true,
    data: rows.map((row) => {
      row.permissions = JSON.parse(row.permissions || '[]');
      return safeAdmin(row);
    })
  });
});

router.post('/admins', requirePermission('admins'), requireSuper, asyncRoute(async (req, res, next) => {
  const username = cleanString(req.body?.username, 40);
  const displayName = cleanString(req.body?.displayName, 60);
  const password = String(req.body?.password || '');
  const permissions = Array.isArray(req.body?.permissions)
    ? [...new Set(req.body.permissions.filter((item) => ADMIN_PERMISSIONS.includes(item)))]
    : [];
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) {
    return next(new ApiError(422, 'INVALID_USERNAME', '账号需为 3-40 位字母、数字、点、下划线或短横线'));
  }
  if (displayName.length < 2) return next(new ApiError(422, 'INVALID_DISPLAY_NAME', '请填写管理员姓名'));
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return next(new ApiError(422, 'WEAK_PASSWORD', '密码至少 8 位，并同时包含字母和数字'));
  }
  if (permissions.length === 0) return next(new ApiError(422, 'PERMISSION_REQUIRED', '请至少分配一项权限'));
  if (one('SELECT id FROM admins WHERE username = ? COLLATE NOCASE', [username])) {
    return next(new ApiError(409, 'ADMIN_EXISTS', '该登录账号已存在'));
  }
  const timestamp = nowIso();
  const result = run(`
    INSERT INTO admins
      (username, password_hash, display_name, is_super, permissions, active, token_version, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?)
  `, [
    username,
    await bcrypt.hash(password, 12),
    displayName,
    JSON.stringify(permissions),
    req.body?.active === false ? 0 : 1,
    timestamp,
    timestamp
  ]);
  const admin = one('SELECT * FROM admins WHERE id = ?', [Number(result.lastInsertRowid)]);
  admin.permissions = JSON.parse(admin.permissions);
  res.status(201).json({ success: true, data: safeAdmin(admin) });
}));

router.patch('/admins/:id', requirePermission('admins'), requireSuper, asyncRoute(async (req, res, next) => {
  const id = parseId(req.params.id);
  const admin = id ? one('SELECT * FROM admins WHERE id = ?', [id]) : null;
  if (!admin) return next(new ApiError(404, 'ADMIN_NOT_FOUND', '管理员账号不存在'));
  if (admin.is_super && id !== req.admin.id) {
    return next(new ApiError(403, 'CANNOT_MODIFY_SUPER', '不能修改其他总管理员'));
  }
  if (admin.is_super && req.body?.active === false) {
    return next(new ApiError(422, 'CANNOT_DISABLE_SELF', '总管理员不能停用自己的账号'));
  }

  const displayName = cleanString(req.body?.displayName ?? admin.display_name, 60);
  const permissions = req.body?.permissions === undefined
    ? JSON.parse(admin.permissions || '[]')
    : [...new Set((Array.isArray(req.body.permissions) ? req.body.permissions : [])
      .filter((item) => ADMIN_PERMISSIONS.includes(item)))];
  const active = req.body?.active === undefined ? Boolean(admin.active) : Boolean(req.body.active);
  if (!admin.is_super && permissions.length === 0) {
    return next(new ApiError(422, 'PERMISSION_REQUIRED', '请至少分配一项权限'));
  }

  let passwordHash = admin.password_hash;
  let versionIncrement = 0;
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return next(new ApiError(422, 'WEAK_PASSWORD', '密码至少 8 位，并同时包含字母和数字'));
    }
    passwordHash = await bcrypt.hash(password, 12);
    versionIncrement = 1;
  }
  if (
    JSON.stringify(permissions) !== JSON.stringify(JSON.parse(admin.permissions || '[]'))
    || active !== Boolean(admin.active)
  ) {
    versionIncrement = 1;
  }
  run(`
    UPDATE admins SET display_name = ?, permissions = ?, active = ?, password_hash = ?,
      token_version = token_version + ?, updated_at = ?
    WHERE id = ?
  `, [
    displayName,
    JSON.stringify(admin.is_super ? [] : permissions),
    active ? 1 : 0,
    passwordHash,
    versionIncrement,
    nowIso(),
    id
  ]);
  const updated = one('SELECT * FROM admins WHERE id = ?', [id]);
  updated.permissions = JSON.parse(updated.permissions || '[]');
  if (id === req.admin.id) setAdminCookie(res, createAdminToken(updated));
  res.json({ success: true, data: safeAdmin(updated) });
}));

router.delete('/admins/:id', requirePermission('admins'), requireSuper, (req, res, next) => {
  const id = parseId(req.params.id);
  const admin = id ? one('SELECT * FROM admins WHERE id = ?', [id]) : null;
  if (!admin) return next(new ApiError(404, 'ADMIN_NOT_FOUND', '管理员账号不存在'));
  if (admin.is_super || id === req.admin.id) {
    return next(new ApiError(422, 'CANNOT_DELETE_ADMIN', '不能删除总管理员或当前登录账号'));
  }
  run('DELETE FROM admins WHERE id = ?', [id]);
  res.json({ success: true });
});

export default router;
