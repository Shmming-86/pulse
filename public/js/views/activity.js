import { state, taskById } from '../state.js';
import { avatarHtml, dayLabel, escapeHtml, relativeTime } from '../utils.js';
import { openTaskDrawer } from '../drawer.js';

const timeOf = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function renderActivity(root) {
  const rows = state.activity;
  if (!rows.length) {
    root.innerHTML = `<div class="empty-state"><h3>还没有动态</h3><p>创建或移动任务后，这里会出现团队的操作记录</p></div>`;
    return;
  }

  let current = '';
  const html = rows
    .map((item) => {
      const label = dayLabel(item.at);
      let group = '';
      if (label !== current) {
        current = label;
        group = `<div class="day-label">${escapeHtml(label)}</div>`;
      }
      const exists = Boolean(taskById(item.taskId));
      return `${group}<div class="feed-row">
        ${avatarHtml(
          state.members.find((member) => member.id === item.actorId) ?? null,
        )}
        <div class="feed-body">
          ${escapeHtml(item.message)}
          ${
            item.taskKey
              ? exists
                ? `<a class="feed-task" data-task-id="${item.taskId}"> · ${escapeHtml(item.taskKey)} ${escapeHtml(
                    item.taskTitle,
                  )}</a>`
                : `<span style="color:var(--text-3)"> · ${escapeHtml(item.taskKey)} ${escapeHtml(
                    item.taskTitle,
                  )}</span>`
              : ''
          }
        </div>
        <span class="feed-time" title="${escapeHtml(relativeTime(item.at))}">${timeOf(item.at)}</span>
      </div>`;
    })
    .join('');

  root.innerHTML = `<div class="timeline-wrap">${html}</div>`;

  root.querySelectorAll('.feed-task[data-task-id]').forEach((link) => {
    link.addEventListener('click', () => openTaskDrawer(link.dataset.taskId));
  });
}
