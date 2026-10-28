const MAX_ACTIVITY = 200;

export function createActivityRepo(db) {
  return {
    list(limit = 40) {
      return db
        .prepare('SELECT * FROM activity ORDER BY at DESC, rowid DESC LIMIT ?')
        .all(limit)
        .map((row) => ({
          id: row.id,
          at: row.at,
          taskId: row.task_id,
          taskKey: row.task_key,
          taskTitle: row.task_title,
          actorId: row.actor_id,
          actorName: row.actor_name,
          type: row.type,
          message: row.message,
        }));
    },

    push(entry) {
      db.prepare(
        `INSERT INTO activity (id, at, task_id, task_key, task_title, actor_id, actor_name, type, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.at,
        entry.taskId ?? null,
        entry.taskKey ?? null,
        entry.taskTitle ?? null,
        entry.actorId ?? null,
        entry.actorName ?? null,
        entry.type,
        entry.message,
      );
      // 只保留最近 200 条，避免活动表无限增长
      db.prepare(
        `DELETE FROM activity WHERE id NOT IN (
           SELECT id FROM activity ORDER BY at DESC, rowid DESC LIMIT ?
         )`,
      ).run(MAX_ACTIVITY);
      return entry;
    },

    removeByTask(taskId) {
      db.prepare('DELETE FROM activity WHERE task_id = ?').run(taskId);
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM activity').get().n;
    },
  };
}
