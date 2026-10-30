import { DEFAULT_COLUMNS, PROJECT, SEED_DONE_COLUMN } from './domain.js';

/** 固定种子的伪随机数，保证每次初始化示例数据一致，便于对照分析结果 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

const MEMBERS = [
  { id: 'm_lin', name: '林深', role: '产品经理', color: '#5b5bd6' },
  { id: 'm_su', name: '苏禾', role: '产品设计', color: '#c026d3' },
  { id: 'm_chen', name: '陈放', role: '前端工程师', color: '#2563eb' },
  { id: 'm_zhou', name: '周野', role: '后端工程师', color: '#0d9488' },
  { id: 'm_he', name: '何念', role: '测试工程师', color: '#d97706' },
];

const TITLES = [
  ['支持任务批量导入 CSV', 'feature'],
  ['新增迭代里程碑视图', 'feature'],
  ['移动端看板适配', 'feature'],
  ['任务模板与快速创建', 'feature'],
  ['附件上传与在线预览', 'feature'],
  ['拖拽到空列时顺序丢失', 'bug'],
  ['Safari 下抽屉滚动穿透', 'bug'],
  ['筛选条件刷新后未保持', 'bug'],
  ['分析页累计流图在窄屏溢出', 'bug'],
  ['令牌过期后请求未自动重试', 'bug'],
  ['完成率分母包含已归档任务', 'bug'],
  ['看板首屏渲染性能优化', 'improvement'],
  ['统一空态与骨架屏', 'improvement'],
  ['活动流文案精简', 'improvement'],
  ['合并重复的成员查询请求', 'improvement'],
  ['列表视图支持批量改状态', 'improvement'],
  ['编写公开接口文档', 'task'],
  ['补充服务层单元测试', 'task'],
  ['接入前端错误监控', 'task'],
  ['整理发布检查清单', 'task'],
  ['清理未使用的样式变量', 'task'],
  ['搭建持续集成流水线', 'task'],
  ['补充设计系统色彩规范', 'task'],
  ['任务卡片信息层级调整', 'task'],
  ['看板列 WIP 超限提示', 'task'],
  ['周报数据导出为 CSV', 'task'],
  ['新增成员首次使用引导', 'task'],
  ['键盘快捷键与命令面板', 'task'],
  ['任务关联与阻塞标记', 'feature'],
  ['逾期任务提醒策略', 'improvement'],
  ['看板泳道按负责人分组', 'feature'],
  ['活动流按任务聚合展示', 'improvement'],
];

const DESCRIPTION_TEMPLATES = [
  '背景：来自团队周会与客户反馈的高频诉求，当前流程需要人工在多个工具之间同步。\n\n目标：在不增加操作步骤的前提下完成闭环，并保证数据可回溯。\n\n验收标准：\n1. 主流程可在 3 步内完成\n2. 异常场景有明确提示文案\n3. 关键操作写入活动流',
  '问题描述：部分场景下界面状态与后端数据不一致，刷新后才能恢复。\n\n期望行为：操作后立即反映真实状态，失败时给出可恢复的提示。\n\n补充信息：已在最新 Chrome / Safari 复现，影响约一成的日常操作。',
  '这件事会降低长期维护成本，属于技术债清理。\n\n范围：仅调整内部实现与目录结构，对外行为保持不变。\n\n风险：需要回归核心流程，避免影响正在进行的需求。',
  '',
];

const LABEL_GROUPS = [
  ['前端'],
  ['后端'],
  ['设计', '体验'],
  ['性能', '技术债'],
  ['基础设施'],
  ['文档'],
  ['客户反馈', '体验'],
  ['安全'],
];

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function iso(ms) {
  return new Date(ms).toISOString();
}

/**
 * 生产环境的空数据集：只保留项目元信息与一个默认管理员。
 * 之所以保留一名成员，是因为系统要求「至少保留一名成员」，且侧栏需要展示当前操作人。
 */
export function buildEmptyData(now = Date.now()) {
  return {
    version: 1,
    project: { ...PROJECT, name: '团队看板', description: '小团队任务跟踪与效能分析' },
    meta: { nextKey: 1, createdAt: iso(now) },
    members: [
      {
        id: 'm_admin',
        name: '管理员',
        role: '系统管理员',
        email: '',
        color: '#5b5bd6',
        createdAt: iso(now),
      },
    ],
    tasks: [],
    activity: [],
  };
}

/**
 * 生成一份带历史轨迹的示例数据。
 * 历史轨迹（history）是分析页计算周期时间、累计流图的基础。
 */
export function buildSeedData(now = Date.now()) {
  const rand = mulberry32(20261019);
  const tasks = [];
  const activity = [];
  let keySeq = 0;
  let activitySeq = 0;

  const statusPlan = [
    ...Array(12).fill('done'),
    ...Array(7).fill('in_progress'),
    ...Array(3).fill('in_review'),
    ...Array(8).fill('todo'),
  ];

  const orderCounter = Object.fromEntries(DEFAULT_COLUMNS.map((s) => [s.id, 0]));

  TITLES.forEach(([title, type], index) => {
    keySeq += 1;
    const id = `t_${keySeq.toString().padStart(3, '0')}`;
    const key = `${PROJECT.key}-${keySeq}`;
    const status = statusPlan[index % statusPlan.length];
    const createdAt =
      index < 3
        ? now - Math.floor((1.1 + index * 0.5) * DAY)
        : now - Math.floor((2 + rand() * 40) * DAY);
    const assignee = pick(rand, MEMBERS);
    const reporter = rand() > 0.5 ? MEMBERS[0] : pick(rand, MEMBERS);
    const priority = pick(rand, ['urgent', 'high', 'high', 'medium', 'medium', 'medium', 'low']);
    const labels = pick(rand, LABEL_GROUPS);
    const difficulty = pick(rand, ['easy', 'easy', 'normal', 'normal', 'hard', 'xhard']);
    const history = [
      { at: iso(createdAt), field: 'created', from: null, to: 'todo', actorId: reporter.id },
    ];

    let cursor = createdAt;
    let completedAt = null;
    // 前几个任务安排在最近两天完成，让「本周完成」等指标在演示时更有意义
    const scale = index < 3 ? 0.22 : 1;

    if (status !== 'todo') {
      const startAt = cursor + Math.floor((0.5 + rand() * 2) * DAY * scale);
      cursor = Math.min(startAt, now - 3600_000);
      history.push({
        at: iso(cursor),
        field: 'status',
        from: 'todo',
        to: 'in_progress',
        actorId: assignee.id,
      });

      if (status === 'in_review' || status === 'done') {
        cursor = Math.min(cursor + Math.floor((0.5 + rand() * 2.5) * DAY * scale), now - 1800_000);
        history.push({
          at: iso(cursor),
          field: 'status',
          from: 'in_progress',
          to: 'in_review',
          actorId: assignee.id,
        });
      }

      if (status === SEED_DONE_COLUMN) {
        cursor = Math.min(cursor + Math.floor((0.3 + rand() * 2.2) * DAY * scale), now - 600_000);
        history.push({
          at: iso(cursor),
          field: 'status',
          from: 'in_review',
          to: 'done',
          actorId: assignee.id,
        });
        completedAt = iso(cursor);
      }
    }

    let dueDate = null;
    if (status !== 'done') {
      const offsetDays = Math.floor(-4 + rand() * 16);
      dueDate = new Date(now + offsetDays * DAY).toISOString().slice(0, 10);
    }

    const subtaskCount = rand() > 0.6 ? 3 : 0;
    const subtasks = Array.from({ length: subtaskCount }, (_, i) => ({
      id: `st_${keySeq}_${i + 1}`,
      title: pick(rand, ['补充交互细节', '接口联调', '补充测试用例', '更新文档', '设计走查']),
      done: status === 'done' ? true : rand() > 0.55,
    }));

    tasks.push({
      id,
      key,
      projectId: PROJECT.id,
      title,
      description: pick(rand, DESCRIPTION_TEMPLATES),
      status,
      type,
      priority,
      assigneeId: assignee.id,
      reporterId: reporter.id,
      labels,
      difficulty,
      dueDate,
      subtasks,
      order: orderCounter[status]++,
      createdAt: iso(createdAt),
      updatedAt: history.at(-1).at,
      completedAt,
      history,
    });

    for (const entry of history) {
      activitySeq += 1;
      const actor = MEMBERS.find((m) => m.id === entry.actorId) ?? MEMBERS[0];
      const message =
        entry.field === 'created'
          ? `${actor.name} 创建了任务`
          : `${actor.name} 将状态由「${statusName(entry.from)}」变更为「${statusName(entry.to)}」`;
      activity.push({
        id: `a_${activitySeq}`,
        at: entry.at,
        taskId: id,
        taskKey: key,
        taskTitle: title,
        actorId: actor.id,
        type: entry.field === 'created' ? 'created' : 'status',
        message,
      });
    }
  });

  activity.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    version: 1,
    project: PROJECT,
    meta: { nextKey: TITLES.length + 1, createdAt: iso(now) },
    members: MEMBERS,
    tasks,
    activity: activity.slice(0, 120),
  };
}

function statusName(id) {
  return DEFAULT_COLUMNS.find((s) => s.id === id)?.name ?? '未开始';
}
