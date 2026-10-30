import {
  filteredTasks,
  isDoneStatus,
  memberById,
  priorityMeta,
  difficultyMeta,
  state,
  statusMeta,
  updateTask,
} from '../state.js';
import { avatarHtml, dueInfo, escapeHtml, formatDate, formatDateTime, relativeTime } from '../utils.js';
import { openTaskDrawer } from '../drawer.js';
import { toast } from '../toast.js';

const sort = { key: 'status', dir: 1 };

const COLUMNS = [
  { key: 'key', label: '编号', sortable: true, width: '78px' },
  { key: 'title', label: '任务', sortable: true },
  { key: 'status', label: '状态', sortable: true, width: '110px' },
  { key: 'priority', label: '优先级', sortable: true, width: '86px' },
  { key: 'assigneeId', label: '负责人', sortable: true, width: '110px' },
  { key: 'dueDate', label: '截止日期', sortable: true, width: '104px' },
  { key: 'startedAt', label: '开始时间', sortable: true, width: '104px' },
  { key: 'difficulty', label: '难度', sortable: true, width: '74px' },
  { key: 'updatedAt', label: '最近更新', sortable: true, width: '96px' },
];

function sorted(rows) {
  const statusIndex = new Map(state.meta.statuses.map((s, i) => [s.id, i]));
  const list = rows.slice();
  list.sort((a, b) => {
    let result = 0;
    switch (sort.key) {
      case 'status':
        result = statusIndex.get(a.status) - statusIndex.get(b.status);
        break;
      case 'priority':
        result = priorityMeta(a.priority).weight - priorityMeta(b.priority).weight;
        break;
      case 'assigneeId':
        result = (memberById(a.assigneeId)?.name ?? 'zz').localeCompare(
          memberById(b.assigneeId)?.name ?? 'zz',
          'zh',
        );
        break;
      case 'dueDate':
        if (!a.dueDate && !b.dueDate) result = 0;
        else if (!a.dueDate) result = 1;
        else if (!b.dueDate) result = -1;
        else result = a.dueDate.localeCompare(b.dueDate);
        break;
      case 'difficulty':
        result = difficultyMeta(a.difficulty).weight - difficultyMeta(b.difficulty).weight;
        break;
      case 'startedAt':
        if (!a.startedAt && !b.startedAt) result = 0;
        else if (!a.startedAt) result = 1;
        else if (!b.startedAt) result = -1;
        else result = a.startedAt.localeCompare(b.startedAt);
        break;
      case 'updatedAt':
        result = new Date(a.updatedAt) - new Date(b.updatedAt);
        break;
      case 'key':
        result = a.key.localeCompare(b.key, undefined, { numeric: true });
        break;
      default:
        result = a.title.localeCompare(b.title, 'zh');
    }
    return result * sort.dir || a.order - b.order;
  });
  return list;
}

function rowHtml(task) {
  const priority = priorityMeta(task.priority);
  const due = dueInfo(task.dueDate, isDoneStatus(task.status));
  const member = memberById(task.assigneeId);
  return `<tr data-task-id="${task.id}">
    <td class="t-key">${escapeHtml(task.key)}</td>
    <td class="t-title">
      <span>${escapeHtml(task.title)}</span>
      ${
        task.labels.length
          ? `<span class="labels">${task.labels
              .slice(0, 2)
              .map((label) => `<span class="chip chip-label">${escapeHtml(label)}</span>`)
              .join('')}</span>`
          : ''
      }
    </td>
    <td>
      <select class="status-select" data-status-for="${task.id}" aria-label="修改状态">
        ${state.meta.statuses
          .map(
            (status) =>
              `<option value="${status.id}" ${status.id === task.status ? 'selected' : ''}>${escapeHtml(
                status.name,
              )}</option>`,
          )
          .join('')}
      </select>
    </td>
    <td><span class="chip chip-priority-${priority.id}"><i class="chip-dot" style="background:${
      priority.color
    }"></i>${escapeHtml(priority.name)}</span></td>
    <td>
      <span class="cell-assignee">
        ${avatarHtml(member)}
        <select class="assignee-select" data-assign-for="${task.id}" aria-label="切换负责人">
          <option value="" ${!task.assigneeId ? 'selected' : ''}>未指派</option>
          ${state.members
            .map(
              (item) =>
                `<option value="${item.id}" ${item.id === task.assigneeId ? 'selected' : ''}>${escapeHtml(
                  item.name,
                )}</option>`,
            )
            .join('')}
        </select>
      </span>
    </td>
    <td>${due ? `<span class="${due.cls}">${escapeHtml(due.text)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
    <td style="color:var(--text-2);font-size:11.5px" title="${escapeHtml(
      task.startedAt ? `开始于 ${formatDateTime(task.startedAt)}` : '尚未开始',
    )}">${task.startedAt ? escapeHtml(formatDate(task.startedAt)) : '<span style="color:var(--text-3)">—</span>'}</td>
    <td style="color:var(--text-2)">${
      task.difficulty
        ? `<span class="diff-badge" style="color:${difficultyMeta(task.difficulty).color};background:${
            difficultyMeta(task.difficulty).color
          }18">${escapeHtml(difficultyMeta(task.difficulty).name)}</span>`
        : '—'
    }</td>
    <td style="color:var(--text-3);font-size:11.5px">${escapeHtml(relativeTime(task.updatedAt))}</td>
  </tr>`;
}

export function renderList(root) {
  const rows = sorted(filteredTasks());
  const open = rows.filter((task) => !isDoneStatus(task.status)).length;

  root.innerHTML = `<div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          ${COLUMNS.map(
            (column) => `<th class="${column.sortable ? 'sortable' : ''}" data-sort="${
              column.key
            }" style="${column.width ? `width:${column.width}` : ''}">
              ${escapeHtml(column.label)}${
                sort.key === column.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''
              }
            </th>`,
          ).join('')}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map(rowHtml).join('')
            : `<tr><td colspan="${COLUMNS.length}"><div class="empty-state">
                <h3>没有匹配的任务</h3><p>调整筛选条件，或新建一个任务</p>
              </div></td></tr>`
        }
      </tbody>
    </table>
  </div>
  <div style="display:flex;justify-content:space-between;padding:10px 4px 0;font-size:11.5px;color:var(--text-3)">
    <span>共 ${rows.length} 个任务 · ${open} 个进行中</span>
    <span>点击行查看详情，状态下拉可快速流转</span>
  </div>`;

  root.querySelector('thead').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (sort.key === key) sort.dir *= -1;
    else {
      sort.key = key;
      sort.dir = key === 'updatedAt' || key === 'priority' ? -1 : 1;
    }
    renderList(root);
  });

  root.querySelector('tbody').addEventListener('click', (event) => {
    if (event.target.closest('.status-select') || event.target.closest('.assignee-select')) return;
    const row = event.target.closest('tr[data-task-id]');
    if (row) openTaskDrawer(row.dataset.taskId);
  });

  root.querySelector('tbody').addEventListener('change', async (event) => {
    const statusSelect = event.target.closest('.status-select');
    if (statusSelect) {
      const id = statusSelect.dataset.statusFor;
      try {
        await updateTask(id, { status: statusSelect.value });
        toast(`状态已更新为「${statusMeta(statusSelect.value).name}」`, 'success', 1800);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    const assignSelect = event.target.closest('.assignee-select');
    if (assignSelect) {
      const id = assignSelect.dataset.assignFor;
      try {
        await updateTask(id, { assigneeId: assignSelect.value || null });
        const member = memberById(assignSelect.value);
        toast(member ? `已指派给 ${member.name}` : '已取消指派', 'success', 1800);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

export { sort as listSort };
