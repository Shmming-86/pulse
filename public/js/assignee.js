import { doneColumnId, memberById, state } from './state.js';
import { escapeHtml, initials } from './utils.js';

let menuEl = null;
let onOutside = null;
let onKeydown = null;

export function isAssigneePickerOpen() {
  return Boolean(menuEl);
}

export function closeAssigneePicker() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  if (onOutside) document.removeEventListener('pointerdown', onOutside, true);
  if (onKeydown) document.removeEventListener('keydown', onKeydown, true);
  onOutside = null;
  onKeydown = null;
}

/**
 * 卡片上的执行人快速切换菜单：点击头像弹出，选中即保存。
 * onPick(value) —— value 为成员 id 或 null（未指派）
 */
export function openAssigneePicker({ anchor, task, onPick }) {
  closeAssigneePicker();
  const rect = anchor.getBoundingClientRect();
  const width = 208;

  const menu = document.createElement('div');
  menu.className = 'assignee-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="assignee-menu-head">指派给</div>
    <button class="assignee-option ${!task.assigneeId ? 'selected' : ''}" data-assignee="" role="menuitem">
      <span class="avatar avatar-xs" style="background:#c3c8d4">?</span>
      <span class="assignee-option-text"><strong>未指派</strong><em>暂不安排负责人</em></span>
    </button>
    ${state.members
      .map((member) => {
        const open = state.tasks.filter(
          (item) => item.assigneeId === member.id && item.status !== doneColumnId(),
        ).length;
        return `<button class="assignee-option ${
          member.id === task.assigneeId ? 'selected' : ''
        }" data-assignee="${member.id}" role="menuitem">
          <span class="avatar avatar-xs" style="background:${member.color}">${initials(member.name)}</span>
          <span class="assignee-option-text"><strong>${escapeHtml(member.name)}</strong><em>${escapeHtml(
            member.role,
          )} · ${open} 个在办</em></span>
        </button>`;
      })
      .join('')}
    <div class="assignee-menu-foot">
      <button class="assignee-manage" data-manage>管理成员…</button>
    </div>`;

  document.body.appendChild(menu);
  menuEl = menu;

  const top =
    rect.bottom + 6 + menu.offsetHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - menu.offsetHeight - 6)
      : rect.bottom + 6;
  const left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - width - 8);
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.minWidth = `${width}px`;

  const close = () => closeAssigneePicker();

  onOutside = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
  };
  onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  // 延迟绑定，避免触发本次点击后立刻关闭
  setTimeout(() => {
    if (!menuEl) return;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
  }, 0);

  menu.addEventListener('click', (event) => {
    if (event.target.closest('[data-manage]')) {
      close();
      location.hash = '#/team';
      return;
    }
    const option = event.target.closest('[data-assignee]');
    if (!option) return;
    const value = option.dataset.assignee || null;
    close();
    if (value !== (task.assigneeId ?? null)) onPick?.(value);
  });

  menu.querySelector('.assignee-option')?.focus();
  return close;
}

/** 兼容外部渲染时取当前成员名（供无障碍标签使用） */
export function assigneeLabel(assigneeId) {
  const member = memberById(assigneeId);
  return member ? `${member.name} · ${member.role}` : '未指派';
}
