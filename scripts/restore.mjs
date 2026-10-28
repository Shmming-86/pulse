/**
 * 数据恢复脚本（跨平台，Node 原生实现）。
 *
 * 用法：
 *   node scripts/restore.mjs backups/kanban-20261021-143000.db.gz
 *   node scripts/restore.mjs backups/kanban-xxx.db      # 支持未压缩的 .db 快照
 *
 * 行为：
 *   1. 解压（如为 .gz）并校验快照是合法 SQLite 数据库、核心表齐全
 *   2. 将当前数据文件另存为 *.before-restore（防误操作）
 *   3. 用快照覆盖 data/kanban.db，并清理残留的 -wal/-shm 文件
 *
 * ⚠️ 恢复前请先停止服务（systemd stop / docker compose stop / Ctrl+C），
 *    恢复完成后再启动，避免运行中的进程写坏数据文件。
 */
import { createGunzip } from 'node:zlib';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const dbFile = process.env.DB_FILE || 'kanban.db';
const target = path.join(dataDir, dbFile);

const CORE_TABLES = ['board_columns', 'members', 'tasks', 'activity'];

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('用法: node scripts/restore.mjs <备份文件> 例如 backups/kanban-20261021-143000.db.gz');
  process.exit(1);
}

const source = path.resolve(backupPath);

async function main() {
  // 解压（如为 .gz）到临时文件
  const tmp = `${target}.restore-tmp`;
  await rm(tmp, { force: true });
  if (source.endsWith('.gz')) {
    await pipeline(createReadStream(source), createGunzip(), createWriteStream(tmp));
  } else {
    await copyFile(source, tmp);
  }

  // 校验临时文件是合法 SQLite 数据库
  let counts = {};
  const check = new DatabaseSync(tmp, { readOnly: true });
  try {
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    const missing = CORE_TABLES.filter((name) => !tables.includes(name));
    if (missing.length) throw new Error(`快照缺少核心表: ${missing.join(', ')}`);
    for (const name of ['board_columns', 'members', 'tasks']) {
      counts[name] = check.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
    }
  } finally {
    check.close();
  }

  await mkdir(dataDir, { recursive: true });

  // 现场保留
  if (existsSync(target)) {
    await copyFile(target, `${target}.before-restore`);
    console.log(`[保护] 当前数据已另存为 ${dbFile}.before-restore`);
  }

  // 覆盖并清理 WAL/SHM 残留
  await rename(tmp, target);
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });

  console.log(
    `[恢复完成] ${source} -> ${target}`,
    `\n[摘要] 看板列 ${counts.board_columns} 个，成员 ${counts.members} 位，任务 ${counts.tasks} 条`,
    `\n[下一步] 请启动服务: npm start`,
  );
}

main().catch((error) => {
  console.error('[恢复失败]', error.message);
  process.exit(1);
});
