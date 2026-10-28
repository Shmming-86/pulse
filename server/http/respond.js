import { AppError, isAppError, tooManyRequests, badRequest } from '../errors.js';

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function sendData(res, data, status = 200) {
  sendJson(res, status, { data });
}

/** 全局错误出口：只暴露受控信息，堆栈仅进日志 */
export function handleError(error, { req, res, logger }) {
  const requestId = req?.context?.requestId;
  if (isAppError(error) && error.expose) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details, requestId },
    });
    return;
  }
  logger.error('请求处理失败', {
    requestId,
    method: req?.method,
    path: req?.url,
    err: error,
  });
  sendJson(res, 500, {
    error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试', requestId },
  });
}

/** 读取并解析 JSON 请求体，限制大小，拒绝非对象载荷 */
export async function readJsonBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new AppError(413, 'PAYLOAD_TOO_LARGE', '请求体过大');
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (error) {
    if (isAppError(error)) throw error;
    throw badRequest('请求体不是合法的 JSON');
  }
}

export function createRateLimiter({ windowMs, max, trustProxy = false }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.min(windowMs, 30_000));
  timer.unref?.();

  return function limit(req, res) {
    // 仅在明确部署于反向代理之后时才信任 X-Forwarded-For，否则客户端可伪造 IP 绕过限流
    const forwarded = trustProxy ? req.headers['x-forwarded-for']?.split(',')[0]?.trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip) ?? { count: 0, resetAt: now + windowMs };
    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    hits.set(ip, entry);
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw tooManyRequests();
    }
  };
}
