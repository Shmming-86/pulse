import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import config from './config.js';
import { openDatabase, transaction } from './db/database.js';
import { initDataset } from './db/seed.js';
import { AppError, notFound } from './errors.js';
import { applyCors, applySecurityHeaders, serveStatic } from './http/middleware.js';
import { createRateLimiter, handleError, readJsonBody, sendData } from './http/respond.js';
import { createRouter } from './http/router.js';
import { createRootLogger } from './logger.js';
import { createActivityRepo } from './repositories/activity.js';
import { createColumnRepo } from './repositories/columns.js';
import { createMemberRepo } from './repositories/members.js';
import { createProjectRepo } from './repositories/project.js';
import { createTaskRepo } from './repositories/tasks.js';
import { registerApiRoutes } from './routes/api.js';
import { createAnalyticsService } from './services/analyticsService.js';
import { createColumnService } from './services/columnService.js';
import { createMemberService } from './services/memberService.js';
import { createTaskService } from './services/taskService.js';

const logger = createRootLogger(config.logLevel);

const dbFile = path.join(config.dataDir, config.dbFile);
const db = openDatabase({ file: dbFile, logger: logger.child({ scope: 'db' }) });

const repos = {
  project: createProjectRepo(db),
  columns: createColumnRepo(db),
  tasks: createTaskRepo(db),
  members: createMemberRepo(db),
  activity: createActivityRepo(db),
};

initDataset({
  db,
  repos,
  seedMode: config.seedMode,
  legacyJsonFile: path.join(config.dataDir, config.legacyJsonFile),
  logger,
});

/** 服务层共享的事务入口（支持嵌套） */
const tx = (fn) => transaction(db, fn);

const taskService = createTaskService({
  tasks: repos.tasks,
  members: repos.members,
  columns: repos.columns,
  activity: repos.activity,
  project: repos.project,
  transaction: tx,
  logger: logger.child({ scope: 'tasks' }),
});
const analyticsService = createAnalyticsService({
  tasks: repos.tasks,
  members: repos.members,
  columns: repos.columns,
});
const memberService = createMemberService({
  members: repos.members,
  tasks: repos.tasks,
  columns: repos.columns,
  activity: repos.activity,
  transaction: tx,
  logger: logger.child({ scope: 'members' }),
});
const columnService = createColumnService({
  columns: repos.columns,
  tasks: repos.tasks,
  members: repos.members,
  activity: repos.activity,
  transaction: tx,
  logger: logger.child({ scope: 'columns' }),
});

const router = createRouter();
registerApiRoutes(router, {
  taskService,
  analyticsService,
  memberService,
  columnService,
  activityRepo: repos.activity,
  projectRepo: repos.project,
  taskRepo: repos.tasks,
  memberRepo: repos.members,
});

const rateLimit = createRateLimiter({ ...config.rateLimit, trustProxy: config.trustProxy });

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  req.context = { requestId };
  req.log = logger.child({ requestId });

  applySecurityHeaders(res);
  applyCors(req, res, config.corsOrigins);
  res.setHeader('X-Request-Id', requestId);

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  res.on('finish', () => {
    req.log.info('http_request', {
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      rateLimit(req, res);
      const matched = router.match(req.method, url.pathname);
      if (!matched.handler) {
        if (matched.allowed?.length) {
          throw new AppError(405, 'METHOD_NOT_ALLOWED', `${req.method} 不被支持`);
        }
        throw notFound(`接口 ${url.pathname} 不存在`);
      }

      const hasBody = ['POST', 'PATCH', 'PUT'].includes(req.method);
      const body = hasBody ? await readJsonBody(req, config.bodyLimitBytes) : {};
      if (typeof body.actorId === 'string') delete body.actorId;
      const actorId =
        (typeof req.headers['x-actor-id'] === 'string' && req.headers['x-actor-id']) || null;

      const data = await matched.handler({
        req,
        res,
        params: matched.params,
        query: url.searchParams,
        body,
        actorId,
        logger: req.log,
      });
      if (res.writableEnded) return;
      sendData(res, data, req.method === 'POST' ? 201 : 200);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await serveStatic(req, res, config.publicDir);
      if (served) return;
      throw notFound('资源不存在');
    }

    throw new AppError(405, 'METHOD_NOT_ALLOWED', `${req.method} 不被支持`);
  } catch (error) {
    handleError(error, { req, res, logger: req.log });
  }
});

server.on('error', (error) => {
  logger.error('服务启动失败', { err: error, port: config.port });
  process.exit(1);
});

// 防止慢连接长期占用：超时后断开，交给客户端重试
server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = Math.min(config.requestTimeoutMs, 20_000);
server.keepAliveTimeout = 65_000;

server.listen(config.port, config.host, () => {
  logger.info('服务已启动', {
    version: config.version,
    url: `http://${config.host}:${config.port}`,
    env: config.env,
    seedMode: config.seedMode,
    database: dbFile,
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('收到退出信号，开始优雅停机', { signal });
  const force = setTimeout(() => {
    logger.warn('停机超时，强制退出');
    process.exit(1);
  }, 5000);
  force.unref();
  server.close(() => {
    try {
      // 关闭连接前把 WAL 合并回主库，避免 -wal 文件堆积
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (error) {
      logger.error('停机时关闭数据库失败', { err: error });
    }
    logger.info('已安全退出');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', { err: reason });
});
process.on('uncaughtException', (error) => {
  logger.error('未捕获异常', { err: error });
});
