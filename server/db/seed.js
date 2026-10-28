import { existsSync, readFileSync } from 'node:fs';
import { transaction } from './database.js';
import { DEFAULT_COLUMNS, PROJECT } from '../domain.js';
import { buildEmptyData, buildSeedData } from '../seed.js';

const now = () => new Date().toISOString();

/**
 * 补齐 started_at（首次进入开始列的时间）。
 * 迁移只对建库时已有的数据生效，种子/旧 JSON 导入是在迁移之后写入的，
 * 因此初始化结束后需要再跑一次同样的回填。
 */
export function backfillStartedAt(db) {
  db.exec(`
    UPDATE tasks SET started_at = (
      SELECT MIN(h.at) FROM task_history h
      WHERE h.task_id = tasks.id
        AND h.field = 'status'
        AND h.to_value = (SELECT id FROM board_columns WHERE is_start = 1 ORDER BY position LIMIT 1)
    )
    WHERE started_at IS NULL
  `);
  db.exec(`
    UPDATE tasks SET started_at = updated_at
    WHERE started_at IS NULL
      AND EXISTS (
        SELECT 1 FROM board_columns s, board_columns cur
        WHERE s.is_start = 1 AND cur.id = tasks.status_id AND cur.position >= s.position
      )
  `);
}

/**
 * 写入一份完整数据集（演示种子与旧版 JSON 迁移共用）。
 * 整体在一个事务中执行，中途失败不会留下半套数据。
 */
function insertDataset({ db, repos, data }) {
  const project = data.project ?? PROJECT;
  transaction(db, () => {
    repos.project.save(project);
    // 默认四列：待处理 / 进行中 / 评审中 / 已完成（用户可后续增删改）
    if (repos.columns.count() === 0) repos.columns.insertMany(DEFAULT_COLUMNS);

    for (const member of data.members ?? []) {
      repos.members.insert({
        id: member.id,
        name: member.name,
        role: member.role ?? '',
        email: member.email ?? '',
        color: member.color ?? '#5b5bd6',
        createdAt: member.createdAt ?? now(),
      });
    }

    for (const task of data.tasks ?? []) {
      repos.tasks.insert({
        ...task,
        projectId: task.projectId ?? project.id,
        description: task.description ?? '',
        labels: task.labels ?? [],
        subtasks: task.subtasks ?? [],
        history: task.history ?? [],
      });
    }

    // 活动表按时间倒序读取，插入时反转以保持原顺序
    for (const entry of [...(data.activity ?? [])].reverse()) {
      repos.activity.push({
        ...entry,
        actorName: entry.actorName ?? null,
      });
    }

    const nextKey = Number(data.meta?.nextKey);
    const fallback = (data.tasks ?? []).length + 1;
    const value = Number.isFinite(nextKey) && nextKey >= 1 ? nextKey : fallback;
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('next_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(value));

    backfillStartedAt(db);
  });
  return {
    columns: repos.columns.count(),
    members: repos.members.count(),
    tasks: repos.tasks.stats().total,
  };
}

/**
 * 首次启动初始化：
 * 1. 数据库里已有数据 → 什么都不做
 * 2. 存在旧版 data/db.json → 自动迁移，保留用户既有数据
 * 3. 否则按 SEED_MODE 生成（demo=演示数据 / empty=空库 + 默认管理员）
 */
export function initDataset({ db, repos, seedMode, legacyJsonFile, logger }) {
  if (repos.columns.count() > 0) return { action: 'existing', tasks: repos.tasks.stats().total };

  if (legacyJsonFile && existsSync(legacyJsonFile)) {
    try {
      const parsed = JSON.parse(readFileSync(legacyJsonFile, 'utf8'));
      if (Array.isArray(parsed.tasks) && Array.isArray(parsed.members)) {
        const stats = insertDataset({ db, repos, data: parsed });
        logger.info('已从旧版 JSON 数据迁移到 SQLite', { file: legacyJsonFile, ...stats });
        return { action: 'migrated-json', ...stats };
      }
    } catch (error) {
      logger.error('旧版数据迁移失败，改用初始数据', { file: legacyJsonFile, err: error });
    }
  }

  const data = seedMode === 'demo' ? buildSeedData() : buildEmptyData();
  const stats = insertDataset({ db, repos, data });
  logger.info('数据库已初始化', { seedMode, ...stats });
  return { action: seedMode === 'demo' ? 'seeded-demo' : 'seeded-empty', ...stats };
}
