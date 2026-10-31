import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, SESSION_HOURS, isProduction } from './config.js';
import { one } from './db.js';

export const ADMIN_COOKIE = 'fushi_admin';
export const LEAD_COOKIE = 'fushi_lead';

export function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

export function ipHash(req) {
  return hashValue(`${clientIp(req)}|${JWT_SECRET}`);
}

export function createAdminToken(admin) {
  return jwt.sign({
    type: 'admin',
    sub: String(admin.id),
    version: admin.token_version
  }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

export function setAdminCookie(res, token) {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearAdminCookie(res) {
  res.clearCookie(ADMIN_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/'
  });
}

export function setLeadCookie(res, fileId) {
  const token = jwt.sign({ type: 'lead', fileId: Number(fileId) }, JWT_SECRET, { expiresIn: '2h' });
  res.cookie(LEAD_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/api/public/downloads'
  });
}

export function leadCookieMatches(req, fileId) {
  const token = req.cookies?.[LEAD_COOKIE];
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.type === 'lead' && Number(payload.fileId) === Number(fileId);
  } catch {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' }
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'admin') throw new Error('Invalid token type');
    const admin = one('SELECT * FROM admins WHERE id = ? AND active = 1', [Number(payload.sub)]);
    if (!admin || Number(payload.version) !== Number(admin.token_version)) {
      throw new Error('Session revoked');
    }
    admin.permissions = JSON.parse(admin.permissions || '[]');
    req.admin = admin;
    next();
  } catch {
    clearAdminCookie(res);
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' }
    });
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (req.admin.is_super || req.admin.permissions.includes(permission)) return next();
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: '当前账号没有此操作权限' }
    });
  };
}

export function requireAnyPermission(permissions) {
  return (req, res, next) => {
    if (req.admin.is_super || permissions.some((permission) => req.admin.permissions.includes(permission))) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: '当前账号没有此操作权限' }
    });
  };
}

export function safeAdmin(admin) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.display_name,
    isSuper: Boolean(admin.is_super),
    permissions: admin.is_super ? ['projects', 'categories', 'analytics', 'inquiries', 'settings', 'admins'] : admin.permissions,
    active: Boolean(admin.active),
    lastLoginAt: admin.last_login_at,
    createdAt: admin.created_at
  };
}
