import { randomUUID } from 'node:crypto';
import { COLUMN_TONE_IDS } from '../domain.js';
import { badRequest, conflict, createValidator, notFound } from '../errors.js';

const NAME_MAX = 16;
const MAX_COLUMNS = 12;
const DEFAULT_TONE = 'neutral';

export function createColumnService({ columns, tasks, members, activity, transaction, logger }) {
  function actorName(actorId) {
    return members.find(actorId)?.name ?? '系统';
  }

  function record({ message, actorId }) {
    activity.push({
      id: `a_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      taskId: null,
      taskKey: null,
      taskTitle: null,
      actorId: actorId ?? null,
      actorName: actorName(actorId),
      type: 'column',
      message,
    });
  }

  function mustFind(id) {
    const column = columns.find(id);
    if (!column) throw notFound(`看板列 ${id} 不存在`);
    return column;
  }

  function present(column) {
    return { ...column, taskCount: tasks.countInColumn(column.id) };
  }

  function validate(v, input, { partial }) {
    const out = {};
    if (!partial || input.name !== undefined) {
      out.name = v.requiredString(input.name, 'name', { max: NAME_MAX });
    }
    if (!partial || input.tone !== undefined) {
      out.tone = v.oneOf(input.tone, 'tone', COLUMN_TONE_IDS, { optional: true }) ?? DEFAULT_TONE;
    }
    if (!partial || input.wipLimit !== undefined) {
      out.wipLimit = v.integer(input.wipLimit, 'wipLimit', { min: 1, max: 99, optional: true });
    }
    for (const field of ['isDone', 'isStart']) {
      if (!partial || input[field] !== undefined) {
        if (input[field] !== undefined && typeof input[field] !== 'boolean') {
          v.issues.push({ field, message: '必须是布尔值' });
        }
        out[field] = input[field] === true;
      }
    }
    return out;
  }

  /** 删除列时的迁移目标：默认取相邻列（前一个，没有则后一个） */
  function resolveTarget(id, moveTo, list) {
    if (moveTo) {
      if (moveTo === id) throw badRequest('任务不能转移到被删除的列');
      const target = columns.find(moveTo);
      if (!target) throw conflict('转移目标列不存在', [{ field: 'moveTo', message: '看板列不存在' }]);
      return target;
    }
    const index = list.findIndex((column) => column.id === id);
    return list[index - 1] ?? list[index + 1] ?? null;
  }

  return {
    list() {
      return columns.list().map(present);
    },

    async create(input = {}, actorId = null) {
      const v = createValidator();
      const data = validate(v, input, { partial: false });
      if (columns.count() >= MAX_COLUMNS) {
        v.issues.push({ field: 'name', message: `最多支持 ${MAX_COLUMNS} 个看板列` });
      }
      if (data.name && columns.findByName(data.name)) {
        v.issues.push({ field: 'name', message: '已存在同名列' });
      }
      v.throwIfInvalid();

      return transaction(() => {
        const now = new Date().toISOString();
        let id = `c_${randomUUID().slice(0, 6)}`;
        while (columns.find(id)) id = `c_${randomUUID().slice(0, 6)}`;

        const list = columns.list();
        const column = columns.insert({
          id,
          name: data.name,
          tone: data.tone,
          wipLimit: data.wipLimit ?? null,
          position: list.length,
          isDone: data.isDone === true,
          isStart: data.isStart === true,
          createdAt: now,
          updatedAt: now,
        });

        if (column.isDone) columns.clearFlags('isDone', id);
        if (column.isStart) columns.clearFlags('isStart', id);

        // 允许插到指定位置（未指定则追加到末尾）
        const requested = Number(input.position);
        if (Number.isInteger(requested) && requested >= 0 && requested < list.length) {
          const ids = columns.list().map((item) => item.id).filter((item) => item !== id);
          ids.splice(requested, 0, id);
          columns.reorder(ids);
        }

        record({ message: `${actorName(actorId)} 新增看板列「${column.name}」`, actorId });
        logger.info('看板列已创建', { columnId: id, name: column.name });
        return present(mustFind(id));
      });
    },

    async update(id, patch = {}, actorId = null) {
      const column = mustFind(id);
      const v = createValidator();
      const data = validate(v, patch, { partial: true });
      if (data.name && columns.findByName(data.name, id)) {
        v.issues.push({ field: 'name', message: '已存在同名列' });
      }
      // 完成列必须始终存在一个，否则“完成时间/完成率/周期时间”失去口径
      if (data.isDone === false && column.isDone) {
        const others = columns.list().filter((item) => item.id !== id && item.isDone);
        if (others.length === 0) {
          v.issues.push({ field: 'isDone', message: '至少需要保留一个「完成」列，请先把其他列标记为完成' });
        }
      }
      v.throwIfInvalid();

      return transaction(() => {
        const now = new Date().toISOString();
        const changes = [];
        for (const field of ['name', 'tone', 'wipLimit', 'isDone', 'isStart']) {
          if (data[field] === undefined) continue;
          const before = column[field] ?? null;
          const after = data[field] ?? null;
          if (before === after) continue;
          if (field === 'name') changes.push(`重命名为「${after}」`);
          if (field === 'tone') changes.push('调整了配色');
          if (field === 'wipLimit') changes.push(after ? `WIP 上限设为 ${after}` : '取消了 WIP 上限');
          if (field === 'isDone') changes.push(after ? '标记为完成列' : '取消完成列标记');
          if (field === 'isStart') changes.push(after ? '标记为开始列' : '取消开始列标记');
        }
        if (data.isDone === true) columns.clearFlags('isDone', id);
        if (data.isStart === true) columns.clearFlags('isStart', id);
        columns.update(id, { ...data, updatedAt: now });

        if (changes.length) {
          record({ message: `${actorName(actorId)} 更新看板列「${column.name}」：${changes.join('，')}`, actorId });
          logger.info('看板列已更新', { columnId: id, changes });
        }
        return present(mustFind(id));
      });
    },

    /** 删除列：先把任务迁移到目标列，再改写历史中的旧列 ID，最后删除 */
    async remove(id, { moveTo = null } = {}, actorId = null) {
      const column = mustFind(id);
      const list = columns.list();
      if (list.length <= 1) throw badRequest('至少需要保留一个看板列');
      const target = resolveTarget(id, moveTo, list);
      if (!target) throw badRequest('找不到可用的任务转移目标列');

      return transaction(() => {
        const now = new Date().toISOString();
        const moved = tasks.moveColumn(id, target.id, now);
        tasks.rewriteHistoryStatus(id, target.id);

        // 语义继承：删掉完成列/开始列时，目标列接管对应语义
        if (column.isDone) columns.update(target.id, { isDone: true, updatedAt: now });
        if (column.isStart) columns.update(target.id, { isStart: true, updatedAt: now });

        columns.remove(id);
        columns.reorder(columns.list().map((item) => item.id));

        record({
          message: `${actorName(actorId)} 删除看板列「${column.name}」${
            moved ? `，${moved} 个任务转移到「${target.name}」` : ''
          }`,
          actorId,
        });
        logger.info('看板列已删除', { columnId: id, moved, to: target.id });
        return { id, moved, to: target.id };
      });
    },

    /** 拖拽/按钮调整列顺序 */
    async move(id, toIndex, actorId = null) {
      mustFind(id);
      const v = createValidator();
      const index = v.integer(toIndex, 'index', { min: 0, max: MAX_COLUMNS - 1, optional: false });
      v.throwIfInvalid();

      const ids = columns.list().map((column) => column.id);
      const from = ids.indexOf(id);
      ids.splice(from, 1);
      const position = Math.max(0, Math.min(index, ids.length));
      ids.splice(position, 0, id);
      return columns.reorder(ids).map(present);
    },
  };
}
