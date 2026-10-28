const map = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        role: row.role,
        email: row.email,
        color: row.color,
        createdAt: row.created_at,
      }
    : null;

export function createMemberRepo(db) {
  return {
    list() {
      return db.prepare('SELECT * FROM members ORDER BY created_at ASC, rowid ASC').all().map(map);
    },

    find(id) {
      return map(db.prepare('SELECT * FROM members WHERE id = ?').get(id));
    },

    exists(id) {
      return Boolean(db.prepare('SELECT 1 AS ok FROM members WHERE id = ?').get(id));
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM members').get().n;
    },

    insert(member) {
      db.prepare('INSERT INTO members (id, name, role, email, color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        member.id,
        member.name,
        member.role ?? '',
        member.email ?? '',
        member.color,
        member.createdAt,
      );
      return this.find(member.id);
    },

    update(id, patch) {
      const columns = { name: 'name', role: 'role', email: 'email', color: 'color' };
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
      if (!sets.length) return this.find(id);
      values.push(id);
      db.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return this.find(id);
    },

    remove(id) {
      db.prepare('DELETE FROM members WHERE id = ?').run(id);
    },

    /** 姓名查重时排除自身（大小写不敏感由 COLLATE NOCASE 保证） */
    findByName(name, excludeId = null) {
      const needle = String(name ?? '').trim();
      const row = excludeId
        ? db.prepare('SELECT * FROM members WHERE name = ? AND id <> ?').get(needle, excludeId)
        : db.prepare('SELECT * FROM members WHERE name = ?').get(needle);
      return map(row);
    },

    /** 成员被删除时，把名下任务的执行人置空或转交（在服务层事务中调用） */
    reassignTasks(sourceId, targetId, updatedAt) {
      const stmt = db.prepare('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE assignee_id = ?');
      return stmt.run(targetId ?? null, updatedAt, sourceId).changes;
    },
  };
}
