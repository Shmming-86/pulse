import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 极简 .env 加载器：只补齐缺失的变量，不覆盖真实环境变量。
 * 解析失败时直接忽略该行，避免因注释/空行导致启动失败。
 */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const problems = [];

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} 必须是 ${min}~${max} 之间的整数，当前值为 "${raw}"`);
    return fallback;
  }
  return value;
}

function readList(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

// 生产环境默认空库（只含一个管理员），开发环境默认演示数据
const seedMode = (process.env.SEED_MODE || (env === 'production' ? 'empty' : 'demo'))
  .trim()
  .toLowerCase();

const config = {
  env,
  isProd: env === 'production',
  version: '1.7.2',
  host: process.env.HOST || '127.0.0.1',
  port: readInt('PORT', 4173, { min: 1, max: 65535 }),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  /** SQLite 数据库文件名（位于 dataDir 下） */
  dbFile: process.env.DB_FILE || 'kanban.db',
  /** 首次启动时若存在旧版 JSON 数据，自动迁移到 SQLite */
  legacyJsonFile: process.env.LEGACY_JSON_FILE || 'db.json',
  publicDir: path.join(ROOT, 'public'),
  corsOrigins: readList('CORS_ORIGINS', ['http://localhost:4173', 'http://127.0.0.1:4173']),
  seedMode,
  // 部署在 Nginx / 负载均衡之后时置为 true，限流才会读取 X-Forwarded-For
  trustProxy: readBool('TRUST_PROXY', false),
  requestTimeoutMs: readInt('REQUEST_TIMEOUT_MS', 30_000, { min: 1000, max: 600_000 }),
  rateLimit: {
    windowMs: 60_000,
    max: readInt('RATE_LIMIT_MAX', 600, { min: 1, max: 100000 }),
  },
  bodyLimitBytes: readInt('BODY_LIMIT_BYTES', 262144, { min: 1024, max: 5_242_880 }),
  logLevel: process.env.LOG_LEVEL || 'info',
};

// 启动即校验，快速失败：配置错误不应留到运行期才暴露
if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
  problems.push(`LOG_LEVEL 仅支持 debug|info|warn|error，当前值为 "${config.logLevel}"`);
}
if (config.corsOrigins.includes('*') && config.isProd) {
  problems.push('生产环境 CORS_ORIGINS 禁止使用通配符 *，请显式列出来源');
}
if (!['demo', 'empty'].includes(config.seedMode)) {
  problems.push(`SEED_MODE 仅支持 demo|empty，当前值为 "${config.seedMode}"`);
}
if (problems.length > 0) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: '配置校验失败，进程退出',
      problems,
    }),
  );
  process.exit(1);
}

export default config;
