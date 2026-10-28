/**
 * 重置数据脚本：删除 SQLite 数据库文件，下次启动按 SEED_MODE 重新生成数据。
 *
 * ⚠️ 使用前请先停止服务。
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const dbFile = process.env.DB_FILE || 'kanban.db';
const target = path.join(dataDir, dbFile);

for (const suffix of ['', '-wal', '-shm']) {
  await rm(`${target}${suffix}`, { force: true });
}
console.log(`已删除 ${target}（含 -wal/-shm），下次启动将按 SEED_MODE 重新生成数据。`);
