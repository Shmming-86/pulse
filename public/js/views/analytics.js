import { memberById, state } from '../state.js';
import { avatarHtml, escapeHtml, icon } from '../utils.js';
import { donutChart, groupedBarChart, lineChart, stackedAreaChart } from '../charts.js';
import { openTaskDrawer } from '../drawer.js';

/** 成员周度统计的指标切换（模块级，切换后重渲染面板即可） */
const WEEKLY_METRICS = {
  completed: { label: '完成任务', unit: '个' },
  created: { label: '新建任务', unit: '个' },
  started: { label: '开始任务', unit: '个' },
  points: { label: '完成点数', unit: '点' },
};
let weeklyMetric = 'completed';

function weeklyTable(data, metric) {
  const conf = WEEKLY_METRICS[metric];
  const weeks = data.weeks ?? [];
  const rows = data.members ?? [];
  const max = Math.max(1, ...rows.flatMap((row) => row.weeks.map((cell) => cell[metric] ?? 0)));

  const cellHtml = (value) => {
    if (!value) return '<td class="wk-cell empty">·</td>';
    const alpha = 0.12 + 0.72 * (value / max);
    const color = alpha > 0.55 ? '#fff' : 'var(--text-1)';
    return `<td class="wk-cell" style="background:rgba(91,91,214,${alpha.toFixed(2)});color:${color}">${value}</td>`;
  };

  const body = rows
    .map(
      (row) => `<tr>
        <td class="wk-name">
          ${
            row.id
              ? avatarHtml(memberById(row.id) ?? { name: row.name, color: row.color, role: row.role }, 'avatar-sm')
              : '<span class="avatar avatar-sm" style="background:#c3c8d4">?</span>'
          }
          <span>${escapeHtml(row.name)}</span>
        </td>
        ${row.weeks.map((cell) => cellHtml(cell[metric])).join('')}
        <td class="wk-total">${row.totals[metric]}</td>
        <td class="wk-cycle">${row.totals.cycleCount ? `${row.totals.cycle} 天` : '—'}</td>
      </tr>`,
    )
    .join('');

  const foot = `<tr class="wk-foot">
      <td class="wk-name">合计</td>
      ${(data.totals ?? []).map((total) => `<td class="wk-cell">${total[metric] ?? 0}</td>`).join('')}
      <td class="wk-total">${rows.reduce((sum, row) => sum + (row.totals[metric] ?? 0), 0)}</td>
      <td class="wk-cycle">—</td>
    </tr>`;

  if (!rows.length) {
    return '<div class="weekly-empty">还没有成员数据</div>';
  }

  return `<div class="weekly-head">
      <div class="metric-switch">
        ${Object.entries(WEEKLY_METRICS)
          .map(
            ([key, item]) =>
              `<button type="button" data-weekly-metric="${key}" class="${
                key === metric ? 'on' : ''
              }">${item.label}</button>`,
          )
          .join('')}
      </div>
      <span class="weekly-unit">单位：${conf.unit}</span>
    </div>
    <div class="weekly-scroll">
      <table class="weekly-table">
        <thead>
          <tr>
            <th class="wk-name">成员</th>
            ${weeks.map((week) => `<th title="${escapeHtml(week.start)} 起的一周">${escapeHtml(week.label)}</th>`).join('')}
            <th class="wk-total">8 周合计</th>
            <th class="wk-cycle">平均周期</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
    </div>`;
}

function kpiCard(label, value, unit, foot, tone = '') {
  return `<div class="kpi">
    <span class="kpi-label">${escapeHtml(label)}</span>
    <span class="kpi-value ${tone}">${value}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</span>
    <span class="kpi-foot">${foot}</span>
  </div>`;
}

function trendFoot(current, previous, suffix = '个') {
  const diff = current - previous;
  if (diff === 0) return '与上周持平';
  const cls = diff > 0 ? 'up' : 'down';
  const sign = diff > 0 ? '+' : '';
  return `较上周 <span class="${cls}">${sign}${diff} ${suffix}</span>`;
}

function insights(data) {
  const { kpi, byMember, wipBreaches } = data;
  const parts = [];
  const diff = kpi.completedThisWeek - kpi.completedLastWeek;
  parts.push(
    `本周完成 <strong>${kpi.completedThisWeek}</strong> 个任务，${
      diff === 0 ? '与上周持平' : diff > 0 ? `比上周多 <strong>${diff}</strong> 个` : `比上周少 <strong>${-diff}</strong> 个`
    }。`,
  );
  if (kpi.overdue > 0) {
    parts.push(
      `有 <strong>${kpi.overdue}</strong> 个任务已逾期，占未完成任务的 ${Math.round(
        (kpi.overdue / Math.max(1, kpi.open)) * 100,
      )}%，建议优先清空。`,
    );
  }
  const busiest = byMember.slice().sort((a, b) => b.points - a.points)[0];
  if (busiest && busiest.points > 0) {
    parts.push(`当前在制工作量最高的是 <strong>${escapeHtml(busiest.name)}</strong>（${busiest.points} 点 / ${busiest.open} 个任务）。`);
  }
  const breach = wipBreaches.find((item) => item.exceeded);
  if (breach) parts.push(`「${escapeHtml(breach.name)}」已超过 WIP 上限（${breach.count}/${breach.limit}）。`);
  return parts.join('');
}

function wipPanel(data) {
  const breaches = data.wipBreaches
    .map((item) => {
      const ratio = Math.min(1, item.count / Math.max(1, item.limit));
      return `<div class="bar-row">
        <span class="bar-label">${escapeHtml(item.name)}</span>
        <div class="bar-track"><i class="bar-fill" style="width:${Math.round(ratio * 100)}%;background:${
          item.exceeded ? '#e5484d' : '#5b5bd6'
        }"></i></div>
        <span class="bar-value ${item.exceeded ? '' : ''}" style="${
          item.exceeded ? 'color:#e5484d;font-weight:600' : ''
        }">${item.count}/${item.limit}</span>
      </div>`;
    })
    .join('');

  const overdue = data.overdue.length
    ? data.overdue
        .map(
          (task) => `<div class="mini-row" data-task-id="${task.id}">
            <span class="mini-key">${escapeHtml(task.key)}</span>
            <span class="mini-title">${escapeHtml(task.title)}</span>
            <span class="mini-meta" style="color:#e5484d">逾期 ${task.daysLate} 天</span>
          </div>`,
        )
        .join('')
    : '<div style="padding:14px 2px;font-size:12px;color:var(--text-3)">没有逾期任务，节奏健康。</div>';

  return `<div class="panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">在制品与风险</div>
        <div class="panel-sub">WIP 上限用于限制并行，逾期任务需要优先处理</div>
      </div>
    </div>
    ${breaches}
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">
      <div class="panel-sub" style="margin-bottom:4px;font-weight:600;color:var(--text-2)">逾期任务</div>
      <div class="mini-list">${overdue}</div>
    </div>
  </div>`;
}

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

  const { kpi } = data;
  // 颜色按列顺序分配，完成列固定绿色；堆叠图从下到上按列逆序展示
  const COLUMN_PALETTE = ['#c3c8d4', '#5b5bd6', '#d97706', '#0d9488', '#8e4ec6', '#0891b2', '#e5484d', '#64748b'];
  const series = (data.columns ?? state.meta.columns ?? [])
    .map((column, index) => ({
      key: column.id,
      name: column.name,
      color: column.isDone ? '#12866f' : COLUMN_PALETTE[index % COLUMN_PALETTE.length],
    }))
    .reverse();

  const maxPoints = Math.max(1, ...data.byMember.map((member) => member.points));
  const memberBars = data.byMember
    .map((member) => {
      const memberInfo = memberById(member.id);
      const width = Math.round((member.points / maxPoints) * 100);
      const share = member.open ? Math.round((member.inProgress / member.open) * 100) : 0;
      return `<div class="bar-row" style="grid-template-columns:96px 1fr 76px">
        <span class="bar-label">${avatarHtml(memberInfo, 'avatar-sm')}${escapeHtml(member.name)}</span>
        <div class="bar-track" title="未完成任务 ${member.open} 个 / 估点 ${member.points} / 进行中 ${member.inProgress} 个">
          <div style="width:${width}%;height:100%;background:#c7c8f5;border-radius:4px;display:flex">
            <div style="width:${share}%;height:100%;background:#5b5bd6;border-radius:4px"></div>
          </div>
        </div>
        <span class="bar-value">${member.points} 点 / ${member.open} 个</span>
      </div>`;
    })
    .join('');

  const priorityLegend = data.byPriority
    .map(
      (item) => `<div class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${escapeHtml(
        item.name,
      )} · ${item.count}</div>`,
    )
    .join('');

  root.innerHTML = `<div class="analytics">
    <div class="insight">${icon('sparkle', 16)}<div>${insights(data)}</div></div>

    <div class="kpi-grid">
      ${kpiCard('进行中', kpi.inProgress, '个', `未完成共 ${kpi.open} 个`)}
      ${kpiCard('本周完成', kpi.completedThisWeek, '个', trendFoot(kpi.completedThisWeek, kpi.completedLastWeek))}
      ${kpiCard('平均周期', kpi.avgCycle, '天', `中位数 ${kpi.medianCycle} 天 · 样本 ${data.cycleSample}`)}
      ${kpiCard('完成率', kpi.completionRate, '%', `累计完成 ${kpi.total - kpi.open}/${kpi.total}`)}
      ${kpiCard(
        '逾期任务',
        kpi.overdue,
        '个',
        kpi.overdue ? `<span class="down">需要优先处理</span>` : '当前无逾期',
      )}
      ${kpiCard('在制工作量', kpi.wipPoints, '点', `平均交付周期 ${kpi.avgLead} 天`)}
    </div>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">累计流图（CFD）</div>
            <div class="panel-sub">按周统计各状态存量，识别积压与流转瓶颈</div>
          </div>
          <div class="legend">${series
            .slice()
            .reverse()
            .map(
              (item) =>
                `<span class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${item.name}</span>`,
            )
            .join('')}</div>
        </div>
        ${stackedAreaChart(data.cfd, series)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">优先级分布</div>
            <div class="panel-sub">全部 ${kpi.total} 个任务</div>
          </div>
        </div>
        ${donutChart(data.byPriority, { size: 158, centerLabel: '任务' })}
        <div class="legend" style="margin-top:12px;flex-direction:column;gap:6px">${priorityLegend}</div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">吞吐量</div>
            <div class="panel-sub">每周新建与完成任务数，观察需求进入与交付节奏</div>
          </div>
          <div class="legend">
            <span class="legend-item"><span class="legend-swatch" style="background:#c3c8d4"></span>新建</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#5b5bd6"></span>完成</span>
          </div>
        </div>
        ${groupedBarChart(
          data.throughput,
          [
            { key: 'created', name: '新建', color: '#c3c8d4' },
            { key: 'completed', name: '完成', color: '#5b5bd6' },
          ],
          { height: 220 },
        )}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">成员负载</div>
            <div class="panel-sub">深色为进行中占比，按剩余估点排序</div>
          </div>
        </div>
        ${memberBars}
        <div class="legend" style="margin-top:10px">
          <span class="legend-item"><span class="legend-swatch" style="background:#5b5bd6"></span>进行中</span>
          <span class="legend-item"><span class="legend-swatch" style="background:#c7c8f5"></span>其他未完成</span>
        </div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">周期时间趋势</div>
            <div class="panel-sub">从开始动手到完成所需的平均天数</div>
          </div>
        </div>
        ${lineChart(
          data.throughput.map((week) => ({ label: week.label, value: week.cycle })),
          { height: 208 },
        )}
      </div>
      ${wipPanel(data)}
    </div>

    <div class="panel weekly-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">成员周度统计</div>
          <div class="panel-sub">按任务当前负责人归属 · 每周一为起点 · 最近 8 周（开始时间取自任务首次进入「开始列」）</div>
        </div>
      </div>
      <div id="weekly-body">${
        data.memberWeekly ? weeklyTable(data.memberWeekly, weeklyMetric) : '<div class="weekly-empty">暂无数据</div>'
      }</div>
    </div>
  </div>`;

  const weeklyBody = root.querySelector('#weekly-body');
  if (weeklyBody && data.memberWeekly) {
    weeklyBody.addEventListener('click', (event) => {
      const button = event.target.closest('[data-weekly-metric]');
      if (!button) return;
      weeklyMetric = button.dataset.weeklyMetric;
      weeklyBody.innerHTML = weeklyTable(data.memberWeekly, weeklyMetric);
    });
  }

  root.querySelectorAll('.mini-row[data-task-id]').forEach((row) => {
    row.addEventListener('click', () => openTaskDrawer(row.dataset.taskId));
  });
}
