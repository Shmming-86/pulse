import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'",
  );
}

/** 显式来源的 CORS：生产环境不允许通配符 */
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Actor-Id');
  res.setHeader('Access-Control-Max-Age', '600');
}

/**
 * 静态资源：仅允许 public 目录内的文件，未知路径回退到 index.html（前端路由）。
 */
export async function serveStatic(req, res, publicDir) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = path.resolve(publicDir, '.' + pathname);
  if (!target.startsWith(publicDir + path.sep) && target !== path.join(publicDir, 'index.html')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(pathname)) return false;
    filePath = path.join(publicDir, 'index.html');
  }

  try {
    const info = await stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // 带内容指纹的弱 ETag：文件一改就失效，避免用户看到旧的 JS/CSS
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      ETag: etag,
      // no-cache = 允许缓存但每次必须回源校验；文件未变返回 304，改动后立刻生效
      'Cache-Control': 'no-cache, must-revalidate',
      'Last-Modified': info.mtime.toUTCString(),
    };

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    const notModified = ifNoneMatch
      ? ifNoneMatch.split(',').map((tag) => tag.trim()).includes(etag)
      : ifModifiedSince
        ? Math.floor(info.mtimeMs / 1000) <= Math.floor(new Date(ifModifiedSince).getTime() / 1000)
        : false;

    if (notModified) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      ...headers,
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}
