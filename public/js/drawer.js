import {
  addSubtask,
  memberById,
  priorityMeta,
  removeSubtask,
  removeTask,
  state,
  taskById,
  toggleSubtask,
  typeMeta,
  updateTask,
} from './state.js';
import { escapeHtml, formatDateTime, icon, relativeTime } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';

let openId = null;
let onCloseCallback = null;

const drawerEl = () => document.getElementById('drawer');

/** ISO 时间 → datetime-local 输入框的本地时间格式（YYYY-MM-DDTHH:mm） */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** 经过天数：完成则算到完成时间，未完成算到今天 */
function elapsedDays(startIso, endIso = null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round(((end - start) / 86_400_000) * 10) / 10;
}
const backdropEl = () => document.getElementById('drawer-backdrop');

export function isDrawerOpen() {
  return Boolean(openId);
}

export function openTaskDrawer(id, { onClose } = {}) {
  if (!taskById(id)) return;
  openId = id;
  if (onClose) onCloseCallback = onClose;
  ensureBound();
  render();
  const overlay = backdropEl();
  const panel = drawerEl();
  overlay.hidden = false;
  panel.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    panel.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
}

export function closeTaskDrawer() {
  if (!openId) return;
  openId = null;
  const overlay = backdropEl();
  const panel = drawerEl();
  overlay.classList.remove('open');
  panel.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (openId) return;
    overlay.hidden = true;
    panel.hidden = true;
    panel.innerHTML = '';
  }, 240);
  onCloseCallback?.();
  onCloseCallback = null;
}

/** 数据变化后刷新抽屉内容，保留滚动位置 */
export function refreshDrawer() {
  if (!openId) return;
  const body = drawerEl().querySelector('.drawer-body');
  const scrollTop = body?.scrollTop ?? 0;
  render();
  const next = drawerEl().querySelector('.drawer-body');
  if (next) next.scrollTop = scrollTop;
}

function render() {
  const task = taskById(openId);
  if (!task) {
    closeTaskDrawer();
    return;
  }
  const panel = drawerEl();
  const type = typeMeta(task.type);
  const priority = priorityMeta(task.priority);
  const reporter = memberById(task.reporterId);
  const doneSubtasks = task.subtasks.filter((item) => item.done).length;
  const percent = task.subtasks.length ? Math.round((doneSubtasks / task.subtasks.length) * 100) : 0;
  const described = task.description?.trim() ? renderMarkdown(task.description) : '';
  const labelPool = [...new Set([...state.labels, ...task.labels])];

  panel.innerHTML = `<header class="drawer-head">
    <span class="type-mark" style="background:${type.color}">${escapeHtml(type.name.charAt(0))}</span>
    <span class="drawer-key">${escapeHtml(task.key)}</span>
    <span class="chip chip-priority-${priority.id}">${escapeHtml(priority.name)}优先级</span>
    <button class="btn btn-ghost btn-sm" data-act="close" aria-label="关闭">${icon('close', 15)}</button>
  </header>

  <div class="drawer-body">
    <textarea class="d-title" rows="1" data-field="title" maxlength="160">${escapeHtml(task.title)}</textarea>

    <div class="d-props">
      <label for="d-status">状态</label>
      <select id="d-status" data-field="status">
        ${state.meta.statuses
          .map(
            (status) =>
              `<option value="${status.id}" ${status.id === task.status ? 'selected' : ''}>${escapeHtml(
                status.name,
              )}</option>`,
          )
          .join('')}
      </select>

      <label for="d-priority">优先级</label>
      <select id="d-priority" data-field="priority">
        ${state.meta.priorities
          .map(
            (item) =>
              `<option value="${item.id}" ${item.id === task.priority ? 'selected' : ''}>${escapeHtml(
                item.name,
              )}</option>`,
          )
          .join('')}
      </select>

      <label for="d-assignee">负责人</label>
      <select id="d-assignee" data-field="assigneeId">
        <option value="" ${!task.assigneeId ? 'selected' : ''}>未指派</option>
        ${state.members
          .map(
            (member) =>
              `<option value="${member.id}" ${member.id === task.assigneeId ? 'selected' : ''}>${escapeHtml(
                member.name,
              )} · ${escapeHtml(member.role)}</option>`,
          )
          .join('')}
      </select>

      <label for="d-due">截止日期</label>
      <input id="d-due" type="date" data-field="dueDate" value="${task.dueDate ?? ''}" />

      <label for="d-estimate">预估点数</label>
      <input id="d-estimate" type="number" min="0" max="100" step="1" data-field="estimate" value="${
        task.estimate ?? ''
      }" placeholder="未估点" />

      <label for="d-type">类型</label>
      <select id="d-type" data-field="type">
        ${state.meta.types
          .map(
            (item) =>
              `<option value="${item.id}" ${item.id === task.type ? 'selected' : ''}>${escapeHtml(
                item.name,
              )}</option>`,
          )
          .join('')}
      </select>
    </div>

    <section class="d-section">
      <div class="d-section-head">
        <h4>标签</h4>
        <span class="count">${task.labels.length} 个</span>
      </div>
      <div class="label-picker">
        ${labelPool
          .map(
            (label) =>
              `<button class="label-toggle ${task.labels.includes(label) ? 'on' : ''}" data-label="${escapeHtml(
                label,
              )}">${escapeHtml(label)}</button>`,
          )
          .join('')}
        <label class="label-custom">
          <input type="text" maxlength="24" placeholder="+ 自定义标签" data-new-label autocomplete="off" />
        </label>
      </div>
      <p class="md-hint">回车新建标签；点已选标签可移除（最多 8 个）</p>
    </section>

    <section class="d-section">
      <div class="d-section-head">
        <h4>描述</h4>
        <button class="link-btn" data-desc-edit type="button">编辑</button>
      </div>
      <div class="md-body" data-desc-view>${described}</div>
      <p class="md-hint" data-desc-empty ${task.description?.trim() ? 'hidden' : ''}>
        还没有描述，点右上角「编辑」补充，支持 Markdown（**粗体**、\`代码\`、- 列表、[链接](https://example.com)）
      </p>
      <textarea class="d-desc" rows="4" data-field="description" hidden placeholder="支持 Markdown：**粗体**、\`代码\`、- 列表、[链接](https://example.com)">${escapeHtml(
        task.description ?? '',
      )}</textarea>
    </section>

    <section class="d-section">
      <div class="d-section-head">
        <h4>子项</h4>
        <span class="count">${doneSubtasks}/${task.subtasks.length}</span>
      </div>
      ${
        task.subtasks.length
          ? `<div class="progress-line">
              <div class="progress-track"><i style="width:${percent}%"></i></div>
              <span class="progress-text">${percent}%</span>
            </div>`
          : ''
      }
      <div class="sub-list">
        ${task.subtasks
          .map(
            (subtask) => `<div class="sub-item ${subtask.done ? 'done' : ''}">
              <input type="checkbox" data-subtask="${subtask.id}" ${subtask.done ? 'checked' : ''} aria-label="${escapeHtml(
                subtask.title,
              )}" />
              <span>${escapeHtml(subtask.title)}</span>
              <button class="icon-btn" data-remove-subtask="${subtask.id}" title="删除子项">${icon(
                'trash',
                13,
              )}</button>
            </div>`,
          )
          .join('')}
      </div>
      <div class="sub-add">
        <input type="text" data-subtask-input placeholder="添加子项后回车" maxlength="120" />
        <button class="btn btn-sm" data-add-subtask>添加</button>
      </div>
    </section>

    <section class="d-section">
      <div class="d-section-head"><h4>时间信息</h4><span class="count">可直接修改</span></div>
      <div class="time-grid">
        <div><span>创建</span><strong>${escapeHtml(formatDateTime(task.createdAt))}</strong></div>
        <label class="time-edit">
          <span>开始时间</span>
          <input type="datetime-local" data-time="startedAt" value="${toLocalInput(task.startedAt)}" aria-label="开始时间" />
        </label>
        <label class="time-edit">
          <span>完成时间</span>
          <input type="datetime-local" data-time="completedAt" value="${toLocalInput(task.completedAt)}" aria-label="完成时间" />
        </label>
        <div><span>${task.completedAt && task.startedAt ? '周期' : task.startedAt ? '已进行' : '状态'}</span><strong>${
          task.startedAt
            ? `${elapsedDays(task.startedAt, task.completedAt)} 天`
            : '未开始'
        }</strong></div>
      </div>
      <p class="time-hint">留空表示未开始 / 未完成；修改会写入活动记录。</p>
    </section>

    <section class="d-section">
      <div class="d-section-head"><h4>活动记录</h4></div>
      <div class="d-activity">
        ${(task.history ?? [])
          .slice()
          .reverse()
          .map((entry) => {
            const actor = memberById(entry.actorId);
            const fromName = state.meta.statuses.find((s) => s.id === entry.from)?.name ?? entry.from;
            const toName = state.meta.statuses.find((s) => s.id === entry.to)?.name ?? entry.to;
            const text =
              entry.field === 'created'
                ? `${actor?.name ?? '系统'} 创建了任务`
                : entry.field === 'assignee'
                  ? entry.to
                    ? `${actor?.name ?? '系统'} 指派给 ${memberById(entry.to)?.name ?? '未知成员'}`
                    : `${actor?.name ?? '系统'} 取消了指派`
                  : entry.field === 'startedAt'
                    ? `${actor?.name ?? '系统'} 将开始时间设为 ${entry.to ? formatDateTime(entry.to) : '未设置'}`
                    : entry.field === 'completedAt'
                      ? `${actor?.name ?? '系统'} 将完成时间设为 ${entry.to ? formatDateTime(entry.to) : '未设置'}`
                      : `状态由「${fromName}」变更为「${toName}」`;
            return `<div class="act-row">
              <span class="act-dot"></span>
              <div>${escapeHtml(text)}<span class="act-time">${escapeHtml(
                relativeTime(entry.at),
              )}</span></div>
            </div>`;
          })
          .join('')}
      </div>
    </section>
  </div>

  <footer class="d-foot">
    <span>${reporter ? `由 ${escapeHtml(reporter.name)} 创建` : '创建者未知'} · ${escapeHtml(
      formatDateTime(task.createdAt),
    )}</span>
    <span style="margin-left:auto">更新于 ${escapeHtml(relativeTime(task.updatedAt))}</span>
    <button class="btn btn-danger btn-sm" data-act="delete">${icon('trash', 13)}删除</button>
  </footer>`;

  const titleEl = panel.querySelector('.d-title');
  const autoGrow = () => {
    titleEl.style.height = 'auto';
    titleEl.style.height = `${titleEl.scrollHeight}px`;
  };
  autoGrow();
  titleEl.addEventListener('input', autoGrow);
  titleEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      titleEl.blur();
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      titleEl.blur();
    }
  });
}

/** 事件只绑定一次，数据通过 openId 实时查询，避免重复渲染导致监听器叠加 */
function ensureBound() {
  const panel = drawerEl();
  if (panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  panel.addEventListener('click', async (event) => {
    const task = taskById(openId);
    if (!task) return;

    if (event.target.closest('[data-act="close"]')) {
      closeTaskDrawer();
      return;
    }

    if (event.target.closest('[data-act="delete"]')) {
      const confirmed = await confirmDialog({
        title: '删除任务',
        message: `将永久删除 ${task.key}「${task.title}」，此操作不可撤销。`,
        confirmText: '确认删除',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await removeTask(task.id);
        toast('任务已删除');
        closeTaskDrawer();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const labelBtn = event.target.closest('[data-label]');
    if (labelBtn) {
      const label = labelBtn.dataset.label;
      const next = task.labels.includes(label)
        ? task.labels.filter((item) => item !== label)
        : [...task.labels, label];
      try {
        await updateTask(task.id, { labels: next });
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const removeBtn = event.target.closest('[data-remove-subtask]');
    if (removeBtn) {
      try {
        await removeSubtask(task.id, removeBtn.dataset.removeSubtask);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (event.target.closest('[data-add-subtask]')) {
      await submitSubtask(panel, task);
    }
  });

  // 描述：点「编辑」切到源码编辑，失焦后保存并回到预览
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-desc-edit]');
    if (!button) return;
    const view = panel.querySelector('[data-desc-view]');
    const editor = panel.querySelector('.d-desc');
    const empty = panel.querySelector('[data-desc-empty]');
    if (!view || !editor) return;
    view.hidden = true;
    empty?.setAttribute('hidden', '');
    editor.hidden = false;
    editor.style.height = 'auto';
    editor.style.height = `${Math.max(96, editor.scrollHeight)}px`;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    button.textContent = '预览';
  });

  panel.addEventListener('change', async (event) => {
    const task = taskById(openId);
    if (!task) return;

    const checkbox = event.target.closest('input[data-subtask]');
    if (checkbox) {
      try {
        await toggleSubtask(task.id, checkbox.dataset.subtask);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    // 开始 / 完成时间手工修正
    const timeInput = event.target.closest('[data-time]');
    if (timeInput) {
      const key = timeInput.dataset.time;
      const iso = timeInput.value ? new Date(timeInput.value).toISOString() : null;
      if (iso === (task[key] ?? null)) return;
      try {
        await updateTask(task.id, { [key]: iso });
        toast(key === 'startedAt' ? '开始时间已更新' : '完成时间已更新', 'success', 1600);
      } catch (error) {
        toast(error.message, 'error');
        refreshDrawer();
      }
      return;
    }

    const field = event.target.closest('[data-field]');
    if (!field) return;
    const name = field.dataset.field;
    // 标题与描述由 blur 处理，避免 change 与 blur 重复提交
    if (name === 'title' || name === 'description') return;
    let value = field.value;
    if (name === 'estimate') value = value === '' ? null : Number(value);
    if (name === 'assigneeId') value = value === '' ? null : value;
    if (name === 'dueDate') value = value === '' ? null : value;
    if (value === (task[name] ?? '')) return;

    try {
      await updateTask(task.id, { [name]: value });
      if (name === 'status') toast('状态已更新', 'success', 1600);
      if (name === 'assigneeId') {
        toast(value ? `已指派给 ${memberById(value)?.name ?? '成员'}` : '已取消指派', 'success', 1600);
      }
    } catch (error) {
      toast(error.message, 'error');
      refreshDrawer();
    }
  });

  panel.addEventListener('keydown', async (event) => {
    if (event.target.matches?.('[data-subtask-input]') && event.key === 'Enter') {
      event.preventDefault();
      const task = taskById(openId);
      if (task) await submitSubtask(panel, task);
      return;
    }

    // 自定义标签：回车添加；输入框为空时退格移除最后一个标签
    if (event.target.matches?.('[data-new-label]')) {
      const task = taskById(openId);
      if (!task) return;
      const input = event.target;
      if (event.key === 'Enter') {
        event.preventDefault();
        const value = input.value.trim().replace(/\s+/g, ' ').slice(0, 24);
        if (!value) return;
        input.value = '';
        if (task.labels.includes(value)) return;
        if (task.labels.length >= 8) {
          toast('最多 8 个标签', 'error');
          return;
        }
        try {
          await updateTask(task.id, { labels: [...task.labels, value] });
        } catch (error) {
          toast(error.message, 'error');
        }
        return;
      }
      if (event.key === 'Backspace' && !input.value && task.labels.length) {
        try {
          await updateTask(task.id, { labels: task.labels.slice(0, -1) });
        } catch (error) {
          toast(error.message, 'error');
        }
        return;
      }
    }
  });

  panel.addEventListener(
    'blur',
    async (event) => {
      const task = taskById(openId);
      if (!task) return;

      // 自定义标签输完直接点别处：自动保存
      const labelInput = event.target.closest?.('[data-new-label]');
      if (labelInput) {
        const value = labelInput.value.trim().replace(/\s+/g, ' ').slice(0, 24);
        labelInput.value = '';
        if (!value || task.labels.includes(value) || task.labels.length >= 8) return;
        try {
          await updateTask(task.id, { labels: [...task.labels, value] });
        } catch (error) {
          toast(error.message, 'error');
        }
        return;
      }

      const field = event.target.closest?.('[data-field]');
      if (!field) return;
      const name = field.dataset.field;
      if (!['title', 'description'].includes(name)) return;
      const value = field.value.trim();
      if (name === 'title' && !value) {
        field.value = task.title;
        return;
      }
      if (value === (task[name] ?? '')) {
        if (name === 'description') refreshDrawer();
        return;
      }
      try {
        await updateTask(task.id, { [name]: value });
      } catch (error) {
        toast(error.message, 'error');
        refreshDrawer();
        return;
      }
      if (name === 'description') refreshDrawer();
    },
    true,
  );
}

async function submitSubtask(panel, task) {
  const input = panel.querySelector('[data-subtask-input]');
  const title = input?.value.trim();
  if (!title) return;
  try {
    await addSubtask(task.id, title);
    input.value = '';
  } catch (error) {
    toast(error.message, 'error');
  }
}

export function bindDrawerGlobal() {
  backdropEl().addEventListener('click', closeTaskDrawer);
}
