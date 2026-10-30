import { randomUUID } from 'node:crypto';
import { DIFFICULTIES, DIFFICULTY_IDS, PRIORITIES, PRIORITY_IDS, TYPE_IDS, TYPES } from '../domain.js';
import { createValidator, notFound, badRequest } from '../errors.js';

const MAX_SUBTASKS = 20;

const priorityName = (id) => PRIORITIES.find((p) => p.id === id)?.name ?? id;
const typeName = (id) => TYPES.find((t) => t.id === id)?.name ?? id;
const difficultyName = (id) => DIFFICULTIES.find((d) => d.id === id)?.name ?? '未评估';

/** ISO 时间转本地「YYYY-MM-DD HH:mm」，用于活动文案（服务端时区即团队时区） */
function formatLocal(iso) {
  if (!iso) return '未设置';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未设置';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function createTaskService({ tasks, members, columns, activity, project, transaction, logger }) {
  const statusName = (id) => columns.find(id)?.name ?? id;
  const isDoneColumn = (id) => columns.find(id)?.isDone === true;

  /**
   * 首次进入「开始列及其后续列」的时间，作为周期时间起点。
   * 一旦写入不再清空（任务退回未开始列时仍保留首次开始时间）。
   */
  function startTimestampFor(statusId) {
    const list = columns.list();
    const start = list.find((column) => column.isStart);
    if (!start) return null;
    const target = list.find((column) => column.id === statusId);
    if (!target || target.position < start.position) return null;
    return new Date().toISOString();
  }

  function actorName(actorId) {
    return members.find(actorId)?.name ?? '系统';
  }

  function record(task, { type, message, actorId }) {
    activity.push({
      id: `a_${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      taskId: task.id,
      taskKey: task.key,
      taskTitle: task.title,
      actorId: actorId ?? null,
      actorName: actorName(actorId),
      type,
      message,
    });
  }

  function mustFind(id) {
    const task = tasks.find(id);
    if (!task) throw notFound(`任务 ${id} 不存在`);
    return task;
  }

  function validateBase(v, input, { partial }) {
    const out = {};
    const statusIds = columns.ids();
    const fallbackStatus = columns.first()?.id ?? statusIds[0];

    if (!partial || input.title !== undefined) {
      out.title = v.requiredString(input.title, 'title', { max: 160 });
    }
    if (!partial || input.description !== undefined) {
      out.description = v.optionalString(input.description, 'description', { max: 5000 });
    }
    if (!partial || input.type !== undefined) {
      // type/priority/status 都有默认值，缺省不应报错；但传了非法值仍要拦截
      out.type = v.oneOf(input.type, 'type', TYPE_IDS, { optional: true }) ?? 'task';
    }
    if (!partial || input.priority !== undefined) {
      out.priority = v.oneOf(input.priority, 'priority', PRIORITY_IDS, { optional: true }) ?? 'medium';
    }
    if (!partial || input.status !== undefined) {
      // 看板列是动态的：以数据库中的列 ID 作为合法状态集合
      out.status = v.oneOf(input.status, 'status', statusIds, { optional: true }) ?? fallbackStatus;
    }
    if (!partial || input.difficulty !== undefined) {
      const raw = input.difficulty;
      if (raw === undefined || raw === null || raw === '') {
        out.difficulty = null;
      } else if (DIFFICULTY_IDS.includes(raw)) {
        out.difficulty = raw;
      } else {
        v.issues.push({ field: 'difficulty', message: '难度取值无效（easy/normal/hard/xhard）' });
        out.difficulty = null;
      }
    }
    if (!partial || input.dueDate !== undefined) {
      out.dueDate = v.dateString(input.dueDate, 'dueDate', { optional: true });
    }
    if (!partial || input.labels !== undefined) {
      out.labels = v.stringArray(input.labels, 'labels') ?? [];
    }
    if (!partial || input.assigneeId !== undefined) {
      if (input.assigneeId === null || input.assigneeId === undefined || input.assigneeId === '') {
        out.assigneeId = null;
      } else {
        const member = members.find(input.assigneeId);
        if (!member) v.issues.push({ field: 'assigneeId', message: '指定的成员不存在' });
        out.assigneeId = member ? member.id : null;
      }
    }
    // 开始 / 完成时间允许手工修正（传空表示清空）
    if (!partial || input.startedAt !== undefined) {
      out.startedAt = v.dateTimeString(input.startedAt, 'startedAt', { optional: true });
    }
    if (!partial || input.completedAt !== undefined) {
      out.completedAt = v.dateTimeString(input.completedAt, 'completedAt', { optional: true });
    }
    return out;
  }

  return {
    list({ status, assigneeId, priority, type, q } = {}) {
      return tasks.list({ status, assigneeId, priority, type, q });
    },

    get(id) {
      return mustFind(id);
    },

    async create(input, actorId = null) {
      const v = createValidator();
      const data = validateBase(v, input, { partial: false });
      v.throwIfInvalid();

      return transaction(() => {
        const now = new Date().toISOString();
        const seq = tasks.nextKeyNumber();
        const currentProject = project.get();
        const done = isDoneColumn(data.status);
        const task = {
          id: `t_${randomUUID().slice(0, 8)}`,
          key: `${currentProject.key}-${seq}`,
          projectId: currentProject.id,
          title: data.title,
          description: data.description ?? '',
          status: data.status,
          type: data.type,
          priority: data.priority,
          assigneeId: data.assigneeId ?? null,
          reporterId: actorId,
          labels: data.labels ?? [],
          difficulty: data.difficulty ?? null,
          dueDate: data.dueDate ?? null,
          subtasks: [],
          order: tasks.countInColumn(data.status),
          createdAt: now,
          updatedAt: now,
          startedAt: startTimestampFor(data.status),
          completedAt: done ? now : null,
          history: [
            { at: now, field: 'created', from: null, to: data.status, actorId: actorId ?? null },
          ],
        };
        const created = tasks.insert(task);
        record(created, {
          type: 'created',
          message: `${actorName(actorId)} 创建了${typeName(created.type)}`,
          actorId,
        });
        logger.info('任务已创建', { taskId: created.id, key: created.key, status: created.status });
        return created;
      });
    },

    async update(id, patch, actorId = null) {
      const task = mustFind(id);
      const v = createValidator();
      const data = validateBase(v, patch, { partial: true });
      v.throwIfInvalid();

      // 手工修正时间时做跨字段校验：不能填未来时间，完成不能早于开始
      const nextStarted = data.startedAt !== undefined ? data.startedAt : task.startedAt;
      const nextCompleted = data.completedAt !== undefined ? data.completedAt : task.completedAt;
      const ceiling = Date.now() + 60_000;
      if (nextStarted && new Date(nextStarted).getTime() > ceiling) {
        throw badRequest('开始时间不能晚于当前时间', [
          { field: 'startedAt', message: '请填写已经发生的时间' },
        ]);
      }
      if (nextCompleted && new Date(nextCompleted).getTime() > ceiling) {
        throw badRequest('完成时间不能晚于当前时间', [
          { field: 'completedAt', message: '请填写已经发生的时间' },
        ]);
      }
      if (nextStarted && nextCompleted && new Date(nextCompleted) < new Date(nextStarted)) {
        throw badRequest('完成时间不能早于开始时间', [
          { field: 'completedAt', message: '应晚于开始时间' },
        ]);
      }

      return transaction(() => {
        const now = new Date().toISOString();
        const changes = [];

        if (data.status !== undefined && data.status !== task.status) {
          const from = task.status;
          const done = isDoneColumn(data.status);
          const startedAt = task.startedAt ?? startTimestampFor(data.status);
          tasks.placeAt(task.id, data.status, Number.MAX_SAFE_INTEGER);
          tasks.update(id, {
            updatedAt: now,
            completedAt: done ? now : null,
            ...(startedAt && startedAt !== task.startedAt ? { startedAt } : {}),
          });
          tasks.addHistory(id, { at: now, field: 'status', from, to: data.status, actorId });
          changes.push({
            type: 'status',
            message: `${actorName(actorId)} 将状态由「${statusName(from)}」变更为「${statusName(data.status)}」`,
          });
        }

        const fields = {};
        for (const field of ['title', 'description', 'type', 'priority', 'difficulty', 'dueDate', 'assigneeId']) {
          if (data[field] === undefined) continue;
          const before = task[field];
          const after = data[field];
          if (before === after) continue;
          fields[field] = after;
          if (field === 'priority') {
            changes.push({
              type: 'update',
              message: `${actorName(actorId)} 将优先级调整为「${priorityName(after)}」`,
            });
          } else if (field === 'difficulty') {
            tasks.addHistory(id, { at: now, field: 'difficulty', from: before ?? null, to: after ?? null, actorId });
            changes.push({
              type: 'update',
              message: `${actorName(actorId)} 将难度调整为「${difficultyName(after)}」`,
            });
          } else if (field === 'assigneeId') {
            tasks.addHistory(id, { at: now, field: 'assignee', from: before ?? null, to: after ?? null, actorId });
            changes.push({
              type: 'assign',
              message: after
                ? `${actorName(actorId)} 指派给 ${actorName(after)}`
                : `${actorName(actorId)} 取消了任务指派`,
            });
          } else if (field === 'title') {
            changes.push({ type: 'update', message: `${actorName(actorId)} 更新了标题` });
          }
        }
        if (Object.keys(fields).length) tasks.update(id, { ...fields, updatedAt: now });

        // 开始 / 完成时间的手工修正（写入历史，抽屉里能追溯改了什么）
        const timeFields = [
          ['startedAt', '开始时间'],
          ['completedAt', '完成时间'],
        ];
        const timePatch = {};
        for (const [field, label] of timeFields) {
          if (data[field] === undefined || data[field] === task[field]) continue;
          timePatch[field] = data[field];
          tasks.addHistory(id, {
            at: now,
            field,
            from: task[field] ?? null,
            to: data[field],
            actorId,
          });
          changes.push({
            type: 'update',
            message: `${actorName(actorId)} 将${label}调整为 ${formatLocal(data[field])}`,
          });
        }
        if (Object.keys(timePatch).length) tasks.update(id, { ...timePatch, updatedAt: now });

        if (data.labels !== undefined && data.labels.join('|') !== task.labels.join('|')) {
          tasks.setLabels(id, data.labels);
          tasks.update(id, { updatedAt: now });
        }

        const updated = mustFind(id);
        for (const change of changes) record(updated, { ...change, actorId });
        return updated;
      });
    },

    async move(id, { status, index }, actorId = null) {
      const task = mustFind(id);
      const v = createValidator();
      const nextStatus = v.oneOf(status, 'status', columns.ids(), { optional: false });
      const nextIndex = v.integer(index, 'index', { min: 0, max: 10000, optional: true });
      v.throwIfInvalid();

      return transaction(() => {
        const from = task.status;
        const now = new Date().toISOString();
        const startedAt = from !== nextStatus ? task.startedAt ?? startTimestampFor(nextStatus) : task.startedAt;
        tasks.placeAt(id, nextStatus, nextIndex ?? Number.MAX_SAFE_INTEGER);
        tasks.update(id, {
          updatedAt: now,
          ...(from !== nextStatus ? { completedAt: isDoneColumn(nextStatus) ? now : null } : {}),
          ...(startedAt && startedAt !== task.startedAt ? { startedAt } : {}),
        });

        if (from !== nextStatus) {
          tasks.addHistory(id, { at: now, field: 'status', from, to: nextStatus, actorId });
          const moved = mustFind(id);
          record(moved, {
            type: 'status',
            message: `${actorName(actorId)} 将状态由「${statusName(from)}」变更为「${statusName(nextStatus)}」`,
            actorId,
          });
        }
        return mustFind(id);
      });
    },

    async remove(id, actorId = null) {
      const task = mustFind(id);
      return transaction(() => {
        tasks.remove(id);
        activity.removeByTask(id);
        record(
          { ...task, id: `deleted_${task.id}` },
          { type: 'deleted', message: `${actorName(actorId)} 删除了任务 ${task.key}`, actorId },
        );
        logger.info('任务已删除', { taskId: id, key: task.key });
        return { id };
      });
    },

    async addSubtask(id, title, actorId = null) {
      const task = mustFind(id);
      const v = createValidator();
      const clean = v.requiredString(title, 'title', { max: 120 });
      v.throwIfInvalid();
      if (task.subtasks.length >= MAX_SUBTASKS) {
        throw badRequest(`单个任务最多 ${MAX_SUBTASKS} 个子项`);
      }
      tasks.insertSubtask(id, { id: `st_${randomUUID().slice(0, 8)}`, title: clean, done: false });
      tasks.update(id, { updatedAt: new Date().toISOString() });
      record(task, { type: 'subtask', message: `${actorName(actorId)} 新增子项：${clean}`, actorId });
      return mustFind(id);
    },

    async toggleSubtask(id, subtaskId) {
      mustFind(id);
      const result = tasks.toggleSubtask(id, subtaskId);
      if (!result) throw notFound('子项不存在');
      tasks.update(id, { updatedAt: new Date().toISOString() });
      return mustFind(id);
    },

    async removeSubtask(id, subtaskId) {
      mustFind(id);
      const removed = tasks.removeSubtask(id, subtaskId);
      if (!removed) throw notFound('子项不存在');
      tasks.update(id, { updatedAt: new Date().toISOString() });
      return mustFind(id);
    },
  };
}
