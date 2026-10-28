export function createProjectRepo(db) {
  const map = (row) =>
    row
      ? { id: row.id, key: row.key, name: row.name, description: row.description }
      : null;

  return {
    get() {
      return map(db.prepare('SELECT * FROM project LIMIT 1').get());
    },

    save(project) {
      db.prepare(
        `INSERT INTO project (id, key, name, description) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET key = excluded.key, name = excluded.name, description = excluded.description`,
      ).run(project.id, project.key, project.name, project.description ?? '');
      return this.get();
    },

    update(patch) {
      const columns = { name: 'name', description: 'description' };
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(columns)) {
        if (patch[key] === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
      if (!sets.length) return this.get();
      db.prepare(`UPDATE project SET ${sets.join(', ')}`).run(...values);
      return this.get();
    },
  };
}
