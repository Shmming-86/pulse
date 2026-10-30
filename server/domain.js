/**
 * 领域常量：前后端共享的枚举定义（前端通过 /api/bootstrap 获取同一份描述）。
 * 看板列本身是数据（存 board_columns 表），这里只保留初始化用的默认列定义。
 */

/** 列配色：对应前端 .col-dot.<tone> 的样式 */
export const COLUMN_TONES = [
  { id: 'neutral', name: '中性', color: '#8b93a7' },
  { id: 'active', name: '进行中', color: '#5b5bd6' },
  { id: 'review', name: '评审', color: '#d97706' },
  { id: 'done', name: '完成', color: '#12866f' },
];

export const COLUMN_TONE_IDS = COLUMN_TONES.map((tone) => tone.id);

/**
 * 默认看板列：首次初始化（空库或演示数据）时写入数据库。
 * - isDone：进入该列即视为完成（写入 completedAt）
 * - isStart：首次进入该列的时间用于计算周期时间
 * 默认第一列是新建任务的落点，最后列是完成列。
 */
export const DEFAULT_COLUMNS = [
  { id: 'todo', name: '待处理', tone: 'neutral', wipLimit: null, isDone: false, isStart: false },
  { id: 'in_progress', name: '进行中', tone: 'active', wipLimit: 4, isDone: false, isStart: true },
  { id: 'in_review', name: '评审中', tone: 'review', wipLimit: 3, isDone: false, isStart: false },
  { id: 'done', name: '已完成', tone: 'done', wipLimit: null, isDone: true, isStart: false },
];

/** 演示数据使用的完成列 ID */
export const SEED_DONE_COLUMN = 'done';

export const PRIORITIES = [
  { id: 'urgent', name: '紧急', weight: 4, color: '#e5484d' },
  { id: 'high', name: '高', weight: 3, color: '#f76b15' },
  { id: 'medium', name: '中', weight: 2, color: '#3b82f6' },
  { id: 'low', name: '低', weight: 1, color: '#8b93a7' },
];

export const PRIORITY_IDS = PRIORITIES.map((p) => p.id);

export const TYPES = [
  { id: 'task', name: '任务', color: '#5b5bd6' },
  { id: 'feature', name: '需求', color: '#8e4ec6' },
  { id: 'bug', name: '缺陷', color: '#e5484d' },
  { id: 'improvement', name: '优化', color: '#0d9488' },
];

export const TYPE_IDS = TYPES.map((t) => t.id);

/**
 * 任务难易程度：替代原先的自由数字「点数」。
 * weight 是折算系数，用于在制工作量、成员负载与周度统计（越大越重）。
 */
export const DIFFICULTIES = [
  { id: 'easy', name: '简单', weight: 1, color: '#12866f' },
  { id: 'normal', name: '一般', weight: 2, color: '#3b82f6' },
  { id: 'hard', name: '较难', weight: 3, color: '#d97706' },
  { id: 'xhard', name: '困难', weight: 5, color: '#e5484d' },
];

export const DIFFICULTY_IDS = DIFFICULTIES.map((d) => d.id);

/** 难度 → 折算权重（未评估记 0） */
export const difficultyWeight = (id) => DIFFICULTIES.find((d) => d.id === id)?.weight ?? 0;

export const LABEL_POOL = [
  '前端',
  '后端',
  '设计',
  '性能',
  '体验',
  '基础设施',
  '文档',
  '技术债',
  '客户反馈',
  '安全',
];

/** 成员头像可选配色，前后端共用（前端渲染色板，后端校验取值） */
export const MEMBER_COLORS = [
  '#5b5bd6',
  '#2563eb',
  '#0d9488',
  '#12866f',
  '#d97706',
  '#e5484d',
  '#c026d3',
  '#7c3aed',
  '#0891b2',
  '#475569',
];

export const PROJECT = {
  id: 'pulse',
  key: 'PLS',
  name: 'Pulse 看板',
  description: '小团队任务跟踪与效能分析',
};
