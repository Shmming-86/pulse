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
  difficultyMeta,
} from '../state.js';
import { toast } from '../toast.js';
import { openTaskDrawer } from '../drawer.js';
import { openAssigneePicker } from '../assignee.js';
import { openColumnDeleteDialog, openColumnModal } from '../modal.js';
import { avatarHtml, dueInfo, escapeHtml, icon, typeIconName } from '../utils.js';

let suppressClick = false;
let draggedId = null;
let columnDragId = null;
let columnDragTarget = null;
let columnDragStartX = null;
let menuEl = null;
let menuCleanup = null;

/** 难度刻度：4 格，比「较难 / 困难」文字更省空间，完整含义在 title 与抽屉里 */
function difficultyMeter(task) {
  if (!task.difficulty) return '';
  const levels = ['easy', 'normal', 'hard', 'xhard'];
  const level = levels.indexOf(task.difficulty) + 1;
  const meta = difficultyMeta(task.difficulty);
  const bars = [1, 2, 3, 4]
    .map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`)
    .join('');
  return `<span class="diff-meter" style="--diff-color:${meta.color}" title="难易程度：${escapeHtml(
    meta.name,
  )}" aria-label="难易程度：${escapeHtml(meta.name)}">${bars}</span>`;
}

function cardHtml(task) {
  const priority = priorityMeta(task.priority);
  const type = typeMeta(task.type);
  const member = memberById(task.assigneeId);
  const due = dueInfo(task.dueDate, isDoneStatus(task.status));
  const doneSubtasks = task.subtasks.filter((item) => item.done).length;
  // 标签最多两个，其余折成 +N，避免卡片被标签撑爆
  const visibleLabels = task.labels.slice(0, 2);
  const restLabels = task.labels.length - visibleLabels.length;
  const assigneeName = member ? `${member.name} · ${member.role}` : '未指派';

  return `<article class="card" draggable="true" data-task-id="${task.id}" data-priority="${task.priority}">
    <header class="card-head">
      <span class="card-type-icon" style="color:${type.color};background:${type.color}14" title="任务类型：${escapeHtml(
        type.name,
      )}">${icon(typeIconName(type.id), 14)}</span>
      <span class="card-key">${escapeHtml(task.key)}</span>
      <button class="card-avatar" data-assignee-btn="${task.id}" title="切换执行人：${escapeHtml(
        assigneeName,
      )}" aria-label="切换执行人：${escapeHtml(assigneeName)}">
        ${
          member
            ? avatarHtml(member, 'avatar-card')
            : `<span class="avatar-ghost" aria-hidden="true">${icon('plus', 12)}</span>`
        }
      </button>
    </header>

    <div class="card-title">${escapeHtml(task.title)}</div>

    ${
      visibleLabels.length
        ? `<div class="card-labels">${visibleLabels
            .map((label) => `<span class="chip chip-label">${escapeHtml(label)}</span>`)
            .join('')}${
            restLabels > 0 ? `<span class="chip chip-label chip-more">+${restLabels}</span>` : ''
          }</div>`
        : ''
    }

    <footer class="card-foot">
      <span class="prio prio-${priority.id}" title="优先级：${escapeHtml(priority.name)}">
        <i style="background:${priority.color}"></i>${escapeHtml(priority.name)}
      </span>
      ${
        due
          ? `<span class="due ${due.overdue ? 'due-over' : due.soon ? 'due-soon' : ''}" title="截止日期">${icon(
              'calendar',
              12,
            )}${escapeHtml(due.text)}</span>`
          : ''
      }
      <span class="foot-right">
        ${
          task.subtasks.length
            ? `<span class="sub-progress" title="子项完成度 ${doneSubtasks}/${task.subtasks.length}">${icon(
                'subtask',
                12,
              )}${doneSubtasks}/${task.subtasks.length}</span>`
            : ''
        }
        ${difficultyMeter(task)}
      </span>
    </footer>
  </article>`;
}

/**
 * 列换位动画（FLIP）：重渲染后先按旧位置偏移，再过渡回新位置，
 * 让列在拖拽落位时平滑滑动而不是瞬间跳变。
 */
/**
 * 落位动画：把新渲染出来的列从"松手瞬间的位置/缩放"平滑归位，
 * 位移与缩放合成一条 transform，避免位移动画和缩放动画打架。
 */
function settleColumn(el, prevRect) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = el.getBoundingClientRect();
  const dx = prevRect.left - rect.left;
  const dy = prevRect.top - rect.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  el.style.transition = 'none';
  el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(1.035)`;
  requestAnimationFrame(() => {
    el.style.transition = 'transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    el.style.transform = 'translate(0, 0) scale(1)';
  });
  window.setTimeout(() => {
    el.style.transition = '';
    el.style.transform = '';
  }, 300);
}

function animateColumnReorder(root, prevRects, { skipId } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const cols = Array.from(root.querySelectorAll('.column'));
  const moved = [];
  cols.forEach((col) => {
    if (skipId && col.dataset.status === skipId) return;
    const prev = prevRects.get(col.dataset.status);
    if (!prev) return;
    const delta = prev.left - col.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) return;
    col.style.transition = 'none';
    col.style.transform = `translateX(${delta}px)`;
    moved.push(col);
  });
  if (!moved.length) return;
  requestAnimationFrame(() => {
    void root.offsetWidth; // 强制回流，确保从偏移位置开始过渡
    moved.forEach((col) => {
      col.style.transition = 'transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)';
      col.style.transform = '';
    });
  });
  window.setTimeout(() => {
    moved.forEach((col) => {
      col.style.transition = '';
      col.style.transform = '';
    });
  }, 420);
}

/** 拖动中：其余列按「新位置 - 旧位置」平移一格，给目标位置腾出空档 */
function previewColumnGap(cols, source, insert) {
  const first = cols[0];
  const second = cols[1];
  if (!first) return;
  const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth + 12;
  const sourceIndex = cols.indexOf(source);

  let m = 0;
  cols.forEach((col) => {
    if (col === source) return;
    const finalIndex = m < insert ? m : m + 1;
    const oldIndex = m < sourceIndex ? m : m + 1;
    const offset = (finalIndex - oldIndex) * step;
    col.style.transition = 'transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    col.style.transform = offset ? `translateX(${offset}px)` : '';
    m += 1;
  });
}

/** 撤销临时位移（取消拖拽或落位后重绘前调用） */
function resetColumnGaps(root) {
  columnDragTarget = null;
  root.querySelectorAll('.column').forEach((col) => {
    col.style.transition = 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)';
    col.style.transform = '';
    window.setTimeout(() => {
      col.style.transition = '';
    }, 240);
  });
}

function clearColumnDrag(root) {
  columnDragId = null;
  columnDragTarget = null;
  columnDragStartX = null;
  root.querySelectorAll('.column').forEach((col) => {
    col.classList.remove('col-dragging');
    col.style.transform = '';
    col.style.transition = '';
  });
}

function columnHtml(column) {
  const tasks = boardTasksByStatus(column.id);
  const hidden = column.isDone ? hiddenStaleTasks().filter((task) => task.status === column.id).length : 0;
  const over = column.wipLimit && tasks.length > column.wipLimit;
  return `<section class="column" data-status="${column.id}">
    <header class="col-head" draggable="true" data-col-id="${column.id}" title="拖动列头可调整列顺序">
      <span class="col-grip" aria-hidden="true">${icon('grip', 14)}</span>
      <span class="col-dot ${column.tone}"></span>
      <span class="col-name" title="${column.isDone ? '完成列' : column.isStart ? '开始列' : ''}">${escapeHtml(
        column.name,
      )}${column.isDone ? '<i class="col-flag" title="完成列">✓</i>' : ''}</span>
      <span class="col-count">${tasks.length}</span>
      ${column.wipLimit ? `<span class="wip ${over ? 'over' : ''}" title="在制品上限">${tasks.length}/${column.wipLimit}</span>` : ''}
      <span class="col-actions">
        <button class="col-add" data-add="${column.id}" title="在此列新建任务" aria-label="在${escapeHtml(
          column.name,
        )}新建任务">${icon('plus', 14)}</button>
        <button class="col-menu-btn" data-col-menu="${column.id}" title="列设置" aria-label="设置${escapeHtml(
          column.name,
        )}">${icon('more', 14)}</button>
      </span>
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
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'column-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="column-menu-head">${escapeHtml(column.name)}</div>
    <button class="column-menu-item" data-action="edit" role="menuitem">${icon('edit', 13)}编辑列</button>
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
      const head = event.target.closest('.col-head[data-col-id]');
      if (head) {
        // 列头里的按钮（新建/菜单）不参与拖拽，避免误触
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        columnDragId = head.dataset.colId;
        columnDragStartX = event.clientX;
        head.closest('.column')?.classList.add('col-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `column:${columnDragId}`);
        // 隐藏浏览器自带的半透明拖影：只保留列本身的视觉变化
        // 注意：setDragImage 的元素必须挂在文档里，离线 canvas 会被 Chrome 忽略（这就是之前重影的原因）
        const ghost = document.createElement('img');
        ghost.src =
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.cssText =
          'position:fixed;top:-200px;left:-200px;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(ghost);
        try {
          event.dataTransfer.setDragImage(ghost, 0, 0);
        } catch {
          /* 极少数浏览器不支持时忽略 */
        }
        window.setTimeout(() => ghost.remove(), 60);
        return;
      }

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
      if (columnDragId) {
        // 取消拖拽：DOM 顺序全程未改动，动画归位即可
        resetColumnGaps(root);
      }
      clearColumnDrag(root);
      draggedId = null;
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 60);
    });
  }

  // ---------- 列拖拽排序（拖动中其它列实时让位，松手落位） ----------
  root.addEventListener('dragover', (event) => {
    if (!columnDragId) return;
    const board = root.querySelector('.board');
    if (!board) return;
    const cols = Array.from(board.querySelectorAll('.column'));
    const source = cols.find((col) => col.dataset.status === columnDragId);
    if (!source) return;
    event.preventDefault();

    // 重渲染可能冲掉拖拽样式，这里补一次保证拖动视觉不中断
    source.classList.add('col-dragging');

    // 插入点用布局坐标（offsetLeft，不受 transform 影响）判断，避免让位后反复抖动
    const boardRect = board.getBoundingClientRect();
    const pointerX = event.clientX - boardRect.left + board.scrollLeft;
    const others = cols.filter((col) => col !== source);
    let insert = others.length;
    for (let i = 0; i < others.length; i += 1) {
      const mid = others[i].offsetLeft + others[i].offsetWidth / 2;
      if (pointerX < mid) {
        insert = i;
        break;
      }
    }
    columnDragTarget = insert;

    // 直接跟手：位移 = 指针位移（限制在看板范围内），只给 70ms 线性过渡抹平抖动
    const step = others[1] ? others[1].offsetLeft - others[0].offsetLeft : source.offsetWidth + 12;
    const fromIndex = cols.indexOf(source);
    const rawDx = columnDragStartX === null ? 0 : event.clientX - columnDragStartX;
    const dx = Math.max(-fromIndex * step, Math.min((cols.length - 1 - fromIndex) * step, rawDx));
    const tilt = Math.max(-0.6, Math.min(0.6, ((insert - fromIndex) * step - dx) / step));

    source.style.transition = 'transform 70ms linear';
    source.style.transform = `translateX(${dx.toFixed(1)}px) scale(1.035) rotate(${tilt.toFixed(
      2,
    )}deg)`;

    previewColumnGap(cols, source, insert);
  });

  root.addEventListener('drop', (event) => {
    if (!columnDragId) return;
    const board = root.querySelector('.board');
    if (!board) return;
    event.preventDefault();

    const movingId = columnDragId;
    const insert = columnDragTarget;
    const from = columns().findIndex((item) => item.id === movingId);
    const prevRects = new Map();
    board.querySelectorAll('.column').forEach((col) => {
      prevRects.set(col.dataset.status, col.getBoundingClientRect());
    });
    const sourcePrevRect = prevRects.get(movingId) ?? null;

    // 先停止后续 dragover 处理，但保留当前视觉：等新 DOM 渲染后由动画接管
    columnDragId = null;

    if (insert === null || from === -1 || insert === from) {
      resetColumnGaps(root);
      clearColumnDrag(root);
      return;
    }

    moveColumn(movingId, insert)
      .then(() => {
        animateColumnReorder(root, prevRects, { skipId: movingId });
        const settled = root.querySelector(`.column[data-status="${movingId}"]`);
        if (settled && sourcePrevRect) settleColumn(settled, sourcePrevRect);
      })
      .catch((error) => {
        toast(error.message, 'error');
        resetColumnGaps(root);
        clearColumnDrag(root);
      });
  });

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
