import type { Rect } from '../../units';
import type { Op } from '../../render/ops';
import {
  DAY_ABBR,
  MONTH_ABBR,
  MONTH_NAMES,
  addDays,
  dateOfIsoWeek,
  formatTime,
  isWeekend,
  monthGrid,
  orderedDayLabels,
  weeksInYear,
  type WeekStart,
} from '../dates';
import {
  box,
  columns,
  fitTextSize,
  header,
  labelledBox,
  line,
  ruledArea,
  rows,
  splitLeft,
  splitTop,
  text,
  textInRect,
  themeFrom,
  type Theme,
} from '../draw';
import {
  bool,
  commonStyleFields,
  num,
  str,
  weekStartField,
  type Generator,
  type GeneratedPage,
  type GeneratorContext,
} from '../registry';

const weekStartOf = (params: Record<string, unknown>): WeekStart =>
  ([0, 1, 6] as const).includes(num(params, 'weekStart', 1) as WeekStart)
    ? (num(params, 'weekStart', 1) as WeekStart)
    : 1;

/** Months selected by the scope parameters, as 1-based numbers. */
function selectedMonths(params: Record<string, unknown>): number[] {
  const scope = str(params, 'scope', 'year');
  if (scope === 'single') return [clampMonth(num(params, 'startMonth', 1))];
  if (scope === 'range') {
    const start = clampMonth(num(params, 'startMonth', 1));
    const count = Math.max(1, Math.min(12, num(params, 'monthCount', 3)));
    return Array.from({ length: count }, (_, i) => ((start - 1 + i) % 12) + 1);
  }
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

const clampMonth = (m: number): number => Math.min(12, Math.max(1, Math.round(m)));

/** Adds `step` months to a (year, 1-based month) pair. */
function shiftMonths(year: number, month: number, step: number): { year: number; month: number } {
  const absolute = year * 12 + (month - 1) + step;
  return { year: Math.floor(absolute / 12), month: ((absolute % 12) + 12) % 12 + 1 };
}

/** The month a monthly generator starts from, whatever its scope. */
function baseMonth(params: Record<string, unknown>): { year: number; month: number } {
  const year = num(params, 'year', new Date().getFullYear());
  const scope = str(params, 'scope', 'year');
  return { year, month: scope === 'year' ? 1 : clampMonth(num(params, 'startMonth', 1)) };
}

/* ------------------------------------------------------------ month pages */

export const calendarMonth: Generator = {
  id: 'calendar-month',
  name: 'Monthly calendar',
  description:
    'A full-page month grid. Generates one page per selected month, so a whole year is a single entry in the running order.',
  category: 'Calendar',
  fields: [
    { key: 'year', label: 'Year', type: 'number', default: new Date().getFullYear(), min: 1900, max: 2200, step: 1 },
    {
      key: 'scope',
      label: 'Months',
      type: 'select',
      default: 'year',
      options: [
        { value: 'year', label: 'Whole year (12 pages)' },
        { value: 'range', label: 'A range of months' },
        { value: 'single', label: 'One month' },
      ],
    },
    {
      key: 'startMonth',
      label: 'Starting month',
      type: 'select',
      default: 1,
      options: MONTH_NAMES.map((name, i) => ({ value: i + 1, label: name })),
      when: { key: 'scope', equals: ['range', 'single'] },
    },
    {
      key: 'monthCount',
      label: 'Number of months',
      type: 'number',
      default: 3,
      min: 1,
      max: 12,
      step: 1,
      when: { key: 'scope', equals: ['range'] },
    },
    weekStartField,
    {
      key: 'cellStyle',
      label: 'Day cell',
      type: 'select',
      default: 'lined',
      options: [
        { value: 'blank', label: 'Blank' },
        { value: 'lined', label: 'Ruled' },
        { value: 'dotted', label: 'Dotted' },
      ],
    },
    { key: 'showWeekNumbers', label: 'Week number column', type: 'boolean', default: false },
    { key: 'showAdjacent', label: 'Show neighbouring months', type: 'boolean', default: true },
    { key: 'notesPanel', label: 'Notes panel', type: 'boolean', default: false },
    {
      key: 'notesWidth',
      label: 'Notes panel width (%)',
      type: 'number',
      default: 22,
      min: 10,
      max: 45,
      step: 1,
      when: { key: 'notesPanel', equals: [true] },
    },
    { key: 'highlightWeekends', label: 'Shade weekends', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const year = num(params, 'year', new Date().getFullYear());
    const weekStart = weekStartOf(params);

    return selectedMonths(params).map((month) => ({
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      ops: monthPage(year, month, weekStart, params, ctx, theme),
    }));
  },

  sequence: {
    unit: 'month',
    advance(params, step) {
      const base = baseMonth(params);
      const { year, month } = shiftMonths(base.year, base.month, step);
      // `single` scope is what turns one repetition into exactly one page.
      return { ...params, scope: 'single', year, startMonth: month };
    },
    labelFor(params, step) {
      const base = baseMonth(params);
      const { year, month } = shiftMonths(base.year, base.month, step);
      return `${MONTH_ABBR[month - 1]} ${year}`;
    },
  },
};

function monthPage(
  year: number,
  month: number,
  weekStart: WeekStart,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const ops: Op[] = [];
  const titleHeight = Math.min(ctx.content.h * 0.12, 16);
  const [titleRect, belowTitle] = splitTop(ctx.content, titleHeight, 3);

  ops.push(
    ...header(titleRect, MONTH_NAMES[month - 1], {
      theme,
      caption: String(year),
      rule: true,
    })
  );

  let gridArea = belowTitle;
  if (bool(params, 'notesPanel')) {
    const notesW = (belowTitle.w * num(params, 'notesWidth', 22)) / 100;
    const [grid, notes] = splitLeft(belowTitle, belowTitle.w - notesW, 4);
    gridArea = grid;
    ops.push(
      ...labelledBox(notes, 'Notes', {
        theme,
        ruleSpacing: 6,
        border: true,
      })
    );
  }

  ops.push(...monthGridOps(year, month, weekStart, params, gridArea, theme));
  return ops;
}

function monthGridOps(
  year: number,
  month: number,
  weekStart: WeekStart,
  params: Record<string, unknown>,
  area: Rect,
  theme: Theme
): Op[] {
  const ops: Op[] = [];
  const { weeks, rowCount } = monthGrid(year, month, weekStart);
  const showWeeks = bool(params, 'showWeekNumbers');
  const cellStyle = str(params, 'cellStyle', 'lined');
  const showAdjacent = bool(params, 'showAdjacent', true);
  const shadeWeekends = bool(params, 'highlightWeekends', true);

  const weekColWidth = showWeeks ? Math.min(area.w * 0.06, 8) : 0;
  const gridRect: Rect = {
    x: area.x + weekColWidth,
    y: area.y,
    w: area.w - weekColWidth,
    h: area.h,
  };

  const headerHeight = Math.min(area.h * 0.07, 7);
  const [dayHeaderRect, bodyRect] = splitTop(gridRect, headerHeight);
  const colWidth = bodyRect.w / 7;
  const rowHeight = bodyRect.h / rowCount;

  // Weekday headings.
  const labels = orderedDayLabels(weekStart, colWidth < 12 ? 'initial' : 'abbr');
  labels.forEach((label, i) => {
    ops.push(
      textInRect(
        { x: bodyRect.x + i * colWidth, y: dayHeaderRect.y, w: colWidth, h: headerHeight },
        label.toUpperCase(),
        {
          size: Math.min(headerHeight * 0.55, 3.4),
          color: theme.muted,
          font: theme.font,
          bold: true,
          align: 'center',
        }
      )
    );
  });

  for (let r = 0; r < rowCount; r++) {
    const y = bodyRect.y + r * rowHeight;

    if (showWeeks) {
      const weekNo = weeks[r][weekStart === 1 ? 0 : 1].isoWeek;
      ops.push(
        textInRect({ x: area.x, y, w: weekColWidth, h: rowHeight }, `W${weekNo}`, {
          size: Math.min(rowHeight * 0.18, 2.6),
          color: theme.muted,
          font: theme.font,
          align: 'center',
        })
      );
    }

    for (let c = 0; c < 7; c++) {
      const cell: Rect = { x: bodyRect.x + c * colWidth, y, w: colWidth, h: rowHeight };
      const info = weeks[r][c];
      if (!info.inMonth && !showAdjacent) {
        ops.push(box(cell, { stroke: theme.hairline, width: 0.15 }));
        continue;
      }

      if (shadeWeekends && info.weekend && info.inMonth) {
        ops.push(box(cell, { fill: theme.fill }));
      }
      ops.push(box(cell, { stroke: info.inMonth ? theme.rule : theme.hairline, width: 0.18 }));

      const numberSize = Math.min(rowHeight * 0.26, colWidth * 0.3, 5);
      ops.push(
        text(cell.x + 1.2, cell.y + numberSize + 0.8, String(info.day), {
          size: numberSize,
          color: info.inMonth ? theme.ink : theme.hairline,
          font: theme.font,
          bold: info.inMonth,
        })
      );

      if (info.inMonth && cellStyle !== 'blank') {
        const writing: Rect = {
          x: cell.x + 1,
          y: cell.y + numberSize + 2,
          w: cell.w - 2,
          h: cell.h - numberSize - 3,
        };
        if (writing.h > 3) {
          const spacing = Math.max(2.6, writing.h / Math.floor(writing.h / 4));
          ops.push(
            ...ruledArea(
              writing,
              spacing,
              theme.hairline,
              0.15,
              cellStyle === 'dotted' ? [0.4, 1.1] : undefined
            )
          );
        }
      }
    }
  }
  return ops;
}

/* ------------------------------------------------------------- year page */

export const calendarYear: Generator = {
  id: 'calendar-year',
  name: 'Year overview',
  description: 'All twelve months on a single page, for the front of a planner.',
  category: 'Calendar',
  fields: [
    { key: 'year', label: 'Year', type: 'number', default: new Date().getFullYear(), min: 1900, max: 2200, step: 1 },
    weekStartField,
    {
      key: 'columns',
      label: 'Columns',
      type: 'select',
      default: 3,
      options: [
        { value: 2, label: '2 × 6' },
        { value: 3, label: '3 × 4' },
        { value: 4, label: '4 × 3' },
      ],
    },
    { key: 'highlightWeekends', label: 'Emphasise weekends', type: 'boolean', default: true },
    { key: 'showTitle', label: 'Show year heading', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const year = num(params, 'year', new Date().getFullYear());
    const weekStart = weekStartOf(params);
    const cols = num(params, 'columns', 3);
    const rowsCount = Math.ceil(12 / cols);

    const ops: Op[] = [];
    let area = ctx.content;

    if (bool(params, 'showTitle', true)) {
      const titleHeight = Math.min(ctx.content.h * 0.09, 14);
      const [titleRect, rest] = splitTop(ctx.content, titleHeight, 4);
      ops.push(...header(titleRect, String(year), { theme, align: 'center', rule: true }));
      area = rest;
    }

    const gap = Math.min(area.w * 0.03, 6);
    const cellW = (area.w - gap * (cols - 1)) / cols;
    const cellH = (area.h - gap * (rowsCount - 1)) / rowsCount;

    for (let m = 0; m < 12; m++) {
      const cx = area.x + (m % cols) * (cellW + gap);
      const cy = area.y + Math.floor(m / cols) * (cellH + gap);
      ops.push(
        ...miniMonth({ x: cx, y: cy, w: cellW, h: cellH }, year, m + 1, weekStart, theme, {
          emphasiseWeekends: bool(params, 'highlightWeekends', true),
        })
      );
    }

    return [{ label: `${year} overview`, ops }];
  },

  sequence: {
    unit: 'year',
    advance: (params, step) => ({
      ...params,
      year: num(params, 'year', new Date().getFullYear()) + step,
    }),
    labelFor: (params, step) =>
      String(num(params, 'year', new Date().getFullYear()) + step),
  },
};

/** Compact month block: title, weekday initials, day numbers. No cell borders. */
export function miniMonth(
  rect: Rect,
  year: number,
  month: number,
  weekStart: WeekStart,
  theme: Theme,
  opts: { emphasiseWeekends?: boolean; showTitle?: boolean } = {}
): Op[] {
  const { emphasiseWeekends = true, showTitle = true } = opts;
  const ops: Op[] = [];
  const { weeks, rowCount } = monthGrid(year, month, weekStart);

  const titleH = showTitle ? Math.min(rect.h * 0.16, 6) : 0;
  const headerH = Math.min(rect.h * 0.12, 4);
  const bodyH = rect.h - titleH - headerH;
  const colW = rect.w / 7;
  const rowH = bodyH / rowCount;
  const digitSize = Math.min(rowH * 0.72, colW * 0.62, 4);

  if (showTitle) {
    ops.push(
      text(rect.x, rect.y + titleH * 0.8, MONTH_NAMES[month - 1], {
        size: fitTextSize(MONTH_NAMES[month - 1], theme.font, rect.w, Math.min(titleH * 0.85, 5)),
        color: theme.accent,
        font: theme.font,
        bold: true,
      })
    );
  }

  const labels = orderedDayLabels(weekStart, 'initial');
  labels.forEach((label, i) => {
    ops.push(
      text(rect.x + colW * (i + 0.5), rect.y + titleH + headerH * 0.75, label, {
        size: Math.min(headerH * 0.75, 2.6),
        color: theme.muted,
        font: theme.font,
        align: 'center',
      })
    );
  });

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < 7; c++) {
      const info = weeks[r][c];
      if (!info.inMonth) continue;
      const cx = rect.x + colW * (c + 0.5);
      const cy = rect.y + titleH + headerH + rowH * (r + 0.5);
      ops.push(
        text(cx, cy, String(info.day), {
          size: digitSize,
          color: emphasiseWeekends && info.weekend ? theme.accent : theme.ink,
          font: theme.font,
          align: 'center',
          baseline: 'middle',
        })
      );
    }
  }
  return ops;
}

/* ------------------------------------------------------------- week pages */

export const calendarWeek: Generator = {
  id: 'calendar-week',
  name: 'Weekly planner',
  description:
    'One page per week. Choose a day-box grid, a vertical agenda, or an hourly time grid.',
  category: 'Calendar',
  fields: [
    { key: 'year', label: 'Year', type: 'number', default: new Date().getFullYear(), min: 1900, max: 2200, step: 1 },
    { key: 'startWeek', label: 'Starting ISO week', type: 'number', default: 1, min: 1, max: 53, step: 1 },
    { key: 'weekCount', label: 'Number of weeks', type: 'number', default: 52, min: 1, max: 53, step: 1 },
    weekStartField,
    {
      key: 'layout',
      label: 'Layout',
      type: 'select',
      default: 'boxes',
      options: [
        { value: 'boxes', label: 'Day boxes + notes' },
        { value: 'agenda', label: 'Vertical agenda' },
        { value: 'hourly', label: 'Hourly time grid' },
      ],
    },
    {
      key: 'hourStart',
      label: 'First hour',
      type: 'number',
      default: 7,
      min: 0,
      max: 23,
      step: 1,
      when: { key: 'layout', equals: ['hourly'] },
    },
    {
      key: 'hourEnd',
      label: 'Last hour',
      type: 'number',
      default: 21,
      min: 1,
      max: 24,
      step: 1,
      when: { key: 'layout', equals: ['hourly'] },
    },
    {
      key: 'use24h',
      label: '24-hour clock',
      type: 'boolean',
      default: true,
      when: { key: 'layout', equals: ['hourly'] },
    },
    { key: 'showWeekend', label: 'Include weekend', type: 'boolean', default: true },
    { key: 'lineSpacing', label: 'Rule spacing (mm)', type: 'number', default: 6, min: 3, max: 15, step: 0.5 },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const year = num(params, 'year', new Date().getFullYear());
    const weekStart = weekStartOf(params);
    const total = weeksInYear(year);
    const start = Math.min(total, Math.max(1, num(params, 'startWeek', 1)));
    const count = Math.min(num(params, 'weekCount', 52), total - start + 1);
    const layout = str(params, 'layout', 'boxes');

    const pages: GeneratedPage[] = [];
    for (let i = 0; i < count; i++) {
      const week = start + i;
      const monday = dateOfIsoWeek(year, week, weekStart);
      const label = `Week ${week}, ${year}`;
      const ops =
        layout === 'hourly'
          ? hourlyWeek(monday, week, params, ctx, theme)
          : layout === 'agenda'
            ? agendaWeek(monday, week, params, ctx, theme)
            : boxesWeek(monday, week, params, ctx, theme);
      pages.push({ label, ops });
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

/**
 * Adds `step` weeks to a generator's starting week, rolling into the next year
 * when it runs past the last ISO week — a 52-week section starting mid-year has
 * to keep going rather than wrapping back to January.
 */
export function shiftWeeks(
  params: Record<string, unknown>,
  step: number
): { year: number; week: number } {
  let year = num(params, 'year', new Date().getFullYear());
  let week = Math.max(1, num(params, 'startWeek', 1)) + step;

  while (week > weeksInYear(year)) {
    week -= weeksInYear(year);
    year += 1;
  }
  while (week < 1) {
    year -= 1;
    week += weeksInYear(year);
  }
  return { year, week };
}

function weekHeader(
  ctx: GeneratorContext,
  monday: Date,
  week: number,
  theme: Theme
): { ops: Op[]; body: Rect } {
  const titleHeight = Math.min(ctx.content.h * 0.1, 14);
  const [titleRect, body] = splitTop(ctx.content, titleHeight, 3);
  const sunday = addDays(monday, 6);
  const range = `${monday.getUTCDate()} ${MONTH_NAMES[monday.getUTCMonth()].slice(0, 3)} – ${sunday.getUTCDate()} ${MONTH_NAMES[sunday.getUTCMonth()].slice(0, 3)} ${sunday.getUTCFullYear()}`;
  return {
    ops: header(titleRect, `Week ${week}`, { theme, caption: range }),
    body,
  };
}

function activeDays(params: Record<string, unknown>, monday: Date): Date[] {
  const all = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return bool(params, 'showWeekend', true) ? all : all.filter((d) => !isWeekend(d));
}

function boxesWeek(
  monday: Date,
  week: number,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const { ops, body } = weekHeader(ctx, monday, week, theme);
  const days = activeDays(params, monday);
  const spacing = num(params, 'lineSpacing', 6);

  // Days plus one notes box, arranged in two columns.
  const boxesCount = days.length + 1;
  const perColumn = Math.ceil(boxesCount / 2);
  const gap = 4;
  const [left, right] = columns(body, [1, 1], gap);
  const leftRows = rows(left, perColumn, gap * 0.6);
  const rightRows = rows(right, boxesCount - perColumn, gap * 0.6);
  const slots = [...leftRows, ...rightRows];

  days.forEach((date, i) => {
    const slot = slots[i];
    if (!slot) return;
    ops.push(...dayBox(slot, date, theme, spacing));
  });

  const notesSlot = slots[days.length];
  if (notesSlot) {
    ops.push(...labelledBox(notesSlot, 'Notes', { theme, ruleSpacing: spacing }));
  }
  return ops;
}

function dayBox(rect: Rect, date: Date, theme: Theme, spacing: number): Op[] {
  const ops: Op[] = [box(rect, { stroke: theme.rule, width: 0.25, radius: 0.8 })];
  const labelH = Math.min(rect.h * 0.3, 6);
  const weekend = isWeekend(date);

  ops.push(
    box({ x: rect.x, y: rect.y, w: rect.w, h: labelH }, { fill: weekend ? theme.fill : undefined })
  );
  ops.push(
    text(rect.x + 1.6, rect.y + labelH * 0.72, DAY_ABBR[date.getUTCDay()].toUpperCase(), {
      size: Math.min(labelH * 0.55, 3.2),
      color: weekend ? theme.accent : theme.muted,
      font: theme.font,
      bold: true,
      letterSpacing: 0.2,
    })
  );
  ops.push(
    text(rect.x + rect.w - 1.6, rect.y + labelH * 0.72, String(date.getUTCDate()), {
      size: Math.min(labelH * 0.6, 3.6),
      color: theme.ink,
      font: theme.font,
      bold: true,
      align: 'right',
    })
  );
  ops.push(line(rect.x, rect.y + labelH, rect.x + rect.w, rect.y + labelH, theme.hairline, 0.18));

  const writing: Rect = {
    x: rect.x + 1.5,
    y: rect.y + labelH,
    w: rect.w - 3,
    h: rect.h - labelH - 1,
  };
  ops.push(...ruledArea(writing, spacing, theme.hairline, 0.15));
  return ops;
}

function agendaWeek(
  monday: Date,
  week: number,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const { ops, body } = weekHeader(ctx, monday, week, theme);
  const days = activeDays(params, monday);
  const spacing = num(params, 'lineSpacing', 6);
  const bands = rows(body, days.length, 1.5);

  days.forEach((date, i) => {
    const band = bands[i];
    const [labelCol, writingCol] = splitLeft(band, Math.min(band.w * 0.16, 26), 2);
    const weekend = isWeekend(date);

    ops.push(
      text(labelCol.x, labelCol.y + 4.2, DAY_ABBR[date.getUTCDay()].toUpperCase(), {
        size: 3.2,
        color: weekend ? theme.accent : theme.muted,
        font: theme.font,
        bold: true,
        letterSpacing: 0.25,
      })
    );
    ops.push(
      text(labelCol.x, labelCol.y + 9.6, String(date.getUTCDate()), {
        size: 6,
        color: theme.ink,
        font: theme.font,
        bold: true,
      })
    );
    ops.push(...ruledArea(writingCol, spacing, theme.hairline, 0.16));
    ops.push(line(band.x, band.y, band.x + band.w, band.y, theme.rule, 0.25));
  });

  return ops;
}

function hourlyWeek(
  monday: Date,
  week: number,
  params: Record<string, unknown>,
  ctx: GeneratorContext,
  theme: Theme
): Op[] {
  const { ops, body } = weekHeader(ctx, monday, week, theme);
  const days = activeDays(params, monday);
  const hourStart = num(params, 'hourStart', 7);
  const hourEnd = Math.max(hourStart + 1, num(params, 'hourEnd', 21));
  const use24h = bool(params, 'use24h', true);
  const hourCount = hourEnd - hourStart;

  const timeColW = Math.min(body.w * 0.1, 14);
  const [timeCol, gridArea] = splitLeft(body, timeColW, 1);
  const headerH = Math.min(body.h * 0.06, 7);
  const [dayHeader, grid] = splitTop(gridArea, headerH);
  const colW = grid.w / days.length;
  const rowH = grid.h / hourCount;

  days.forEach((date, i) => {
    const cell = { x: grid.x + i * colW, y: dayHeader.y, w: colW, h: headerH };
    ops.push(
      textInRect(cell, `${DAY_ABBR[date.getUTCDay()]} ${date.getUTCDate()}`, {
        size: Math.min(headerH * 0.5, 3),
        color: isWeekend(date) ? theme.accent : theme.muted,
        font: theme.font,
        bold: true,
        align: 'center',
      })
    );
  });

  for (let h = 0; h <= hourCount; h++) {
    const y = grid.y + h * rowH;
    ops.push(line(grid.x, y, grid.x + grid.w, y, h === 0 ? theme.rule : theme.hairline, 0.18));
    if (h < hourCount) {
      ops.push(
        text(timeCol.x + timeCol.w - 1, y + Math.min(rowH * 0.5, 3), formatTime((hourStart + h) * 60, use24h), {
          size: Math.min(rowH * 0.42, 2.8),
          color: theme.muted,
          font: theme.font,
          align: 'right',
        })
      );
      // Half-hour hairline, dashed so it reads as secondary.
      ops.push(
        line(grid.x, y + rowH / 2, grid.x + grid.w, y + rowH / 2, theme.hairline, 0.12, [0.8, 1.2])
      );
    }
  }

  for (let i = 0; i <= days.length; i++) {
    const x = grid.x + i * colW;
    ops.push(line(x, grid.y, x, grid.y + grid.h, theme.hairline, 0.15));
  }

  return ops;
}
