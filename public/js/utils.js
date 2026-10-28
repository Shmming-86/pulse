const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

const DAY = 86_400_000;

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = diff / 60_000;
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${Math.floor(minutes)} 分钟前`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)} 小时前`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)} 天前`;
  return formatDate(iso);
}

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = startOfToday();
  const target = new Date(d).setHours(0, 0, 0, 0);
  if (target === today) return '今天';
  if (target === today - DAY) return '昨天';
  return formatDate(iso);
}

/** 截止日期状态：逾期 / 临近 / 正常（isDone 由调用方按看板列语义判断） */
export function dueInfo(dueDate, isDone = false) {
  if (!dueDate) return null;
  if (isDone) return { text: formatDate(`${dueDate}T00:00:00`), cls: 'chip' };
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  const today = startOfToday();
  const diffDays = Math.round((due - today) / DAY);
  if (diffDays < 0) return { text: `逾期 ${Math.abs(diffDays)} 天`, cls: 'chip chip-overdue', overdue: true };
  if (diffDays === 0) return { text: '今天到期', cls: 'chip chip-soon', soon: true };
  if (diffDays === 1) return { text: '明天到期', cls: 'chip chip-soon', soon: true };
  if (diffDays <= 3) return { text: `${diffDays} 天后到期`, cls: 'chip chip-soon' };
  return { text: formatDate(`${dueDate}T00:00:00`), cls: 'chip' };
}

export function initials(name) {
  if (!name) return '?';
  return Array.from(name.trim())[0] ?? '?';
}

export function avatarHtml(member, extraClass = '') {
  if (!member) {
    return `<span class="avatar avatar-sm ${extraClass}" style="background:#c3c8d4" title="未指派">?</span>`;
  }
  return `<span class="avatar avatar-sm ${extraClass}" style="background:${member.color}" title="${escapeHtml(
    member.name,
  )} · ${escapeHtml(member.role)}">${initials(member.name)}</span>`;
}

/** 任务类型 → 图标名（新增类型时只需在这里补映射） */
const TYPE_ICONS = { task: 'squareCheck', feature: 'sparkle', bug: 'bug', improvement: 'trend' };

export function typeIconName(typeId) {
  return TYPE_ICONS[typeId] ?? 'squareCheck';
}

const ICONS = {
  plus: '<path d="M10 4.5v11M4.5 10h11" stroke-linecap="round"/>',
  close: '<path d="M5 5l10 10M15 5L5 15" stroke-linecap="round"/>',
  trash:
    '<path d="M4 6h12M8 6V4.5h4V6M6.5 6l.7 9.2h5.6L13.5 6M8.8 8.8v3.8M11.2 8.8v3.8" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron: '<path d="M6 8l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
  calendar:
    '<rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8h13M7 3.5v2M13 3.5v2" stroke-linecap="round"/>',
  subtask:
    '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M7 10l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
  warning: '<path d="M10 4l6.5 11.5h-13L10 4z" stroke-linejoin="round"/><path d="M10 8.5v3M10 13.5v.4" stroke-linecap="round"/>',
  refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v4h-4" stroke-linecap="round" stroke-linejoin="round"/>',
  sparkle:
    '<path d="M10 3.5l1.6 4.2 4.4 1.6-4.4 1.6L10 15.1l-1.6-4.2L4 9.3l4.4-1.6L10 3.5z" stroke-linejoin="round"/>',
  clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.4v3.8l2.5 1.5" stroke-linecap="round"/>',
  arrowUp: '<path d="M10 15V5M6 9l4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M10 5v10M6 11l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
  filter: '<path d="M3.5 5.5h13l-5 5.6v4.4l-3-1.4v-3L3.5 5.5z" stroke-linejoin="round"/>',
  more: '<circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
  inbox:
    '<path d="M3.5 11.5L5 5h10l1.5 6.5V15h-13v-3.5z" stroke-linejoin="round"/><path d="M3.5 11.5h3l.8 1.6h5.4l.8-1.6h3" stroke-linejoin="round"/>',
  archive:
    '<rect x="3.5" y="4.5" width="13" height="4" rx="1.2" stroke-linejoin="round"/><path d="M5 8.5V15a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5M8.5 11.8h3" stroke-linecap="round" stroke-linejoin="round"/>',
  edit:
    '<path d="M4 16l.6-3.2L13 4.4a1.6 1.6 0 0 1 2.3 0l.3.3a1.6 1.6 0 0 1 0 2.3l-8.4 8.4L4 16z" stroke-linejoin="round"/><path d="M12 5.6l2.4 2.4" stroke-linecap="round"/>',
  user:
    '<circle cx="10" cy="7.2" r="3.1"/><path d="M4.4 16.2c.6-2.6 2.9-4.1 5.6-4.1s5 1.5 5.6 4.1" stroke-linecap="round"/>',
  bug:
    '<path d="M8 2l1.9 1.9M14.1 3.9L16 2M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.5 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M17.5 9c1.9-.2 3.5-1.9 3.5-4"/><path d="M22 13h-4"/><path d="M21 21c0-2.1-1.7-3.9-3.8-4"/>',
  trend: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  squareCheck:
    '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.4 12.4l2.6 2.6 4.6-5.2" stroke-linecap="round" stroke-linejoin="round"/>',
  mail:
    '<rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3.6 6.2l6.4 4.6 6.4-4.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name, size = 16) {
  const path = ICONS[name] ?? '';
  return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${path}</svg>`;
}

export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function sortByOrder(a, b) {
  return a.order - b.order;
}
