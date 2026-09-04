/**
 * Compiles a page template into drawing ops.
 *
 * This is where a design stops being "a template" and becomes geometry for a
 * *specific* page size. Block rects are stored as fractions of the content box,
 * so re-targeting a notebook from A5 to A6 is just a matter of compiling
 * against a different size — the proportions survive automatically, and only
 * the type scale needs a policy (`typeScale`).
 */
import type { AssetIndex } from '../assets';
import { aspectOf } from '../assets';
import { layoutLatex } from '../latex/layout';
import { parseLatex } from '../latex/parse';
import type { MathCache } from '../latex/types';
import { measureText, metricsOf, sanitizeText, wrapText } from '../render/fonts';
import type { FontSpec, Op } from '../render/ops';
import { rotateM } from '../render/ops';
import { applyPalette } from '../render/palette';
import { renderPattern } from '../render/patterns';
import type { Block, BlockContent, PageTemplate } from '../types/page';
import type { Pattern } from '../types/pattern';
import type { NotebookPalette } from '../palette';
import { contentRect, resolvePageSize, type Bleed, type Margins, type Rect, type Size } from '../units';

export interface PageNumberContext {
  /** The number to print, already offset by `startAt`. */
  number: number;
  total: number;
  title: string;
  /** Right-hand pages are odd when counting from 1; drives `outer` positions. */
  isRecto: boolean;
}

export interface CompilePageOptions {
  size: Size;
  margins: Margins;
  assets: AssetIndex;
  math: MathCache;
  pageNumber?: PageNumberContext;
  /** Resolves `theme:*` colours. Omit to leave references unresolved. */
  palette?: NotebookPalette;
  /**
   * Print bleed: how far page-wide artwork may run past the trim edge. Only
   * the background and a ruling that reaches the page boundary are extended —
   * never blocks, and never a ruling that stops inside the margins.
   */
  bleed?: Bleed;
}

export interface CompiledContent {
  ops: Op[];
  /** Formula keys the renderer needed but did not have. */
  missingMath: string[];
  warnings: string[];
}

export function compileTemplate(
  template: PageTemplate,
  options: CompilePageOptions
): CompiledContent {
  const size = template.sizeOverride ? resolvePageSize(template.sizeOverride) : options.size;
  const margins = template.marginsOverride ?? options.margins;
  const content = contentRect(size, margins);

  const authored = resolvePageSize(template.authoredFor);
  const authoredContent = contentRect(authored, margins);
  const typeScale =
    template.typeScale === 'proportional' && authoredContent.w > 0 && authoredContent.h > 0
      ? Math.min(content.w / authoredContent.w, content.h / authoredContent.h)
      : 1;
  // Patterns keep absolute spacings unless they opt in, so this ratio is only
  // handed to them; blocks use `typeScale` above.
  const pageScale = authored.w > 0 ? Math.min(size.w / authored.w, size.h / authored.h) : 1;

  const ops: Op[] = [];
  const missingMath = new Set<string>();
  const warnings: string[] = [];

  // Bleed is only granted to artwork that actually reaches an edge: the page
  // background on every side, and the ruling only on the sides where its area
  // touches the page boundary. A ruling inside margins must not creep into
  // them, and blocks never bleed — extending an image or a table is a design
  // decision, not trim safety.
  const bleed = options.bleed ?? { top: 0, right: 0, bottom: 0, left: 0 };

  if (template.background) {
    ops.push({
      kind: 'rect',
      x: -bleed.left,
      y: -bleed.top,
      w: size.w + bleed.left + bleed.right,
      h: size.h + bleed.top + bleed.bottom,
      fill: { color: template.background },
    });
  }

  const patternArea: Rect =
    template.pattern.area === 'full' ? { x: 0, y: 0, w: size.w, h: size.h } : content;
  const patternBleed: Bleed = touchesEdges(patternArea, size, bleed);
  ops.push(
    ...renderPattern(template.pattern, patternArea, { scale: pageScale, bleed: patternBleed })
  );

  const ctx: BlockContext = {
    content,
    size,
    authoredWidth: authoredContent.w,
    typeScale,
    pageScale,
    assets: options.assets,
    math: options.math,
    pageNumber: options.pageNumber,
    missingMath,
    warnings,
  };

  for (const block of template.blocks) {
    if (!block.visible) continue;
    ops.push(...compileBlock(block, ctx));
  }

  return {
    ops: options.palette ? applyPalette(ops, options.palette) : ops,
    missingMath: [...missingMath],
    warnings,
  };
}

/** The subset of `bleed` on sides where `area` reaches the page boundary. */
function touchesEdges(area: Rect, page: Size, bleed: Bleed): Bleed {
  const e = 0.05; // mm; margin rounding leaves areas a hair off the edge
  return {
    top: area.y <= e ? bleed.top : 0,
    right: area.x + area.w >= page.w - e ? bleed.right : 0,
    bottom: area.y + area.h >= page.h - e ? bleed.bottom : 0,
    left: area.x <= e ? bleed.left : 0,
  };
}

interface BlockContext {
  content: Rect;
  size: Size;
  authoredWidth: number;
  typeScale: number;
  pageScale: number;
  assets: AssetIndex;
  math: MathCache;
  pageNumber?: PageNumberContext;
  missingMath: Set<string>;
  warnings: string[];
}

/** Absolute mm rect for a block, from its content-box fractions plus padding. */
function resolveRect(block: Block, ctx: BlockContext): Rect {
  const { content } = ctx;
  const raw: Rect = {
    x: content.x + block.rect.x * content.w,
    y: content.y + block.rect.y * content.h,
    w: block.rect.w * content.w,
    h: block.rect.h * content.h,
  };
  const pad = block.padding * ctx.typeScale;
  return {
    x: raw.x + pad,
    y: raw.y + pad,
    w: Math.max(0, raw.w - pad * 2),
    h: Math.max(0, raw.h - pad * 2),
  };
}

function compileBlock(block: Block, ctx: BlockContext): Op[] {
  const rect = resolveRect(block, ctx);
  if (rect.w <= 0 || rect.h <= 0) return [];

  const inner: Op[] = [];

  if (block.background) {
    inner.push({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      fill: { color: block.background },
    });
  }

  inner.push(...compileContent(block.content, rect, ctx));

  if (inner.length === 0) return [];

  const needsGroup = block.rotation !== 0 || block.opacity < 1;
  if (!needsGroup) return inner;

  return [
    {
      kind: 'group',
      ops: inner,
      opacity: block.opacity < 1 ? block.opacity : undefined,
      matrix:
        block.rotation !== 0
          ? rotateM(block.rotation, rect.x + rect.w / 2, rect.y + rect.h / 2)
          : undefined,
    },
  ];
}

function compileContent(content: BlockContent, rect: Rect, ctx: BlockContext): Op[] {
  switch (content.type) {
    case 'text':
      return textBlock(content, rect, ctx);
    case 'latex':
      return latexBlock(content, rect, ctx);
    case 'image':
      return imageBlock(content, rect, ctx);
    case 'shape':
      return shapeBlock(content, rect, ctx);
    case 'pattern':
      return patternBlock(content, rect, ctx);
    case 'graph':
      return graphBlock(content, rect, ctx);
    case 'table':
      return tableBlock(content, rect, ctx);
    case 'fields':
      return fieldsBlock(content, rect, ctx);
    case 'checklist':
      return checklistBlock(content, rect, ctx);
    case 'pagenumber':
      return pageNumberBlock(content, rect, ctx);
  }
}

type Content<T extends BlockContent['type']> = Extract<BlockContent, { type: T }>;

/* ------------------------------------------------------------------- text */

function textBlock(c: Content<'text'>, rect: Rect, ctx: BlockContext): Op[] {
  const font: FontSpec = { family: c.font.family, bold: c.font.bold, italic: c.font.italic };
  let size = c.size * ctx.typeScale;
  const spacing = c.letterSpacing * ctx.typeScale;

  let lines = wrapText(sanitizeText(c.text), { font, size, maxWidth: rect.w, letterSpacing: spacing });

  if (c.autoFit) {
    // Shrink until the wrapped block fits vertically. Re-wrapping each step is
    // required because a smaller size changes where the lines break.
    let guard = 0;
    while (lines.length * size * c.lineHeight > rect.h && size > 0.6 && guard++ < 200) {
      size -= Math.max(0.05, size * 0.04);
      lines = wrapText(sanitizeText(c.text), {
        font,
        size,
        maxWidth: rect.w,
        letterSpacing: spacing,
      });
    }
  }

  const lineHeight = size * c.lineHeight;
  const blockHeight = lines.length * lineHeight;
  const metrics = metricsOf(font);

  const offsetY =
    c.valign === 'middle'
      ? Math.max(0, (rect.h - blockHeight) / 2)
      : c.valign === 'bottom'
        ? Math.max(0, rect.h - blockHeight)
        : 0;

  const x =
    c.align === 'center' ? rect.x + rect.w / 2 : c.align === 'right' ? rect.x + rect.w : rect.x;

  return lines.map((line, i) => ({
    kind: 'text' as const,
    x,
    // Position by baseline so multi-line text keeps an even rhythm.
    y: rect.y + offsetY + i * lineHeight + size * metrics.ascender,
    text: line,
    font,
    size,
    color: c.color,
    align: c.align,
    baseline: 'alphabetic' as const,
    letterSpacing: spacing || undefined,
  }));
}

/* ------------------------------------------------------------------ latex */

function latexBlock(c: Content<'latex'>, rect: Rect, ctx: BlockContext): Op[] {
  const doc = parseLatex(c.source);
  const result = layoutLatex(doc, {
    box: rect,
    fontSize: c.size * (c.fit === 'reflow' ? ctx.typeScale : 1),
    font: { family: c.font.family, bold: c.font.bold, italic: c.font.italic },
    color: c.color,
    lineHeight: c.lineHeight,
    align: c.align,
    valign: c.valign,
    fit: c.fit,
    authoredWidth: ctx.authoredWidth,
    math: ctx.math,
  });

  for (const key of result.missing) ctx.missingMath.add(key);
  for (const warning of doc.warnings) ctx.warnings.push(warning);
  if (result.overflow) {
    ctx.warnings.push('A LaTeX block overflows its box — enlarge it or switch the fit mode.');
  }
  return result.ops;
}

/* ------------------------------------------------------------------ image */

function imageBlock(c: Content<'image'>, rect: Rect, ctx: BlockContext): Op[] {
  if (!c.assetId) {
    return [
      {
        kind: 'rect',
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        stroke: { color: '#c8d4e0', width: 0.2, dash: [1.5, 1.5] },
      },
    ];
  }

  const aspect = aspectOf(ctx.assets, c.assetId);
  let drawn: Rect;

  if (c.fit === 'fill') {
    drawn = rect;
  } else {
    const boxAspect = rect.w / rect.h;
    // `contain` fits inside the box; `cover` fills it and overflows, which is
    // why it needs a clip below.
    const matchWidth = c.fit === 'contain' ? aspect > boxAspect : aspect < boxAspect;
    const w = matchWidth ? rect.w : rect.h * aspect;
    const h = matchWidth ? rect.w / aspect : rect.h;
    const x =
      c.align === 'left' ? rect.x : c.align === 'right' ? rect.x + rect.w - w : rect.x + (rect.w - w) / 2;
    const y =
      c.valign === 'top'
        ? rect.y
        : c.valign === 'bottom'
          ? rect.y + rect.h - h
          : rect.y + (rect.h - h) / 2;
    drawn = { x, y, w, h };
  }

  const op: Op = {
    kind: 'image',
    x: drawn.x,
    y: drawn.y,
    w: drawn.w,
    h: drawn.h,
    assetId: c.assetId,
    opacity: c.opacity < 1 ? c.opacity : undefined,
  };

  return c.fit === 'cover'
    ? [{ kind: 'group', ops: [op], clip: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }]
    : [op];
}

/* ------------------------------------------------------------------ shape */

function shapeBlock(c: Content<'shape'>, rect: Rect, ctx: BlockContext): Op[] {
  const width = c.strokeWidth * ctx.typeScale;
  const stroke = width > 0 ? { color: c.stroke, width, dash: c.dashed ? [1.5, 1.2] : undefined } : undefined;
  const fill = c.fill ? { color: c.fill } : undefined;

  switch (c.shape) {
    case 'ellipse':
      return [
        {
          kind: 'ellipse',
          cx: rect.x + rect.w / 2,
          cy: rect.y + rect.h / 2,
          rx: rect.w / 2,
          ry: rect.h / 2,
          fill,
          stroke,
        },
      ];
    case 'line':
      return [
        {
          kind: 'line',
          x1: rect.x,
          y1: rect.y + rect.h / 2,
          x2: rect.x + rect.w,
          y2: rect.y + rect.h / 2,
          stroke: stroke ?? { color: c.stroke, width: 0.3 },
        },
      ];
    case 'triangle':
      return [
        {
          kind: 'polyline',
          points: [
            rect.x + rect.w / 2,
            rect.y,
            rect.x + rect.w,
            rect.y + rect.h,
            rect.x,
            rect.y + rect.h,
          ],
          closed: true,
          fill,
          stroke,
        },
      ];
    default:
      return [
        {
          kind: 'rect',
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          radius: c.radius * ctx.typeScale || undefined,
          fill,
          stroke,
        },
      ];
  }
}

/* ---------------------------------------------------------------- pattern */

function patternBlock(c: Content<'pattern'>, rect: Rect, ctx: BlockContext): Op[] {
  const pattern: Pattern = c.pattern;
  const ops = renderPattern(pattern, rect, { scale: ctx.pageScale });
  if (c.border.enabled) {
    ops.push({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      radius: c.border.radius || undefined,
      stroke: { color: c.border.color, width: c.border.width },
    });
  }
  return ops;
}

/* ------------------------------------------------------------------ graph */

function graphBlock(c: Content<'graph'>, rect: Rect, ctx: BlockContext): Op[] {
  const labelSize = c.labelSize * ctx.typeScale;
  const labelFont: FontSpec = { family: 'times', bold: false, italic: false };
  const left = c.showLabels ? Math.max(6, labelSize * 3.3) : 2;
  const bottom = c.showLabels ? Math.max(6, labelSize * 3.1) : 2;
  const top = c.showArrows ? 3 : 1;
  const right = c.showArrows ? 3 : 1;
  const plot: Rect = {
    x: rect.x + left,
    y: rect.y + top,
    w: rect.w - left - right,
    h: rect.h - top - bottom,
  };
  if (plot.w <= 2 || plot.h <= 2) return [];

  const xStep = plot.w / c.xMax;
  const yStep = plot.h / c.yMax;
  const grid = { color: c.gridColor, width: c.gridWidth * ctx.typeScale };
  const axis = { color: c.axisColor, width: c.axisWidth * ctx.typeScale };
  const ops: Op[] = [];

  if (c.showGrid) {
    for (let i = 0; i <= c.xMax; i++) {
      const x = plot.x + xStep * i;
      ops.push({ kind: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: grid });
    }
    for (let i = 0; i <= c.yMax; i++) {
      const y = plot.y + yStep * i;
      ops.push({ kind: 'line', x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: grid });
    }
  }

  const originX = plot.x;
  const originY = plot.y + plot.h;
  const arrow = c.showArrows ? Math.min(2.2, Math.max(1.2, labelSize)) : 0;
  ops.push(
    {
      kind: 'line',
      x1: originX,
      y1: originY,
      x2: plot.x + plot.w + arrow,
      y2: originY,
      stroke: axis,
    },
    {
      kind: 'line',
      x1: originX,
      y1: originY,
      x2: originX,
      y2: plot.y - arrow,
      stroke: axis,
    }
  );

  if (c.showArrows) {
    ops.push(
      {
        kind: 'polyline',
        points: [plot.x + plot.w + arrow, originY, plot.x + plot.w + arrow * 0.45, originY - arrow * 0.45],
        stroke: axis,
      },
      {
        kind: 'polyline',
        points: [plot.x + plot.w + arrow, originY, plot.x + plot.w + arrow * 0.45, originY + arrow * 0.45],
        stroke: axis,
      },
      {
        kind: 'polyline',
        points: [originX, plot.y - arrow, originX - arrow * 0.45, plot.y - arrow + arrow * 0.45],
        stroke: axis,
      },
      {
        kind: 'polyline',
        points: [originX, plot.y - arrow, originX + arrow * 0.45, plot.y - arrow + arrow * 0.45],
        stroke: axis,
      }
    );
  }

  if (!c.showLabels) return ops;
  for (let i = c.xLabelEvery; i <= c.xMax; i += c.xLabelEvery) {
    ops.push({
      kind: 'text',
      x: plot.x + xStep * i,
      y: originY + labelSize * 1.35,
      text: String(i),
      font: labelFont,
      size: labelSize,
      color: c.labelColor,
      align: 'center',
      baseline: 'alphabetic',
    });
  }
  for (let i = c.yLabelEvery; i <= c.yMax; i += c.yLabelEvery) {
    ops.push({
      kind: 'text',
      x: originX - labelSize * 0.7,
      y: originY - yStep * i + labelSize * 0.34,
      text: String(i),
      font: labelFont,
      size: labelSize,
      color: c.labelColor,
      align: 'right',
      baseline: 'alphabetic',
    });
  }
  return ops;
}

/* ------------------------------------------------------------------ table */

function tableBlock(c: Content<'table'>, rect: Rect, ctx: BlockContext): Op[] {
  const cols = c.columns.length ? c.columns : [{ label: '', weight: 1, align: 'left' as const }];
  const size = c.size * ctx.typeScale;
  const lineWidth = c.lineWidth * ctx.typeScale;
  const headerHeight = cols.some((col) => col.label) ? c.headerHeight * ctx.typeScale : 0;

  const bodyHeight = Math.max(0, rect.h - headerHeight);
  const rowHeight = c.fillHeight
    ? c.rows > 0
      ? bodyHeight / c.rows
      : bodyHeight
    : c.rowHeight * ctx.typeScale;
  const rowCount = c.fillHeight ? c.rows : Math.max(0, Math.floor(bodyHeight / rowHeight));

  const totalWeight = cols.reduce((a, col) => a + col.weight, 0) || 1;
  const ops: Op[] = [];

  if (headerHeight > 0) {
    ops.push({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: headerHeight,
      fill: { color: c.headerFill },
    });
  }

  if (c.zebraFill) {
    for (let r = 0; r < rowCount; r += 2) {
      ops.push({
        kind: 'rect',
        x: rect.x,
        y: rect.y + headerHeight + r * rowHeight,
        w: rect.w,
        h: rowHeight,
        fill: { color: c.zebraFill },
      });
    }
  }

  let x = rect.x;
  for (const col of cols) {
    const w = (rect.w * col.weight) / totalWeight;
    if (headerHeight > 0 && col.label) {
      const tx = col.align === 'center' ? x + w / 2 : col.align === 'right' ? x + w - 1.5 : x + 1.5;
      ops.push({
        kind: 'text',
        x: tx,
        y: rect.y + headerHeight / 2,
        text: sanitizeText(col.label),
        font: { family: c.font.family, bold: true, italic: c.font.italic },
        size,
        color: c.color,
        align: col.align,
        baseline: 'middle',
      });
    }
    x += w;
    if (c.verticalRules && x < rect.x + rect.w - 0.01) {
      ops.push({
        kind: 'line',
        x1: x,
        y1: rect.y,
        x2: x,
        y2: rect.y + headerHeight + rowCount * rowHeight,
        stroke: { color: c.lineColor, width: lineWidth },
      });
    }
  }

  for (let r = 0; r <= rowCount; r++) {
    const y = rect.y + headerHeight + r * rowHeight;
    ops.push({
      kind: 'line',
      x1: rect.x,
      y1: y,
      x2: rect.x + rect.w,
      y2: y,
      stroke: { color: c.lineColor, width: r === 0 ? lineWidth * 1.5 : lineWidth },
    });
  }

  if (c.outerBorder) {
    ops.push({
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: headerHeight + rowCount * rowHeight,
      stroke: { color: c.lineColor, width: lineWidth * 1.5 },
    });
  }

  return ops;
}

/* ----------------------------------------------------------------- fields */

function fieldsBlock(c: Content<'fields'>, rect: Rect, ctx: BlockContext): Op[] {
  if (c.items.length === 0) return [];
  const size = c.size * ctx.typeScale;
  const gap = c.gap * ctx.typeScale;
  const font: FontSpec = { family: c.font.family, bold: c.font.bold, italic: c.font.italic };

  const cols = Math.max(1, c.columns);
  const rowsCount = Math.ceil(c.items.length / cols);
  const colWidth = (rect.w - gap * (cols - 1)) / cols;
  const rowHeight = rect.h / rowsCount;
  const ops: Op[] = [];

  c.items.forEach((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = rect.x + col * (colWidth + gap);
    const baseline = rect.y + row * rowHeight + rowHeight * 0.65;
    const labelWidth = label ? measureText(`${label} `, font, size) : 0;

    if (label) {
      ops.push({
        kind: 'text',
        x,
        y: baseline,
        text: sanitizeText(label),
        font,
        size,
        color: c.color,
        baseline: 'alphabetic',
      });
    }
    ops.push({
      kind: 'line',
      x1: x + labelWidth,
      y1: baseline + size * 0.25,
      x2: x + colWidth,
      y2: baseline + size * 0.25,
      stroke: { color: c.lineColor, width: c.lineWidth * ctx.typeScale },
    });
  });

  return ops;
}

/* -------------------------------------------------------------- checklist */

function checklistBlock(c: Content<'checklist'>, rect: Rect, ctx: BlockContext): Op[] {
  const size = c.size * ctx.typeScale;
  const rowHeight = c.rowHeight * ctx.typeScale;
  const boxSize = c.boxSize * ctx.typeScale;
  const total = c.items.length + c.blankRows;
  const maxRows = Math.min(total, Math.max(0, Math.floor(rect.h / rowHeight)));
  const font: FontSpec = { family: c.font.family, bold: c.font.bold, italic: c.font.italic };
  const ops: Op[] = [];

  for (let i = 0; i < maxRows; i++) {
    const cy = rect.y + i * rowHeight + rowHeight / 2;
    if (c.boxShape === 'circle') {
      ops.push({
        kind: 'ellipse',
        cx: rect.x + boxSize / 2,
        cy,
        rx: boxSize / 2,
        ry: boxSize / 2,
        stroke: { color: c.lineColor, width: 0.25 * ctx.typeScale },
      });
    } else {
      ops.push({
        kind: 'rect',
        x: rect.x,
        y: cy - boxSize / 2,
        w: boxSize,
        h: boxSize,
        radius: 0.4 * ctx.typeScale,
        stroke: { color: c.lineColor, width: 0.25 * ctx.typeScale },
      });
    }

    const textX = rect.x + boxSize + size * 0.8;
    const label = c.items[i];
    if (label) {
      ops.push({
        kind: 'text',
        x: textX,
        y: cy,
        text: sanitizeText(label),
        font,
        size,
        color: c.color,
        baseline: 'middle',
      });
    } else if (c.showRule) {
      ops.push({
        kind: 'line',
        x1: textX,
        y1: cy + size * 0.45,
        x2: rect.x + rect.w,
        y2: cy + size * 0.45,
        stroke: { color: c.lineColor, width: 0.18 * ctx.typeScale },
      });
    }
  }
  return ops;
}

/* ------------------------------------------------------------ page number */

function pageNumberBlock(c: Content<'pagenumber'>, rect: Rect, ctx: BlockContext): Op[] {
  const info = ctx.pageNumber;
  if (!info) return [];
  const value = formatPageNumber(c.format, info);
  if (!value) return [];

  const size = c.size * ctx.typeScale;
  const x =
    c.align === 'center' ? rect.x + rect.w / 2 : c.align === 'right' ? rect.x + rect.w : rect.x;

  return [
    {
      kind: 'text',
      x,
      y: rect.y + rect.h / 2,
      text: sanitizeText(value),
      font: { family: c.font.family, bold: c.font.bold, italic: c.font.italic },
      size,
      color: c.color,
      align: c.align,
      baseline: 'middle',
    },
  ];
}

export function formatPageNumber(format: string, info: PageNumberContext): string {
  return format
    .replace(/\{n\}/g, String(info.number))
    .replace(/\{total\}/g, String(info.total))
    .replace(/\{title\}/g, info.title);
}
