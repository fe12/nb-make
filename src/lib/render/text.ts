/**
 * Text anchoring shared by both backends.
 *
 * Both the SVG preview and the PDF exporter resolve a `TextOp` to the same
 * baseline and the same left edge through these helpers, rather than each
 * leaning on its own renderer's alignment model. That is what stops text from
 * drifting by a line or a few millimetres between preview and export.
 */
import { measureText, metricsOf } from './fonts';
import type { TextOp } from './ops';

/** Alphabetic-baseline Y for a text op, in mm. */
export function baselineY(op: TextOp): number {
  const metrics = metricsOf(op.font);
  switch (op.baseline ?? 'alphabetic') {
    case 'top':
      return op.y + metrics.ascender * op.size;
    case 'middle':
      // Optical centring on the cap height reads better than using the full
      // ascender, which leaves visible bottom-heaviness in table cells.
      return op.y + (metrics.capHeight / 2) * op.size;
    case 'bottom':
      return op.y + metrics.descender * op.size;
    default:
      return op.y;
  }
}

/** Advance width of the op's text, in mm. */
export const widthOf = (op: TextOp): number =>
  measureText(op.text, op.font, op.size, op.letterSpacing ?? 0);

/** Left edge of the drawn text, in mm, resolving `align`. */
export function leftX(op: TextOp): number {
  const width = widthOf(op);
  switch (op.align ?? 'left') {
    case 'center':
      return op.x - width / 2;
    case 'right':
      return op.x - width;
    default:
      return op.x;
  }
}
