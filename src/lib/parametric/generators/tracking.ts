import type { Rect } from '../../units';
import type { Op } from '../../render/ops';
import { MONTH_NAMES, addDays, isWeekend, utc } from '../dates';
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
} from '../draw';
import {
  bool,
  commonStyleFields,
  list,
  num,
  str,
  type GeneratedPage,
  type Generator,
} from '../registry';

/* --------------------------------------------------------- budget ledger */

export const budgetLedger: Generator = {
  id: 'budget-ledger',
  name: 'Budget ledger',
  description: 'A ruled ledger with money columns and an optional summary panel.',
  category: 'Tracking',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 12, min: 1, max: 200, step: 1 },
    {
      key: 'columnSet',
      label: 'Columns',
      type: 'select',
      default: 'full',
      options: [
        { value: 'simple', label: 'Date · Description · Amount' },
        { value: 'full', label: 'Date · Description · Category · In · Out · Balance' },
        { value: 'expense', label: 'Date · Description · Category · Amount' },
      ],
    },
    { key: 'rowCount', label: 'Rows', type: 'number', default: 26, min: 5, max: 60, step: 1 },
    { key: 'title', label: 'Title', type: 'text', default: 'Ledger' },
    { key: 'showSummary', label: 'Summary panel', type: 'boolean', default: true },
    { key: 'zebra', label: 'Alternate row shading', type: 'boolean', default: false },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const sets: Record<string, { headers: string[]; weights: number[] }> = {
      simple: { headers: ['Date', 'Description', 'Amount'], weights: [1.2, 4, 1.4] },
      full: {
        headers: ['Date', 'Description', 'Category', 'In', 'Out', 'Balance'],
        weights: [1.1, 3.4, 1.6, 1.2, 1.2, 1.3],
      },
      expense: {
        headers: ['Date', 'Description', 'Category', 'Amount'],
        weights: [1.1, 3.6, 1.7, 1.4],
      },
    };
    const set = sets[str(params, 'columnSet', 'full')] ?? sets.full;
    const total = num(params, 'pageCount', 12);

    const pages: GeneratedPage[] = [];
    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      const titleH = Math.min(ctx.content.h * 0.09, 13);
      const [titleRect, body] = splitTop(ctx.content, titleH, 3);
      ops.push(...header(titleRect, str(params, 'title', 'Ledger'), { theme, caption: `${p + 1}` }));

      const showSummary = bool(params, 'showSummary', true);
      const [ledgerArea, summaryArea] = showSummary
        ? splitTop(body, body.h - Math.min(body.h * 0.18, 30), 4)
        : [body, null];

      const built = table(ledgerArea, {
        theme,
        headers: set.headers,
        weights: set.weights,
        rowCount: num(params, 'rowCount', 26),
        fontSize: 2.9,
        zebra: bool(params, 'zebra') ? theme.fill : undefined,
      });
      ops.push(...built.ops);

      if (summaryArea) {
        const cells = columns(summaryArea, [1, 1, 1], 4);
        const labels = ['Total in', 'Total out', 'Balance'];
        cells.forEach((cell, i) => {
          ops.push(box(cell, { stroke: theme.rule, width: 0.25, radius: 0.8 }));
          ops.push(
            text(cell.x + 2, cell.y + 4.5, labels[i].toUpperCase(), {
              size: 2.4,
              color: theme.muted,
              font: theme.font,
              bold: true,
              letterSpacing: 0.2,
            })
          );
          ops.push(
            line(cell.x + 2, cell.y + cell.h - 3, cell.x + cell.w - 2, cell.y + cell.h - 3, theme.hairline, 0.2)
          );
        });
      }

      pages.push({ label: `Ledger ${p + 1}`, ops });
    }
    return pages;
  },
};

/* ------------------------------------------------------------ project plan */

export const projectGantt: Generator = {
  id: 'project-gantt',
  name: 'Project timeline',
  description: 'A task list beside a dated week or day grid, for sketching a schedule by hand.',
  category: 'Planning',
  fields: [
    { key: 'title', label: 'Project title', type: 'text', default: 'Project plan' },
    { key: 'startDate', label: 'Start date', type: 'text', default: new Date().toISOString().slice(0, 10), help: 'YYYY-MM-DD' },
    {
      key: 'unit',
      label: 'Timeline unit',
      type: 'select',
      default: 'week',
      options: [
        { value: 'day', label: 'Days' },
        { value: 'week', label: 'Weeks' },
        { value: 'month', label: 'Months' },
      ],
    },
    { key: 'periods', label: 'Number of periods', type: 'number', default: 12, min: 2, max: 40, step: 1 },
    { key: 'taskRows', label: 'Task rows', type: 'number', default: 18, min: 3, max: 50, step: 1 },
    { key: 'tasks', label: 'Pre-filled tasks', type: 'stringlist', default: [] },
    { key: 'labelWidth', label: 'Task column width (%)', type: 'number', default: 34, min: 15, max: 60, step: 1 },
    { key: 'pageCount', label: 'Pages', type: 'number', default: 1, min: 1, max: 50, step: 1 },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const periods = num(params, 'periods', 12);
    const taskRows = num(params, 'taskRows', 18);
    const unit = str(params, 'unit', 'week');
    const tasks = list(params, 'tasks', []);
    const startMatch = str(params, 'startDate', '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const start = startMatch
      ? utc(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3]))
      : utc(new Date().getFullYear(), new Date().getMonth() + 1, 1);

    const periodLabel = (i: number): string => {
      if (unit === 'day') {
        const d = addDays(start, i);
        return `${d.getUTCDate()}`;
      }
      if (unit === 'week') return `W${i + 1}`;
      const m = (start.getUTCMonth() + i) % 12;
      return MONTH_NAMES[m].slice(0, 3);
    };

    const total = num(params, 'pageCount', 1);
    const pages: GeneratedPage[] = [];

    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      const titleH = Math.min(ctx.content.h * 0.09, 13);
      const [titleRect, body] = splitTop(ctx.content, titleH, 3);
      ops.push(...header(titleRect, str(params, 'title', 'Project plan'), { theme }));

      const labelW = (body.w * num(params, 'labelWidth', 34)) / 100;
      const [labelCol, gridCol] = splitLeft(body, labelW, 0);
      const headerH = Math.min(body.h * 0.06, 8);
      const colW = gridCol.w / periods;
      const rowH = (body.h - headerH) / taskRows;

      for (let i = 0; i < periods; i++) {
        const cell = { x: gridCol.x + i * colW, y: body.y, w: colW, h: headerH };
        const isWeekendDay = unit === 'day' && isWeekend(addDays(start, i));
        if (isWeekendDay) {
          ops.push(box({ ...cell, h: body.h }, { fill: theme.fill }));
        }
        ops.push(
          textInRect(cell, periodLabel(i), {
            size: Math.min(colW * 0.5, headerH * 0.45, 2.6),
            color: theme.muted,
            font: theme.font,
            align: 'center',
          })
        );
      }

      ops.push(
        textInRect({ x: labelCol.x, y: body.y, w: labelW, h: headerH }, 'TASK', {
          size: Math.min(headerH * 0.42, 2.6),
          color: theme.muted,
          font: theme.font,
          bold: true,
          letterSpacing: 0.2,
        })
      );

      for (let r = 0; r < taskRows; r++) {
        const y = body.y + headerH + r * rowH;
        ops.push(line(body.x, y, body.x + body.w, y, theme.hairline, 0.15));
        const task = tasks[p * taskRows + r];
        if (task) {
          ops.push(
            textInRect({ x: labelCol.x + 1.5, y, w: labelW - 3, h: rowH }, task, {
              size: Math.min(rowH * 0.4, 2.9),
              color: theme.ink,
              font: theme.font,
            })
          );
        }
      }

      for (let i = 0; i <= periods; i++) {
        ops.push(
          line(gridCol.x + i * colW, body.y, gridCol.x + i * colW, body.y + body.h, theme.hairline, 0.12)
        );
      }
      ops.push(line(gridCol.x, body.y, gridCol.x, body.y + body.h, theme.rule, 0.3));
      ops.push(line(body.x, body.y + headerH, body.x + body.w, body.y + headerH, theme.rule, 0.3));
      ops.push(box(body, { stroke: theme.rule, width: 0.25 }));

      pages.push({ label: `Timeline ${p + 1}`, ops });
    }
    return pages;
  },
};

/* ------------------------------------------------------------ workout log */

export const workoutLog: Generator = {
  id: 'workout-log',
  name: 'Workout log',
  description: 'Exercise rows with set/rep/weight columns and a warm-up and notes area.',
  category: 'Tracking',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 24, min: 1, max: 300, step: 1 },
    { key: 'exercises', label: 'Pre-filled exercises', type: 'stringlist', default: [] },
    { key: 'exerciseRows', label: 'Exercise rows', type: 'number', default: 8, min: 2, max: 20, step: 1 },
    { key: 'setCount', label: 'Sets per exercise', type: 'number', default: 4, min: 1, max: 8, step: 1 },
    { key: 'showHeaderFields', label: 'Date / focus header', type: 'boolean', default: true },
    { key: 'showNotes', label: 'Notes area', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const exercises = list(params, 'exercises', []);
    const rowCount = num(params, 'exerciseRows', 8);
    const setCount = num(params, 'setCount', 4);
    const total = num(params, 'pageCount', 24);

    const pages: GeneratedPage[] = [];
    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      let area = ctx.content;

      const titleH = Math.min(area.h * 0.09, 13);
      const [titleRect, rest] = splitTop(area, titleH, 3);
      ops.push(...header(titleRect, 'Workout', { theme }));
      area = rest;

      if (bool(params, 'showHeaderFields', true)) {
        const fieldH = 9;
        const [fields, below] = splitTop(area, fieldH, 3);
        const cells = columns(fields, [1, 1, 1], 5);
        ['Date', 'Focus', 'Duration'].forEach((label, i) => {
          const cell = cells[i];
          ops.push(
            text(cell.x, cell.y + 3, label.toUpperCase(), {
              size: 2.3,
              color: theme.muted,
              font: theme.font,
              bold: true,
              letterSpacing: 0.2,
            })
          );
          ops.push(line(cell.x, cell.y + 7.5, cell.x + cell.w, cell.y + 7.5, theme.rule, 0.22));
        });
        area = below;
      }

      const [tableArea, notesArea] = bool(params, 'showNotes', true)
        ? splitTop(area, area.h - Math.min(area.h * 0.2, 34), 4)
        : [area, null];

      const headers = ['Exercise', ...Array.from({ length: setCount }, (_, i) => `Set ${i + 1}`)];
      const weights = [2.6, ...Array.from({ length: setCount }, () => 1)];
      const built = table(tableArea, {
        theme,
        headers,
        weights,
        rowCount,
        fontSize: 2.7,
      });
      ops.push(...built.ops);

      built.cells.forEach((row, i) => {
        const name = exercises[i];
        if (name) {
          ops.push(
            textInRect({ ...row[0], x: row[0].x + 1.5, w: row[0].w - 3 }, name, {
              size: Math.min(built.rowHeight * 0.36, 2.9),
              color: theme.ink,
              font: theme.font,
            })
          );
        }
      });

      if (notesArea) {
        ops.push(...labelledBox(notesArea, 'Notes', { theme, ruleSpacing: 6 }));
      }
      pages.push({ label: `Workout ${p + 1}`, ops });
    }
    return pages;
  },
};

/* ------------------------------------------------------------ reading log */

export const readingLog: Generator = {
  id: 'reading-log',
  name: 'Reading log',
  description: 'Title, author, dates and a rating column for each book.',
  category: 'Tracking',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 4, min: 1, max: 60, step: 1 },
    { key: 'rowCount', label: 'Rows per page', type: 'number', default: 18, min: 4, max: 40, step: 1 },
    { key: 'showRating', label: 'Rating column', type: 'boolean', default: true },
    { key: 'ratingStars', label: 'Rating boxes', type: 'number', default: 5, min: 3, max: 10, step: 1, when: { key: 'showRating', equals: [true] } },
    { key: 'title', label: 'Title', type: 'text', default: 'Reading log' },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const rowCount = num(params, 'rowCount', 18);
    const showRating = bool(params, 'showRating', true);
    const stars = num(params, 'ratingStars', 5);
    const total = num(params, 'pageCount', 4);

    const headers = ['Title', 'Author', 'Started', 'Finished'];
    const weights = [3.4, 2.4, 1.3, 1.3];
    if (showRating) {
      headers.push('Rating');
      weights.push(1.6);
    }

    const pages: GeneratedPage[] = [];
    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      const titleH = Math.min(ctx.content.h * 0.09, 13);
      const [titleRect, body] = splitTop(ctx.content, titleH, 3);
      ops.push(...header(titleRect, str(params, 'title', 'Reading log'), { theme }));

      const built = table(body, { theme, headers, weights, rowCount, fontSize: 2.8 });
      ops.push(...built.ops);

      if (showRating) {
        for (const row of built.cells) {
          const cell = row[row.length - 1];
          const size = Math.min(cell.h * 0.42, (cell.w - 2) / stars - 0.6, 3);
          const totalW = stars * size + (stars - 1) * 0.6;
          const startX = cell.x + (cell.w - totalW) / 2;
          const cy = cell.y + cell.h / 2 - size / 2;
          for (let s = 0; s < stars; s++) {
            ops.push(
              box({ x: startX + s * (size + 0.6), y: cy, w: size, h: size }, {
                stroke: theme.hairline,
                width: 0.18,
                radius: size / 2,
              })
            );
          }
        }
      }
      pages.push({ label: `Reading log ${p + 1}`, ops });
    }
    return pages;
  },
};

/* ----------------------------------------------------------------- kanban */

export const kanbanBoard: Generator = {
  id: 'kanban',
  name: 'Kanban board',
  description: 'Titled columns divided into card slots.',
  category: 'Planning',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 6, min: 1, max: 100, step: 1 },
    { key: 'columnLabels', label: 'Columns', type: 'stringlist', default: ['To do', 'Doing', 'Done'] },
    { key: 'cardsPerColumn', label: 'Card slots per column', type: 'number', default: 6, min: 1, max: 20, step: 1 },
    { key: 'cardLines', label: 'Lines per card', type: 'number', default: 2, min: 0, max: 6, step: 1 },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const labels = list(params, 'columnLabels', ['To do', 'Doing', 'Done']);
    const cards = num(params, 'cardsPerColumn', 6);
    const cardLines = num(params, 'cardLines', 2);
    const total = num(params, 'pageCount', 6);
    if (labels.length === 0) return [];

    const ops: Op[] = [];
    const gap = Math.min(ctx.content.w * 0.02, 4);
    const cols = columns(ctx.content, labels.map(() => 1), gap);

    labels.forEach((label, i) => {
      const col = cols[i];
      const headH = 8;
      ops.push(box({ ...col, h: headH }, { fill: theme.accent, radius: 1 }));
      ops.push(
        textInRect({ ...col, h: headH }, label, {
          size: 3.2,
          color: theme.accentInk,
          font: theme.font,
          bold: true,
          align: 'center',
        })
      );

      const body: Rect = { x: col.x, y: col.y + headH + 2, w: col.w, h: col.h - headH - 2 };
      const slots = rows(body, cards, 2);
      for (const slot of slots) {
        ops.push(box(slot, { stroke: theme.rule, width: 0.22, radius: 1 }));
        if (cardLines > 0) {
          const spacing = slot.h / (cardLines + 1);
          for (let l = 1; l <= cardLines; l++) {
            const y = slot.y + spacing * l;
            ops.push(line(slot.x + 2, y, slot.x + slot.w - 2, y, theme.hairline, 0.16));
          }
        }
      }
    });

    return Array.from({ length: total }, (_, i) => ({ label: `Kanban ${i + 1}`, ops }));
  },
};
