import { difficultyMeta, isDoneStatus, memberById, state, statusMeta } from '../state.js';
import { avatarHtml, escapeHtml } from '../utils.js';
import {
  donutChart,
  emptyChart,
  groupedBarChart,
  ringProgress,
  sparkline,
  stackedAreaChart,
} from '../charts.js';
import { openTaskDrawer } from '../drawer.js';
import { openDetailModal } from '../modal.js';

/**
 * 分析看板：卡片 + 图形优先，明细全部走「点击下钻」的弹框或任务抽屉。
 * 所有明细由 state.tasks 在本地过滤，口径与服务端聚合保持一致（同源数据）。
 */

const DAY = 86_400_000;
const COLUMN_PALETTE = ['#c3c8d4', '#5b5bd6', '#d97706', '#0d9488', '#8e4ec6', '#0891b2', '#e5484d', '#64748b'];

const weekStartOf = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // 周一为一周起点
  return d.getTime() - offset * DAY;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const openOf = () => state.tasks.filter((task) => !isDoneStatus(task.status));
const doneOf = () => state.tasks.filter((task) => task.completedAt && isDoneStatus(task.status));

const cycleDaysOf = (task) => {
  if (!task.startedAt || !task.completedAt) return null;
  const diff = new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime();
  return Math.max(0, Math.round((diff / DAY) * 10) / 10);
};

const memberNameOf = (task) => memberById(task.assigneeId)?.name ?? '未指派';

const difficultyBadge = (task) => {
  if (!task.difficulty) return '<span class="detail-muted">未评估</span>';
  const d = difficultyMeta(task.difficulty);
  return `<span class="diff-badge" style="color:${d.color};background:${d.color}18">${escapeHtml(d.name)}</span>`;
};

/* ---------------- 明细弹框：任务列表 ---------------- */

function taskTable(rows, { showCycle = false, empty = '暂无任务' } = {}) {
  if (!rows.length) return `<p class="detail-empty">${empty}</p>`;
  const body = rows
    .map((task) => {
      const cycle = cycleDaysOf(task);
      return `<tr data-task-id="${task.id}">
        <td class="detail-key">${escapeHtml(task.key)}</td>
        <td class="detail-title">${escapeHtml(task.title)}</td>
        <td>${escapeHtml(statusMeta(task.status).name)}</td>
        <td>${escapeHtml(memberNameOf(task))}</td>
        <td>${difficultyBadge(task)}</td>
        <td>${showCycle ? (cycle === null ? '—' : `${cycle} 天`) : escapeHtml(fmtDate(task.dueDate))}</td>
      </tr>`;
    })
    .join('');
  return `<table class="detail-table">
    <thead><tr><th>编号</th><th>标题</th><th>状态</th><th>负责人</th><th>难度</th><th>${
      showCycle ? '周期' : '截止'
    }</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function openTaskList({ title, subtitle, rows, showCycle = false, empty }) {
  openDetailModal({
    title,
    subtitle,
    body: taskTable(rows, { showCycle, empty }),
    onMount({ close, modal }) {
      modal.querySelectorAll('tr[data-task-id]').forEach((row) => {
        row.addEventListener('click', () => {
          close({ skipDismiss: true });
          openTaskDrawer(row.dataset.taskId);
        });
      });
    },
  });
}

function statStrip(items) {
  return `<div class="detail-stats">${items
    .map(
      (item) =>
        `<div class="detail-stat"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(
          String(item.value),
        )}${item.unit ? `<em>${escapeHtml(item.unit)}</em>` : ''}</strong></div>`,
    )
    .join('')}</div>`;
}

/* ---------------- 卡片片段 ---------------- */

function deltaFoot(current, previous, unit = '个') {
  const diff = current - previous;
  if (!diff) return '<span class="an-flat">与上周持平</span>';
  const pct = previous ? Math.round((Math.abs(diff) / previous) * 100) : 100;
  return diff > 0
    ? `<span class="an-up">▲ ${diff}${unit}（+${pct}%）</span>`
    : `<span class="an-down">▼ ${Math.abs(diff)}${unit}（-${pct}%）</span>`;
}

function kpiCard({ id, label, value, unit = '', foot = '', spark = '', ring = '', tone = '' }) {
  return `<button type="button" class="an-kpi ${tone}" data-detail="${id}">
    <span class="an-kpi-label">${label}</span>
    <span class="an-kpi-value">${value}${unit ? `<em>${unit}</em>` : ''}</span>
    <span class="an-kpi-foot">${foot}</span>
    ${ring ? `<span class="an-kpi-ring">${ring}</span>` : ''}
    ${spark ? `<span class="an-kpi-spark">${spark}</span>` : ''}
  </button>`;
}

function weekHeader(weeks) {
  return `<div class="an-heat-head"><span></span>${weeks
    .map((week) => `<span>${escapeHtml(week.label)}</span>`)
    .join('')}</div>`;
}

/* ---------------- 主渲染 ---------------- */

export function renderAnalytics(root) {
  const data = state.analytics;
  if (!data) {
    root.innerHTML = `<div class="skeleton-wrap">
      <div class="skeleton skeleton-kpi"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>`;
    return;
  }

  const kpi = data.kpi;
  const throughput = data.throughput ?? [];
  const cfd = data.cfd ?? [];
  const weeks = data.memberWeekly?.weeks ?? [];
  const columnSeries = (data.columns ?? [])
    .map((column, index) => ({
      key: column.id,
      name: column.name,
      color: column.isDone ? '#12866f' : COLUMN_PALETTE[index % COLUMN_PALETTE.length],
    }))
    .reverse();

  const now = Date.now();
  const thisWeek = weekStartOf(now);
  const lastWeek = thisWeek - 7 * DAY;
  const doneThisWeek = doneOf().filter((task) => new Date(task.completedAt).getTime() >= thisWeek);
  const doneLastWeek = doneOf().filter((task) => {
    const ts = new Date(task.completedAt).getTime();
    return ts >= lastWeek && ts < thisWeek;
  });

  const openRows = openOf();
  const overdueRows = openRows
    .filter((task) => task.dueDate && new Date(`${task.dueDate}T00:00:00`).getTime() < now)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const maxLate = overdueRows.length
    ? Math.floor((now - new Date(`${overdueRows[0].dueDate}T00:00:00`).getTime()) / DAY)
    : 0;

  // ---- 成员负载 ----
  const loadRows = (data.byMember ?? [])
    .slice()
    .sort((a, b) => b.points - a.points || b.open - a.open);
  const maxLoadPoints = Math.max(1, ...loadRows.map((row) => row.points));
  const loadHtml = loadRows
    .map((row) => {
      const info = memberById(row.id);
      const memberTasks = openRows.filter((task) => task.assigneeId === row.id);
      const doingPoints = memberTasks
        .filter((task) => task.status === (data.columns ?? []).find((c) => c.isStart)?.id)
        .reduce((sum, task) => sum + difficultyMeta(task.difficulty).weight, 0);
      const width = Math.round((row.points / maxLoadPoints) * 100);
      const doingShare = row.points ? Math.round((doingPoints / row.points) * 100) : 0;
      return `<button type="button" class="an-load-row" data-member-load="${row.id}">
        <span class="an-load-name">${avatarHtml(info, 'avatar-xs')}${escapeHtml(row.name)}</span>
        <span class="an-load-bar">
          <span class="an-load-fill" style="width:${width}%">
            <span class="an-load-doing" style="width:${doingShare}%"></span>
          </span>
        </span>
        <span class="an-load-value">${row.points} 分 · ${row.open} 个</span>
      </button>`;
    })
    .join('');

  // ---- 周度热力 ----
  const weeklyMembers = data.memberWeekly?.members ?? [];
  const maxCell = Math.max(1, ...weeklyMembers.flatMap((row) => row.weeks.map((cell) => cell.completed)));
  const heatHtml = `<div class="an-heat">
    ${weekHeader(weeks)}
    ${weeklyMembers
      .map(
        (row) => `<div class="an-heat-row">
          <span class="an-heat-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name.slice(0, 2))}</span>
          ${row.weeks
            .map((cell, index) => {
              const alpha = cell.completed ? 0.14 + 0.7 * (cell.completed / maxCell) : 0;
              const color = alpha > 0.55 ? '#fff' : cell.completed ? 'var(--text-1)' : 'var(--text-3)';
              return `<button type="button" class="an-heat-cell" data-heat="${row.id ?? 'none'}|${index}" style="background:rgba(91,91,214,${alpha.toFixed(
                2,
              )});color:${color}" title="${escapeHtml(row.name)} · ${escapeHtml(weeks[index]?.label ?? '')}：完成 ${
                cell.completed
              } 个">${cell.completed || ''}</button>`;
            })
            .join('')}
        </div>`,
      )
      .join('')}
  </div>`;

  // ---- 风险 ----
  const breaches = (data.wipBreaches ?? []).filter((row) => row.limit);
  const exceededCols = breaches.filter((row) => row.exceeded);
  const atLimitCols = breaches.filter((row) => !row.exceeded && row.count === row.limit);
  const riskHtml = `
    ${
      overdueRows.length
        ? overdueRows
            .slice(0, 3)
            .map((task) => {
              const days = Math.floor((now - new Date(`${task.dueDate}T00:00:00`).getTime()) / DAY);
              return `<button type="button" class="an-risk-item" data-risk-task="${task.id}">
                <span class="an-risk-key">${escapeHtml(task.key)}</span>
                <span class="an-risk-title">${escapeHtml(task.title)}</span>
                <span class="an-risk-badge">逾期 ${days} 天</span>
              </button>`;
            })
            .join('')
        : '<p class="an-risk-empty">当前没有逾期任务</p>'
    }
    ${
      exceededCols.length || atLimitCols.length
        ? `<div class="an-risk-wip">
            ${exceededCols
              .map(
                (row) =>
                  `<span class="an-wip-chip danger">${escapeHtml(row.name)} 超限 ${row.count}/${
                    row.limit
                  }</span>`,
              )
              .join('')}
            ${atLimitCols
              .map(
                (row) =>
                  `<span class="an-wip-chip">${escapeHtml(row.name)} 已达上限 ${row.count}/${
                    row.limit
                  }</span>`,
              )
              .join('')}
          </div>`
        : ''
    }`;

  root.innerHTML = `<div class="an-page">
    <header class="an-top">
      <div>
        <div class="an-title">效能概览</div>
        <div class="an-sub">近 ${weeks.length || 8} 周 · 更新于 ${fmtDate(
          data.generatedAt,
        )} · 点击卡片或图元查看明细</div>
      </div>
      <div class="an-legend">
        ${(data.byType ?? [])
          .map(
            (item) =>
              `<span class="an-legend-item"><i style="background:${item.color}"></i>${escapeHtml(
                item.name,
              )} ${item.count}</span>`,
          )
          .join('')}
      </div>
    </header>

    <section class="an-kpis">
      ${kpiCard({
        id: 'completed',
        label: '本周完成',
        value: kpi.completedThisWeek,
        unit: '个',
        foot: deltaFoot(kpi.completedThisWeek, kpi.completedLastWeek),
        spark: sparkline(throughput.map((row) => row.completed ?? 0), { color: '#5b5bd6' }),
      })}
      ${kpiCard({
        id: 'wip',
        label: '进行中',
        value: kpi.inProgress,
        unit: '个',
        foot: `未完成共 ${kpi.open} 个`,
      })}
      ${kpiCard({
        id: 'cycle',
        label: '平均周期',
        value: kpi.avgCycle,
        unit: '天',
        foot: `中位数 ${kpi.medianCycle} 天 · 样本 ${data.cycleSample}`,
        spark: sparkline(
          throughput.map((row) => row.avgCycle ?? 0).filter((value) => value > 0),
          { color: '#0d9488' },
        ),
      })}
      ${kpiCard({
        id: 'completion',
        label: '完成率',
        value: kpi.completionRate,
        unit: '%',
        foot: `累计 ${kpi.total - kpi.open}/${kpi.total}`,
        ring: ringProgress(kpi.completionRate, { size: 44, thickness: 5 }),
      })}
      ${kpiCard({
        id: 'overdue',
        label: '逾期任务',
        value: kpi.overdue,
        unit: '个',
        tone: kpi.overdue ? 'danger' : '',
        foot: kpi.overdue ? `最长逾期 ${maxLate} 天` : '当前无逾期',
      })}
      ${kpiCard({
        id: 'points',
        label: '在制难度分',
        value: kpi.wipPoints,
        unit: '分',
        foot: `平均交付 ${kpi.avgLead} 天`,
      })}
    </section>

    <section class="an-grid">
      <article class="an-card" data-detail="throughput">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">交付节奏</div>
            <div class="an-card-sub">每周新建与完成对比，点击查看周明细</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        ${throughput.length ? groupedBarChart(
          throughput,
          [
            { key: 'created', name: '新建', color: '#9aa3f0' },
            { key: 'completed', name: '完成', color: '#5b5bd6' },
          ],
          { height: 210 },
        ) : emptyChart(210)}
      </article>

      <article class="an-card" data-detail="cfd">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">累计流（CFD）</div>
            <div class="an-card-sub">各列存量随时间变化，识别积压</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        ${cfd.length ? stackedAreaChart(cfd, columnSeries, { height: 210 }) : emptyChart(210)}
      </article>

      <article class="an-card" data-detail="load">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">成员负载</div>
            <div class="an-card-sub">按未完成难度分排序 · 深色为进行中</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        <div class="an-load">${loadHtml || '<p class="an-risk-empty">暂无成员</p>'}</div>
      </article>

      <article class="an-card" data-detail="heat">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">周度节奏</div>
            <div class="an-card-sub">每人每周完成任务数，点格子看当周明细</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        ${heatHtml}
      </article>

      <article class="an-card" data-detail="mix">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">任务构成</div>
            <div class="an-card-sub">按类型分布</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        <div class="an-mix">
          ${donutChart(data.byType ?? [], { size: 148, thickness: 16, centerLabel: '任务' })}
        </div>
      </article>

      <article class="an-card" data-detail="risk">
        <div class="an-card-head">
          <div>
            <div class="an-card-title">风险预警</div>
            <div class="an-card-sub">逾期与 WIP 超限，点击任务直达详情</div>
          </div>
          <span class="an-link">明细</span>
        </div>
        ${riskHtml}
      </article>
    </section>
  </div>`;

  const page = root.querySelector('.an-page');
  if (page)
    bindInteractions(page, {
      data,
      weeks,
      doneThisWeek,
      doneLastWeek,
      overdueRows,
      openRows,
      exceededCols,
      atLimitCols,
    });
}

/* ---------------- 交互 ---------------- */

function bindInteractions(root, ctx) {
  const { data, weeks, doneThisWeek, doneLastWeek, overdueRows, openRows, exceededCols, atLimitCols } = ctx;

  root.addEventListener('click', (event) => {
    const riskTask = event.target.closest('[data-risk-task]');
    if (riskTask) {
      event.stopPropagation();
      openTaskDrawer(riskTask.dataset.riskTask);
      return;
    }

    const heatCell = event.target.closest('[data-heat]');
    if (heatCell) {
      event.stopPropagation();
      const [memberId, index] = heatCell.dataset.heat.split('|');
      openHeatDetail(data, memberId === 'none' ? null : memberId, Number(index));
      return;
    }

    const memberRow = event.target.closest('[data-member-load]');
    if (memberRow) {
      event.stopPropagation();
      const memberId = memberRow.dataset.memberLoad;
      const tasks = openRows.filter((task) => task.assigneeId === memberId);
      openTaskList({
        title: `${memberById(memberId)?.name ?? '成员'} · 未完成任务`,
        subtitle: `共 ${tasks.length} 个，按难度分加权排序`,
        rows: tasks.sort(
          (a, b) => difficultyMeta(b.difficulty).weight - difficultyMeta(a.difficulty).weight,
        ),
      });
      return;
    }

    const card = event.target.closest('[data-detail]');
    if (!card) return;
    const kind = card.dataset.detail;
    const handlers = {
      completed: () =>
        openDetailModal({
          title: '本周交付明细',
          subtitle: '本周与上周完成的任务，点击行可打开任务详情',
          body: `${statStrip([
            { label: '本周完成', value: doneThisWeek.length, unit: '个' },
            { label: '上周完成', value: doneLastWeek.length, unit: '个' },
          ])}${taskTable(doneThisWeek, { showCycle: true, empty: '本周还没有完成的任务' })}`,
          onMount({ close, modal }) {
            modal.querySelectorAll('tr[data-task-id]').forEach((row) => {
              row.addEventListener('click', () => {
                close({ skipDismiss: true });
                openTaskDrawer(row.dataset.taskId);
              });
            });
          },
        }),
      wip: () => {
        const group = (data.columns ?? []).map((column) => ({
          column,
          tasks: openRows.filter((task) => task.status === column.id),
        }));
        openDetailModal({
          title: '进行中与在办分布',
          subtitle: '按看板列统计未完成任务，WIP 超限会在风险卡片提示',
          body: `<div class="detail-cols">${group
            .map(
              (item) => `<div class="detail-col">
                <div class="detail-col-head"><span>${escapeHtml(item.column.name)}</span><b>${
                  item.tasks.length
                }</b></div>
                <div class="detail-col-body">${
                  item.tasks.length
                    ? item.tasks
                        .slice(0, 6)
                        .map(
                          (task) =>
                            `<button type="button" class="detail-mini" data-open-task="${task.id}">
                              <span class="detail-key">${escapeHtml(task.key)}</span>
                              <span>${escapeHtml(task.title)}</span>
                            </button>`,
                        )
                        .join('')
                    : '<p class="detail-muted">空</p>'
                }</div>
              </div>`,
            )
            .join('')}</div>`,
          onMount({ close, modal }) {
            modal.querySelectorAll('[data-open-task]').forEach((btn) => {
              btn.addEventListener('click', () => {
                close({ skipDismiss: true });
                openTaskDrawer(btn.dataset.openTask);
              });
            });
          },
        });
      },
      cycle: () => {
        const buckets = [
          { label: '≤1 天', min: 0, max: 1 },
          { label: '1~3 天', min: 1, max: 3 },
          { label: '3~7 天', min: 3, max: 7 },
          { label: '7~14 天', min: 7, max: 14 },
          { label: '>14 天', min: 14, max: Infinity },
        ].map((bucket) => {
          const rows = doneOf().filter((task) => {
            const days = cycleDaysOf(task);
            return days !== null && days >= bucket.min && days < bucket.max;
          });
          return { ...bucket, count: rows.length, rows };
        });
        const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
        openDetailModal({
          title: '交付周期分布',
          subtitle: `平均 ${data.kpi.avgCycle} 天 · 中位数 ${data.kpi.medianCycle} 天 · 样本 ${data.cycleSample} 个`,
          body: `<div class="detail-bars">${buckets
            .map(
              (bucket) => `<div class="detail-bar-row">
                <span class="detail-bar-label">${bucket.label}</span>
                <span class="detail-bar-track"><span style="width:${Math.round(
                  (bucket.count / maxCount) * 100,
                )}%"></span></span>
                <span class="detail-bar-value">${bucket.count}</span>
              </div>`,
            )
            .join('')}</div>
            ${taskTable(
              doneOf()
                .slice()
                .sort((a, b) => (cycleDaysOf(b) ?? 0) - (cycleDaysOf(a) ?? 0))
                .slice(0, 20),
              { showCycle: true },
            )}`,
          onMount({ close, modal }) {
            modal.querySelectorAll('tr[data-task-id]').forEach((row) => {
              row.addEventListener('click', () => {
                close({ skipDismiss: true });
                openTaskDrawer(row.dataset.taskId);
              });
            });
          },
        });
      },
      completion: () => {
        const types = (data.byType ?? []).map((type) => {
          const all = state.tasks.filter((task) => task.type === type.id);
          const done = all.filter((task) => isDoneStatus(task.status));
          return {
            ...type,
            total: all.length,
            done: done.length,
            rate: all.length ? Math.round((done.length / all.length) * 100) : 0,
          };
        });
        openDetailModal({
          title: '完成率构成',
          subtitle: '按任务类型拆分完成情况',
          body: `${statStrip([
            { label: '整体完成率', value: `${data.kpi.completionRate}`, unit: '%' },
            { label: '已完成', value: data.kpi.total - data.kpi.open, unit: '个' },
            { label: '未完成', value: data.kpi.open, unit: '个' },
          ])}
          <table class="detail-table"><thead><tr><th>类型</th><th>总数</th><th>已完成</th><th>完成率</th></tr></thead>
          <tbody>${types
            .map(
              (type) => `<tr><td>${escapeHtml(type.name)}</td><td>${type.total}</td><td>${
                type.done
              }</td><td>${type.rate}%</td></tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      overdue: () =>
        openTaskList({
          title: '逾期任务',
          subtitle: `共 ${overdueRows.length} 个，按截止日期排序；点击行打开任务`,
          rows: overdueRows,
          empty: '当前没有逾期任务',
        }),
      points: () => {
        const byDifficulty = (state.meta.difficulties ?? []).map((item) => {
          const rows = openRows.filter((task) => task.difficulty === item.id);
          return { ...item, rows, count: rows.length };
        });
        const unrated = openRows.filter((task) => !task.difficulty);
        openDetailModal({
          title: '在制难度构成',
          subtitle: `未完成任务合计 ${data.kpi.wipPoints} 分（未评估任务不计分）`,
          body: `<table class="detail-table"><thead><tr><th>难度</th><th>权重</th><th>任务数</th><th>小计</th></tr></thead>
          <tbody>${byDifficulty
            .map(
              (item) => `<tr><td>${difficultyBadge({ difficulty: item.id })}</td><td>${
                item.weight
              }</td><td>${item.count}</td><td>${item.count * item.weight}</td></tr>`,
            )
            .join('')}
          <tr><td><span class="detail-muted">未评估</span></td><td>0</td><td>${
            unrated.length
          }</td><td>0</td></tr></tbody></table>`,
        });
      },
      throughput: () => {
        const rows = data.throughput ?? [];
        const avgCreate = rows.length
          ? Math.round(rows.reduce((sum, row) => sum + (row.created ?? 0), 0) / rows.length)
          : 0;
        const avgDone = rows.length
          ? Math.round(rows.reduce((sum, row) => sum + (row.completed ?? 0), 0) / rows.length)
          : 0;
        openDetailModal({
          title: '交付节奏明细',
          subtitle: '每周新建 / 完成 / 平均周期',
          body: `${statStrip([
            { label: '周均新建', value: avgCreate, unit: '个' },
            { label: '周均完成', value: avgDone, unit: '个' },
            { label: '完成率', value: kpiRate(rows), unit: '%' },
          ])}
          <table class="detail-table"><thead><tr><th>周</th><th>新建</th><th>完成</th><th>平均周期</th></tr></thead>
          <tbody>${rows
            .map(
              (row) => `<tr><td>${escapeHtml(row.label ?? '')}</td><td>${row.created ?? 0}</td><td>${
                row.completed ?? 0
              }</td><td>${row.avgCycle ? `${row.avgCycle} 天` : '—'}</td></tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      cfd: () => {
        const series = (data.columns ?? []).slice();
        openDetailModal({
          title: '累计流明细',
          subtitle: '每周各列存量（任务数）',
          body: `<table class="detail-table"><thead><tr><th>周</th>${series
            .map((column) => `<th>${escapeHtml(column.name)}</th>`)
            .join('')}</tr></thead>
          <tbody>${(data.cfd ?? [])
            .map(
              (row) => `<tr><td>${escapeHtml(row.label ?? '')}</td>${series
                .map((column) => `<td>${row[column.id] ?? 0}</td>`)
                .join('')}</tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      load: () => {
        const rows = (data.byMember ?? []).slice().sort((a, b) => b.points - a.points);
        openDetailModal({
          title: '成员负载明细',
          subtitle: '未完成任务数、进行中、难度分、近 30 天完成',
          body: `<table class="detail-table"><thead><tr><th>成员</th><th>未完成</th><th>进行中</th><th>难度分</th><th>近 30 天完成</th><th>紧急</th></tr></thead>
          <tbody>${rows
            .map(
              (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.open}</td><td>${
                row.inProgress
              }</td><td>${row.points}</td><td>${row.done30d}</td><td>${row.urgent}</td></tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      heat: () => {
        const members = data.memberWeekly?.members ?? [];
        openDetailModal({
          title: '周度节奏明细',
          subtitle: '每人每周完成任务数 / 难度分',
          body: `<table class="detail-table"><thead><tr><th>成员</th>${weeks
            .map((week) => `<th>${escapeHtml(week.label)}</th>`)
            .join('')}<th>合计</th></tr></thead>
          <tbody>${members
            .map(
              (row) => `<tr><td>${escapeHtml(row.name)}</td>${row.weeks
                .map((cell) => `<td>${cell.completed || '·'}</td>`)
                .join('')}<td>${row.totals.completed}</td></tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      mix: () => {
        const types = data.byType ?? [];
        const priorities = data.byPriority ?? [];
        openDetailModal({
          title: '任务构成明细',
          subtitle: `全部 ${data.kpi.total} 个任务`,
          body: `<table class="detail-table"><thead><tr><th>类型</th><th>数量</th><th>占比</th></tr></thead>
          <tbody>${types
            .map(
              (item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.count}</td><td>${
                data.kpi.total ? Math.round((item.count / data.kpi.total) * 100) : 0
              }%</td></tr>`,
            )
            .join('')}</tbody></table>
          <table class="detail-table" style="margin-top:14px"><thead><tr><th>优先级</th><th>数量</th><th>占比</th></tr></thead>
          <tbody>${priorities
            .map(
              (item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.count}</td><td>${
                data.kpi.total ? Math.round((item.count / data.kpi.total) * 100) : 0
              }%</td></tr>`,
            )
            .join('')}</tbody></table>`,
        });
      },
      risk: () =>
        openDetailModal({
          title: '风险预警明细',
          subtitle: '逾期任务与 WIP 超限列',
          body: `${statStrip([
            { label: '逾期', value: data.kpi.overdue, unit: '个' },
            { label: 'WIP 超限', value: exceededCols.length, unit: '列' },
            { label: '已达上限', value: atLimitCols.length, unit: '列' },
          ])}
          ${
            exceededCols.length || atLimitCols.length
              ? `<div class="detail-wip">${exceededCols
                  .map(
                    (row) =>
                      `<div class="detail-wip-row danger"><b>${escapeHtml(row.name)}</b><span>超限 ${
                        row.count
                      } / ${row.limit}</span></div>`,
                  )
                  .join('')}${atLimitCols
                  .map(
                    (row) =>
                      `<div class="detail-wip-row"><b>${escapeHtml(row.name)}</b><span>已达上限 ${
                        row.count
                      } / ${row.limit}</span></div>`,
                  )
                  .join('')}</div>`
              : '<p class="detail-empty">没有 WIP 超限的列</p>'
          }
          ${taskTable(overdueRows, { empty: '当前没有逾期任务' })}`,
          onMount({ close, modal }) {
            modal.querySelectorAll('tr[data-task-id]').forEach((row) => {
              row.addEventListener('click', () => {
                close({ skipDismiss: true });
                openTaskDrawer(row.dataset.taskId);
              });
            });
          },
        }),
    };
    handlers[kind]?.();
  });
}

function kpiRate(rows) {
  const created = rows.reduce((sum, row) => sum + (row.created ?? 0), 0);
  const completed = rows.reduce((sum, row) => sum + (row.completed ?? 0), 0);
  return created ? Math.round((completed / created) * 100) : 0;
}

function openHeatDetail(data, memberId, weekIndex) {
  const week = data.memberWeekly?.weeks?.[weekIndex];
  const start = week ? new Date(`${week.start}T00:00:00`).getTime() : 0;
  const end = start + 7 * DAY;
  const memberName = memberId ? memberById(memberId)?.name ?? '成员' : '未指派';
  const rows = state.tasks.filter((task) => {
    if (!task.completedAt) return false;
    const ts = new Date(task.completedAt).getTime();
    if (ts < start || ts >= end) return false;
    return memberId ? task.assigneeId === memberId : !task.assigneeId;
  });
  openTaskList({
    title: `${memberName} · ${week?.label ?? ''} 完成详情`,
    subtitle: `当周完成 ${rows.length} 个任务`,
    rows,
    showCycle: true,
    empty: '当周没有完成的任务',
  });
}
