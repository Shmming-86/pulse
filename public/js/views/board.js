import {
  assignTask,
  boardTasks,
  boardTasksByStatus,
  columns,
  columnAllTasks,
  createTask,
  hiddenStaleTasks,
  isDoneStatus,
  memberById,
  moveColumn,
  moveTask,
  refreshData,
  staleDoneDays,
  statusMeta,
  taskById,
  priorityMeta,
  typeMeta,
} from '../state.js';
import { toast } from '../toast.js';
import { openTaskDrawer } from '../drawer.js';
import { openAssigneePicker } from '../assignee.js';
import { openColumnDeleteDialog, openColumnModal } from '../modal.js';
import { avatarHtml, dueInfo, escapeHtml, icon, typeIconName } from '../utils.js';

let suppressClick = false;
let draggedId = null;
let menuEl = null;
let menuCleanup = null;

function cardHtml(task) {
  const priority = priorityMeta(task.priority);
  const type = typeMeta(task.type);
  const member = memberById(task.assigneeId);
  const due = dueInfo(task.dueDate, isDoneStatus(task.status));
  const doneSubtasks = task.subtasks.filter((item) => item.done).length;

  return `<article class="card" draggable="true" data-task-id="${task.id}">
    <div class="card-top">
      <span class="card-type" style="color:${type.color};background:${type.color}18" title="任务类型：${escapeHtml(
        type.name,
      )}">${icon(typeIconName(type.id), 12)}<span>${escapeHtml(type.name)}</span></span>
      <span class="card-key">${escapeHtml(task.key)}</span>
      <button class="card-avatar" data-assignee-btn="${task.id}" title="切换执行人：${escapeHtml(
        member ? `${member.name} · ${member.role}` : '未指派',
      )}" aria-label="切换执行人">${avatarHtml(member)}</button>
    </div>
    <div class="card-title">${escapeHtml(task.title)}</div>
    ${
      task.labels.length
        ? `<div class="card-labels">${task.labels
            .map((label) => `<span class="chip chip-label">${escapeHtml(label)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="card-meta">
      <span class="chip chip-priority-${priority.id}"><i class="chip-dot" style="background:${
        priority.color
      }"></i>${escapeHtml(priority.name)}</span>
      ${
        due
          ? `<span class="${due.cls}">${icon('calendar', 10)}${escapeHtml(due.text)}</span>`
          : ''
      }
      <span class="meta-right">
        ${
          task.subtasks.length
            ? `<span class="sub-progress" title="子项完成度">${icon('subtask', 11)}${doneSubtasks}/${
                task.subtasks.length
              }</span>`
            : ''
        }
        ${task.estimate ? `<span class="points" title="预估点数">${task.estimate}</span>` : ''}
      </span>
    </div>
  </article>`;
}

function columnHtml(column) {
  const tasks = boardTasksByStatus(column.id);
  const hidden = column.isDone ? hiddenStaleTasks().filter((task) => task.status === column.id).length : 0;
  const over = column.wipLimit && tasks.length > column.wipLimit;
  return `<section class="column" data-status="${column.id}">
    <header class="col-head">
      <span class="col-dot ${column.tone}"></span>
      <span class="col-name" title="${column.isDone ? '完成列' : column.isStart ? '开始列' : ''}">${escapeHtml(
        column.name,
      )}${column.isDone ? '<i class="col-flag" title="完成列">✓</i>' : ''}</span>
      <span class="col-count">${tasks.length}</span>
      ${column.wipLimit ? `<span class="wip ${over ? 'over' : ''}" title="在制品上限">${tasks.length}/${column.wipLimit}</span>` : ''}
      <button class="col-add" data-add="${column.id}" title="在此列新建任务" aria-label="在${escapeHtml(
        column.name,
      )}新建任务">${icon('plus', 14)}</button>
      <button class="col-menu-btn" data-col-menu="${column.id}" title="列设置" aria-label="设置${escapeHtml(
        column.name,
      )}">${icon('more', 14)}</button>
    </header>
    <div class="card-list" data-status="${column.id}">
      ${tasks.map(cardHtml).join('')}
    </div>
    ${tasks.length === 0 ? '<div class="col-empty">暂无任务</div>' : ''}
    ${
      hidden
        ? `<div class="col-hidden-note" title="完成超过 ${staleDoneDays()} 天的任务默认不在看板展示">已归档 ${hidden} 条 · <a href="#/list">列表查看</a></div>`
        : ''
    }
    <div class="col-foot">
      <button class="add-inline" data-add="${column.id}">${icon('plus', 13)}添加任务</button>
    </div>
  </section>`;
}

function addColumnTileHtml() {
  return `<button class="column-add-tile" data-add-column title="新增看板列">
    ${icon('plus', 16)}<span>添加列</span>
  </button>`;
}

export function renderBoard(root) {
  const list = columns();
  const total = boardTasks().length;
  const hidden = hiddenStaleTasks().length;
  root.innerHTML = `<div class="board">${list.map(columnHtml).join('')}${addColumnTileHtml()}</div>`;
  if (total === 0) {
    root.querySelector('.board').insertAdjacentHTML(
      'beforeend',
      `<div class="empty-state" style="align-self:center;flex:1">
        <h3>没有匹配的任务</h3>
        <p>${
          hidden
            ? `看板已隐藏 ${hidden} 条完成超过 ${staleDoneDays()} 天的任务，<a href="#/list">去列表查看</a>`
            : '调整筛选条件，或新建一个任务'
        }</p>
      </div>`,
    );
  }
  bind(root);
}

/** 关闭列设置菜单（点击外部、Esc 都会关闭） */
export function closeColumnMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  menuCleanup?.();
  menuCleanup = null;
}

function openColumnMenu(anchor, column) {
  closeColumnMenu();
  const list = columns();
  const index = list.findIndex((item) => item.id === column.id);
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'column-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="column-menu-head">${escapeHtml(column.name)}</div>
    <button class="column-menu-item" data-action="edit" role="menuitem">${icon('edit', 13)}编辑列</button>
    <button class="column-menu-item" data-action="left" role="menuitem" ${
      index <= 0 ? 'disabled' : ''
    }>◀ 左移</button>
    <button class="column-menu-item" data-action="right" role="menuitem" ${
      index >= list.length - 1 ? 'disabled' : ''
    }>右移 ▶</button>
    <div class="column-menu-sep"></div>
    <button class="column-menu-item danger" data-action="delete" role="menuitem">${icon('trash', 13)}删除列</button>`;
  document.body.appendChild(menu);
  menuEl = menu;

  const top =
    rect.bottom + 6 + menu.offsetHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - menu.offsetHeight - 6)
      : rect.bottom + 6;
  const left = Math.min(Math.max(8, rect.right - menu.offsetWidth), window.innerWidth - 8 - menu.offsetWidth);
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;

  const onPointer = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) closeColumnMenu();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeColumnMenu();
    }
  };
  setTimeout(() => {
    if (!menuEl) return;
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
  };

  menu.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    closeColumnMenu();
    if (action === 'edit') {
      openColumnModal({ column });
      return;
    }
    if (action === 'delete') {
      openColumnDeleteDialog({ column });
      return;
    }
    try {
      await moveColumn(column.id, action === 'left' ? index - 1 : index + 1);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function bind(root) {
  if (root.dataset.boardBound !== '1') {
    root.dataset.boardBound = '1';

    root.addEventListener('click', async (event) => {
      const assignBtn = event.target.closest('[data-assignee-btn]');
      if (assignBtn) {
        event.stopPropagation();
        const task = taskById(assignBtn.dataset.assigneeBtn);
        if (!task) return;
        openAssigneePicker({
          anchor: assignBtn,
          task,
          onPick: async (value) => {
            try {
              await assignTask(task.id, value);
              const member = value ? memberById(value) : null;
              toast(member ? `已指派给 ${member.name}` : '已取消指派', 'success', 1800);
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        });
        return;
      }

      const menuBtn = event.target.closest('[data-col-menu]');
      if (menuBtn) {
        event.stopPropagation();
        const column = columns().find((item) => item.id === menuBtn.dataset.colMenu);
        if (column) openColumnMenu(menuBtn, column);
        return;
      }

      if (event.target.closest('[data-add-column]')) {
        openColumnModal();
        return;
      }

      const addButton = event.target.closest('[data-add]');
      if (addButton) {
        openComposer(addButton.closest('.column'));
        return;
      }

      const card = event.target.closest('.card');
      if (card && !suppressClick) {
        openTaskDrawer(card.dataset.taskId);
      }
    });

    root.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      draggedId = card.dataset.taskId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedId);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });

    root.addEventListener('dragend', (event) => {
      const card = event.target.closest('.card');
      card?.classList.remove('dragging');
      root.querySelectorAll('.column').forEach((col) => col.classList.remove('drag-over'));
      draggedId = null;
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
    });
  }

  root.querySelectorAll('.card-list').forEach((list) => {
    list.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!draggedId) return;
      const column = list.closest('.column');
      root.querySelectorAll('.column').forEach((col) => col.classList.remove('drag-over'));
      column.classList.add('drag-over');

      const dragging = list.closest('.board').querySelector('.card.dragging');
      if (!dragging) return;
      const after = findAfterElement(list, event.clientY);
      if (after) list.insertBefore(dragging, after);
      else list.appendChild(dragging);
    });

    list.addEventListener('dragleave', (event) => {
      if (event.target !== list || list.contains(event.relatedTarget)) return;
      list.closest('.column')?.classList.remove('drag-over');
    });

    list.addEventListener('drop', async (event) => {
      event.preventDefault();
      if (!draggedId) return;
      const column = list.closest('.column');
      column.classList.remove('drag-over');
      const dragging = list.querySelector('.card.dragging');
      if (!dragging) return;
      const cards = [...list.querySelectorAll('.card')];
      const visibleIndex = cards.indexOf(dragging);
      const status = list.dataset.status;

      // 看板可能隐藏了超期完成的任务，落点要按「完整列」换算真实序号
      const anchorId = cards[visibleIndex + 1]?.dataset.taskId ?? null;
      const full = columnAllTasks(status);
      const anchorIndex = anchorId ? full.findIndex((item) => item.id === anchorId) : -1;
      const index = anchorIndex >= 0 ? anchorIndex : visibleIndex;

      const task = taskById(draggedId);
      const previousStatus = task?.status;
      try {
        await moveTask(draggedId, status, index);
        if (previousStatus && previousStatus !== status) {
          const name = statusMeta(status).name;
          toast(`已移动到「${escapeHtml(name)}」`, 'success', 2000);
        }
      } catch (error) {
        toast(error.message, 'error');
        await refreshData().catch(() => {});
      }
    });
  });
}

function findAfterElement(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card;
  }
  return null;
}

function openComposer(column) {
  if (!column || column.querySelector('.quick-add')) return;
  const status = column.dataset.status;
  const foot = column.querySelector('.col-foot');
  foot.innerHTML = `<div class="quick-add">
    <textarea rows="2" placeholder="输入任务标题，回车创建"></textarea>
    <div class="quick-add-foot">
      <button class="btn btn-primary btn-sm" data-submit>创建</button>
      <button class="btn btn-ghost btn-sm" data-cancel>取消</button>
      <span class="hint">Esc 取消</span>
    </div>
  </div>`;
  const textarea = foot.querySelector('textarea');
  textarea.focus();

  const close = () => {
    foot.innerHTML = `<button class="add-inline" data-add="${status}">${icon('plus', 13)}添加任务</button>`;
  };

  const submit = async () => {
    const title = textarea.value.trim();
    if (!title) {
      close();
      return;
    }
    try {
      await createTask({ title, status });
      toast('任务已创建', 'success', 1800);
      close();
    } catch (error) {
      toast(error.message, 'error');
      textarea.disabled = false;
    }
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  foot.querySelector('[data-submit]').addEventListener('click', submit);
  foot.querySelector('[data-cancel]').addEventListener('click', close);
}
