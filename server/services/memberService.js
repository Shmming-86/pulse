import { randomUUID } from 'node:crypto';
import { difficultyWeight, MEMBER_COLORS } from '../domain.js';
import { badRequest, conflict, createValidator, notFound } from '../errors.js';

const NAME_MAX = 16;
const ROLE_MAX = 24;
const EMAIL_MAX = 80;
const DEFAULT_ROLE = '团队成员';
const DEFAULT_COLOR = MEMBER_COLORS[0];

const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function createMemberService({ members, tasks, columns, activity, transaction, logger }) {
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
      type: 'member',
      message,
    });
  }

  function mustFind(id) {
    const member = members.find(id);
    if (!member) throw notFound(`成员 ${id} 不存在`);
    return member;
  }

  /** 成员负载快照：完成列/开始列来自数据库，不假设固定状态 */
  function statsOf(memberId) {
    const doneColumnId = columns.doneColumn()?.id ?? null;
    const startColumnId = columns.startColumn()?.id ?? null;
    const own = tasks.list({ assigneeId: memberId });
    const open = own.filter((task) => task.status !== doneColumnId);
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: own.length,
      open: open.length,
      inProgress: open.filter((task) => task.status === startColumnId).length,
      done: own.filter((task) => task.status === doneColumnId).length,
      points: open.reduce((sum, task) => sum + difficultyWeight(task.difficulty), 0),
      overdue: open.filter((task) => task.dueDate && task.dueDate < today).length,
    };
  }

  function present(member) {
    return { ...member, stats: statsOf(member.id) };
  }

  function validate(v, input, { partial }) {
    const out = {};
    if (!partial || input.name !== undefined) {
      out.name = v.requiredString(input.name, 'name', { max: NAME_MAX });
    }
    if (!partial || input.role !== undefined) {
      out.role = v.optionalString(input.role, 'role', { max: ROLE_MAX }) || DEFAULT_ROLE;
    }
    if (!partial || input.email !== undefined) {
      const email = v.optionalString(input.email, 'email', { max: EMAIL_MAX });
      if (email) {
        if (!isEmail(email)) v.issues.push({ field: 'email', message: '邮箱格式不正确' });
        out.email = email;
      } else {
        out.email = '';
      }
    }
    if (!partial || input.color !== undefined) {
      if (input.color === undefined || input.color === null || input.color === '') {
        out.color = DEFAULT_COLOR;
      } else if (!isHexColor(input.color)) {
        v.issues.push({ field: 'color', message: '颜色格式应为 #RRGGBB' });
        out.color = DEFAULT_COLOR;
      } else {
        out.color = input.color.toLowerCase();
      }
    }
    return out;
  }

  return {
    list() {
      return members.list().map(present);
    },

    get(id) {
      return present(mustFind(id));
    },

    async create(input, actorId = null) {
      const v = createValidator();
      const data = validate(v, input ?? {}, { partial: false });
      if (data.name && members.findByName(data.name)) {
        v.issues.push({ field: 'name', message: '已存在同名成员' });
      }
      v.throwIfInvalid();

      const member = members.insert({
        id: `m_${randomUUID().slice(0, 8)}`,
        name: data.name,
        role: data.role,
        email: data.email,
        color: data.color,
        createdAt: new Date().toISOString(),
      });
      record({
        message: `${actorName(actorId)} 添加了成员 ${member.name}（${member.role}）`,
        actorId,
      });
      logger.info('成员已创建', { memberId: member.id, name: member.name });
      return present(member);
    },

    async update(id, patch = {}, actorId = null) {
      const member = mustFind(id);
      const v = createValidator();
      const data = validate(v, patch ?? {}, { partial: true });
      if (data.name && members.findByName(data.name, id)) {
        v.issues.push({ field: 'name', message: '已存在同名成员' });
      }
      v.throwIfInvalid();

      const changes = [];
      for (const field of ['name', 'role', 'email', 'color']) {
        if (data[field] === undefined || data[field] === member[field]) continue;
        const before = member[field];
        if (field === 'name') changes.push(`姓名由「${before}」改为「${data.name}」`);
        else if (field === 'role') changes.push(`角色调整为「${data.role}」`);
        else if (field === 'email') changes.push(data.email ? '更新了联系邮箱' : '清空了联系邮箱');
      }

      const updated = members.update(id, data);
      if (changes.length) {
        record({ message: `${actorName(actorId)} ${changes.join('，')}`, actorId });
        logger.info('成员已更新', { memberId: id, changes });
      }
      return present(updated);
    },

    /**
     * 删除成员：名下任务按 reassignTo 转交或置为未指派，
     * 每个受影响任务都写入指派历史，分析口径与任务时间线保持一致。
     */
    async remove(id, { reassignTo = null } = {}, actorId = null) {
      const member = mustFind(id);
      if (members.count() <= 1) throw badRequest('至少需要保留一名成员');

      let target = null;
      if (reassignTo) {
        if (reassignTo === id) throw badRequest('不能把任务转交给被删除的成员');
        target = members.find(reassignTo);
        if (!target) throw conflict('转交对象不存在', [{ field: 'reassignTo', message: '成员不存在' }]);
      }

      return transaction(() => {
        const now = new Date().toISOString();
        const own = tasks.list({ assigneeId: id });
        members.reassignTasks(id, target?.id ?? null, now);
        for (const task of own) {
          tasks.addHistory(task.id, {
            at: now,
            field: 'assignee',
            from: id,
            to: target?.id ?? null,
            actorId: actorId ?? null,
          });
        }
        members.remove(id);

        const tail = own.length
          ? target
            ? `，${own.length} 个任务转交给 ${target.name}`
            : `，${own.length} 个任务已变为未指派`
          : '';
        record({ message: `${actorName(actorId)} 移除了成员 ${member.name}${tail}`, actorId });
        logger.info('成员已删除', { memberId: id, name: member.name, tasks: own.length });
        return { id, reassigned: own.length, to: target?.id ?? null };
      });
    },
  };
}
