/**
 * Substitutes `theme:*` colour references for real colours, once, on a finished
 * op tree.
 *
 * Doing it here rather than inside every pattern, block and generator is the
 * whole point: those all just emit `theme:accent` and stay ignorant of
 * palettes, and a single pass at the end guarantees nothing is missed — a new
 * generator gets palette support for free.
 */
import { resolveColor, type NotebookPalette } from '../palette';
import type { Fill, Op, Stroke } from './ops';

export function applyPalette(ops: Op[], palette: NotebookPalette): Op[] {
  let changed = false;
  const out = ops.map((op) => {
    const next = applyToOp(op, palette);
    if (next !== op) changed = true;
    return next;
  });
  // Returning the original array when nothing referenced the palette keeps the
  // ops reference stable, which is what the exporter's de-duplication relies on.
  return changed ? out : ops;
}

function applyToOp(op: Op, palette: NotebookPalette): Op {
  switch (op.kind) {
    case 'line': {
      // A line's stroke is required, unlike the other shapes'.
      const color = resolveColor(op.stroke.color, palette);
      return color === op.stroke.color ? op : { ...op, stroke: { ...op.stroke, color } };
    }

    case 'rect':
    case 'ellipse':
    case 'polyline':
    case 'path': {
      const fill = mapFill(op.fill, palette);
      const stroke = mapStroke(op.stroke, palette);
      return fill === op.fill && stroke === op.stroke ? op : { ...op, fill, stroke };
    }

    case 'text': {
      const color = resolveColor(op.color, palette);
      return color === op.color ? op : { ...op, color };
    }

    case 'group': {
      const inner = applyPalette(op.ops, palette);
      return inner === op.ops ? op : { ...op, ops: inner };
    }

    default:
      return op;
  }
}

function mapStroke(stroke: Stroke | undefined, palette: NotebookPalette): Stroke | undefined {
  if (!stroke) return stroke;
  const color = resolveColor(stroke.color, palette);
  return color === stroke.color ? stroke : { ...stroke, color };
}

function mapFill(fill: Fill | undefined, palette: NotebookPalette): Fill | undefined {
  if (!fill) return fill;
  const color = resolveColor(fill.color, palette);
  return color === fill.color ? fill : { ...fill, color };
}
