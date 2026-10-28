import {
  boardTasks,
  bootstrap,
  clearFilters,
  currentUser,
  doneColumnId,
  filteredTasks,
  hiddenStaleTasks,
  loadAnalytics,
  setFilter,
  staleDoneDays,
  state,
  subscribe,
  toggleStaleDone,
} from './state.js';
import { renderBoard } from './views/board.js';
import { renderList } from './views/list.js';
import { renderAnalytics } from './views/analytics.js';
import { renderActivity } from './views/activity.js';
import { renderMembers } from './views/members.js';
import {
  bindDrawerGlobal,
  closeTaskDrawer,
  isDrawerOpen,
  refreshDrawer,
} from './drawer.js';
import { openMemberModal, openTaskModal } from './modal.js';
import { toast } from './toast.js';
import { debounce, escapeHtml, icon } from './utils.js';

const VIEWS = {
  board: { title: '看板', render: renderBoard, filters: true },
  list: { title: '列表', render: renderList, filters: true },
  analytics: { title: '分析', render: renderAnalytics, filters: false },
  team: { title: '团队', render: renderMembers, filters: false },
  activity: { title: '动态', render: renderActivity, filters: false },
};

const $ = (selector) => document.querySelector(selector);
let analyticsLoading = false;

function currentView() {
  const hash = location.hash.replace(/^#\/?/, '');
  return VIEWS[hash] ? hash : 'board';
}

function navigate(view) {
  if (!VIEWS[view]) return;
  if (location.hash !== `#/${view}`) location.hash = `#/${view}`;
  else handleRoute();
}

function handleRoute() {
  state.view = currentView();
  render();
  if (state.view === 'analytics') maybeLoadAnalytics();
}

async function maybeLoadAnalytics(force = false) {
  if (state.view !== 'analytics' || analyticsLoading) return;
  if (!force && state.analytics && Date.now() - state.analyticsFetchedAt < 15_000) return;
  analyticsLoading = true;
  try {
    await loadAnalytics({ force });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    analyticsLoading = false;
  }
}

function renderShell() {
  const view = state.view;
  const config = VIEWS[view];
  const active = document.querySelector(`.nav-item[data-view="${view}"]`);
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  active?.classList.add('active');
  document.querySelectorAll('.seg-btn').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  $('#page-title').textContent = config.title;

  const count =
    view === 'analytics'
      ? state.tasks.length
      : view === 'activity'
        ? state.activity.length
        : view === 'team'
          ? state.members.length
          : view === 'board'
            ? boardTasks().length
            : filteredTasks().length;
  $('#page-count').textContent = state.loading && !state.tasks.length ? '—' : String(count);
  document.querySelector('.nav-count[data-count="board"]').textContent = String(
    filteredTasks().filter((task) => task.status !== doneColumnId()).length,
  );

  // 看板「隐藏超期完成」开关（仅看板视图展示，列表视图始终显示全部）
  const staleChip = $('#stale-toggle');
  if (staleChip) {
    const isBoard = view === 'board';
    staleChip.hidden = !isBoard;
    if (isBoard) {
      const hidden = hiddenStaleTasks().length;
      const on = state.boardView.hideStaleDone;
      staleChip.classList.toggle('off', !on);
      staleChip.innerHTML = on
        ? `${icon('archive', 13)}<span>已隐藏完成 &gt;${staleDoneDays()} 天</span><em>${hidden}</em>`
        : `${icon('archive', 13)}<span>显示全部任务</span>${hidden ? `<em>${hidden}</em>` : ''}`;
      staleChip.title = on
        ? `看板默认不展示完成超过 ${staleDoneDays()} 天的任务，点击可临时显示全部（列表视图始终可见）`
        : '当前显示全部任务，点击恢复「隐藏完成超过 7 天」';
    }
  }

  if (state.project) {
    $('#project-name').textContent = state.project.name;
    $('#project-key').textContent = state.project.key;
    $('#project-sub').textContent = `小团队 · ${state.members.length} 人`;
  }

  const stack = $('#member-stack');
  const signature = state.members.map((member) => `${member.id}:${member.name}:${member.color}`).join('|');
  if (stack.dataset.signature !== signature) {
    stack.dataset.signature = signature;
    stack.innerHTML = state.members
      .map(
        (member) =>
          `<span class="avatar avatar-sm" style="background:${member.color}" title="${escapeHtml(
            member.name,
          )} · ${escapeHtml(member.role)}">${escapeHtml(Array.from(member.name)[0])}</span>`,
      )
      .join('');
  }

  const me = currentUser();
  if (me) {
    const avatar = $('#me-avatar');
    avatar.textContent = Array.from(me.name)[0] ?? '?';
    avatar.style.background = me.color;
    $('#me-name').textContent = me.name;
    $('#me-role').textContent = me.role;
  }

  $('#filterbar').style.display = config.filters ? '' : 'none';
  populateFilters({ resetValues: false });

  if (state.lastSync) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(state.lastSync).getTime()) / 1000));
    $('#sync-note').textContent =
      seconds < 10 ? '已同步 · 刚刚' : `已同步 · ${seconds < 60 ? `${seconds} 秒前` : `${Math.round(seconds / 60)} 分钟前`}`;
  }

  $('#clear-filters').hidden = !(
    state.filters.q ||
    state.filters.assigneeId ||
    state.filters.priority ||
    state.filters.type
  );
}

function renderView() {
  const root = $('#view-root');
  const view = state.view;
  root.className = `view${view === 'board' ? ' view-board' : ''}`;

  if (state.loading && state.tasks.length === 0) {
    root.innerHTML = `<div class="skeleton-wrap">
      <div class="skeleton skeleton-kpi"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>`;
    return;
  }

  if (state.offline && state.tasks.length === 0) {
    root.innerHTML = `<div class="empty-state">
      <h3>无法连接服务</h3>
      <p>${escapeHtml(state.error ?? '请确认服务已启动，然后点击右上角刷新')}</p>
      <div style="margin-top:14px"><button class="btn" data-retry>${icon('refresh', 14)}重新连接</button></div>
    </div>`;
    root.querySelector('[data-retry]')?.addEventListener('click', () => bootstrap());
    return;
  }

  VIEWS[view].render(root);

  if (state.offline) {
    root.insertAdjacentHTML(
      'afterbegin',
      `<div class="offline-banner">${icon('warning', 14)}当前处于离线状态，展示的是最近一次同步的数据。</div>`,
    );
  }
}

function render() {
  renderShell();
  renderView();
  if (isDrawerOpen()) refreshDrawer();
}

function populateFilters({ resetValues = true } = {}) {
  const assignee = $('#filter-assignee');
  const priority = $('#filter-priority');
  const type = $('#filter-type');

  const signature = state.members.map((member) => `${member.id}:${member.name}`).join('|');
  if (assignee.dataset.signature !== signature && state.members.length) {
    assignee.dataset.signature = signature;
    assignee.innerHTML =
      '<option value="">全部负责人</option>' +
      state.members
        .map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`)
        .join('');
    if (state.filters.assigneeId && !state.members.some((m) => m.id === state.filters.assigneeId)) {
      state.filters.assigneeId = '';
    }
    assignee.value = state.filters.assigneeId;
  }
  if (priority.options.length <= 1 && state.meta.priorities.length) {
    priority.innerHTML =
      '<option value="">全部优先级</option>' +
      state.meta.priorities
        .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
        .join('');
  }
  if (type.options.length <= 1 && state.meta.types.length) {
    type.innerHTML =
      '<option value="">全部类型</option>' +
      state.meta.types
        .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
        .join('');
  }
  if (!resetValues) return;

  assignee.value = state.filters.assigneeId;
  priority.value = state.filters.priority;
  type.value = state.filters.type;
  $('#search-input').value = state.filters.q;
}

function bindShell() {
  bindDrawerGlobal();

  window.addEventListener('hashchange', handleRoute);

  $('#new-task-btn').addEventListener('click', () => openTaskModal());

  $('#member-stack').addEventListener('click', () => {
    location.hash = '#/team';
  });

  // 侧栏「当前操作人」直接打开我的信息维护
  const openMyProfile = () => {
    const member = currentUser();
    if (!member) {
      location.hash = '#/team';
      return;
    }
    openMemberModal({ member });
  };
  const meBlock = $('#me-block');
  meBlock.addEventListener('click', openMyProfile);
  meBlock.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMyProfile();
    }
  });

  const debouncedSearch = debounce((value) => setFilter('q', value), 180);
  $('#search-input').addEventListener('input', (event) => debouncedSearch(event.target.value));

  $('#filter-assignee').addEventListener('change', (event) =>
    setFilter('assigneeId', event.target.value),
  );
  $('#filter-priority').addEventListener('change', (event) =>
    setFilter('priority', event.target.value),
  );
  $('#filter-type').addEventListener('change', (event) => setFilter('type', event.target.value));

  $('#clear-filters').addEventListener('click', () => {
    clearFilters();
    populateFilters();
  });

  // 看板默认条件开关：隐藏 / 显示完成超过 7 天的任务
  $('#stale-toggle').addEventListener('click', () => toggleStaleDone());

  $('#refresh-btn').addEventListener('click', async () => {
    const button = $('#refresh-btn');
    button.disabled = true;
    await bootstrap({ silent: true });
    if (state.tasks.length) {
      toast('数据已刷新', 'success', 1600);
      if (state.view === 'analytics') await maybeLoadAnalytics(true);
    }
    button.disabled = false;
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const modalOpen = !document.getElementById('modal-backdrop').hidden;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#search-input').focus();
      $('#search-input').select();
      return;
    }
    if (event.key === 'Escape' && !modalOpen && isDrawerOpen()) {
      closeTaskDrawer();
      return;
    }
    if (typing || modalOpen) return;
    if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openTaskModal();
    }
  });

  window.addEventListener('offline', () => {
    state.offline = true;
    toast('网络已断开，操作将无法保存', 'error', 4000);
    render();
  });
  window.addEventListener('online', () => {
    toast('网络已恢复，正在重新同步', 'success', 2000);
    bootstrap({ silent: true });
  });

  setInterval(() => {
    if (state.lastSync && !state.loading) renderShell();
  }, 30_000);
}

subscribe(() => {
  render();
  if (state.view === 'analytics') maybeLoadAnalytics();
});

async function start() {
  bindShell();
  if (!location.hash) history.replaceState(null, '', '#/board');
  state.view = currentView();
  render();
  await bootstrap();
  populateFilters();
  render();
  if (state.view === 'analytics') maybeLoadAnalytics();
}

start();
