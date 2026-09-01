import type { Rect } from '../../units';
import type { Op } from '../../render/ops';
import { shiftWeeks } from './calendar';
import {
  DAY_NAMES,
  MONTH_NAMES,
  addDays,
  dateOfIsoWeek,
  daysInMonth,
  formatTime,
  isWeekend,
  utc,
  weeksInYear,
  type WeekStart,
} from '../dates';
import {
  box,
  columns,
  header,
  labelledBox,
  line,
  rows,
  splitLeft,
  splitTop,
  table,
  text,
  textInRect,
  themeFrom,
  type Theme,
} from '../draw';
import {
  bool,
  commonStyleFields,
  list,
  num,
  str,
  weekStartField,
  type GeneratedPage,
  type Generator,
  type GeneratorContext,
} from '../registry';

/** Parses `YYYY-MM-DD`, falling back to today when malformed. */
function parseISODate(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const now = new Date();
    return utc(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  return utc(Number(match[1]), Number(match[2]), Number(match[3]));
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------- daily planner */

export const dailyPlanner: Generator = {
  id: 'daily-planner',
  name: 'Daily planner',
  description:
    'One page per day with an hourly schedule, priorities and notes. Set a start date and a day count to generate a run.',
  category: 'Planning',
  fields: [
    { key: 'startDate', label: 'Start date', type: 'text', default: todayISO(), help: 'YYYY-MM-DD' },
    { key: 'dayCount', label: 'Number of days', type: 'number', default: 31, min: 1, max: 400, step: 1 },
    { key: 'skipWeekends', label: 'Skip weekends', type: 'boolean', default: false },
    { key: 'hourStart', label: 'First hour', type: 'number', default: 6, min: 0, max: 23, step: 1 },
    { key: 'hourEnd', label: 'Last hour', type: 'number', default: 22, min: 1, max: 24, step: 1 },
    { key: 'halfHours', label: 'Half-hour divisions', type: 'boolean', default: true },
    { key: 'use24h', label: '24-hour clock', type: 'boolean', default: true },
    { key: 'showPriorities', label: 'Priorities panel', type: 'boolean', default: true },
    { key: 'priorityCount', label: 'Priority rows', type: 'number', default: 3, min: 1, max: 10, step: 1, when: { key: 'showPriorities', equals: [true] } },
    { key: 'showNotes', label: 'Notes panel', type: 'boolean', default: true },
    { key: 'showHabits', label: 'Daily habits strip', type: 'boolean', default: false },
    { key: 'habits', label: 'Habits', type: 'stringlist', default: ['Water', 'Exercise', 'Read'], when: { key: 'showHabits', equals: [true] } },
    { key: 'lineSpacing', label: 'Rule spacing (mm)', type: 'number', default: 6, min: 3, max: 14, step: 0.5 },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const start = parseISODate(str(params, 'startDate', todayISO()));
    const count = num(params, 'dayCount', 31);
    const skipWeekends = bool(params, 'skipWeekends');

    const pages: GeneratedPage[] = [];
    let cursor = start;
    let produced = 0;
    let guard = 0;

    while (produced < count && guard++ < count * 3 + 10) {
      if (!skipWeekends || !isWeekend(cursor)) {
        pages.push({
          label: `${cursor.getUTCDate()} ${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
          ops: dailyPage(cursor, params, ctx, theme),
        });
        produced++;
      }
      cursor = addDays(cursor, 1);
    }
    return pages;
  },

  sequence: {
    unit: 'day',
    advance(params, step) {
      return { ...params, startDate: isoDate(nthPlannedDay(params, step)), dayCount: 1 };
    },
    labelFor(params, step) {
      const date = nthPlannedDay(params, step);
      return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()].slice(0, 3)}`;
    },
  },
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The date of the `step`-th page this planner would produce.
 *
 * It walks day by day rather than adding `step` outright so that "skip
 * weekends" still yields consecutive *working* days when the section advances.
 */
function nthPlannedDay(params: Record<string, unknown>, step: number): Date {
  const skipWeekends = bool(params, 'skipWeekends');
  let cursor = parseISODate(str(params, 'startDate', todayISO()));
  let produced = 0;
  let guard = 0;

  while (guard++ < step * 3 + 16) {
    if (!skipWeekends || !isWeekend(cursor)) {
      if (produced === step) return cursor;
      produced++;
    }
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function dailyPage(
  date: Date,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const ops: Op[] = [];
  const titleH = Math.min(ctx.content.h * 0.1, 15);
  const [titleRect, rest] = splitTop(ctx.content, titleH, 3);

  ops.push(
    ...header(titleRect, DAY_NAMES[date.getUTCDay()], {
      theme,
      caption: `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    })
  );

  let body = rest;

  if (bool(params, 'showHabits')) {
    const habits = list(params, 'habits', []);
    if (habits.length) {
      const stripH = Math.min(body.h * 0.08, 11);
      const [strip, below] = splitTop(body, stripH, 3);
      ops.push(...habitStrip(strip, habits, theme));
      body = below;
    }
  }

  const hasSide = bool(params, 'showPriorities', true) || bool(params, 'showNotes', true);
  const [scheduleArea, sideArea] = hasSide ? splitLeft(body, body.w * 0.56, 4) : [body, null];

  ops.push(...hourlyColumn(scheduleArea, params, theme));

  if (sideArea) {
    const panels: Array<{ label: string; weight: number; spacing: number; checkboxes: number }> = [];
    if (bool(params, 'showPriorities', true)) {
      panels.push({
        label: 'Top priorities',
        weight: 1,
        spacing: 8,
        checkboxes: num(params, 'priorityCount', 3),
      });
    }
    if (bool(params, 'showNotes', true)) {
      panels.push({ label: 'Notes', weight: 2, spacing: num(params, 'lineSpacing', 6), checkboxes: 0 });
    }

    const totalWeight = panels.reduce((a, p) => a + p.weight, 0);
    let y = sideArea.y;
    for (const panel of panels) {
      const h = ((sideArea.h - 4 * (panels.length - 1)) * panel.weight) / totalWeight;
      const rect: Rect = { x: sideArea.x, y, w: sideArea.w, h };
      if (panel.checkboxes > 0) {
        ops.push(...checkboxPanel(rect, panel.label, panel.checkboxes, theme));
      } else {
        ops.push(...labelledBox(rect, panel.label, { theme, ruleSpacing: panel.spacing }));
      }
      y += h + 4;
    }
  }

  return ops;
}

function hourlyColumn(rect: Rect, params: Record<string, unknown>, theme: Theme): Op[] {
  const hourStart = num(params, 'hourStart', 6);
  const hourEnd = Math.max(hourStart + 1, num(params, 'hourEnd', 22));
  const use24h = bool(params, 'use24h', true);
  const halfHours = bool(params, 'halfHours', true);
  const hourCount = hourEnd - hourStart;

  const ops: Op[] = [];
  const labelH = 5;
  const [labelRect, grid] = splitTop(rect, labelH);
  ops.push(
    text(labelRect.x, labelRect.y + 3.4, 'SCHEDULE', {
      size: 2.6,
      color: theme.muted,
      font: theme.font,
      bold: true,
      letterSpacing: 0.25,
    })
  );

  const timeW = Math.min(grid.w * 0.16, 15);
  const rowH = grid.h / hourCount;

  for (let h = 0; h < hourCount; h++) {
    const y = grid.y + h * rowH;
    ops.push(line(grid.x, y, grid.x + grid.w, y, theme.rule, 0.2));
    ops.push(
      text(grid.x + timeW - 1.5, y + Math.min(rowH * 0.55, 3.4), formatTime((hourStart + h) * 60, use24h), {
        size: Math.min(rowH * 0.4, 2.9),
        color: theme.muted,
        font: theme.font,
        align: 'right',
      })
    );
    if (halfHours && rowH > 5) {
      ops.push(
        line(grid.x + timeW, y + rowH / 2, grid.x + grid.w, y + rowH / 2, theme.hairline, 0.14, [0.8, 1.2])
      );
    }
  }
  ops.push(line(grid.x, grid.y + grid.h, grid.x + grid.w, grid.y + grid.h, theme.rule, 0.2));
  ops.push(line(grid.x + timeW, grid.y, grid.x + timeW, grid.y + grid.h, theme.hairline, 0.15));
  return ops;
}

function checkboxPanel(rect: Rect, label: string, count: number, theme: Theme): Op[] {
  const ops = labelledBox(rect, label, { theme, border: true });
  const labelH = 3 * 1.6;
  const body: Rect = { x: rect.x + 2, y: rect.y + labelH + 1.5, w: rect.w - 4, h: rect.h - labelH - 3 };
  const bands = rows(body, count);

  for (const band of bands) {
    const size = Math.min(band.h * 0.45, 4);
    const cy = band.y + band.h / 2;
    ops.push(
      box({ x: band.x, y: cy - size / 2, w: size, h: size }, { stroke: theme.rule, width: 0.25, radius: 0.4 })
    );
    ops.push(line(band.x + size + 2, cy + size / 2, band.x + band.w, cy + size / 2, theme.hairline, 0.18));
  }
  return ops;
}

function habitStrip(rect: Rect, habits: string[], theme: Theme): Op[] {
  const ops: Op[] = [box(rect, { stroke: theme.hairline, width: 0.2, radius: 0.8 })];
  const cells = columns(rect, habits.map(() => 1));

  habits.forEach((habit, i) => {
    const cell = cells[i];
    if (i > 0) ops.push(line(cell.x, cell.y, cell.x, cell.y + cell.h, theme.hairline, 0.15));
    const size = Math.min(cell.h * 0.3, 3);
    ops.push(
      text(cell.x + cell.w / 2, cell.y + cell.h * 0.4, habit, {
        size,
        color: theme.muted,
        font: theme.font,
        align: 'center',
        baseline: 'middle',
      })
    );
    const boxSize = Math.min(cell.h * 0.32, 4);
    ops.push(
      box(
        { x: cell.x + cell.w / 2 - boxSize / 2, y: cell.y + cell.h * 0.62, w: boxSize, h: boxSize },
        { stroke: theme.rule, width: 0.25, radius: 0.4 }
      )
    );
  });
  return ops;
}

/* ---------------------------------------------------------- habit tracker */

export const habitTracker: Generator = {
  id: 'habit-tracker',
  name: 'Habit tracker',
  description: 'A habits × days grid, one page per month.',
  category: 'Tracking',
  fields: [
    { key: 'year', label: 'Year', type: 'number', default: new Date().getFullYear(), min: 1900, max: 2200, step: 1 },
    {
      key: 'scope',
      label: 'Months',
      type: 'select',
      default: 'year',
      options: [
        { value: 'year', label: 'Whole year (12 pages)' },
        { value: 'single', label: 'One month' },
      ],
    },
    {
      key: 'month',
      label: 'Month',
      type: 'select',
      default: 1,
      options: MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m })),
      when: { key: 'scope', equals: ['single'] },
    },
    {
      key: 'habits',
      label: 'Habits',
      type: 'stringlist',
      default: ['Exercise', 'Read 20 min', 'No sugar', 'Journal', 'Sleep by 11', 'Water 2 L'],
    },
    { key: 'blankRows', label: 'Extra blank rows', type: 'number', default: 4, min: 0, max: 20, step: 1 },
    { key: 'shadeWeekends', label: 'Shade weekends', type: 'boolean', default: true },
    { key: 'showTotals', label: 'Totals column', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const year = num(params, 'year', new Date().getFullYear());
    const months =
      str(params, 'scope', 'year') === 'single'
        ? [num(params, 'month', 1)]
        : Array.from({ length: 12 }, (_, i) => i + 1);

    return months.map((month) => ({
      label: `Habits — ${MONTH_NAMES[month - 1]} ${year}`,
      ops: habitPage(year, month, params, ctx, theme),
    }));
  },

  sequence: {
    unit: 'month',
    advance(params, step) {
      const { year, month } = shiftTrackerMonth(params, step);
      return { ...params, scope: 'single', year, month };
    },
    labelFor(params, step) {
      const { year, month } = shiftTrackerMonth(params, step);
      return `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
    },
  },
};

function shiftTrackerMonth(
  params: Record<string, unknown>,
  step: number
): { year: number; month: number } {
  const startMonth = str(params, 'scope', 'year') === 'single' ? num(params, 'month', 1) : 1;
  const absolute =
    num(params, 'year', new Date().getFullYear()) * 12 + (startMonth - 1) + step;
  return { year: Math.floor(absolute / 12), month: ((absolute % 12) + 12) % 12 + 1 };
}

function habitPage(
  year: number,
  month: number,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const ops: Op[] = [];
  const titleH = Math.min(ctx.content.h * 0.1, 14);
  const [titleRect, body] = splitTop(ctx.content, titleH, 3);
  ops.push(...header(titleRect, `${MONTH_NAMES[month - 1]} habits`, { theme, caption: String(year) }));

  const habits = list(params, 'habits', []);
  const rowCount = habits.length + num(params, 'blankRows', 4);
  if (rowCount === 0) return ops;

  const days = daysInMonth(year, month);
  const showTotals = bool(params, 'showTotals', true);

  const labelW = Math.min(body.w * 0.3, 42);
  const totalsW = showTotals ? Math.min(body.w * 0.07, 11) : 0;
  const gridW = body.w - labelW - totalsW;
  const dayW = gridW / days;

  const headerH = Math.min(body.h * 0.07, 8);
  const rowH = (body.h - headerH) / rowCount;

  // Day-number header.
  for (let d = 1; d <= days; d++) {
    const x = body.x + labelW + (d - 1) * dayW;
    const date = utc(year, month, d);
    if (bool(params, 'shadeWeekends', true) && isWeekend(date)) {
      ops.push(box({ x, y: body.y, w: dayW, h: body.h }, { fill: theme.fill }));
    }
    ops.push(
      textInRect({ x, y: body.y, w: dayW, h: headerH }, String(d), {
        size: Math.min(dayW * 0.55, headerH * 0.42, 2.6),
        color: theme.muted,
        font: theme.font,
        align: 'center',
      })
    );
  }

  if (showTotals) {
    ops.push(
      textInRect(
        { x: body.x + labelW + gridW, y: body.y, w: totalsW, h: headerH },
        'Σ',
        { size: Math.min(headerH * 0.5, 3), color: theme.muted, font: theme.font, align: 'center' }
      )
    );
  }

  for (let r = 0; r < rowCount; r++) {
    const y = body.y + headerH + r * rowH;
    const label = habits[r];
    if (label) {
      ops.push(
        textInRect({ x: body.x, y, w: labelW - 2, h: rowH }, label, {
          size: Math.min(rowH * 0.42, 3.2),
          color: theme.ink,
          font: theme.font,
        })
      );
    } else {
      ops.push(line(body.x, y + rowH * 0.75, body.x + labelW - 2, y + rowH * 0.75, theme.hairline, 0.16));
    }
    ops.push(line(body.x, y, body.x + body.w, y, theme.hairline, 0.15));
  }

  // Vertical rules for every day plus the label and totals separators.
  for (let d = 0; d <= days; d++) {
    const x = body.x + labelW + d * dayW;
    ops.push(line(x, body.y, x, body.y + body.h, theme.hairline, 0.12));
  }
  ops.push(line(body.x + labelW, body.y, body.x + labelW, body.y + body.h, theme.rule, 0.25));
  ops.push(box(body, { stroke: theme.rule, width: 0.25 }));
  ops.push(line(body.x, body.y + headerH, body.x + body.w, body.y + headerH, theme.rule, 0.25));

  return ops;
}

/* ----------------------------------------------------------- meal planner */

export const mealPlanner: Generator = {
  id: 'meal-planner',
  name: 'Meal planner',
  description: 'A week of meals with a shopping list panel.',
  category: 'Planning',
  fields: [
    { key: 'year', label: 'Year', type: 'number', default: new Date().getFullYear(), min: 1900, max: 2200, step: 1 },
    { key: 'startWeek', label: 'Starting ISO week', type: 'number', default: 1, min: 1, max: 53, step: 1 },
    { key: 'weekCount', label: 'Number of weeks', type: 'number', default: 12, min: 1, max: 53, step: 1 },
    weekStartField,
    { key: 'meals', label: 'Meals', type: 'stringlist', default: ['Breakfast', 'Lunch', 'Dinner'] },
    { key: 'showShoppingList', label: 'Shopping list panel', type: 'boolean', default: true },
    { key: 'showDates', label: 'Show dates', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const year = num(params, 'year', new Date().getFullYear());
    const weekStart = (num(params, 'weekStart', 1) as WeekStart) ?? 1;
    const total = weeksInYear(year);
    const start = Math.min(total, Math.max(1, num(params, 'startWeek', 1)));
    const count = Math.min(num(params, 'weekCount', 12), total - start + 1);
    const meals = list(params, 'meals', ['Breakfast', 'Lunch', 'Dinner']);

    const pages: GeneratedPage[] = [];
    for (let i = 0; i < count; i++) {
      const week = start + i;
      const monday = dateOfIsoWeek(year, week, weekStart);
      const ops: Op[] = [];

      const titleH = Math.min(ctx.content.h * 0.1, 14);
      const [titleRect, body] = splitTop(ctx.content, titleH, 3);
      ops.push(...header(titleRect, 'Meal plan', { theme, caption: `Week ${week}, ${year}` }));

      const showList = bool(params, 'showShoppingList', true);
      const [gridArea, listArea] = showList ? splitTop(body, body.h * 0.7, 4) : [body, null];

      const headers = ['', ...meals];
      const weights = [1.1, ...meals.map(() => 2)];
      const built = table(gridArea, {
        theme,
        headers,
        weights,
        rowCount: 7,
        fontSize: 2.8,
        headerHeight: Math.min(gridArea.h * 0.12, 8),
      });
      ops.push(...built.ops);

      built.cells.forEach((row, dayIndex) => {
        const date = addDays(monday, dayIndex);
        const label = bool(params, 'showDates', true)
          ? `${DAY_NAMES[date.getUTCDay()].slice(0, 3)} ${date.getUTCDate()}`
          : DAY_NAMES[date.getUTCDay()].slice(0, 3);
        ops.push(
          textInRect(row[0], label, {
            size: Math.min(built.rowHeight * 0.32, 3),
            color: isWeekend(date) ? theme.accent : theme.ink,
            font: theme.font,
            bold: true,
            align: 'center',
          })
        );
      });

      if (listArea) {
        const [left, right] = columns(listArea, [1, 1], 4);
        ops.push(...labelledBox(left, 'Shopping list', { theme, ruleSpacing: 5 }));
        ops.push(...labelledBox(right, 'Notes / prep', { theme, ruleSpacing: 5 }));
      }

      pages.push({ label: `Meals week ${week}`, ops });
    }
    return pages;
  },

  sequence: {
    unit: 'week',
    advance(params, step) {
      const { year, week } = shiftWeeks(params, step);
      return { ...params, year, startWeek: week, weekCount: 1 };
    },
    labelFor(params, step) {
      const { year, week } = shiftWeeks(params, step);
      return `W${week} ${year}`;
    },
  },
};
