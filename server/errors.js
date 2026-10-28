/**
 * 类型化错误体系：服务层抛出 AppError，由全局错误处理器统一转成
 * 规范化的响应结构。客户端永远看不到堆栈或内部实现细节。
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (details, message = '请求参数校验未通过') =>
  new AppError(422, 'VALIDATION_FAILED', message, details);
export const notFound = (message = '资源不存在') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
export const tooManyRequests = (message = '请求过于频繁，请稍后再试') =>
  new AppError(429, 'RATE_LIMITED', message);

export function isAppError(error) {
  return error instanceof AppError;
}

/**
 * 校验工具：在边界处一次性收集所有问题，前端可以一次展示全部错误。
 */
export function createValidator() {
  const issues = [];
  const api = {
    requiredString(value, field, { max = 200 } = {}) {
      if (typeof value !== 'string' || value.trim() === '') {
        issues.push({ field, message: '必填' });
        return '';
      }
      const trimmed = value.trim();
      if (trimmed.length > max) {
        issues.push({ field, message: `长度不能超过 ${max} 个字符` });
        return trimmed.slice(0, max);
      }
      return trimmed;
    },
    optionalString(value, field, { max = 5000 } = {}) {
      if (value === undefined || value === null || value === '') return '';
      if (typeof value !== 'string') {
        issues.push({ field, message: '必须是字符串' });
        return '';
      }
      const trimmed = value.trim();
      if (trimmed.length > max) {
        issues.push({ field, message: `长度不能超过 ${max} 个字符` });
        return trimmed.slice(0, max);
      }
      return trimmed;
    },
    oneOf(value, field, allowed, { optional = false } = {}) {
      if (value === undefined || value === null || value === '') {
        if (!optional) issues.push({ field, message: `必须是 ${allowed.join(' / ')} 之一` });
        return undefined;
      }
      if (!allowed.includes(value)) {
        issues.push({ field, message: `必须是 ${allowed.join(' / ')} 之一` });
        return undefined;
      }
      return value;
    },
    integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = true } = {}) {
      if (value === undefined || value === null || value === '') {
        if (!optional) issues.push({ field, message: '必填' });
        return null;
      }
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(num) || num < min || num > max) {
        issues.push({ field, message: `必须是 ${min}~${max} 的整数` });
        return null;
      }
      return num;
    },
    dateString(value, field, { optional = true } = {}) {
      if (value === undefined || value === null || value === '') {
        if (!optional) issues.push({ field, message: '必填' });
        return null;
      }
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        issues.push({ field, message: '日期格式应为 YYYY-MM-DD' });
        return null;
      }
      const parsed = new Date(`${value}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        issues.push({ field, message: '日期无效' });
        return null;
      }
      return value;
    },
    /** 日期时间：接受 ISO 8601 或 datetime-local（YYYY-MM-DDTHH:mm），统一存 ISO 字符串 */
    dateTimeString(value, field, { optional = true } = {}) {
      if (value === undefined || value === null || value === '') {
        if (!optional) issues.push({ field, message: '必填' });
        return null;
      }
      if (typeof value !== 'string') {
        issues.push({ field, message: '时间格式不正确' });
        return null;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        issues.push({ field, message: '时间格式应为 YYYY-MM-DD HH:mm' });
        return null;
      }
      return parsed.toISOString();
    },
    stringArray(value, field, { max = 8, maxLength = 24 } = {}) {
      if (value === undefined || value === null) return undefined;
      if (!Array.isArray(value)) {
        issues.push({ field, message: '必须是字符串数组' });
        return undefined;
      }
      const cleaned = [];
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed) continue;
        if (trimmed.length > maxLength) {
          issues.push({ field, message: `单个标签不能超过 ${maxLength} 个字符` });
          continue;
        }
        if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
      }
      if (cleaned.length > max) issues.push({ field, message: `最多 ${max} 个标签` });
      return cleaned.slice(0, max);
    },
    throwIfInvalid() {
      if (issues.length > 0) throw validationFailed(issues);
    },
    get issues() {
      return issues;
    },
  };
  return api;
}
