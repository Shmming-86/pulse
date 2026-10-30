import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite 数据层（Node 内置 node:sqlite，零第三方依赖）。
 *
 * 设计要点：
 * - WAL 模式：读写不互相阻塞，单进程内读取无需等待写事务落盘
 * - foreign_keys=ON：由数据库保证引用完整性（删任务级联删子项/标签/历史）
 * - 所有变更走 transaction()，异常自动 ROLLBACK，避免半截写入
 * - 迁移按 version 递增，已应用记录在 schema_migrations，可重复执行
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE project (
          id          TEXT PRIMARY KEY,
          key         TEXT NOT NULL,
          name        TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE board_columns (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          tone       TEXT NOT NULL DEFAULT 'neutral',
          wip_limit  INTEGER,
          position   INTEGER NOT NULL,
          is_done    INTEGER NOT NULL DEFAULT 0,
          is_start   INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_columns_position ON board_columns(position);

        CREATE TABLE members (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          role       TEXT NOT NULL DEFAULT '',
          email      TEXT NOT NULL DEFAULT '',
          color      TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE tasks (
          id           TEXT PRIMARY KEY,
          seq          INTEGER NOT NULL,
          task_key     TEXT NOT NULL UNIQUE,
          project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          title        TEXT NOT NULL,
          description  TEXT NOT NULL DEFAULT '',
          status_id    TEXT NOT NULL REFERENCES board_columns(id),
          type         TEXT NOT NULL DEFAULT 'task',
          priority     TEXT NOT NULL DEFAULT 'medium',
          assignee_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
          reporter_id  TEXT,
          estimate     INTEGER,
          due_date     TEXT,
          position     INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX idx_tasks_status ON tasks(status_id, position);
        CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
        CREATE INDEX idx_tasks_updated ON tasks(updated_at DESC);

        CREATE TABLE task_labels (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          name    TEXT NOT NULL,
          PRIMARY KEY (task_id, name)
        );

        CREATE TABLE subtasks (
          id       TEXT PRIMARY KEY,
          task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          title    TEXT NOT NULL,
          done     INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_subtasks_task ON subtasks(task_id, position);

        CREATE TABLE task_history (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          at         TEXT NOT NULL,
          field      TEXT NOT NULL,
          from_value TEXT,
          to_value   TEXT,
          actor_id   TEXT
        );
        CREATE INDEX idx_history_task ON task_history(task_id, id);

        CREATE TABLE activity (
          id         TEXT PRIMARY KEY,
          at         TEXT NOT NULL,
          task_id    TEXT,
          task_key   TEXT,
          task_title TEXT,
          actor_id   TEXT,
          actor_name TEXT,
          type       TEXT NOT NULL,
          message    TEXT NOT NULL
        );
        CREATE INDEX idx_activity_at ON activity(at DESC);

        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    name: 'task_difficulty',
    up(db) {
      db.exec('ALTER TABLE tasks ADD COLUMN difficulty TEXT');

      // 老数据的数字点数折算成难度档位，避免历史任务全部显示「未评估」
      db.exec(`
        UPDATE tasks SET difficulty = CASE
          WHEN estimate IS NULL OR estimate <= 0 THEN NULL
          WHEN estimate <= 2 THEN 'easy'
          WHEN estimate <= 4 THEN 'normal'
          WHEN estimate <= 6 THEN 'hard'
          ELSE 'xhard'
        END
        WHERE difficulty IS NULL
      `);
    },
  },
  {
    version: 2,
    name: 'task_started_at',
    up(db) {
      db.exec('ALTER TABLE tasks ADD COLUMN started_at TEXT');

      // 1) 从历史回填：最早一次进入「开始列」的时间
      db.exec(`
        UPDATE tasks SET started_at = (
          SELECT MIN(h.at) FROM task_history h
          WHERE h.task_id = tasks.id
            AND h.field = 'status'
            AND h.to_value = (SELECT id FROM board_columns WHERE is_start = 1 ORDER BY position LIMIT 1)
        )
        WHERE started_at IS NULL
      `);

      // 2) 当前已越过开始列但没有历史（人工导入/老数据）：用最近更新时间兜底
      db.exec(`
        UPDATE tasks SET started_at = updated_at
        WHERE started_at IS NULL
          AND EXISTS (
            SELECT 1 FROM board_columns s, board_columns cur
            WHERE s.is_start = 1 AND cur.id = tasks.status_id AND cur.position >= s.position
          )
      `);
    },
  },
];

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

export function openDatabase({ file, logger }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (const pragma of PRAGMAS) db.exec(pragma);
  migrate(db, logger);
  return db;
}

function migrate(db, logger) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    transaction(db, () => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    logger?.info('数据库迁移已应用', { version: migration.version, name: migration.name });
  }
}

/**
 * 事务封装：抛出异常时回滚，避免部分写入落库。
 * 支持嵌套调用（服务层包事务、仓储内部再包一层时用 SAVEPOINT），不会报 "cannot start a transaction"。
 */
const depths = new WeakMap();

export function transaction(db, fn) {
  const depth = depths.get(db) ?? 0;
  const savepoint = `sp_${depth}`;
  if (depth === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);
  depths.set(db, depth + 1);
  try {
    const result = fn();
    depths.set(db, depth);
    if (depth === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    depths.set(db, depth);
    try {
      if (depth === 0) db.exec('ROLLBACK');
      else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      /* 回滚失败时保留原始异常 */
    }
    throw error;
  }
}

export function tableCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
