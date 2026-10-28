import { transaction } from '../db/database.js';

const map = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        tone: row.tone,
        wipLimit: row.wip_limit ?? null,
        position: row.position,
        isDone: row.is_done === 1,
        isStart: row.is_start === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

/**
 * 看板列仓储。列是业务数据而不是常量：用户可以新增、重命名、
 * 调整顺序、设置 WIP 上限与「完成/开始」语义。
 */
export function createColumnRepo(db) {
  const all = () => db.prepare('SELECT * FROM board_columns ORDER BY position ASC').all().map(map);

  return {
    list: all,

    find(id) {
      return map(db.prepare('SELECT * FROM board_columns WHERE id = ?').get(id));
    },

    findByName(name, excludeId = null) {
      const row = excludeId
        ? db
            .prepare('SELECT * FROM board_columns WHERE lower(name) = lower(?) AND id <> ?')
            .get(String(name ?? '').trim(), excludeId)
        : db.prepare('SELECT * FROM board_columns WHERE lower(name) = lower(?)').get(String(name ?? '').trim());
      return map(row);
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM board_columns').get().n;
    },

    ids() {
      return all().map((column) => column.id);
    },

    first() {
      return all()[0] ?? null;
    },

    last() {
      const columns = all();
      return columns[columns.length - 1] ?? null;
    },

    /** 完成列：优先 is_done，兜底取最后一列，保证分析口径始终有解 */
    doneColumn() {
      const columns = all();
      return columns.find((column) => column.isDone) ?? columns[columns.length - 1] ?? null;
    },

    /** 开始列：优先 is_start，兜底取第二列（没有则第一列） */
    startColumn() {
      const columns = all();
      return columns.find((column) => column.isStart) ?? columns[1] ?? columns[0] ?? null;
    },

    nextPosition() {
      const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM board_columns').get();
      return row.max + 1;
    },

    insert(column) {
      db.prepare(
        `INSERT INTO board_columns (id, name, tone, wip_limit, position, is_done, is_start, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        column.id,
        column.name,
        column.tone,
        column.wipLimit ?? null,
        column.position,
        column.isDone ? 1 : 0,
        column.isStart ? 1 : 0,
        column.createdAt,
        column.updatedAt,
      );
      return this.find(column.id);
    },

    update(id, patch) {
      const columns = {
        name: 'name',
        tone: 'tone',
        wipLimit: 'wip_limit',
        isDone: 'is_done',
        isStart: 'is_start',
        updatedAt: 'updated_at',
      };
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] === undefined) continue;
        sets.push(`${column} = ?`);
        const value = patch[key];
        values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
      if (!sets.length) return this.find(id);
      values.push(id);
      db.prepare(`UPDATE board_columns SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return this.find(id);
    },

    remove(id) {
      db.prepare('DELETE FROM board_columns WHERE id = ?').run(id);
    },

    /** 单列语义唯一性：设置完成/开始列时清空同语义的其他列 */
    clearFlags(field, exceptId) {
      const column = field === 'isDone' ? 'is_done' : 'is_start';
      db.prepare(`UPDATE board_columns SET ${column} = 0 WHERE id <> ?`).run(exceptId);
    },

    /**
     * 重排：先整体偏移再顺序赋值，避免 position 唯一索引在中间态冲突。
     */
    reorder(orderedIds) {
      transaction(db, () => {
        db.prepare('UPDATE board_columns SET position = position + 1000').run();
        const stmt = db.prepare('UPDATE board_columns SET position = ?, updated_at = ? WHERE id = ?');
        const now = new Date().toISOString();
        orderedIds.forEach((id, index) => stmt.run(index, now, id));
      });
      return all();
    },

    /** 批量初始化（仅种子/迁移使用） */
    insertMany(columns) {
      const now = new Date().toISOString();
      transaction(db, () => {
        columns.forEach((column, index) => {
          this.insert({
            ...column,
            position: index,
            createdAt: now,
            updatedAt: now,
          });
        });
      });
      return all();
    },
  };
}
