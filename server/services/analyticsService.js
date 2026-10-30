import { difficultyWeight, PRIORITIES, TYPES } from '../domain.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const WEEK_COUNT = 8;

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 以周一为一周起点 */
function startOfWeek(ms) {
  const day = startOfDay(ms);
  const weekday = (new Date(day).getDay() + 6) % 7;
  return day - weekday * DAY;
}

/**
 * 本地时区的 YYYY-MM-DD。
 * 不能用 toISOString().slice(0,10)：东八区的周一 00:00 会被序列化成周日的 UTC 日期，
 * 前端按本地日期解析就会整体错开一天（周度热力/明细对不上）。
 */
function isoDayLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function labelOf(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 还原任务在某个时间点的状态：以创建为起点，顺序应用历史变更 */
function statusAt(task, ts, initialStatus) {
  let status = initialStatus;
  const created = new Date(task.createdAt).getTime();
  if (ts < created) return null;
  for (const entry of task.history ?? []) {
    if (entry.field !== 'status') continue;
    if (new Date(entry.at).getTime() <= ts) status = entry.to;
  }
  return status;
}

function firstEntryInto(task, status) {
  if (!status) return null;
  const entry = (task.history ?? []).find((item) => item.field === 'status' && item.to === status);
  return entry ? new Date(entry.at).getTime() : null;
}

/** 开始时间：优先用落库的 startedAt，老数据回退到历史里首次进入开始列 */
function startedAtOf(task, startColumnId) {
  if (task.startedAt) {
    const ts = new Date(task.startedAt).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  return firstEntryInto(task, startColumnId);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const round1 = (n) => Math.round(n * 10) / 10;

export function createAnalyticsService({ tasks, members, columns }) {
  return {
    overview() {
      const now = Date.now();
      const today = startOfDay(now);
      const rows = tasks.list();

      // 看板列是动态的：完成列、开始列、首列都从数据库读取
      const columnList = columns.list();
      const doneColumnId = columns.doneColumn()?.id ?? null;
      const startColumnId = columns.startColumn()?.id ?? null;
      const initialColumnId = columnList[0]?.id ?? doneColumnId;
      const isDone = (statusId) => statusId === doneColumnId;

      const done = rows.filter((task) => isDone(task.status));

      const cycleTimes = [];
      const leadTimes = [];
      for (const task of done) {
        const finished = task.completedAt ? new Date(task.completedAt).getTime() : null;
        if (!finished) continue;
        const created = new Date(task.createdAt).getTime();
        leadTimes.push((finished - created) / DAY);
        const started = startedAtOf(task, startColumnId);
        if (started) cycleTimes.push((finished - started) / DAY);
      }

      const overdue = rows
        .filter(
          (task) =>
            !isDone(task.status) &&
            task.dueDate &&
            new Date(`${task.dueDate}T00:00:00`).getTime() < today,
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      const thisWeekStart = startOfWeek(now);
      const lastWeekStart = thisWeekStart - WEEK;
      const completedThisWeek = done.filter(
        (task) => task.completedAt && new Date(task.completedAt).getTime() >= thisWeekStart,
      ).length;
      const completedLastWeek = done.filter((task) => {
        if (!task.completedAt) return false;
        const ts = new Date(task.completedAt).getTime();
        return ts >= lastWeekStart && ts < thisWeekStart;
      }).length;

      const wipBreaches = columnList
        .filter((column) => column.wipLimit)
        .map((column) => {
          const count = rows.filter((task) => task.status === column.id).length;
          return {
            statusId: column.id,
            name: column.name,
            count,
            limit: column.wipLimit,
            exceeded: count > column.wipLimit,
          };
        });

      const weeks = [];
      for (let i = WEEK_COUNT - 1; i >= 0; i -= 1) {
        const start = thisWeekStart - i * WEEK;
        weeks.push({
          start,
          label: labelOf(start),
          created: 0,
          completed: 0,
          cycleTimes: [],
        });
      }

      for (const task of rows) {
        const created = new Date(task.createdAt).getTime();
        for (const week of weeks) {
          if (created >= week.start && created < week.start + WEEK) week.created += 1;
        }
        if (task.completedAt) {
          const finished = new Date(task.completedAt).getTime();
          for (const week of weeks) {
            if (finished >= week.start && finished < week.start + WEEK) {
              week.completed += 1;
              const started = startedAtOf(task, startColumnId);
              if (started && finished >= started) {
                week.cycleTimes.push((finished - started) / DAY);
              }
            }
          }
        }
      }

      // 累计流图：每周最后时刻各列的存量，列顺序与看板一致
      const cfd = weeks.map((week) => {
        const ts = Math.min(week.start + WEEK - 1, now);
        const buckets = Object.fromEntries(columnList.map((column) => [column.id, 0]));
        for (const task of rows) {
          const status = statusAt(task, ts, initialColumnId);
          if (!status || buckets[status] === undefined) continue;
          buckets[status] += 1;
        }
        return { label: week.label, ...buckets };
      });

      const throughput = weeks.map((week) => ({
        label: week.label,
        created: week.created,
        completed: week.completed,
        cycle: week.cycleTimes.length ? round1(week.cycleTimes.reduce((a, b) => a + b, 0) / week.cycleTimes.length) : 0,
      }));

      const byStatus = columnList.map((column) => ({
        id: column.id,
        name: column.name,
        tone: column.tone,
        count: rows.filter((task) => task.status === column.id).length,
      }));

      const byPriority = PRIORITIES.map((priority) => ({
        id: priority.id,
        name: priority.name,
        color: priority.color,
        count: rows.filter((task) => task.priority === priority.id).length,
      }));

      const byType = TYPES.map((type) => ({
        id: type.id,
        name: type.name,
        color: type.color,
        count: rows.filter((task) => task.type === type.id).length,
      }));

      const byMember = members.list().map((member) => {
        const own = rows.filter((task) => task.assigneeId === member.id);
        const open = own.filter((task) => !isDone(task.status));
        const finished = own.filter(
          (task) =>
            task.completedAt && new Date(task.completedAt).getTime() >= now - 30 * DAY,
        );
        return {
          id: member.id,
          name: member.name,
          role: member.role,
          color: member.color,
          open: open.length,
          inProgress: open.filter((task) => task.status === startColumnId).length,
          points: open.reduce((sum, task) => sum + difficultyWeight(task.difficulty), 0),
          done30d: finished.length,
          urgent: open.filter((task) => task.priority === 'urgent').length,
        };
      });

      // 成员周度统计：按任务「当前负责人」归属，统计最近 8 周的新建/开始/完成/点数/平均周期
      const emptyCell = () => ({ created: 0, started: 0, completed: 0, points: 0, cycleSum: 0, cycleCount: 0 });
      const emptyTotals = () => ({ created: 0, started: 0, completed: 0, points: 0, cycleSum: 0, cycleCount: 0 });
      const weeklyRows = members.list().map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        color: member.color,
        weeks: weeks.map(emptyCell),
        totals: emptyTotals(),
      }));
      const weeklyById = new Map(weeklyRows.map((row) => [row.id, row]));
      const unassignedRow = {
        id: null,
        name: '未指派',
        role: '',
        color: '#c3c8d4',
        weeks: weeks.map(emptyCell),
        totals: emptyTotals(),
      };

      const weekIndex = (ts) => weeks.findIndex((week) => ts >= week.start && ts < week.start + WEEK);
      const bump = (row, index, field, amount = 1) => {
        if (index < 0) return;
        row.weeks[index][field] += amount;
        row.totals[field] += amount;
      };

      for (const task of rows) {
        const owner = weeklyById.get(task.assigneeId) ?? unassignedRow;
        bump(owner, weekIndex(new Date(task.createdAt).getTime()), 'created');

        const started = startedAtOf(task, startColumnId);
        if (started) bump(owner, weekIndex(started), 'started');

        if (task.completedAt) {
          const finished = new Date(task.completedAt).getTime();
          const index = weekIndex(finished);
          if (index >= 0) {
            bump(owner, index, 'completed');
            bump(owner, index, 'points', difficultyWeight(task.difficulty));
            if (started && finished >= started) {
              owner.weeks[index].cycleSum += (finished - started) / DAY;
              owner.weeks[index].cycleCount += 1;
              owner.totals.cycleSum += (finished - started) / DAY;
              owner.totals.cycleCount += 1;
            }
          }
        }
      }

      const presentCell = (cell) => ({
        created: cell.created,
        started: cell.started,
        completed: cell.completed,
        points: cell.points,
        cycle: cell.cycleCount ? round1(cell.cycleSum / cell.cycleCount) : 0,
      });
      const presentTotal = (totals) => ({ ...presentCell(totals), cycleCount: totals.cycleCount });

      const hasActivity = (row) =>
        row.totals.created || row.totals.started || row.totals.completed || row.totals.points;
      const memberWeeklyRows = weeklyRows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        color: row.color,
        weeks: row.weeks.map(presentCell),
        totals: presentTotal(row.totals),
      }));

      if (hasActivity(unassignedRow)) {
        memberWeeklyRows.push({
          id: null,
          name: '未指派',
          role: '',
          color: unassignedRow.color,
          weeks: unassignedRow.weeks.map(presentCell),
          totals: presentTotal(unassignedRow.totals),
        });
      }

      const weeklyTotals = weeks.map((week, index) => {
        const cells = memberWeeklyRows.map((row) => row.weeks[index]);
        return {
          created: cells.reduce((sum, cell) => sum + cell.created, 0),
          started: cells.reduce((sum, cell) => sum + cell.started, 0),
          completed: cells.reduce((sum, cell) => sum + cell.completed, 0),
          points: cells.reduce((sum, cell) => sum + cell.points, 0),
        };
      });

      const memberWeekly = {
        weeks: weeks.map((week) => ({
          start: isoDayLocal(week.start),
          label: week.label,
        })),
        members: memberWeeklyRows,
        totals: weeklyTotals,
      };

      const total = rows.length;
      const doneCount = done.length;
      const openRows = rows.filter((task) => !isDone(task.status));
      const avgCycle = cycleTimes.length
        ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
        : 0;

      return {
        generatedAt: new Date(now).toISOString(),
        kpi: {
          total,
          open: openRows.length,
          inProgress: rows.filter((task) => task.status === startColumnId).length,
          completionRate: total ? round1((doneCount / total) * 100) : 0,
          completedThisWeek,
          completedLastWeek,
          overdue: overdue.length,
          avgCycle: round1(avgCycle),
          medianCycle: round1(median(cycleTimes)),
          avgLead: round1(leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : 0),
          wipPoints: openRows.reduce((sum, task) => sum + difficultyWeight(task.difficulty), 0),
        },
        columns: columnList.map((column) => ({
          id: column.id,
          name: column.name,
          tone: column.tone,
          isDone: column.isDone,
          isStart: column.isStart,
        })),
        cfd,
        throughput,
        byStatus,
        byPriority,
        byType,
        byMember,
        memberWeekly,
        wipBreaches,
        overdue: overdue.slice(0, 6).map((task) => ({
          id: task.id,
          key: task.key,
          title: task.title,
          dueDate: task.dueDate,
          assigneeId: task.assigneeId,
          priority: task.priority,
          daysLate: Math.floor((today - new Date(`${task.dueDate}T00:00:00`).getTime()) / DAY),
        })),
        cycleSample: cycleTimes.length,
      };
    },
  };
}
