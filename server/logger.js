const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(level) {
  return LEVELS[level] ?? LEVELS.info;
}

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    stack: error.stack,
  };
}

/**
 * 结构化 JSON 日志：一行一条，便于采集与检索。
 * 注意：不记录请求体、密码、令牌等敏感信息。
 */
function createLogger(base = {}, threshold = LEVELS.info) {
  const emit = (level, msg, fields = {}) => {
    if (LEVELS[level] < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...fields,
    };
    if (record.err instanceof Error) record.err = serializeError(record.err);
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLogger({ ...base, ...extra }, threshold),
  };
}

export function createRootLogger(level) {
  return createLogger({ app: 'kanban-pulse' }, resolveThreshold(level));
}

export default createRootLogger;
