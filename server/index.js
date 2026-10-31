import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { APP_BASE_PATH, COVERS_DIR, PORT, PUBLIC_DIR, PUBLIC_ORIGIN, ROOT_DIR, isProduction } from './config.js';
import { db } from './db.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { seedDatabase } from './seed.js';
import { getInitialSiteData } from './services/site-data.js';

seedDatabase();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY || '0', 10) || false);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// SameSite Cookie 是第一道 CSRF 防护；这里再拒绝来源与站点不一致的写请求。
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let expectedOrigin;
  try {
    expectedOrigin = PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (new URL(origin).origin !== new URL(expectedOrigin).origin) {
      return res.status(403).json({
        success: false,
        error: { code: 'ORIGIN_REJECTED', message: '请求来源校验失败' }
      });
    }
    next();
  } catch {
    return res.status(403).json({
      success: false,
      error: { code: 'ORIGIN_REJECTED', message: '请求来源校验失败' }
    });
  }
});

app.use('/api/public', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, publicRoutes);

app.use('/api/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, adminRoutes);

app.use('/media/covers', express.static(COVERS_DIR, {
  dotfiles: 'deny',
  fallthrough: false,
  maxAge: isProduction ? '7d' : 0,
  immutable: isProduction,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

function sendHtmlWithBase(res, filePath, basePath) {
  const html = fs.readFileSync(filePath, 'utf8').replaceAll('__APP_BASE__', basePath);
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
}

function sendPublicHtml(res) {
  const serialized = Buffer
    .from(JSON.stringify(getInitialSiteData()), 'utf8')
    .toString('base64');
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('__APP_BASE__', APP_BASE_PATH)
    .replaceAll('__INITIAL_SITE_DATA__', serialized);
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
}

app.get(['/', '/index.html'], (req, res) => {
  sendPublicHtml(res);
});

app.get(/^\/admin\/?$/, (req, res) => {
  sendHtmlWithBase(res, path.join(PUBLIC_DIR, 'admin', 'index.html'), `${APP_BASE_PATH}admin/`);
});

app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin'), {
  index: false,
  dotfiles: 'deny',
  maxAge: isProduction ? '1h' : 0,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: isProduction ? '1h' : 0,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'API_NOT_FOUND', message: '接口不存在' }
  });
});

app.use((req, res) => {
  res.status(404);
  sendHtmlWithBase(res, path.join(PUBLIC_DIR, '404.html'), APP_BASE_PATH);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || '服务器内部错误';

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    status = 400;
    code = 'INVALID_JSON';
    message = '请求数据格式无效';
  } else if (error.name === 'MulterError') {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
    code = error.code;
    message = error.code === 'LIMIT_FILE_SIZE' ? '上传文件超过大小限制' : '文件上传失败';
  } else if (status >= 500) {
    console.error(`[${new Date().toISOString()}]`, req.method, req.originalUrl, error);
    code = 'INTERNAL_ERROR';
    message = '服务器处理请求时出现异常';
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(error.details ? { details: error.details } : {})
    }
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`傅先生AI项目VIP 已启动：http://127.0.0.1:${PORT}`);
  console.log(`管理后台：http://127.0.0.1:${PORT}/admin/`);
  console.log(`项目目录：${ROOT_DIR}`);
});

function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭服务...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
