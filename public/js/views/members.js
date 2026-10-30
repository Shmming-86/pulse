import {
  assignTask,
  isDoneStatus,
  memberById,
  difficultyWeight,
  openTasksOf,
  startColumnId,
  state,
  unassignedTasks,
} from '../state.js';
import { avatarHtml, dueInfo, escapeHtml, icon, initials } from '../utils.js';
import { toast } from '../toast.js';
import { openAssigneePicker } from '../assignee.js';
import { openMemberDeleteDialog, openMemberModal } from '../modal.js';

function statsOf(member) {
  if (member.stats) return member.stats;
  const own = state.tasks.filter((task) => task.assigneeId === member.id);
  const open = own.filter((task) => !isDoneStatus(task.status));
  return {
    total: own.length,
    open: open.length,
    inProgress: open.filter((task) => task.status === startColumnId()).length,
    done: own.length - open.length,
    points: open.reduce((sum, task) => sum + difficultyWeight(task.difficulty), 0),
    overdue: open.filter((task) => task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10))
      .length,
  };
}

function memberCardHtml(member, maxPoints) {
  const stats = statsOf(member);
  const width = maxPoints ? Math.max(4, Math.round((stats.points / maxPoints) * 100)) : 0;
  const lastOne = state.members.length <= 1;
  return `<article class="member-card" data-member-id="${member.id}">
    <header class="member-card-head">
      <span class="avatar avatar-lg" style="background:${member.color}">${initials(member.name)}</span>
      <div class="member-id">
        <strong>${escapeHtml(member.name)}</strong>
        <span>${escapeHtml(member.role)}</span>
        <em>${member.email ? escapeHtml(member.email) : '未填写邮箱'}</em>
      </div>
      <div class="member-actions">
        <button class="icon-btn" data-edit="${member.id}" title="编辑成员信息" aria-label="编辑 ${escapeHtml(
          member.name,
        )}">${icon('edit', 14)}</button>
        <button class="icon-btn" data-delete="${member.id}" title="${
          lastOne ? '至少需要保留一名成员' : '删除成员'
        }" aria-label="删除 ${escapeHtml(member.name)}" ${lastOne ? 'disabled' : ''}>${icon('trash', 14)}</button>
      </div>
    </header>
    <div class="member-stats">
      <div><strong>${stats.open}</strong><span>在办</span></div>
      <div><strong>${stats.inProgress}</strong><span>进行中</span></div>
      <div><strong>${stats.done}</strong><span>已完成</span></div>
      <div class="${stats.overdue ? 'warn' : ''}"><strong>${stats.overdue}</strong><span>逾期</span></div>
    </div>
    <div class="member-load">
      <span class="load-label">在办工作量</span>
      <div class="load-track"><i style="width:${width}%;background:${member.color}"></i></div>
      <span class="load-value">${stats.points} 分</span>
    </div>
    <footer class="member-card-foot">
      <span>${stats.total} 个任务 · ${stats.inProgress} 个进行中</span>
      <button class="link-btn" data-view-tasks="${member.id}">查看任务 →</button>
    </footer>
  </article>`;
}

function unassignedRowHtml(task) {
  const due = dueInfo(task.dueDate, isDoneStatus(task.status));
  return `<div class="unassigned-row" data-unassigned="${task.id}">
    <span class="card-key">${escapeHtml(task.key)}</span>
    <span class="unassigned-title">${escapeHtml(task.title)}</span>
    ${due ? `<span class="${due.cls}">${escapeHtml(due.text)}</span>` : ''}
    <button class="btn btn-sm" data-assign="${task.id}">${icon('user', 12)}指派</button>
  </div>`;
}

export function renderMembers(root) {
  const members = state.members;
  const maxPoints = Math.max(0, ...members.map((member) => statsOf(member).points));
  const unassigned = unassignedTasks();
  const totalOpen = state.tasks.filter((task) => !isDoneStatus(task.status)).length;

  root.innerHTML = `<div class="team">
    <div class="team-bar">
      <div class="team-summary">
        <div class="team-stat"><span>团队成员</span><strong>${members.length}</strong></div>
        <div class="team-stat"><span>在办任务</span><strong>${totalOpen}</strong></div>
        <div class="team-stat ${
          unassigned.length ? 'warn' : ''
        }"><span>未指派</span><strong>${unassigned.length}</strong></div>
      </div>
      <button class="btn btn-primary" data-new-member>${icon('plus', 14)}新增成员</button>
    </div>

    ${
      members.length
        ? `<div class="team-grid">${members.map((member) => memberCardHtml(member, maxPoints)).join('')}</div>`
        : `<div class="empty-state"><h3>还没有成员</h3><p>添加成员后即可在任务中指派执行人</p></div>`
    }

    <section class="panel unassigned-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">待指派任务</div>
          <div class="panel-sub">这些任务还没有执行人，点击指派可快速安排</div>
        </div>
        <span class="pill-count">${unassigned.length}</span>
      </div>
      ${
        unassigned.length
          ? `<div class="unassigned-list">${unassigned
              .slice()
              .sort((a, b) => a.order - b.order)
              .slice(0, 8)
              .map(unassignedRowHtml)
              .join('')}</div>
            ${
              unassigned.length > 8
                ? `<div class="unassigned-more">另有 ${unassigned.length - 8} 个未指派任务，可在看板筛选「未指派」查看</div>`
                : ''
            }`
          : `<div class="unassigned-empty">${icon('check', 14)}所有任务都已安排执行人</div>`
      }
    </section>
  </div>`;

  root.querySelector('[data-new-member]')?.addEventListener('click', () => openMemberModal());

  // 容器复用，事件只绑定一次，数据实时查询
  if (root.dataset.membersBound === '1') return;
  root.dataset.membersBound = '1';

  root.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit]');
    if (editBtn) {
      openMemberModal({ member: memberById(editBtn.dataset.edit) });
      return;
    }

    const deleteBtn = event.target.closest('[data-delete]');
    if (deleteBtn) {
      const member = memberById(deleteBtn.dataset.delete);
      if (!member) return;
      const own = openTasksOf(member.id).length + (member.stats?.done ?? 0);
      await openMemberDeleteDialog({ member, taskCount: own });
      return;
    }

    const viewBtn = event.target.closest('[data-view-tasks]');
    if (viewBtn) {
      state.filters.assigneeId = viewBtn.dataset.viewTasks;
      state.filters.q = '';
      location.hash = '#/board';
      return;
    }

    const assignBtn = event.target.closest('[data-assign]');
    if (assignBtn) {
      const task = state.tasks.find((item) => item.id === assignBtn.dataset.assign);
      if (!task) return;
      openAssigneePicker({
        anchor: assignBtn,
        task,
        onPick: async (value) => {
          try {
            await assignTask(task.id, value);
            toast(`已指派给 ${memberById(value)?.name ?? '未指派'}`, 'success', 1800);
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      });
    }
  });
}
