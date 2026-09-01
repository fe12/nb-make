/**
 * Flows a parsed LaTeX document into drawing ops inside a box.
 *
 * This is the piece that answers the "my source is A4 but the target is A6"
 * question. Three fit strategies, each with a different intent:
 *
 *  - `reflow` keeps the type size and re-wraps to the new width. Good for
 *    prose, where you want the same readable size on a smaller page.
 *  - `scale` scales the type by the width ratio against the size the block was
 *    authored at, so the result is a photographic reduction: identical line
 *    breaks, just smaller. Good for formula sheets you want to look "the same".
 *  - `both` does `scale`, then shrinks further if it still overflows vertically.
 */
import type { Rect } from '../units';
import { measureText, metricsOf, sanitizeText } from '../render/fonts';
import type { FontSpec, Op } from '../render/ops';
import { multiply, scaleM, translate } from '../render/ops';
import type { InlineStyle, LatexDocument, LatexParagraph, MathCache } from './types';

export interface LatexLayoutOptions {
  box: Rect;
  /** Base type size in mm. */
  fontSize: number;
  font: FontSpec;
  color: string;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  fit: 'reflow' | 'scale' | 'both';
  /**
   * Content width the source was written against, in mm. Only used by the
   * `scale` strategies; defaults to the box width (i.e. no scaling).
   */
  authoredWidth?: number;
  math: MathCache;
}

export interface LatexLayoutResult {
  ops: Op[];
  /** Total height consumed, in mm. */
  height: number;
  /** Effective type scale applied. */
  scale: number;
  overflow: boolean;
  /** Formula keys that were missing from the cache. */
  missing: string[];
}

const HEADING_SCALE: Record<number, number> = {
  0: 1.9,
  1: 1.45,
  2: 1.22,
  3: 1.06,
  4: 1,
};

export function layoutLatex(
  doc: LatexDocument,
  options: LatexLayoutOptions
): LatexLayoutResult {
  const authored = options.authoredWidth ?? options.box.w;
  const widthRatio = authored > 0 ? options.box.w / authored : 1;

  const baseScale =
    options.fit === 'reflow' ? 1 : clamp(widthRatio, 0.05, 4);

  let result = run(doc, options, baseScale);

  if (options.fit === 'both' && result.overflow) {
    // Binary search the largest scale that fits. Re-running the flow each time
    // is what keeps line breaking honest — a smaller size fits more words per
    // line, so we cannot just scale the first result.
    let lo = 0.15;
    let hi = baseScale;
    for (let i = 0; i < 14 && hi - lo > 0.005; i++) {
      const mid = (lo + hi) / 2;
      const trial = run(doc, options, mid);
      if (trial.overflow) hi = mid;
      else lo = mid;
    }
    const fitted = run(doc, options, lo);
    if (!fitted.overflow || fitted.height < result.height) result = fitted;
  }

  return result;
}

function run(doc: LatexDocument, options: LatexLayoutOptions, scale: number): LatexLayoutResult {
  const { box, math } = options;
  const size = options.fontSize * scale;
  const leading = size * options.lineHeight;
  const missing = new Set<string>();
  const lines: PositionedLine[] = [];

  let cursorY = 0;

  for (const paragraph of doc.paragraphs) {
    const { size: paraSize, bold, spaceBefore, spaceAfter, indent, align } =
      paragraphStyle(paragraph, size, options);

    cursorY += spaceBefore;

    const availableWidth = box.w - indent;
    const items = buildItems(paragraph, {
      ...options,
      fontSize: paraSize,
      baseBold: bold,
      math,
      missing,
    });

    for (const line of breakLines(items, availableWidth)) {
      const ascent = Math.max(line.ascent, paraSize * metricsOf(options.font).ascender);
      const descent = Math.max(line.descent, paraSize * -metricsOf(options.font).descender);
      lines.push({
        items: line.items,
        width: line.width,
        baseline: cursorY + ascent,
        indent,
        marker: line.first ? paragraph.marker : undefined,
        markerSize: paraSize,
        align,
        availableWidth,
      });
      cursorY += Math.max(ascent + descent, paraSize * options.lineHeight);
    }

    cursorY += spaceAfter;
    // Blank paragraphs still need to advance, or consecutive spacers collapse.
    if (doc.paragraphs.length && lines.length === 0) cursorY += leading;
  }

  const totalHeight = cursorY;
  const overflow = totalHeight > box.h + 0.01;

  const offsetY =
    options.valign === 'middle'
      ? Math.max(0, (box.h - totalHeight) / 2)
      : options.valign === 'bottom'
        ? Math.max(0, box.h - totalHeight)
        : 0;

  const ops: Op[] = [];
  for (const line of lines) {
    ops.push(...emitLine(line, box, offsetY, options));
  }

  return { ops, height: totalHeight, scale, overflow, missing: [...missing] };
}

interface ParaStyle {
  size: number;
  bold: boolean;
  spaceBefore: number;
  spaceAfter: number;
  indent: number;
  align: 'left' | 'center' | 'right';
}

function paragraphStyle(
  paragraph: LatexParagraph,
  size: number,
  options: LatexLayoutOptions
): ParaStyle {
  switch (paragraph.kind) {
    case 'heading': {
      const factor = HEADING_SCALE[paragraph.level ?? 1] ?? 1.2;
      return {
        size: size * factor,
        bold: true,
        spaceBefore: size * 0.8,
        spaceAfter: size * 0.35,
        indent: 0,
        align: paragraph.align ?? 'left',
      };
    }
    case 'display':
      return {
        size,
        bold: false,
        spaceBefore: size * 0.6,
        spaceAfter: size * 0.6,
        indent: 0,
        align: 'center',
      };
    case 'item':
      return {
        size,
        bold: false,
        spaceBefore: 0,
        spaceAfter: size * 0.25,
        indent: size * 1.6 * (paragraph.depth ?? 1),
        align: 'left',
      };
    case 'spacer':
      return {
        size,
        bold: false,
        spaceBefore: size * options.lineHeight,
        spaceAfter: 0,
        indent: 0,
        align: 'left',
      };
    default:
      return {
        size,
        bold: false,
        spaceBefore: 0,
        spaceAfter: size * 0.45,
        indent: 0,
        align: paragraph.align ?? options.align,
      };
  }
}

type Item =
  | {
      kind: 'word';
      text: string;
      font: FontSpec;
      size: number;
      width: number;
      ascent: number;
      descent: number;
    }
  | { kind: 'space'; width: number }
  | {
      kind: 'math';
      key: string;
      size: number;
      width: number;
      ascent: number;
      descent: number;
    }
  | { kind: 'break' };

interface BuildContext extends LatexLayoutOptions {
  baseBold: boolean;
  missing: Set<string>;
}

function buildItems(paragraph: LatexParagraph, ctx: BuildContext): Item[] {
  const items: Item[] = [];

  for (const node of paragraph.nodes) {
    if (node.type === 'break') {
      items.push({ kind: 'break' });
      continue;
    }

    if (node.type === 'math') {
      const blob = ctx.math[node.key];
      const size = ctx.fontSize;
      if (!blob) {
        ctx.missing.add(node.key);
        // Reserve a plausible box so the layout does not jump when it arrives.
        const approx = Math.max(1, node.tex.length * 0.45) * size * 0.5;
        items.push({
          kind: 'math',
          key: node.key,
          size,
          width: approx,
          ascent: size * 0.8,
          descent: size * 0.25,
        });
      } else {
        items.push({
          kind: 'math',
          key: node.key,
          size,
          width: blob.width * size,
          ascent: blob.ascent * size,
          descent: blob.descent * size,
        });
      }
      continue;
    }

    const font = fontFor(node.style, ctx.font, ctx.baseBold);
    const size = ctx.fontSize * (node.style.scale ?? 1);
    const metrics = metricsOf(font);
    const text = sanitizeText(node.text);

    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        items.push({ kind: 'space', width: measureText(' ', font, size) });
      } else {
        items.push({
          kind: 'word',
          text: part,
          font,
          size,
          width: measureText(part, font, size),
          ascent: size * metrics.ascender,
          descent: size * -metrics.descender,
        });
      }
    }
  }
  return items;
}

function fontFor(style: InlineStyle, base: FontSpec, baseBold: boolean): FontSpec {
  return {
    family: style.mono ? 'courier' : base.family,
    bold: style.bold || baseBold || base.bold,
    italic: style.italic || base.italic,
  };
}

interface BrokenLine {
  items: Item[];
  width: number;
  ascent: number;
  descent: number;
  first: boolean;
}

function breakLines(items: Item[], maxWidth: number): BrokenLine[] {
  const lines: BrokenLine[] = [];
  let current: Item[] = [];
  let width = 0;
  let first = true;

  const push = () => {
    // Trailing spaces must not affect alignment.
    while (current.length && current[current.length - 1].kind === 'space') {
      const removed = current.pop()!;
      width -= removed.kind === 'space' ? removed.width : 0;
    }
    let ascent = 0;
    let descent = 0;
    for (const item of current) {
      if (item.kind === 'word' || item.kind === 'math') {
        ascent = Math.max(ascent, item.ascent);
        descent = Math.max(descent, item.descent);
      }
    }
    lines.push({ items: current, width, ascent, descent, first });
    first = false;
    current = [];
    width = 0;
  };

  for (const item of items) {
    if (item.kind === 'break') {
      push();
      continue;
    }
    if (item.kind === 'space' && current.length === 0) continue;

    if (width + item.width > maxWidth && current.length > 0 && item.kind !== 'space') {
      push();
    }
    current.push(item);
    width += item.width;
  }
  if (current.length || lines.length === 0) push();
  return lines;
}

interface PositionedLine {
  items: Item[];
  width: number;
  baseline: number;
  indent: number;
  marker?: string;
  markerSize: number;
  align: 'left' | 'center' | 'right';
  availableWidth: number;
}

function emitLine(
  line: PositionedLine,
  box: Rect,
  offsetY: number,
  options: LatexLayoutOptions
): Op[] {
  const ops: Op[] = [];
  const baseline = box.y + offsetY + line.baseline;
  const slack = Math.max(0, line.availableWidth - line.width);
  const startX =
    box.x +
    line.indent +
    (line.align === 'center' ? slack / 2 : line.align === 'right' ? slack : 0);

  if (line.marker) {
    ops.push({
      kind: 'text',
      x: box.x + Math.max(0, line.indent - line.markerSize * 1.3),
      y: baseline,
      text: line.marker,
      font: options.font,
      size: line.markerSize,
      color: options.color,
      baseline: 'alphabetic',
    });
  }

  let x = startX;
  for (const item of line.items) {
    switch (item.kind) {
      case 'space':
        x += item.width;
        break;
      case 'word':
        ops.push({
          kind: 'text',
          x,
          y: baseline,
          text: item.text,
          font: item.font,
          size: item.size,
          color: options.color,
          baseline: 'alphabetic',
        });
        x += item.width;
        break;
      case 'math': {
        const blob = options.math[item.key];
        if (blob) {
          // Blob paths are in em units with the baseline at y = 0, so a
          // translate + uniform scale is all that is needed.
          ops.push({
            kind: 'group',
            matrix: multiply(translate(x, baseline), scaleM(item.size)),
            ops: blob.paths.map((p) => ({
              kind: 'path' as const,
              d: p.d,
              fill: { color: p.fill ?? options.color },
            })),
          });
        } else {
          ops.push({
            kind: 'rect',
            x,
            y: baseline - item.ascent,
            w: item.width,
            h: item.ascent + item.descent,
            stroke: { color: '#c8d4e0', width: 0.15, dash: [0.6, 0.6] },
          });
        }
        x += item.width;
        break;
      }
      case 'break':
        break;
    }
  }
  return ops;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
