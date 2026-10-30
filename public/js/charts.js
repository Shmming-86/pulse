import { escapeHtml } from './utils.js';

/**
 * 轻量 SVG 图表：不引入第三方图表库，保证零依赖与完全可控的视觉风格。
 * 所有图表使用 viewBox 自适应容器宽度。
 */

const W = 680;

function niceMax(value) {
  if (value <= 4) return 4;
  return Math.ceil(value / 4) * 4;
}

function grid(max, { left, top, width, height }) {
  const ticks = 4;
  let out = '';
  for (let i = 0; i <= ticks; i += 1) {
    const value = (max / ticks) * i;
    const y = top + height - (height * i) / ticks;
    out += `<line class="grid-line" x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" />`;
    out += `<text x="${left - 8}" y="${y + 3.5}" text-anchor="end" font-size="10">${Math.round(
      value,
    )}</text>`;
  }
  return out;
}

function xAxis(labels, { left, top, width, height }) {
  return labels
    .map((label, index) => {
      const step = labels.length > 1 ? width / (labels.length - 1) : 0;
      const x = left + step * index;
      return `<text x="${x}" y="${top + height + 16}" text-anchor="middle" font-size="10">${escapeHtml(
        label,
      )}</text>`;
    })
    .join('');
}

export function stackedAreaChart(data, series, { height = 236 } = {}) {
  if (!data.length) return emptyChart(height);
  const pad = { left: 34, right: 14, top: 12, bottom: 26 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const totals = data.map((row) => series.reduce((sum, s) => sum + (row[s.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i) => pad.left + step * i;
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  let cumulative = data.map(() => 0);
  const layers = series.map((s) => {
    const upper = data.map((row, i) => cumulative[i] + (row[s.key] ?? 0));
    const points = data.map((_, i) => `${x(i).toFixed(1)},${y(upper[i]).toFixed(1)}`);
    const lowerPoints = data
      .map((_, i) => `${x(i).toFixed(1)},${y(cumulative[i]).toFixed(1)}`)
      .reverse();
    const area = `M${points.join('L')}L${lowerPoints.join('L')}Z`;
    const line = `M${points.join('L')}`;
    cumulative = upper;
    return `<path d="${area}" fill="${s.color}" fill-opacity="0.16" />
      <path d="${line}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round" />`;
  });

  const hover = data
    .map((row, i) => {
      const summary = series
        .map((s) => `${s.name} ${row[s.key] ?? 0}`)
        .join(' · ');
      const half = step / 2 || 12;
      return `<rect x="${x(i) - half}" y="${pad.top}" width="${Math.max(step, 10)}" height="${innerH}" fill="transparent">
        <title>${escapeHtml(row.label)} 当周 · ${escapeHtml(summary)}</title>
      </rect>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="累计流图">
    ${grid(max, { left: pad.left, top: pad.top, width: innerW, height: innerH })}
    <line class="axis-line" x1="${pad.left}" y1="${pad.top + innerH}" x2="${pad.left + innerW}" y2="${
      pad.top + innerH
    }" />
    ${layers.join('')}
    ${xAxis(data.map((row) => row.label), { left: pad.left, top: pad.top, width: innerW, height: innerH })}
    ${hover}
  </svg>`;
}

export function groupedBarChart(data, series, { height = 236 } = {}) {
  if (!data.length) return emptyChart(height);
  const pad = { left: 34, right: 14, top: 12, bottom: 26 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(
    Math.max(1, ...data.flatMap((row) => series.map((s) => row[s.key] ?? 0))),
  );
  const band = innerW / data.length;
  const barW = Math.min(18, (band - 10) / series.length);
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  const bars = data
    .map((row, i) => {
      const center = pad.left + band * i + band / 2;
      const groupWidth = barW * series.length + 3 * (series.length - 1);
      return series
        .map((s, si) => {
          const value = row[s.key] ?? 0;
          const bx = center - groupWidth / 2 + si * (barW + 3);
          const bh = Math.max(value === 0 ? 0 : 2, (value / max) * innerH);
          return `<rect x="${bx.toFixed(1)}" y="${(pad.top + innerH - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(
            1,
          )}" rx="3" fill="${s.color}" fill-opacity="${si === 0 ? 0.35 : 0.95}">
            <title>${escapeHtml(row.label)} · ${escapeHtml(s.name)} ${value}</title>
          </rect>`;
        })
        .join('');
    })
    .join('');

  const labels = data
    .map((row, i) => {
      const center = pad.left + band * i + band / 2;
      return `<text x="${center}" y="${pad.top + innerH + 16}" text-anchor="middle" font-size="10">${escapeHtml(
        row.label,
      )}</text>`;
    })
    .join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="吞吐量">
    ${grid(max, { left: pad.left, top: pad.top, width: innerW, height: innerH })}
    <line class="axis-line" x1="${pad.left}" y1="${pad.top + innerH}" x2="${pad.left + innerW}" y2="${
      pad.top + innerH
    }" />
    ${bars}
    ${labels}
  </svg>`;
}

export function lineChart(data, { height = 200, color = '#5b5bd6', suffix = ' 天' } = {}) {
  if (!data.length) return emptyChart(height);
  const pad = { left: 34, right: 14, top: 14, bottom: 26 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = data.map((row) => row.value);
  const max = niceMax(Math.max(1, ...values));
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i) => pad.left + step * i;
  const y = (v) => pad.top + innerH - (v / max) * innerH;
  const points = data.map((row, i) => `${x(i).toFixed(1)},${y(row.value).toFixed(1)}`);
  const area = `M${points.join('L')}L${x(data.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(
    1,
  )}L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)}Z`;

  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="周期时间趋势">
    ${grid(max, { left: pad.left, top: pad.top, width: innerW, height: innerH })}
    <path d="${area}" fill="${color}" fill-opacity="0.1" />
    <path d="M${points.join('L')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${data
      .map(
        (row, i) =>
          `<circle cx="${x(i)}" cy="${y(row.value)}" r="2.6" fill="#fff" stroke="${color}" stroke-width="2">
            <title>${escapeHtml(row.label)} · ${row.value}${suffix}</title>
          </circle>`,
      )
      .join('')}
    ${xAxis(
      data.map((row) => row.label),
      { left: pad.left, top: pad.top, width: innerW, height: innerH },
    )}
  </svg>`;
}

export function donutChart(items, { size = 168, thickness = 18, centerLabel = '任务' } = {}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  if (total === 0) {
    return `<div class="empty-state" style="padding:24px 0">暂无数据</div>`;
  }

  let angle = -Math.PI / 2;
  const paths = items
    .filter((item) => item.count > 0)
    .map((item) => {
      const sweep = (item.count / total) * Math.PI * 2;
      const gap = 0.02;
      const start = angle + gap / 2;
      const end = angle + sweep - gap / 2;
      angle += sweep;
      const largeArc = end - start > Math.PI ? 1 : 0;
      const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
      const outerR = radius;
      const innerR = radius - thickness;
      const d = `M${p(outerR, start)}A${outerR},${outerR} 0 ${largeArc} 1 ${p(outerR, end)}L${p(
        innerR,
        end,
      )}A${innerR},${innerR} 0 ${largeArc} 0 ${p(innerR, start)}Z`;
      return `<path d="${d}" fill="${item.color}">
        <title>${escapeHtml(item.name)} ${item.count}（${Math.round((item.count / total) * 100)}%）</title>
      </path>`;
    })
    .join('');

  return `<div class="donut" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="分布图">
      ${paths}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="650" fill="#15171c">${total}</text>
      <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="#8991a3">${escapeHtml(
        centerLabel,
      )}</text>
    </svg>
  </div>`;
}

export function emptyChart(height = 200) {
  return `<div class="empty-state" style="height:${height}px;display:grid;place-content:center;padding:0">
    <p>暂无可分析的数据</p>
  </div>`;
}

/**
 * 迷你趋势线：KPI 卡右下角用，不画坐标轴，只表达走向。
 * values 为按时间正序的数值数组。
 */
export function sparkline(values, { width = 108, height = 30, color = '#5b5bd6' } = {}) {
  const data = (values ?? []).map((v) => Number(v) || 0);
  if (data.length < 2) return '';
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 8);

  const points = data.map((v, i) => [i * stepX, y(v)]);
  const line = points.map(([x, py], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = points[points.length - 1];
  const id = `sp${Math.random().toString(36).slice(2, 8)}`;

  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

/** 环形进度（完成率等百分比指标），中心留白由外层文字填充 */
export function ringProgress(percent, { size = 46, thickness = 5, color = '#5b5bd6', track = '#e9ecf3' } = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${thickness}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${thickness}"
      stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

/** 水平分段条：用于负载/容量对比，segments = [{value, color}] */
export function segmentBar(segments, { height = 8, total = null } = {}) {
  const sum = total ?? segments.reduce((acc, s) => acc + (s.value || 0), 0);
  if (!sum) return `<div class="segbar" style="height:${height}px;background:var(--surface-2);border-radius:999px"></div>`;
  const parts = segments
    .filter((s) => s.value > 0)
    .map(
      (s) =>
        `<span style="width:${((s.value / sum) * 100).toFixed(2)}%;background:${s.color}"></span>`,
    )
    .join('');
  return `<div class="segbar" style="height:${height}px">${parts}</div>`;
}
