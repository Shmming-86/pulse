import config from '../config.js';
import { COLUMN_TONES, DIFFICULTIES, LABEL_POOL, MEMBER_COLORS, PRIORITIES, TYPES } from '../domain.js';
import { badRequest } from '../errors.js';

export function registerApiRoutes(
  router,
  { taskService, analyticsService, memberService, columnService, activityRepo, projectRepo, taskRepo, memberRepo },
) {
  router.get('/api/health', () => ({
    status: 'ok',
    version: config.version,
    env: config.env,
    uptime: Math.round(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    storage: 'sqlite',
    tasks: taskRepo.stats().total,
    members: memberRepo.count(),
  }));

  /** 首屏一次性拉取，避免瀑布式请求 */
  router.get('/api/bootstrap', () => ({
    project: projectRepo.get(),
    members: memberService.list(),
    columns: columnService.list(),
    tasks: taskService.list(),
    activity: activityRepo.list(40),
    // 内置标签 + 任务里已经用过的自定义标签（去重、保持顺序）
    labels: [...new Set([...LABEL_POOL, ...taskRepo.distinctLabels()])],
    meta: {
      // statuses 是历史字段名，前端以 columns 为准；两者同源，保留兼容
      statuses: columnService.list(),
      columns: columnService.list(),
      priorities: PRIORITIES,
      difficulties: DIFFICULTIES,
      types: TYPES,
      columnTones: COLUMN_TONES,
      memberColors: MEMBER_COLORS,
      serverTime: new Date().toISOString(),
    },
  }));

  router.get('/api/tasks', ({ query }) =>
    taskService.list({
      status: query.get('status') ?? undefined,
      assigneeId: query.get('assigneeId') ?? undefined,
      priority: query.get('priority') ?? undefined,
      type: query.get('type') ?? undefined,
      q: query.get('q') ?? undefined,
    }),
  );

  router.get('/api/tasks/:id', ({ params }) => taskService.get(params.id));

  router.post('/api/tasks', ({ body, actorId }) => taskService.create(body, actorId));

  router.patch('/api/tasks/:id', ({ params, body, actorId }) =>
    taskService.update(params.id, body, actorId),
  );

  router.post('/api/tasks/:id/move', ({ params, body, actorId }) => {
    if (typeof body !== 'object' || body === null) throw badRequest('请求体不能为空');
    return taskService.move(params.id, { status: body.status, index: body.index }, actorId);
  });

  router.del('/api/tasks/:id', ({ params, actorId }) => taskService.remove(params.id, actorId));

  router.post('/api/tasks/:id/subtasks', ({ params, body, actorId }) =>
    taskService.addSubtask(params.id, body.title, actorId),
  );

  router.patch('/api/tasks/:id/subtasks/:subtaskId', ({ params }) =>
    taskService.toggleSubtask(params.id, params.subtaskId),
  );

  router.del('/api/tasks/:id/subtasks/:subtaskId', ({ params }) =>
    taskService.removeSubtask(params.id, params.subtaskId),
  );

  router.get('/api/analytics', () => analyticsService.overview());

  router.get('/api/activity', ({ query }) => {
    const limit = Number(query.get('limit') ?? 40);
    return activityRepo.list(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 40);
  });

  router.get('/api/members', () => memberService.list());

  router.post('/api/members', ({ body, actorId }) => memberService.create(body, actorId));

  router.patch('/api/members/:id', ({ params, body, actorId }) =>
    memberService.update(params.id, body, actorId),
  );

  router.del('/api/members/:id', ({ params, query, actorId }) =>
    memberService.remove(
      params.id,
      { reassignTo: query.get('reassignTo') || null },
      actorId,
    ),
  );

  /** 看板列：动态新增、修改、排序、删除（删除时任务迁移） */
  router.get('/api/columns', () => columnService.list());

  router.post('/api/columns', ({ body, actorId }) => columnService.create(body, actorId));

  router.patch('/api/columns/:id', ({ params, body, actorId }) =>
    columnService.update(params.id, body, actorId),
  );

  router.post('/api/columns/:id/move', ({ params, body, actorId }) =>
    columnService.move(params.id, body.index, actorId),
  );

  router.del('/api/columns/:id', ({ params, query, actorId }) =>
    columnService.remove(params.id, { moveTo: query.get('moveTo') || null }, actorId),
  );
}
