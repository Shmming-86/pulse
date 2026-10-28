/**
 * 清空任务与动态（保留成员、看板列、项目信息）。
 *
 * 用法：
 *   node scripts/clear.js --dry-run        # 只统计，不修改
 *   node scripts/clear.js --yes            # 执行清空
 *   DATA_DIR=/opt/kanban-pulse/data node scripts/clear.js --yes
 *
 * 行为：
 *   1. 执行前把当前数据库复制为 data/kanban.db.before-clear（防误操作）
 *   2. 事务内清空 tasks（级联 task_labels / subtasks / task_history）与 activity
 *   3. 重置任务编号计数器，清空后新任务从 PLS-1 重新开始
 *   4. 保留：项目信息、看板列（含 WIP/完成语义）、成员
 *
 * ⚠️ 不可恢复（除非用 .before-clear 或备份）。建议先停服务再执行。
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const dryRun = args.includes('--dry-run') || !confirmed;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const dbFile = path.join(dataDir, process.env.DB_FILE || 'kanban.db');

if (!existsSync(dbFile)) {
  console.error(`[清空失败] 数据库文件不存在: ${dbFile}`);
  process.exit(1);
}

const db = new DatabaseSync(dbFile);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const TABLES = ['tasks', 'task_labels', 'subtasks', 'task_history', 'activity'];
const before = Object.fromEntries(TABLES.map((t) => [t, count(t)]));
const keep = {
  members: count('members'),
  columns: count('board_columns'),
};

console.log('[当前数据]');
for (const t of TABLES) console.log(`  ${t.padEnd(13)} ${before[t]}`);
console.log(`  ${'members'.padEnd(13)} ${keep.members}（保留）`);
console.log(`  ${'columns'.padEnd(13)} ${keep.columns}（保留）`);

if (dryRun) {
  console.log('\n[预演] 未做任何修改。确认清空请加 --yes：');
  console.log('  node scripts/clear.js --yes');
  db.close();
  process.exit(0);
}

// 现场保留一份：WAL 模式下直接拷主库文件会丢掉 -wal 里的数据，
// 必须用 VACUUM INTO 生成包含全部已提交事务的独立快照。
const snapshot = `${dbFile}.before-clear`;
rmSync(snapshot, { force: true });
db.exec(`VACUUM INTO '${snapshot.replace(/\\/g, '/').replace(/'/g, "''")}'`);
console.log(`\n[保护] 已保存清空前的数据快照: ${snapshot}`);

try {
  db.exec('BEGIN IMMEDIATE');
  // 级联会清理 task_labels / subtasks / task_history
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM activity');
  db.prepare("INSERT INTO meta (key, value) VALUES ('next_key', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  console.error('[清空失败] 已回滚:', error.message);
  process.exit(1);
}

const after = Object.fromEntries(TABLES.map((t) => [t, count(t)]));
console.log('[清空结果]');
for (const t of TABLES) console.log(`  ${t.padEnd(13)} ${before[t]} -> ${after[t]}`);
console.log(`  ${'members'.padEnd(13)} ${count('members')}`);
console.log(`  ${'columns'.padEnd(13)} ${count('board_columns')}`);

// 回收空间
db.exec('VACUUM');
db.close();
console.log('\n[完成] 任务编号将从 PLS-1 重新开始。启动服务: npm start');
