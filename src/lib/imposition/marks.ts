/**
 * Printer's marks, produced as ordinary drawing ops so the visual layout editor
 * and the PDF exporter show exactly the same thing.
 */
import type { Op } from '../render/ops';
import type { Imposition } from '../types/notebook';
import type { Rect, Size } from '../units';

/**
 * Corner crop marks: two short rules per corner, set back from the trim edge so
 * the blade line stays visible on the cut sheet.
 */
export function cropMarks(rect: Rect, imposition: Imposition, bleedMm = 0): Op[] {
  const cfg = imposition.cropMarks;
  if (!cfg.enabled) return [];

  // Marks are set back beyond the bleed so they stay on clean paper instead of
  // drowning in the ruling that now runs past the trim edge.
  const { length: len, color, width } = cfg;
  const offset = cfg.offset + bleedMm;
  const stroke = { color, width };
  const ops: Op[] = [];
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;

  const h = (x1: number, x2: number, y: number) =>
    ops.push({ kind: 'line', x1, y1: y, x2, y2: y, stroke });
  const v = (x: number, y1: number, y2: number) =>
    ops.push({ kind: 'line', x1: x, y1, x2: x, y2, stroke });

  h(left - offset - len, left - offset, top);
  h(left - offset - len, left - offset, bottom);
  h(right + offset, right + offset + len, top);
  h(right + offset, right + offset + len, bottom);

  v(left, top - offset - len, top - offset);
  v(right, top - offset - len, top - offset);
  v(left, bottom + offset, bottom + offset + len);
  v(right, bottom + offset, bottom + offset + len);

  return ops;
}

/** Dashed guide down the sheet's fold, for booklet and folded layouts. */
export function foldMarks(sheet: Size, imposition: Imposition): Op[] {
  if (!imposition.foldMarks) return [];
  const stroke = { color: '#9aa8b6', width: 0.12, dash: [2, 2] };

  return imposition.bindingEdge === 'left'
    ? [{ kind: 'line', x1: sheet.w / 2, y1: 0, x2: sheet.w / 2, y2: sheet.h, stroke }]
    : [{ kind: 'line', x1: 0, y1: sheet.h / 2, x2: sheet.w, y2: sheet.h / 2, stroke }];
}

/** Thin outline showing where each trimmed page sits. */
export function pageBorder(rect: Rect, imposition: Imposition): Op[] {
  const cfg = imposition.pageBorder;
  if (!cfg.enabled) return [];
  return [
    {
      kind: 'rect',
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      stroke: { color: cfg.color, width: cfg.width },
    },
  ];
}

/** Fill-order numbers, useful when proofing a manual arrangement. */
export function slotNumber(rect: Rect, value: string, imposition: Imposition): Op[] {
  if (!imposition.showSlotNumbers) return [];
  const size = Math.min(rect.w, rect.h) * 0.14;
  return [
    {
      kind: 'text',
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      text: value,
      font: { family: 'helvetica', bold: true },
      size: Math.min(size, 12),
      color: '#c8d4e0',
      align: 'center',
      baseline: 'middle',
      opacity: 0.7,
    },
  ];
}
