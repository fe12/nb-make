/**
 * Drawing helpers shared by the parametric generators.
 *
 * Generators describe *what* a page contains; everything about how a table,
 * label or rule is actually drawn lives here so the generated pages look like
 * one coherent family rather than a dozen independent sketches.
 */
import { themeRef } from '../palette';
import type { Rect } from '../units';
import { measureText, metricsOf, sanitizeText } from '../render/fonts';
import type { FontSpec, Op, TextAlign, TextBaseline } from '../render/ops';

export interface Theme {
  ink: string;
  muted: string;
  rule: string;
  hairline: string;
  accent: string;
  accentInk: string;
  fill: string;
  font: FontSpec;
}

/**
 * Generated pages draw in palette roles rather than fixed colours, so they
 * restyle with the notebook. `accentInk` stays white: it sits on top of the
 * accent colour and has to stay legible whatever that is.
 */
export const DEFAULT_THEME: Theme = {
  ink: themeRef('primary'),
  muted: themeRef('secondary'),
  rule: themeRef('secondary'),
  hairline: themeRef('secondaryAlt'),
  accent: themeRef('accent'),
  accentInk: '#ffffff',
  fill: themeRef('secondaryAlt'),
  font: { family: 'helvetica' },
};

export function themeFrom(params: Record<string, unknown>, base = DEFAULT_THEME): Theme {
  const accent = typeof params.accentColor === 'string' ? params.accentColor : base.accent;
  const rule = typeof params.ruleColor === 'string' ? params.ruleColor : base.rule;
  const font =
    typeof params.fontFamily === 'string'
      ? ({ family: params.fontFamily } as FontSpec)
      : base.font;
  return { ...base, accent, rule, font };
}

export interface TextOptions {
  size: number;
  font?: FontSpec;
  color?: string;
  align?: TextAlign;
  baseline?: TextBaseline;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  opacity?: number;
}

export function text(x: number, y: number, value: string, opts: TextOptions): Op {
  const font: FontSpec = {
    family: opts.font?.family ?? 'helvetica',
    bold: opts.bold ?? opts.font?.bold,
    italic: opts.italic ?? opts.font?.italic,
  };
  return {
    kind: 'text',
    x,
    y,
    text: sanitizeText(value),
    font,
    size: opts.size,
    color: opts.color ?? DEFAULT_THEME.ink,
    align: opts.align ?? 'left',
    baseline: opts.baseline ?? 'alphabetic',
    letterSpacing: opts.letterSpacing,
    opacity: opts.opacity,
  };
}

/** Text vertically centred in `rect`, horizontally aligned with padding. */
export function textInRect(rect: Rect, value: string, opts: TextOptions & { pad?: number }): Op {
  const pad = opts.pad ?? 1;
  const align = opts.align ?? 'left';
  const x =
    align === 'center'
      ? rect.x + rect.w / 2
      : align === 'right'
        ? rect.x + rect.w - pad
        : rect.x + pad;
  return text(x, rect.y + rect.h / 2, value, { ...opts, align, baseline: 'middle' });
}

export const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  dash?: number[]
): Op => ({ kind: 'line', x1, y1, x2, y2, stroke: { color, width, dash } });

export const box = (
  rect: Rect,
  opts: { stroke?: string; width?: number; fill?: string; radius?: number } = {}
): Op => ({
  kind: 'rect',
  x: rect.x,
  y: rect.y,
  w: rect.w,
  h: rect.h,
  radius: opts.radius,
  fill: opts.fill ? { color: opts.fill } : undefined,
  stroke: opts.stroke ? { color: opts.stroke, width: opts.width ?? 0.2 } : undefined,
});

/** Splits a rect into columns using relative weights. */
export function columns(rect: Rect, weights: number[], gap = 0): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const usable = rect.w - gap * (weights.length - 1);
  const out: Rect[] = [];
  let x = rect.x;
  for (const weight of weights) {
    const w = (usable * weight) / total;
    out.push({ x, y: rect.y, w, h: rect.h });
    x += w + gap;
  }
  return out;
}

/** Splits a rect into equal-height rows. */
export function rows(rect: Rect, count: number, gap = 0): Rect[] {
  if (count <= 0) return [];
  const usable = rect.h - gap * (count - 1);
  const h = usable / count;
  return Array.from({ length: count }, (_, i) => ({
    x: rect.x,
    y: rect.y + i * (h + gap),
    w: rect.w,
    h,
  }));
}

/** Removes `amount` from one side and returns both parts. */
export function splitTop(rect: Rect, amount: number, gap = 0): [Rect, Rect] {
  const top = { x: rect.x, y: rect.y, w: rect.w, h: amount };
  const rest = {
    x: rect.x,
    y: rect.y + amount + gap,
    w: rect.w,
    h: Math.max(0, rect.h - amount - gap),
  };
  return [top, rest];
}

export function splitLeft(rect: Rect, amount: number, gap = 0): [Rect, Rect] {
  const left = { x: rect.x, y: rect.y, w: amount, h: rect.h };
  const rest = {
    x: rect.x + amount + gap,
    y: rect.y,
    w: Math.max(0, rect.w - amount - gap),
    h: rect.h,
  };
  return [left, rest];
}

export function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    w: Math.max(0, rect.w - by * 2),
    h: Math.max(0, rect.h - by * 2),
  };
}

export interface TableOptions {
  theme: Theme;
  headers?: string[];
  weights?: number[];
  headerHeight?: number;
  rowCount: number;
  /** Draw internal vertical rules. */
  verticals?: boolean;
  outer?: boolean;
  zebra?: string;
  headerFill?: string;
  fontSize?: number;
  lineWidth?: number;
  /** Rows shorter than this are dropped rather than drawn unusably thin. */
  minRowHeight?: number;
}

export interface TableResult {
  ops: Op[];
  /** `cells[row][col]`, excluding the header. */
  cells: Rect[][];
  headerCells: Rect[];
  rowHeight: number;
}

/**
 * A ruled table that fills `rect` exactly. Rows are sized to consume the whole
 * height, which is what makes a generated page look printed rather than
 * assembled from fixed-height pieces.
 */
export function table(rect: Rect, opts: TableOptions): TableResult {
  const {
    theme,
    headers = [],
    rowCount,
    verticals = true,
    outer = true,
    zebra,
    headerFill,
    fontSize = 3,
    lineWidth = 0.2,
    minRowHeight = 1.5,
  } = opts;

  const colCount = Math.max(1, headers.length || opts.weights?.length || 1);
  const weights = opts.weights ?? Array.from({ length: colCount }, () => 1);
  const headerHeight = headers.length ? (opts.headerHeight ?? Math.max(5, fontSize * 2)) : 0;

  const bodyTop = rect.y + headerHeight;
  const bodyHeight = Math.max(0, rect.h - headerHeight);
  const rowHeight = rowCount > 0 ? bodyHeight / rowCount : bodyHeight;

  const ops: Op[] = [];
  const cells: Rect[][] = [];
  const headerCells: Rect[] = [];

  if (rowHeight < minRowHeight && rowCount > 0) {
    return { ops, cells, headerCells, rowHeight };
  }

  const colRects = columns({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, weights);

  if (headers.length) {
    if (headerFill ?? theme.fill) {
      ops.push(box({ ...rect, h: headerHeight }, { fill: headerFill ?? theme.fill }));
    }
    headers.forEach((label, i) => {
      const cell = { x: colRects[i].x, y: rect.y, w: colRects[i].w, h: headerHeight };
      headerCells.push(cell);
      if (label) {
        ops.push(
          textInRect(cell, label, {
            size: fontSize,
            color: theme.ink,
            font: theme.font,
            bold: true,
            align: 'center',
          })
        );
      }
    });
  }

  if (zebra) {
    for (let r = 0; r < rowCount; r += 2) {
      ops.push(
        box({ x: rect.x, y: bodyTop + r * rowHeight, w: rect.w, h: rowHeight }, { fill: zebra })
      );
    }
  }

  for (let r = 0; r < rowCount; r++) {
    const row: Rect[] = colRects.map((c) => ({
      x: c.x,
      y: bodyTop + r * rowHeight,
      w: c.w,
      h: rowHeight,
    }));
    cells.push(row);
    if (r > 0) {
      ops.push(
        line(rect.x, bodyTop + r * rowHeight, rect.x + rect.w, bodyTop + r * rowHeight, theme.hairline, lineWidth)
      );
    }
  }

  if (headerHeight > 0) {
    ops.push(line(rect.x, bodyTop, rect.x + rect.w, bodyTop, theme.rule, lineWidth * 1.4));
  }

  if (verticals) {
    for (let c = 1; c < colCount; c++) {
      ops.push(
        line(colRects[c].x, rect.y, colRects[c].x, rect.y + rect.h, theme.hairline, lineWidth)
      );
    }
  }

  if (outer) {
    ops.push(box(rect, { stroke: theme.rule, width: lineWidth * 1.4 }));
  }

  return { ops, cells, headerCells, rowHeight };
}

/** Title bar with an optional right-hand caption. */
export function header(
  rect: Rect,
  title: string,
  opts: { theme: Theme; caption?: string; size?: number; rule?: boolean; align?: TextAlign }
): Op[] {
  const { theme, caption, rule = true, align = 'left' } = opts;
  const size = opts.size ?? Math.min(rect.h * 0.62, 9);
  const ops: Op[] = [];

  const x = align === 'center' ? rect.x + rect.w / 2 : align === 'right' ? rect.x + rect.w : rect.x;
  ops.push(
    text(x, rect.y + rect.h * 0.72, title, {
      size,
      color: theme.ink,
      font: theme.font,
      bold: true,
      align,
    })
  );

  if (caption) {
    ops.push(
      text(rect.x + rect.w, rect.y + rect.h * 0.72, caption, {
        size: size * 0.5,
        color: theme.muted,
        font: theme.font,
        align: 'right',
      })
    );
  }

  if (rule) {
    ops.push(
      line(rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h, theme.accent, 0.5)
    );
  }
  return ops;
}

/** Evenly spaced write-on rules filling a rect. */
export function ruledArea(
  rect: Rect,
  spacing: number,
  color: string,
  width = 0.2,
  dash?: number[]
): Op[] {
  const ops: Op[] = [];
  for (let y = rect.y + spacing; y <= rect.y + rect.h + 0.001; y += spacing) {
    ops.push(line(rect.x, y, rect.x + rect.w, y, color, width, dash));
  }
  return ops;
}

/** A labelled area: small caption above a ruled or blank box. */
export function labelledBox(
  rect: Rect,
  label: string,
  opts: {
    theme: Theme;
    size?: number;
    ruleSpacing?: number;
    border?: boolean;
    fill?: string;
  }
): Op[] {
  const { theme, border = true, fill, ruleSpacing } = opts;
  const size = opts.size ?? 3;
  const ops: Op[] = [];
  const labelHeight = label ? size * 1.6 : 0;

  if (label) {
    ops.push(
      text(rect.x, rect.y + size, label.toUpperCase(), {
        size: size * 0.82,
        color: theme.muted,
        font: theme.font,
        bold: true,
        letterSpacing: size * 0.06,
      })
    );
  }

  const body: Rect = {
    x: rect.x,
    y: rect.y + labelHeight,
    w: rect.w,
    h: Math.max(0, rect.h - labelHeight),
  };

  if (fill) ops.push(box(body, { fill }));
  if (border) ops.push(box(body, { stroke: theme.rule, width: 0.25 }));
  if (ruleSpacing) ops.push(...ruledArea(inset(body, 1.5), ruleSpacing, theme.hairline, 0.18));

  return ops;
}

/** Checkbox column paired with a rule, used by several trackers. */
export function checkboxRow(
  rect: Rect,
  opts: { theme: Theme; boxSize?: number; label?: string; size?: number; rule?: boolean }
): Op[] {
  const { theme, label, rule = true } = opts;
  const size = opts.size ?? 3;
  const boxSize = opts.boxSize ?? Math.min(rect.h * 0.55, 4);
  const cy = rect.y + rect.h / 2;
  const ops: Op[] = [
    box(
      { x: rect.x, y: cy - boxSize / 2, w: boxSize, h: boxSize },
      { stroke: theme.rule, width: 0.25, radius: 0.4 }
    ),
  ];

  const textX = rect.x + boxSize + size * 0.8;
  if (label) {
    ops.push(
      text(textX, cy, label, { size, color: theme.ink, font: theme.font, baseline: 'middle' })
    );
  } else if (rule) {
    ops.push(line(textX, cy + size * 0.5, rect.x + rect.w, cy + size * 0.5, theme.hairline, 0.18));
  }
  return ops;
}

/** Shrinks `size` until `value` fits `maxWidth`. */
export function fitTextSize(
  value: string,
  font: FontSpec,
  maxWidth: number,
  desired: number,
  min = 1
): number {
  let size = desired;
  while (size > min && measureText(value, font, size) > maxWidth) size -= 0.1;
  return Math.max(min, size);
}

export const capHeightOffset = (font: FontSpec, size: number): number =>
  metricsOf(font).capHeight * size;
