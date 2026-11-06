import {
  addSubtask,
  difficultyMeta,
  memberById,
  priorityMeta,
  removeSubtask,
  removeTask,
  state,
  subscribe,
  taskById,
  toggleSubtask,
  typeMeta,
  updateTask,
} from './state.js';
import { escapeHtml, formatDateTime, formatHours, hoursInfo, icon, relativeTime, typeIconName } from './utils.js';
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
  // render 发生在 hidden 状态时 scrollHeight 测出 0，这里显示后必须重新测一次
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    panel.classList.add('open');
    growTitle(panel);
  });
  document.body.style.overflow = 'hidden';
}

/**
 * 关闭前把还在输入框里、尚未失焦的文本改动落库。
 * 否则用户打完备注直接按 Esc / 点遮罩，内容会因为 blur 处理器在关闭后查不到任务而丢失。
 */
function flushPendingEdits() {
  const task = openId ? taskById(openId) : null;
  if (!task) return;
  const panel = drawerEl();
  for (const field of ['title', 'description', 'note']) {
    const input = panel.querySelector(`[data-field="${field}"]`);
    if (!input || input.hidden) continue;
    const value = input.value.trim();
    if (field === 'title' && !value) continue;
    if (value === (task[field] ?? '')) continue;
    updateTask(task.id, { [field]: value }).catch(() => {});
  }
}

export function closeTaskDrawer() {
  if (!openId) return;
  flushPendingEdits();
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

/** 把标题输入框高度调整为内容高度；抽屉隐藏时测不到高度，由 openTaskDrawer 显示后再补一次 */
function growTitle(panel) {
  const titleEl = panel.querySelector('.d-title');
  if (!titleEl) return;
  titleEl.style.height = 'auto';
  const h = titleEl.scrollHeight;
  if (h > 0) titleEl.style.height = `${h}px`;
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
  const noteText = task.note ?? '';
  const hours = hoursInfo(task);
  const hoursPercent =
    hours && hours.est ? Math.min(100, Math.round(((hours.act ?? 0) / hours.est) * 100)) : 0;
  const hoursHeadText = hours
    ? hours.act !== null && hours.est !== null
      ? `实际 ${formatHours(hours.act)} / 预估 ${formatHours(hours.est)} 小时`
      : hours.act !== null
        ? `实际 ${formatHours(hours.act)} 小时`
        : `预估 ${formatHours(hours.est)} 小时`
    : '未填写';

  panel.innerHTML = `<header class="drawer-head">
    <span class="card-type drawer-type" style="color:${type.color};background:${type.color}18" title="任务类型：${escapeHtml(
      type.name,
    )}">${icon(typeIconName(type.id), 13)}<span>${escapeHtml(type.name)}</span></span>
    <span class="drawer-key">${escapeHtml(task.key)}</span>
    <span class="drawer-task-name" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
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

      <label for="d-difficulty">难易程度</label>
      <select id="d-difficulty" data-field="difficulty">
        <option value="" ${task.difficulty ? '' : 'selected'}>未评估</option>
        ${(state.meta.difficulties ?? [])
          .map(
            (item) =>
              `<option value="${item.id}" ${
                item.id === task.difficulty ? 'selected' : ''
              }>${escapeHtml(item.name)}</option>`,
          )
          .join('')}
      </select>

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
        <h4>备注</h4>
        <span class="count" data-note-count>${noteText.trim() ? `${noteText.trim().length} 字` : '未填写'}</span>
      </div>
      <textarea class="d-note" rows="3" maxlength="2000" data-field="note" placeholder="记录任务相关情况：背景、阻塞、依赖、决策、验收要点…">${escapeHtml(
        noteText,
      )}</textarea>
      <p class="md-hint">失焦自动保存 · 纯文本，支持多行（最多 2000 字）</p>
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
      <div class="d-section-head">
        <h4>工时</h4>
        <span class="count">${escapeHtml(hoursHeadText)}</span>
      </div>
      <div class="hours-grid">
        <label class="hours-cell">
          <span>预估工时（小时）</span>
          <input type="number" min="0" max="999" step="0.5" inputmode="decimal"
            data-field="estimatedHours" value="${task.estimatedHours ?? ''}"
            placeholder="未填写" aria-label="预估工时（小时）" />
        </label>
        <label class="hours-cell">
          <span>实际工时（小时）</span>
          <input type="number" min="0" max="999" step="0.5" inputmode="decimal"
            data-field="actualHours" value="${task.actualHours ?? ''}"
            placeholder="未填写" aria-label="实际工时（小时）" />
        </label>
      </div>
      ${
        hours && hours.est !== null
          ? `<div class="hours-bar ${hours.over ? 'over' : ''}">
              <div class="hours-track"><i style="width:${hoursPercent}%"></i></div>
              <span class="hours-text">${
                hours.act === null
                  ? '尚未记录实际工时'
                  : hours.diff === 0
                    ? '与预估持平'
                    : hours.diff > 0
                      ? `超出 ${formatHours(hours.diff)} 小时`
                      : `比预估少 ${formatHours(-hours.diff)} 小时`
              }</span>
            </div>`
          : hours
            ? `<p class="hours-note">已记录实际 ${formatHours(hours.act)} 小时，补齐预估工时后可直接看偏差。</p>`
            : '<p class="hours-note">填写预估与实际工时，便于评估投入与复盘偏差。</p>'
      }
      <p class="time-hint">单位小时，可填 0.5 的倍数；留空表示未填写，保存后写入活动记录。</p>
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
                      : entry.field === 'difficulty'
                        ? `${actor?.name ?? '系统'} 将难度调整为「${difficultyMeta(entry.to).name}」`
                        : entry.field === 'estimatedHours' || entry.field === 'actualHours'
                          ? `${actor?.name ?? '系统'} 将${
                              entry.field === 'estimatedHours' ? '预估工时' : '实际工时'
                            }调整为 ${entry.to === null ? '未填写' : `${formatHours(entry.to)} 小时`}`
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
  const autoGrow = () => growTitle(panel);
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

  // 状态变化（本端改名 / 其他端同步 / 轮询刷新）时，同步顶栏的任务名称：
  // 只更新文本，不整块重绘，避免打断正在编辑的标题输入框
  if (panel.dataset.nameSynced !== '1') {
    panel.dataset.nameSynced = '1';
    subscribe(() => {
      if (!openId) return;
      const task = taskById(openId);
      const nameEl = panel.querySelector('.drawer-task-name');
      if (!task || !nameEl) return;
      if (nameEl.textContent !== task.title) {
        nameEl.textContent = task.title;
        nameEl.title = task.title;
      }
      const titleEl = panel.querySelector('.d-title');
      if (titleEl && document.activeElement !== titleEl && titleEl.value !== task.title) {
        titleEl.value = task.title;
      }
    });
  }

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

  // 备注：输入时实时更新字数（落库仍在失焦时进行）
  panel.addEventListener('input', (event) => {
    if (!event.target.matches?.('[data-field="note"]')) return;
    const count = panel.querySelector('[data-note-count]');
    if (!count) return;
    const length = event.target.value.trim().length;
    count.textContent = length ? `${length} 字` : '未填写';
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

    // 工时：单位小时，允许一位小数；留空表示清空（与「0 小时」区分）
    if (name === 'estimatedHours' || name === 'actualHours') {
      const raw = field.value.trim();
      const next = raw === '' ? null : Math.round(Number(raw) * 10) / 10;
      if (raw !== '' && (!Number.isFinite(next) || next < 0 || next > 999)) {
        toast('工时需为 0~999 之间的数字', 'error');
        refreshDrawer();
        return;
      }
      if (next === (task[name] ?? null)) return;
      try {
        await updateTask(task.id, { [name]: next });
        toast(name === 'estimatedHours' ? '预估工时已更新' : '实际工时已更新', 'success', 1600);
      } catch (error) {
        toast(error.message, 'error');
        refreshDrawer();
      }
      return;
    }

    // 标题与描述由 blur 处理，避免 change 与 blur 重复提交
    if (name === 'title' || name === 'description' || name === 'note') return;
    let value = field.value;
    if (name === 'difficulty') value = value === '' ? null : value;
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
      if (!['title', 'description', 'note'].includes(name)) return;
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
      // 描述保存后切回预览；备注保存后同步字数与卡片指示
      if (name === 'description' || name === 'note') refreshDrawer();
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
