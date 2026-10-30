import { api, setCurrentUser } from './api.js';

/** 看板默认隐藏「完成时间超过 N 天」的任务，列表视图不受影响 */
export const STALE_DONE_DAYS = 7;
const STALE_PREF_KEY = 'pulse.board.hideStaleDone';

function readHideStalePref() {
  try {
    const raw = window.localStorage.getItem(STALE_PREF_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export const state = {
  project: null,
  members: [],
  tasks: [],
  activity: [],
  labels: [],
  meta: { columns: [], statuses: [], priorities: [], types: [], memberColors: [], columnTones: [] },
  analytics: null,
  analyticsFetchedAt: 0,
  filters: { q: '', assigneeId: '', priority: '', type: '' },
  /** 看板视图专属显示偏好（列表视图始终展示全部任务） */
  boardView: { hideStaleDone: readHideStalePref() },
  view: 'board',
  loading: true,
  offline: false,
  error: null,
  lastSync: null,
  currentUserId: 'm_lin',
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let scheduled = false;
export function emit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const listener of listeners) listener();
  });
}

export function memberById(id) {
  return state.members.find((member) => member.id === id) ?? null;
}

export function taskById(id) {
  return state.tasks.find((task) => task.id === id) ?? null;
}

/** 当前登录成员，删除成员后自动回退到第一位 */
export function currentUser() {
  return memberById(state.currentUserId) ?? state.members[0] ?? null;
}

export function columns() {
  return state.meta.columns ?? state.meta.statuses ?? [];
}

export function doneColumnId() {
  const list = columns();
  return (list.find((column) => column.isDone) ?? list[list.length - 1])?.id ?? null;
}

export function startColumnId() {
  const list = columns();
  return (list.find((column) => column.isStart) ?? list[1] ?? list[0])?.id ?? null;
}

export function isDoneStatus(statusId) {
  return statusId === doneColumnId();
}

/** 新建任务的默认落点：第一列 */
export function firstColumnId() {
  return columns()[0]?.id ?? null;
}

export function openTasksOf(memberId) {
  const doneId = doneColumnId();
  return state.tasks.filter((task) => task.assigneeId === memberId && task.status !== doneId);
}

export function unassignedTasks() {
  return state.tasks.filter((task) => !task.assigneeId);
}

export function statusMeta(id) {
  return state.meta.statuses.find((item) => item.id === id) ?? { id, name: id, wipLimit: null };
}

/** 难度元数据：来自 bootstrap 的 meta.difficulties，未评估返回占位对象 */
export function difficultyMeta(id) {
  return (
    (state.meta.difficulties ?? []).find((item) => item.id === id) ?? {
      id: null,
      name: '未评估',
      color: '#8b93a7',
      weight: 0,
    }
  );
}

/** 难度折算权重（未评估记 0） */
export function difficultyWeight(id) {
  return difficultyMeta(id).weight ?? 0;
}

export function priorityMeta(id) {
  return (
    state.meta.priorities.find((item) => item.id === id) ?? {
      id,
      name: id,
      color: '#8b93a7',
      weight: 0,
    }
  );
}

export function typeMeta(id) {
  return state.meta.types.find((item) => item.id === id) ?? { id, name: id, color: '#8b93a7' };
}

export function filtersActive() {
  const { q, assigneeId, priority, type } = state.filters;
  return Boolean(q || assigneeId || priority || type);
}

export function filteredTasks() {
  const { q, assigneeId, priority, type } = state.filters;
  const needle = q.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (assigneeId && task.assigneeId !== assigneeId) return false;
    if (priority && task.priority !== priority) return false;
    if (type && task.type !== type) return false;
    if (!needle) return true;
    return (
      task.title.toLowerCase().includes(needle) ||
      task.key.toLowerCase().includes(needle) ||
      (task.description ?? '').toLowerCase().includes(needle) ||
      task.labels.some((label) => label.toLowerCase().includes(needle))
    );
  });
}

export function tasksByStatus(statusId) {
  return filteredTasks()
    .filter((task) => task.status === statusId)
    .sort((a, b) => a.order - b.order);
}

export function staleDoneDays() {
  return STALE_DONE_DAYS;
}

/** 完成时间是否已超过 N 天（无 completedAt 的老数据一律视为未超期） */
export function isStaleDone(task, days = STALE_DONE_DAYS) {
  if (!task?.completedAt) return false;
  const at = new Date(task.completedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at > days * 86_400_000;
}

/** 当前因「超过 7 天完成」被看板隐藏的任务 */
export function hiddenStaleTasks() {
  if (!state.boardView.hideStaleDone) return [];
  return filteredTasks().filter((task) => isStaleDone(task));
}

/** 看板可见任务：在通用筛选之上叠加「隐藏超期完成」默认条件 */
export function boardTasks() {
  const list = filteredTasks();
  if (!state.boardView.hideStaleDone) return list;
  return list.filter((task) => !isStaleDone(task));
}

export function boardTasksByStatus(statusId) {
  return boardTasks()
    .filter((task) => task.status === statusId)
    .sort((a, b) => a.order - b.order);
}

/** 某一列的完整任务（不受「隐藏超期完成」影响），用于拖拽落点换算真实序号 */
export function columnAllTasks(statusId) {
  return filteredTasks()
    .filter((task) => task.status === statusId)
    .sort((a, b) => a.order - b.order);
}

export function toggleStaleDone() {
  state.boardView.hideStaleDone = !state.boardView.hideStaleDone;
  try {
    window.localStorage.setItem(STALE_PREF_KEY, state.boardView.hideStaleDone ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
  emit();
}

export function openCount() {
  const doneId = doneColumnId();
  return filteredTasks().filter((task) => task.status !== doneId).length;
}

export function setFilter(key, value) {
  if (!(key in state.filters)) return;
  state.filters[key] = value;
  emit();
}

export function clearFilters() {
  state.filters = { q: '', assigneeId: '', priority: '', type: '' };
  emit();
}

/** 首屏数据：一次请求拿到项目、成员、任务、动态、枚举 */
export async function bootstrap({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    emit();
  }
  try {
    const data = await api.bootstrap();
    state.project = data.project;
    state.members = data.members;
    state.tasks = data.tasks;
    state.activity = data.activity;
    state.labels = data.labels;
    state.meta = data.meta;
    if (!state.meta.columns) state.meta.columns = data.columns ?? data.meta.statuses ?? [];
    if (!state.members.some((member) => member.id === state.currentUserId)) {
      state.currentUserId = state.members[0]?.id ?? '';
    }
    setCurrentUser(state.currentUserId);
    state.offline = false;
    state.error = null;
    state.lastSync = new Date().toISOString();
  } catch (error) {
    state.offline = true;
    state.error = error.message;
  } finally {
    state.loading = false;
    emit();
  }
}

/** 变更后同步任务与活动流，保证列内顺序、活动记录与服务端一致 */
export async function refreshData() {
  const [data, activity] = await Promise.all([api.bootstrap(), api.activity(60)]);
  state.tasks = data.tasks;
  state.members = data.members;
  state.project = data.project;
  state.meta = data.meta;
  state.activity = activity;
  state.analyticsFetchedAt = 0;
  state.lastSync = new Date().toISOString();
  state.offline = false;
  emit();
}

export async function loadAnalytics({ force = false } = {}) {
  if (!force && state.analytics && Date.now() - state.analyticsFetchedAt < 15_000) return;
  try {
    const data = await api.analytics();
    state.analytics = data;
    state.analyticsFetchedAt = Date.now();
    emit();
  } catch (error) {
    state.offline = error.offline === true;
    throw error;
  }
}

export async function createTask(payload) {
  const task = await api.createTask(payload);
  state.tasks.push(task);
  state.analyticsFetchedAt = 0;
  await refreshAfterMutation();
  return task;
}

export async function updateTask(id, patch) {
  const updated = await api.updateTask(id, patch);
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index !== -1) state.tasks[index] = updated;
  state.analyticsFetchedAt = 0;
  await refreshAfterMutation();
  return updated;
}

export async function moveTask(id, status, index) {
  const updated = await api.moveTask(id, { status, index });
  const local = state.tasks.find((task) => task.id === id);
  if (local) Object.assign(local, updated);
  await refreshData();
  return updated;
}

export async function removeTask(id) {
  await api.deleteTask(id);
  state.tasks = state.tasks.filter((task) => task.id !== id);
  state.analyticsFetchedAt = 0;
  await refreshAfterMutation();
}

export async function addSubtask(id, title) {
  const updated = await api.addSubtask(id, title);
  patchLocal(updated);
  return updated;
}

export async function toggleSubtask(id, subtaskId) {
  const updated = await api.toggleSubtask(id, subtaskId);
  patchLocal(updated);
  return updated;
}

export async function removeSubtask(id, subtaskId) {
  const updated = await api.removeSubtask(id, subtaskId);
  patchLocal(updated);
  return updated;
}

function patchLocal(updated) {
  const index = state.tasks.findIndex((task) => task.id === updated.id);
  if (index !== -1) state.tasks[index] = updated;
  emit();
}

export async function createMember(payload) {
  const member = await api.createMember(payload);
  state.members.push(member);
  await refreshAfterMutation();
  return member;
}

export async function updateMember(id, patch) {
  const member = await api.updateMember(id, patch);
  const index = state.members.findIndex((item) => item.id === id);
  if (index !== -1) state.members[index] = member;
  await refreshAfterMutation();
  return member;
}

/** 删除成员：reassignTo 指定任务转交对象，未指定则任务变为未指派 */
export async function removeMember(id, reassignTo = null) {
  const result = await api.deleteMember(id, reassignTo);
  state.members = state.members.filter((member) => member.id !== id);
  if (state.currentUserId === id) {
    state.currentUserId = state.members[0]?.id ?? '';
    setCurrentUser(state.currentUserId);
  }
  if (state.filters.assigneeId === id) state.filters.assigneeId = '';
  await refreshAfterMutation();
  return result;
}

/** 快速切换任务执行人 */
export async function assignTask(id, assigneeId) {
  const task = await updateTask(id, { assigneeId: assigneeId || null });
  return task;
}

async function refreshAfterMutation() {
  const [data, activity] = await Promise.all([api.bootstrap(), api.activity(60)]);
  state.tasks = data.tasks;
  state.members = data.members;
  state.project = data.project;
  state.meta = data.meta;
  state.activity = activity;
  state.analyticsFetchedAt = 0;
  state.lastSync = new Date().toISOString();
  state.offline = false;
  emit();
}

/** 新增看板列 */
export async function createColumn(payload) {
  const column = await api.createColumn(payload);
  await refreshAfterMutation();
  return column;
}

/** 修改看板列（名称/配色/WIP/完成与开始语义） */
export async function updateColumn(id, patch) {
  const column = await api.updateColumn(id, patch);
  await refreshAfterMutation();
  return column;
}

/** 调整列顺序 */
export async function moveColumn(id, index) {
  const list = await api.moveColumn(id, index);
  await refreshAfterMutation();
  return list;
}

/** 删除看板列，moveTo 指定任务迁移目标列 */
export async function removeColumn(id, moveTo) {
  const result = await api.deleteColumn(id, moveTo);
  await refreshAfterMutation();
  return result;
}
