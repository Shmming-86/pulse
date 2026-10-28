/**
 * 数据备份脚本（跨平台，Node 原生实现，无第三方依赖）。
 *
 * 用法：
 *   node scripts/backup.mjs                 # 备份到 ./backups
 *   node scripts/backup.mjs --keep 14       # 只保留最近 14 份
 *   DATA_DIR=/opt/kanban-pulse/data node scripts/backup.mjs
 *
 * 行为：
 *   1. 通过 SQLite `VACUUM INTO` 生成一致性快照（服务运行中也可安全备份）
 *   2. 校验快照可打开且核心表齐全，gzip 压缩后写入
 *      backups/kanban-YYYYMMDD-HHmmss.db.gz
 *   3. 按保留数量清理最旧的备份（默认 30 份）
 *
 * 建议配合系统定时任务使用：
 *   Linux:  crontab -e  添加  30 2 * * *  cd /opt/kanban-pulse && node scripts/backup.mjs
 *   Windows: 任务计划程序调用  node D:\kanban\scripts\backup.mjs
 */
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const keepArg = args.indexOf('--keep');
const keep = keepArg !== -1 ? Math.max(1, Number(args[keepArg + 1]) || 30) : 30;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const backupDir = path.resolve(root, process.env.BACKUP_DIR || 'backups');
const source = path.join(dataDir, process.env.DB_FILE || 'kanban.db');

const CORE_TABLES = ['board_columns', 'members', 'tasks', 'activity'];

async function main() {
  if (!existsSync(source)) {
    console.error(`[备份失败] 数据库文件不存在: ${source}`);
    process.exit(1);
  }

  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15); // YYYYMMDD-HHMMSS
  const snapshot = path.join(backupDir, `kanban-${stamp}.db`);
  const target = `${snapshot}.gz`;

  // VACUUM INTO 输出文件必须不存在；快照基于读取事务，服务运行中也可执行
  const db = new DatabaseSync(source);
  try {
    db.exec(`VACUUM INTO '${snapshot.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // 校验快照完整性
  const check = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    const missing = CORE_TABLES.filter((name) => !tables.includes(name));
    if (missing.length) throw new Error(`快照缺少核心表: ${missing.join(', ')}`);
    const tasks = check.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
    console.log(`[校验通过] 快照包含任务 ${tasks} 条`);
  } finally {
    check.close();
  }

  await pipeline(createReadStream(snapshot), createGzip({ level: 9 }), createWriteStream(target));
  await rm(snapshot, { force: true });
  const sizeKb = (statSync(target).size / 1024).toFixed(1);

  // 清理旧备份
  const oldFiles = readdirSync(backupDir)
    .filter((name) => /^kanban-\d{8}-\d{6}\.db\.gz$/.test(name))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of oldFiles) {
    await rm(path.join(backupDir, name), { force: true });
  }

  console.log(`[备份完成] ${target} (${sizeKb} KB)，最多保留 ${keep} 份`);
  if (oldFiles.length) console.log(`[清理] 已删除 ${oldFiles.length} 份过期备份`);
}

main().catch((error) => {
  console.error('[备份失败]', error);
  process.exit(1);
});
