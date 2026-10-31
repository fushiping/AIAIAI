import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getSettings,
  nowIso,
  one,
  run
} from '../db.js';
import {
  clientIp,
  hashValue,
  ipHash,
  leadCookieMatches,
  setLeadCookie
} from '../security.js';
import { resolveStoragePath, storageProvider } from '../services/storage.js';
import { subscribeSiteUpdates } from '../services/events.js';
import { mergeUiText } from '../content.js';
import { getPublicSiteData } from '../services/site-data.js';
import {
  ApiError,
  asyncRoute,
  cleanString,
  parseId,
  projectMeta,
  projectSelect
} from '../utils.js';

const router = express.Router();

function applyMessageTemplate(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined ? match : String(values[key])
  ));
}

const publicWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: '提交过于频繁，请稍后再试' }
  }
});

const downloadPrepareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: '下载请求过于频繁，请稍后再试' }
  }
});

router.get('/events', (req, res) => {
  subscribeSiteUpdates(req, res);
});

function todayDownloadCount(req) {
  return Number(one(`
    SELECT COUNT(*) AS count
    FROM analytics_events
    WHERE ip_hash = ?
      AND event_type IN ('download_software', 'download_document')
      AND date(created_at, 'localtime') = date('now', 'localtime')
  `, [ipHash(req)])?.count || 0);
}

router.get('/bootstrap', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: getPublicSiteData()
  });
});

router.get('/projects/:id', (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return next(new ApiError(400, 'INVALID_ID', '项目编号无效'));
  const row = one(`${projectSelect()} WHERE p.id = ? AND p.published = 1`, [id]);
  const uiText = mergeUiText(getSettings().uiText);
  if (!row) return next(new ApiError(404, 'PROJECT_NOT_FOUND', uiText['errors.projectUnavailable']));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: projectMeta(row, true) });
});

router.post('/track', publicWriteLimiter, (req, res, next) => {
  const type = req.body?.type;
  const timestamp = nowIso();
  if (type === 'visit') {
    run(`
      INSERT INTO analytics_events (event_type, ip_hash, user_agent, path, created_at)
      VALUES ('visit', ?, ?, ?, ?)
    `, [
      ipHash(req),
      cleanString(req.get('user-agent'), 300),
      cleanString(req.body?.path || '/', 200),
      timestamp
    ]);
    return res.status(201).json({ success: true });
  }
  if (type === 'project_view') {
    const projectId = parseId(req.body?.projectId);
    const project = projectId
      ? one('SELECT id FROM projects WHERE id = ? AND published = 1', [projectId])
      : null;
    const uiText = mergeUiText(getSettings().uiText);
    if (!project) return next(new ApiError(404, 'PROJECT_NOT_FOUND', uiText['errors.projectUnavailable']));
    run(`
      INSERT INTO analytics_events (event_type, project_id, ip_hash, user_agent, path, created_at)
      VALUES ('project_view', ?, ?, ?, ?, ?)
    `, [
      projectId,
      ipHash(req),
      cleanString(req.get('user-agent'), 300),
      cleanString(req.body?.path || '', 200),
      timestamp
    ]);
    return res.status(201).json({ success: true });
  }
  return next(new ApiError(400, 'INVALID_EVENT', '不支持的统计事件'));
});

router.post('/inquiries', publicWriteLimiter, asyncRoute(async (req, res, next) => {
  if (cleanString(req.body?.website, 100)) {
    return res.status(201).json({ success: true, data: { id: null } });
  }

  const name = cleanString(req.body?.name, 40);
  const phone = cleanString(req.body?.phone, 30);
  const company = cleanString(req.body?.company, 100);
  const wechat = cleanString(req.body?.wechat, 60);
  const message = cleanString(req.body?.message, 1200);
  const privacyConsent = req.body?.privacyConsent === true;
  const uiText = mergeUiText(getSettings().uiText);

  if (name.length < 2) return next(new ApiError(422, 'INVALID_NAME', uiText['validation.name']));
  if (!/^[0-9+\-()\s]{6,30}$/.test(phone)) {
    return next(new ApiError(422, 'INVALID_PHONE', uiText['validation.phone']));
  }
  if (message.length < 5) return next(new ApiError(422, 'INVALID_MESSAGE', uiText['validation.message']));
  if (!privacyConsent) return next(new ApiError(422, 'CONSENT_REQUIRED', uiText['validation.consent']));

  let projectId = parseId(req.body?.projectId);
  let sourceFileId = parseId(req.body?.sourceFileId);
  let file = null;

  if (sourceFileId) {
    file = one(`
      SELECT f.*, p.published
      FROM project_files f
      JOIN projects p ON p.id = f.project_id
      WHERE f.id = ? AND p.published = 1
    `, [sourceFileId]);
    if (!file) return next(new ApiError(404, 'FILE_NOT_FOUND', uiText['errors.fileUnavailable']));
    projectId = file.project_id;
  } else if (projectId) {
    const project = one('SELECT id FROM projects WHERE id = ? AND published = 1', [projectId]);
    if (!project) projectId = null;
  }

  const timestamp = nowIso();
  const result = run(`
    INSERT INTO inquiries
      (name, company, phone, wechat, message, project_id, source_file_id, privacy_consent, status, is_read, admin_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'new', 0, '', ?, ?)
  `, [name, company, phone, wechat, message, projectId, sourceFileId, timestamp, timestamp]);

  if (sourceFileId) setLeadCookie(res, sourceFileId);

  res.status(201).json({
    success: true,
    data: {
      id: Number(result.lastInsertRowid),
      downloadUnlocked: Boolean(sourceFileId),
      message: sourceFileId ? uiText['messages.inquiryDownload'] : uiText['messages.inquiryGeneral']
    }
  });
}));

router.post('/downloads/:fileId/prepare', downloadPrepareLimiter, (req, res, next) => {
  const fileId = parseId(req.params.fileId);
  if (!fileId) return next(new ApiError(400, 'INVALID_ID', '文件编号无效'));

  const file = one(`
    SELECT f.*, p.name AS project_name, p.published, p.id AS project_id
    FROM project_files f
    JOIN projects p ON p.id = f.project_id
    WHERE f.id = ? AND p.published = 1
  `, [fileId]);
  const settings = getSettings();
  const uiText = mergeUiText(settings.uiText);
  if (!file) return next(new ApiError(404, 'FILE_NOT_FOUND', uiText['errors.fileUnavailable']));
  if (settings.downloadRequireLead && !leadCookieMatches(req, fileId)) {
    return res.json({
      success: true,
      data: {
        allowed: false,
        reason: 'lead_required',
        file: { id: file.id, name: file.display_name, type: file.type },
        project: { id: file.project_id, name: file.project_name }
      }
    });
  }

  const dailyLimit = Math.max(0, Number(settings.downloadDailyLimit || 0));
  if (dailyLimit > 0) {
    const used = todayDownloadCount(req);
    if (used >= dailyLimit) {
      return res.json({
        success: true,
        data: {
          allowed: false,
          reason: 'limit_reached',
          dailyLimit,
          used,
          message: applyMessageTemplate(uiText['messages.downloadDailyLimit'], { limit: dailyLimit })
        }
      });
    }
  }

  const timestamp = nowIso();
  run('DELETE FROM download_tickets WHERE expires_at < ?', [timestamp]);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  run(`
    INSERT INTO download_tickets (token_hash, file_id, project_id, ip_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    hashValue(token),
    file.id,
    file.project_id,
    ipHash(req),
    expiresAt,
    timestamp
  ]);

  res.json({
    success: true,
    data: {
      allowed: true,
      downloadUrl: `/api/public/downloads/${token}`,
      expiresAt,
      remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - todayDownloadCount(req)) : null
    }
  });
});

router.get('/downloads/:token', (req, res, next) => {
  const tokenHash = hashValue(String(req.params.token || ''));
  const uiText = mergeUiText(getSettings().uiText);
  const ticket = one(`
    SELECT t.*, f.display_name, f.storage_key, f.type
    FROM download_tickets t
    JOIN project_files f ON f.id = t.file_id
    JOIN projects p ON p.id = t.project_id
    WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at >= ? AND p.published = 1
  `, [tokenHash, nowIso()]);

  if (!ticket) {
    return next(new ApiError(410, 'DOWNLOAD_LINK_EXPIRED', uiText['errors.downloadExpired']));
  }
  if (ticket.ip_hash !== ipHash(req)) {
    return next(new ApiError(403, 'DOWNLOAD_IP_MISMATCH', uiText['errors.downloadDevice']));
  }

  const usedAt = nowIso();
  const result = run(`
    UPDATE download_tickets SET used_at = ?
    WHERE token_hash = ? AND used_at IS NULL
  `, [usedAt, tokenHash]);
  if (Number(result.changes) !== 1) {
    return next(new ApiError(410, 'DOWNLOAD_LINK_USED', uiText['errors.downloadUsed']));
  }

  const eventType = ticket.type === 'software' ? 'download_software' : 'download_document';
  run(`
    INSERT INTO analytics_events
      (event_type, project_id, file_id, ip_hash, user_agent, path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    eventType,
    ticket.project_id,
    ticket.file_id,
    ipHash(req),
    cleanString(req.get('user-agent'), 300),
    `/download/${ticket.file_id}`,
    usedAt
  ]);

  const filePath = resolveStoragePath(ticket.storage_key);
  res.download(filePath, ticket.display_name, (error) => {
    if (error && !res.headersSent) next(error);
  });
});

router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      storage: storageProvider.name,
      clientIp: clientIp(req),
      time: nowIso()
    }
  });
});

export default router;
