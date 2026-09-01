/**
 * PDF backend for the drawing IR.
 *
 * Two decisions shape this file:
 *
 * 1. Geometry is emitted as SVG path data through `drawSvgPath`. pdf-lib
 *    applies `translate(0, pageHeight) · scale(k, -k)` for that call, which is
 *    exactly the millimetre, Y-down space our ops already live in — so no
 *    per-primitive coordinate flipping is needed and there is one code path
 *    instead of ten.
 *
 * 2. Consecutive ops that share a style are merged into a single path with many
 *    subpaths. A 5 mm dot grid on A4 is ~2500 circles; without batching that is
 *    2500 graphics-state pushes per page, and the file balloons.
 */
import {
  clip,
  closePath,
  degrees,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { parseColor } from './color';
import { fontKey, measureText, sanitizeText, type StandardFontKey } from './fonts';
import type { Fill, Op, Stroke, TextOp } from './ops';
import { flatten } from './ops';
import { baselineY, leftX } from './text';
import { mmToPt } from '../units';

/** Millimetres to points; also the scale handed to `drawSvgPath`. */
const MM = mmToPt(1);

const STANDARD_FONT: Record<StandardFontKey, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  HelveticaOblique: StandardFonts.HelveticaOblique,
  HelveticaBoldOblique: StandardFonts.HelveticaBoldOblique,
  TimesRoman: StandardFonts.TimesRoman,
  TimesRomanBold: StandardFonts.TimesRomanBold,
  TimesRomanItalic: StandardFonts.TimesRomanItalic,
  TimesRomanBoldItalic: StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  CourierBold: StandardFonts.CourierBold,
  CourierOblique: StandardFonts.CourierOblique,
  CourierBoldOblique: StandardFonts.CourierBoldOblique,
};

/** Lazily embeds and caches the standard fonts for one document. */
export class FontPool {
  private cache = new Map<StandardFontKey, PDFFont>();

  constructor(private doc: PDFDocument) {}

  async get(key: StandardFontKey): Promise<PDFFont> {
    let font = this.cache.get(key);
    if (!font) {
      font = await this.doc.embedFont(STANDARD_FONT[key]);
      this.cache.set(key, font);
    }
    return font;
  }

  /** Pre-embeds every font a page needs, so drawing can stay synchronous. */
  async preload(ops: Op[]): Promise<Map<StandardFontKey, PDFFont>> {
    const keys = new Set<StandardFontKey>();
    collectFontKeys(ops, keys);
    for (const key of keys) await this.get(key);
    return this.cache;
  }
}

function collectFontKeys(ops: Op[], into: Set<StandardFontKey>): void {
  for (const op of ops) {
    if (op.kind === 'text') into.add(fontKey(op.font));
    else if (op.kind === 'group') collectFontKeys(op.ops, into);
  }
}

export interface DrawContext {
  page: PDFPage;
  /** Page height in millimetres, for the Y flip. */
  heightMm: number;
  fonts: Map<StandardFontKey, PDFFont>;
  images: Map<string, PDFImage>;
}

export function drawOps(ctx: DrawContext, ops: Op[]): void {
  const batcher = new PathBatcher(ctx);
  emit(ctx, flatten(ops), batcher, 1);
  batcher.flush();
}

function emit(ctx: DrawContext, ops: Op[], batcher: PathBatcher, opacity: number): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'group': {
        // A clip or a group opacity forces a state boundary, so flush first to
        // keep the painter's-algorithm order intact.
        batcher.flush();
        const nextOpacity = opacity * (op.opacity ?? 1);

        if (op.clip) {
          const { x, y, w, h } = op.clip;
          const top = ctx.heightMm;
          ctx.page.pushOperators(
            pushGraphicsState(),
            moveTo(x * MM, (top - y) * MM),
            lineTo((x + w) * MM, (top - y) * MM),
            lineTo((x + w) * MM, (top - y - h) * MM),
            lineTo(x * MM, (top - y - h) * MM),
            closePath(),
            clip(),
            endPath()
          );
          emit(ctx, op.ops, batcher, nextOpacity);
          batcher.flush();
          ctx.page.pushOperators(popGraphicsState());
        } else {
          emit(ctx, op.ops, batcher, nextOpacity);
          batcher.flush();
        }
        break;
      }

      case 'text':
        batcher.flush();
        drawText(ctx, op, opacity);
        break;

      case 'image':
        batcher.flush();
        drawImage(ctx, op, opacity);
        break;

      default:
        batcher.add(pathOf(op), styleOf(op), opacity);
    }
  }
}

/* ------------------------------------------------------------- path build */

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

/** Converts a geometric op to SVG path data in millimetres. */
function pathOf(op: Op): string {
  switch (op.kind) {
    case 'line':
      return `M ${n(op.x1)} ${n(op.y1)} L ${n(op.x2)} ${n(op.y2)}`;

    case 'rect': {
      const { x, y, w, h } = op;
      if (w <= 0 || h <= 0) return '';
      const r = Math.min(op.radius ?? 0, w / 2, h / 2);
      if (r <= 0) {
        return `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`;
      }
      // Rounded corners via the standard circular-arc bezier constant.
      const k = r * 0.5522847498;
      return [
        `M ${n(x + r)} ${n(y)}`,
        `L ${n(x + w - r)} ${n(y)}`,
        `C ${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)}`,
        `L ${n(x + w)} ${n(y + h - r)}`,
        `C ${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}`,
        `L ${n(x + r)} ${n(y + h)}`,
        `C ${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)}`,
        `L ${n(x)} ${n(y + r)}`,
        `C ${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)}`,
        'Z',
      ].join(' ');
    }

    case 'ellipse': {
      const { cx, cy, rx, ry } = op;
      if (rx <= 0 || ry <= 0) return '';
      // Four cubic segments; emitting beziers rather than arcs keeps the
      // geometry identical to what the SVG preview rasterises.
      const kx = rx * 0.5522847498;
      const ky = ry * 0.5522847498;
      return [
        `M ${n(cx - rx)} ${n(cy)}`,
        `C ${n(cx - rx)} ${n(cy - ky)} ${n(cx - kx)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)}`,
        `C ${n(cx + kx)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - ky)} ${n(cx + rx)} ${n(cy)}`,
        `C ${n(cx + rx)} ${n(cy + ky)} ${n(cx + kx)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)}`,
        `C ${n(cx - kx)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + ky)} ${n(cx - rx)} ${n(cy)}`,
        'Z',
      ].join(' ');
    }

    case 'polyline': {
      if (op.points.length < 4) return '';
      const parts: string[] = [`M ${n(op.points[0])} ${n(op.points[1])}`];
      for (let i = 2; i < op.points.length; i += 2) {
        parts.push(`L ${n(op.points[i])} ${n(op.points[i + 1])}`);
      }
      if (op.closed) parts.push('Z');
      return parts.join(' ');
    }

    case 'path':
      return op.d;

    default:
      return '';
  }
}

interface Style {
  fill?: Fill;
  stroke?: Stroke;
}

function styleOf(op: Op): Style {
  switch (op.kind) {
    case 'line':
      return { stroke: op.stroke };
    case 'rect':
    case 'ellipse':
    case 'polyline':
    case 'path':
      return { fill: op.fill, stroke: op.stroke };
    default:
      return {};
  }
}

const styleKey = (style: Style, opacity: number): string =>
  [
    style.fill?.color ?? '-',
    style.fill?.opacity ?? 1,
    style.stroke?.color ?? '-',
    style.stroke?.width ?? 0,
    style.stroke?.dash?.join(',') ?? '-',
    style.stroke?.opacity ?? 1,
    style.stroke?.cap ?? '-',
    opacity,
  ].join('|');

/** Accumulates same-styled subpaths and emits them as one `drawSvgPath`. */
class PathBatcher {
  private key: string | null = null;
  private parts: string[] = [];
  private style: Style = {};
  private opacity = 1;

  constructor(private ctx: DrawContext) {}

  add(d: string, style: Style, opacity: number): void {
    if (!d) return;
    if (!style.fill && (!style.stroke || style.stroke.width <= 0)) return;

    const key = styleKey(style, opacity);
    if (key !== this.key) {
      this.flush();
      this.key = key;
      this.style = style;
      this.opacity = opacity;
    }
    this.parts.push(d);
  }

  flush(): void {
    if (this.parts.length === 0) {
      this.key = null;
      return;
    }

    const { fill, stroke } = this.style;
    const d = this.parts.join(' ');
    this.parts = [];
    this.key = null;

    this.ctx.page.drawSvgPath(d, {
      x: 0,
      y: this.ctx.heightMm * MM,
      scale: MM,
      color: fill ? colorOf(fill.color) : undefined,
      opacity: (fill?.opacity ?? 1) * this.opacity,
      borderColor: stroke && stroke.width > 0 ? colorOf(stroke.color) : undefined,
      // Emitted after the scale operator, so this is in millimetres.
      borderWidth: stroke && stroke.width > 0 ? stroke.width : undefined,
      borderOpacity: (stroke?.opacity ?? 1) * this.opacity,
      borderDashArray: stroke?.dash?.length ? stroke.dash : undefined,
    });
  }
}

const colorOf = (value: string) => {
  const { r, g, b } = parseColor(value);
  return rgb(r, g, b);
};

/* -------------------------------------------------------------- text/image */

function drawText(ctx: DrawContext, op: TextOp, opacity: number): void {
  const text = sanitizeText(op.text);
  if (!text.trim()) return;

  const font = ctx.fonts.get(fontKey(op.font));
  if (!font) return;

  const rotation = op.rotate ?? 0;
  const anchor = { x: op.x, y: op.y };
  const size = mmToPt(op.size);
  const color = colorOf(op.color);
  const alpha = (op.opacity ?? 1) * opacity;

  const place = (xMm: number, yMm: number, value: string) => {
    const p = rotatePoint(xMm, yMm, anchor.x, anchor.y, rotation);
    ctx.page.drawText(value, {
      x: p.x * MM,
      y: (ctx.heightMm - p.y) * MM,
      size,
      font,
      color,
      opacity: alpha,
      // pdf-lib rotates anticlockwise in PDF space; our ops are clockwise.
      rotate: degrees(-rotation),
    });
  };

  const baseY = baselineY(op);
  const startX = leftX(op);

  if (!op.letterSpacing) {
    place(startX, baseY, text);
    return;
  }

  // pdf-lib has no character-spacing option, so spaced text is set glyph by
  // glyph. Only a handful of small-caps labels use this.
  let x = startX;
  for (const ch of text) {
    place(x, baseY, ch);
    x += measureText(ch, op.font, op.size) + op.letterSpacing;
  }
}

function drawImage(
  ctx: DrawContext,
  op: Extract<Op, { kind: 'image' }>,
  opacity: number
): void {
  const image = ctx.images.get(op.assetId);
  if (!image || op.w <= 0 || op.h <= 0) return;

  const rotation = op.rotate ?? 0;
  // pdf-lib anchors images at their bottom-left and rotates about that point,
  // so rotate the corner about the image centre ourselves.
  const corner = rotatePoint(
    op.x,
    op.y + op.h,
    op.x + op.w / 2,
    op.y + op.h / 2,
    rotation
  );

  ctx.page.drawImage(image, {
    x: corner.x * MM,
    y: (ctx.heightMm - corner.y) * MM,
    width: op.w * MM,
    height: op.h * MM,
    opacity: (op.opacity ?? 1) * opacity,
    rotate: degrees(-rotation),
  });
}

/** Clockwise rotation in the millimetre, Y-down space. */
function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degreesCw: number
): { x: number; y: number } {
  if (!degreesCw) return { x, y };
  const r = (degreesCw * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
