import { transaction } from '../db/database.js';

/** DTO 字段 → 数据库列 */
const FIELD_MAP = {
  title: 'title',
  description: 'description',
  status: 'status_id',
  type: 'type',
  priority: 'priority',
  assigneeId: 'assignee_id',
  reporterId: 'reporter_id',
  estimate: 'estimate',
  dueDate: 'due_date',
  position: 'position',
  updatedAt: 'updated_at',
  startedAt: 'started_at',
  completedAt: 'completed_at',
};

const BOOLEAN_COLUMNS = new Set();

function mapTask(row, extras) {
  return {
    id: row.id,
    key: row.task_key,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status_id,
    type: row.type,
    priority: row.priority,
    assigneeId: row.assignee_id ?? null,
    reporterId: row.reporter_id ?? null,
    labels: extras.labels,
    estimate: row.estimate ?? null,
    dueDate: row.due_date ?? null,
    subtasks: extras.subtasks,
    order: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    history: extras.history,
  };
}

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const bucket = map.get(item[key]);
    if (bucket) bucket.push(item);
    else map.set(item[key], [item]);
  }
  return map;
}

export function createTaskRepo(db) {
  /** 批量补齐标签/子项/历史：固定 3 条查询，避免按任务逐条查询的 N+1 */
  function hydrate(rows) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const marks = ids.map(() => '?').join(',');

    const labels = groupBy(
      db.prepare(`SELECT task_id, name FROM task_labels WHERE task_id IN (${marks}) ORDER BY rowid`).all(...ids),
      'task_id',
    );
    const subtasks = groupBy(
      db
        .prepare(`SELECT * FROM subtasks WHERE task_id IN (${marks}) ORDER BY position ASC, rowid ASC`)
        .all(...ids),
      'task_id',
    );
    const history = groupBy(
      db.prepare(`SELECT * FROM task_history WHERE task_id IN (${marks}) ORDER BY id ASC`).all(...ids),
      'task_id',
    );

    return rows.map((row) =>
      mapTask(row, {
        labels: (labels.get(row.id) ?? []).map((item) => item.name),
        subtasks: (subtasks.get(row.id) ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          done: item.done === 1,
        })),
        history: (history.get(row.id) ?? []).map((item) => ({
          at: item.at,
          field: item.field,
          from: item.from_value,
          to: item.to_value,
          actorId: item.actor_id ?? null,
        })),
      }),
    );
  }

  function escapeLike(value) {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  return {
    list({ status, assigneeId, priority, type, q } = {}) {
      const where = [];
      const params = [];
      if (status) {
        where.push('t.status_id = ?');
        params.push(status);
      }
      if (assigneeId) {
        where.push('t.assignee_id = ?');
        params.push(assigneeId);
      }
      if (priority) {
        where.push('t.priority = ?');
        params.push(priority);
      }
      if (type) {
        where.push('t.type = ?');
        params.push(type);
      }
      if (q) {
        const like = `%${escapeLike(q.toLowerCase())}%`;
        where.push(
          `(lower(t.title) LIKE ? ESCAPE '\\' OR lower(t.task_key) LIKE ? ESCAPE '\\' OR lower(t.description) LIKE ? ESCAPE '\\' OR EXISTS (
             SELECT 1 FROM task_labels l WHERE l.task_id = t.id AND lower(l.name) LIKE ? ESCAPE '\\'
           ))`,
        );
        params.push(like, like, like, like);
      }
      const sql = `SELECT t.* FROM tasks t
        JOIN board_columns c ON c.id = t.status_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.position ASC, t.position ASC, t.created_at ASC`;
      return hydrate(db.prepare(sql).all(...params));
    },

    find(id) {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!row) return null;
      return hydrate([row])[0];
    },

    countInColumn(statusId) {
      return db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE status_id = ?').get(statusId).n;
    },

    insert(task) {
      return transaction(db, () => {
        const seq = Number(String(task.key).split('-').pop()) || 0;
        db.prepare(
          `INSERT INTO tasks
             (id, seq, task_key, project_id, title, description, status_id, type, priority,
              assignee_id, reporter_id, estimate, due_date, position, created_at, updated_at, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          task.id,
          seq,
          task.key,
          task.projectId,
          task.title,
          task.description ?? '',
          task.status,
          task.type,
          task.priority,
          task.assigneeId ?? null,
          task.reporterId ?? null,
          task.estimate ?? null,
          task.dueDate ?? null,
          task.order ?? 0,
          task.createdAt,
          task.updatedAt,
          task.startedAt ?? null,
          task.completedAt ?? null,
        );
        this.setLabels(task.id, task.labels ?? []);
        (task.subtasks ?? []).forEach((subtask, index) => {
          db.prepare('INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, ?, ?)').run(
            subtask.id,
            task.id,
            subtask.title,
            subtask.done ? 1 : 0,
            index,
          );
        });
        for (const entry of task.history ?? []) this.addHistory(task.id, entry);
        return this.find(task.id);
      });
    },

    update(id, patch) {
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(FIELD_MAP)) {
        if (patch[key] === undefined) continue;
        sets.push(`${column} = ?`);
        const value = patch[key];
        values.push(BOOLEAN_COLUMNS.has(column) && typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
      if (!sets.length) return this.find(id);
      values.push(id);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return this.find(id);
    },

    /** 任务上出现过的全部标签（用于前端标签池：内置标签 + 自定义标签） */
    distinctLabels() {
      return db
        .prepare('SELECT DISTINCT name FROM task_labels ORDER BY name COLLATE NOCASE')
        .all()
        .map((row) => row.name);
    },

    setLabels(taskId, labels) {
      db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
      const stmt = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, name) VALUES (?, ?)');
      for (const label of labels) stmt.run(taskId, label);
    },

    addHistory(taskId, entry) {
      db.prepare(
        'INSERT INTO task_history (task_id, at, field, from_value, to_value, actor_id) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(taskId, entry.at, entry.field, entry.from ?? null, entry.to ?? null, entry.actorId ?? null);
    },

    /**
     * 把任务放到目标列的指定位置，并重排该列 order。
     * 整个操作在一个事务里完成，前端拿到的顺序始终连续、无空洞。
     */
    placeAt(taskId, statusId, index) {
      transaction(db, () => {
        const rows = db
          .prepare('SELECT id FROM tasks WHERE status_id = ? AND id <> ? ORDER BY position ASC')
          .all(statusId, taskId)
          .map((row) => row.id);
        const position = Math.max(0, Math.min(index ?? rows.length, rows.length));
        rows.splice(position, 0, taskId);
        const stmt = db.prepare('UPDATE tasks SET status_id = ?, position = ? WHERE id = ?');
        rows.forEach((id, i) => stmt.run(statusId, i, id));
      });
    },

    /** 删除列前把任务整体迁移到目标列（保持原有相对顺序），返回迁移数量 */
    moveColumn(sourceStatusId, targetStatusId, updatedAt) {
      return transaction(db, () => {
        const rows = db
          .prepare('SELECT id FROM tasks WHERE status_id = ? ORDER BY position ASC')
          .all(sourceStatusId)
          .map((row) => row.id);
        let base = this.countInColumn(targetStatusId);
        const stmt = db.prepare('UPDATE tasks SET status_id = ?, position = ?, updated_at = ? WHERE id = ?');
        for (const id of rows) {
          stmt.run(targetStatusId, base, updatedAt, id);
          base += 1;
        }
        return rows.length;
      });
    },

    /** 列被删除后，把历史里的旧列 ID 改写为迁移目标，保证累计流图口径连续 */
    rewriteHistoryStatus(fromStatusId, toStatusId) {
      db.prepare('UPDATE task_history SET from_value = ? WHERE field = ? AND from_value = ?').run(
        toStatusId,
        'status',
        fromStatusId,
      );
      db.prepare('UPDATE task_history SET to_value = ? WHERE field = ? AND to_value = ?').run(
        toStatusId,
        'status',
        fromStatusId,
      );
    },

    remove(id) {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    },

    /** 任务键序号：存 meta 表，避免删除任务后编号回退 */
    nextKeyNumber() {
      return transaction(db, () => {
        const row = db.prepare("SELECT value FROM meta WHERE key = 'next_key'").get();
        let next = row ? Number(row.value) : NaN;
        if (!Number.isFinite(next) || next < 1) {
          const max = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM tasks').get().max;
          next = max + 1;
        }
        db.prepare(
          "INSERT INTO meta (key, value) VALUES ('next_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(String(next + 1));
        return next;
      });
    },

    insertSubtask(taskId, subtask) {
      const position = db.prepare('SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ?').get(taskId).n;
      db.prepare('INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, ?, ?)').run(
        subtask.id,
        taskId,
        subtask.title,
        subtask.done ? 1 : 0,
        position,
      );
    },

    toggleSubtask(taskId, subtaskId) {
      const row = db.prepare('SELECT * FROM subtasks WHERE id = ? AND task_id = ?').get(subtaskId, taskId);
      if (!row) return null;
      db.prepare('UPDATE subtasks SET done = ? WHERE id = ?').run(row.done === 1 ? 0 : 1, subtaskId);
      return { id: subtaskId, done: row.done !== 1 };
    },

    removeSubtask(taskId, subtaskId) {
      const result = db.prepare('DELETE FROM subtasks WHERE id = ? AND task_id = ?').run(subtaskId, taskId);
      return result.changes > 0;
    },

    stats() {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
           FROM tasks`,
        )
        .get();
      return { total: row.total ?? 0, completed: row.completed ?? 0 };
    },
  };
}
