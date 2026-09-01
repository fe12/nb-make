import type { Rect } from '../../units';
import type { Op } from '../../render/ops';
import {
  box,
  columns,
  header,
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
  type GeneratedPage,
  type Generator,
} from '../registry';

/* ----------------------------------------------------------- Cornell notes */

export const cornellNotes: Generator = {
  id: 'cornell-notes',
  name: 'Cornell notes',
  description:
    'The three-zone note-taking layout: a cue column, a main notes area, and a summary strip.',
  category: 'Notes',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    { key: 'cueWidth', label: 'Cue column width (%)', type: 'number', default: 28, min: 15, max: 45, step: 1 },
    { key: 'summaryHeight', label: 'Summary height (%)', type: 'number', default: 18, min: 0, max: 40, step: 1 },
    { key: 'ruleSpacing', label: 'Rule spacing (mm)', type: 'number', default: 7, min: 4, max: 14, step: 0.5 },
    { key: 'showHeader', label: 'Topic / date header', type: 'boolean', default: true },
    { key: 'ruleCues', label: 'Rule the cue column', type: 'boolean', default: false },
    { key: 'labelZones', label: 'Label the zones', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const spacing = num(params, 'ruleSpacing', 7);
    const labelZones = bool(params, 'labelZones', true);

    const build = (): Op[] => {
      const ops: Op[] = [];
      let area = ctx.content;

      if (bool(params, 'showHeader', true)) {
        const headerH = Math.min(area.h * 0.09, 13);
        const [head, rest] = splitTop(area, headerH, 2);
        const [topic, date] = columns(head, [2.2, 1], 4);
        ops.push(...fieldLine(topic, 'Topic', theme));
        ops.push(...fieldLine(date, 'Date', theme));
        ops.push(line(area.x, head.y + head.h, area.x + area.w, head.y + head.h, theme.accent, 0.4));
        area = rest;
      }

      const summaryPct = num(params, 'summaryHeight', 18);
      const summaryH = (area.h * summaryPct) / 100;
      const [upper, summary] =
        summaryPct > 0 ? splitTop(area, area.h - summaryH - 3, 3) : [area, null];

      const cueW = (upper.w * num(params, 'cueWidth', 28)) / 100;
      const [cue, notes] = splitLeft(upper, cueW, 0);

      ops.push(...ruledArea(notes, spacing, theme.hairline, 0.18));
      if (bool(params, 'ruleCues')) {
        ops.push(...ruledArea(cue, spacing, theme.hairline, 0.18));
      }
      ops.push(line(notes.x, upper.y, notes.x, upper.y + upper.h, theme.rule, 0.35));

      if (labelZones) {
        ops.push(zoneLabel(cue, 'Cues', theme));
        ops.push(zoneLabel(notes, 'Notes', theme, 2));
      }

      if (summary) {
        ops.push(line(area.x, summary.y - 1.5, area.x + area.w, summary.y - 1.5, theme.rule, 0.35));
        if (labelZones) ops.push(zoneLabel(summary, 'Summary', theme));
        ops.push(
          ...ruledArea(
            { x: summary.x, y: summary.y + 4, w: summary.w, h: summary.h - 4 },
            spacing,
            theme.hairline,
            0.18
          )
        );
      }
      return ops;
    };

    const ops = build();
    const count = num(params, 'pageCount', 20);
    return Array.from({ length: count }, (_, i) => ({
      label: `Cornell notes ${i + 1}`,
      ops,
    }));
  },
};

function zoneLabel(rect: Rect, label: string, theme: Theme, padLeft = 0): Op {
  return text(rect.x + padLeft + 1, rect.y + 3, label.toUpperCase(), {
    size: 2.4,
    color: theme.muted,
    font: theme.font,
    bold: true,
    letterSpacing: 0.25,
  });
}

function fieldLine(rect: Rect, label: string, theme: Theme): Op[] {
  const size = Math.min(rect.h * 0.34, 3.2);
  const labelWidth = size * label.length * 0.72 + 2;
  const baseline = rect.y + rect.h * 0.72;
  return [
    text(rect.x, baseline, `${label}`, { size, color: theme.muted, font: theme.font }),
    line(rect.x + labelWidth, baseline + 0.8, rect.x + rect.w, baseline + 0.8, theme.rule, 0.2),
  ];
}

/* ------------------------------------------------------- index / contents */

export const indexPage: Generator = {
  id: 'index-contents',
  name: 'Index / contents',
  description: 'Numbered contents rows with a page-number column, for the front of a notebook.',
  category: 'Notes',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 2, min: 1, max: 40, step: 1 },
    { key: 'title', label: 'Title', type: 'text', default: 'Index' },
    { key: 'columnCount', label: 'Columns', type: 'select', default: 1, options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }] },
    { key: 'rowsPerColumn', label: 'Rows per column', type: 'number', default: 28, min: 5, max: 80, step: 1 },
    { key: 'showNumbers', label: 'Number the rows', type: 'boolean', default: false },
    { key: 'pageColumnWidth', label: 'Page column width (mm)', type: 'number', default: 14, min: 6, max: 40, step: 1 },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const colCount = num(params, 'columnCount', 1);
    const rowCount = num(params, 'rowsPerColumn', 28);
    const pageColW = num(params, 'pageColumnWidth', 14);
    const showNumbers = bool(params, 'showNumbers');
    const total = num(params, 'pageCount', 2);

    const pages: GeneratedPage[] = [];
    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      const titleH = Math.min(ctx.content.h * 0.09, 13);
      const [titleRect, body] = splitTop(ctx.content, titleH, 3);
      ops.push(
        ...header(titleRect, str(params, 'title', 'Index'), {
          theme,
          caption: total > 1 ? `${p + 1} / ${total}` : undefined,
        })
      );

      const cols = columns(body, Array.from({ length: colCount }, () => 1), 6);
      for (const col of cols) {
        const bands = rows(col, rowCount);
        bands.forEach((band, i) => {
          const [entry, pageCol] = splitLeft(band, band.w - pageColW, 0);
          const baseline = band.y + band.h * 0.78;

          if (showNumbers) {
            ops.push(
              text(entry.x, baseline, `${p * rowCount * colCount + i + 1}`, {
                size: Math.min(band.h * 0.42, 2.6),
                color: theme.hairline,
                font: theme.font,
              })
            );
          }
          ops.push(line(entry.x, baseline + 1, entry.x + entry.w - 2, baseline + 1, theme.hairline, 0.18));
          ops.push(line(pageCol.x, baseline + 1, pageCol.x + pageCol.w, baseline + 1, theme.rule, 0.18));
        });
        ops.push(
          line(col.x + col.w - pageColW, col.y, col.x + col.w - pageColW, col.y + col.h, theme.hairline, 0.15)
        );
      }
      pages.push({ label: `Index ${p + 1}`, ops });
    }
    return pages;
  },
};

/* ------------------------------------------------------------- storyboard */

const ASPECTS: Record<string, number> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '2.39:1': 2.39,
  '9:16': 9 / 16,
};

export const storyboard: Generator = {
  id: 'storyboard',
  name: 'Storyboard',
  description: 'Framed panels at a chosen aspect ratio, each with caption rules underneath.',
  category: 'Creative',
  fields: [
    { key: 'pageCount', label: 'Pages', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    { key: 'cols', label: 'Columns', type: 'number', default: 2, min: 1, max: 4, step: 1 },
    { key: 'panelRows', label: 'Rows', type: 'number', default: 3, min: 1, max: 6, step: 1 },
    {
      key: 'aspect',
      label: 'Frame aspect',
      type: 'select',
      default: '16:9',
      options: Object.keys(ASPECTS).map((k) => ({ value: k, label: k })),
    },
    { key: 'captionLines', label: 'Caption lines', type: 'number', default: 3, min: 0, max: 8, step: 1 },
    { key: 'showNumbers', label: 'Number the panels', type: 'boolean', default: true },
    { key: 'continuousNumbering', label: 'Number across pages', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const cols = num(params, 'cols', 2);
    const rowCount = num(params, 'panelRows', 3);
    const aspect = ASPECTS[str(params, 'aspect', '16:9')] ?? 16 / 9;
    const captionLines = num(params, 'captionLines', 3);
    const total = num(params, 'pageCount', 10);
    const perPage = cols * rowCount;

    const pages: GeneratedPage[] = [];
    for (let p = 0; p < total; p++) {
      const ops: Op[] = [];
      const gap = Math.min(ctx.content.w * 0.03, 6);
      const cellW = (ctx.content.w - gap * (cols - 1)) / cols;
      const cellH = (ctx.content.h - gap * (rowCount - 1)) / rowCount;

      for (let i = 0; i < perPage; i++) {
        const cx = ctx.content.x + (i % cols) * (cellW + gap);
        const cy = ctx.content.y + Math.floor(i / cols) * (cellH + gap);
        const index = bool(params, 'continuousNumbering', true) ? p * perPage + i + 1 : i + 1;
        ops.push(
          ...panel({ x: cx, y: cy, w: cellW, h: cellH }, aspect, captionLines, theme, {
            number: bool(params, 'showNumbers', true) ? index : undefined,
          })
        );
      }
      pages.push({ label: `Storyboard ${p + 1}`, ops });
    }
    return pages;
  },
};

function panel(
  rect: Rect,
  aspect: number,
  captionLines: number,
  theme: Theme,
  opts: { number?: number }
): Op[] {
  const ops: Op[] = [];
  const captionH = captionLines > 0 ? Math.min(rect.h * 0.36, captionLines * 5 + 2) : 0;
  const frameArea: Rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h - captionH };

  // Fit the requested aspect inside the available frame area.
  let fw = frameArea.w;
  let fh = fw / aspect;
  if (fh > frameArea.h) {
    fh = frameArea.h;
    fw = fh * aspect;
  }
  const frame: Rect = {
    x: frameArea.x + (frameArea.w - fw) / 2,
    y: frameArea.y,
    w: fw,
    h: fh,
  };

  ops.push(box(frame, { stroke: theme.rule, width: 0.3 }));

  if (opts.number !== undefined) {
    const badge = 5;
    ops.push(
      box({ x: frame.x, y: frame.y - badge - 0.6, w: badge * 1.6, h: badge }, { fill: theme.accent, radius: 0.6 })
    );
    ops.push(
      textInRect(
        { x: frame.x, y: frame.y - badge - 0.6, w: badge * 1.6, h: badge },
        String(opts.number),
        { size: 2.8, color: theme.accentInk, font: theme.font, bold: true, align: 'center' }
      )
    );
  }

  if (captionLines > 0) {
    const caption: Rect = {
      x: rect.x,
      y: frame.y + frame.h + 2,
      w: rect.w,
      h: rect.h - (frame.y + frame.h + 2 - rect.y),
    };
    const spacing = caption.h / (captionLines + 0.5);
    for (let i = 1; i <= captionLines; i++) {
      const y = caption.y + spacing * i;
      ops.push(line(caption.x, y, caption.x + caption.w, y, theme.hairline, 0.18));
    }
  }
  return ops;
}

/* ------------------------------------------------------------- title page */

export const titlePage: Generator = {
  id: 'title-page',
  name: 'Title page',
  description: 'A cover with a title, subtitle and owner details.',
  category: 'Notes',
  fields: [
    { key: 'title', label: 'Title', type: 'text', default: 'Notebook' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', default: '' },
    { key: 'owner', label: 'Owner line', type: 'text', default: 'This book belongs to' },
    { key: 'showRule', label: 'Decorative rule', type: 'boolean', default: true },
    { key: 'showDateFields', label: 'Started / finished fields', type: 'boolean', default: true },
    ...commonStyleFields,
  ],

  generate(params, ctx) {
    const theme = themeFrom(params);
    const ops: Op[] = [];
    const c = ctx.content;
    const cx = c.x + c.w / 2;

    const title = str(params, 'title', 'Notebook');
    const subtitle = str(params, 'subtitle', '');

    ops.push(
      text(cx, c.y + c.h * 0.34, title, {
        size: Math.min(c.w * 0.11, 16),
        color: theme.ink,
        font: theme.font,
        bold: true,
        align: 'center',
      })
    );

    if (bool(params, 'showRule', true)) {
      const ruleW = c.w * 0.34;
      ops.push(
        line(cx - ruleW / 2, c.y + c.h * 0.38, cx + ruleW / 2, c.y + c.h * 0.38, theme.accent, 0.6)
      );
    }

    if (subtitle) {
      ops.push(
        text(cx, c.y + c.h * 0.44, subtitle, {
          size: Math.min(c.w * 0.05, 6),
          color: theme.muted,
          font: theme.font,
          align: 'center',
        })
      );
    }

    const owner = str(params, 'owner', '');
    if (owner) {
      ops.push(
        text(cx, c.y + c.h * 0.64, owner, {
          size: 3,
          color: theme.muted,
          font: theme.font,
          align: 'center',
        })
      );
      ops.push(
        line(c.x + c.w * 0.22, c.y + c.h * 0.7, c.x + c.w * 0.78, c.y + c.h * 0.7, theme.rule, 0.25)
      );
    }

    if (bool(params, 'showDateFields', true)) {
      const bandY = c.y + c.h * 0.82;
      const band: Rect = { x: c.x + c.w * 0.15, y: bandY, w: c.w * 0.7, h: 10 };
      const [started, finished] = columns(band, [1, 1], 8);
      for (const [rect, label] of [
        [started, 'Started'],
        [finished, 'Finished'],
      ] as const) {
        ops.push(
          text(rect.x, rect.y + 3, label.toUpperCase(), {
            size: 2.4,
            color: theme.muted,
            font: theme.font,
            bold: true,
            letterSpacing: 0.2,
          })
        );
        ops.push(line(rect.x, rect.y + 8, rect.x + rect.w, rect.y + 8, theme.rule, 0.25));
      }
    }

    return [{ label: title || 'Title page', ops, suppressPattern: true }];
  },
};
