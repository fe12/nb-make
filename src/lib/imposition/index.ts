/**
 * Imposition: deciding which notebook page lands where on each printed sheet.
 *
 * Two things live here and nothing else: generating slot rectangles from a
 * layout mode, and choosing the page order that fills them. Both are pure, so
 * the visual editor and the PDF exporter agree by construction — the editor
 * shows exactly the arrangement that will be printed.
 */
import type { Imposition, Slot } from '../types/notebook';
import { resolvePageSize, contentRect, type Rect, type Size } from '../units';

export interface SheetPlacement {
  slot: Slot;
  /** Index into the compiled page list, or null for a deliberately blank slot. */
  pageIndex: number | null;
}

export interface Sheet {
  /** 0-based sheet number; front and back of one sheet share it. */
  index: number;
  side: 'front' | 'back';
  placements: SheetPlacement[];
}

/** Where a page ends up inside its slot, in millimetres on the sheet. */
export interface Placement {
  /** Axis-aligned area the rotated page covers. */
  rect: Rect;
  /** Clockwise degrees as seen on the printed sheet. */
  rotation: number;
  scale: number;
}

export const idFor = (prefix: string, n: number): string => `${prefix}-${n}`;

/* ----------------------------------------------------------- slot layout */

/**
 * Builds the slot grid implied by the layout parameters. Manual mode keeps
 * whatever the user dragged, so it is never regenerated behind their back.
 */
export function generateSlots(imposition: Imposition): Slot[] {
  if (imposition.mode === 'manual') return imposition.slots;

  const sheet = resolvePageSize(imposition.sheet);
  const area = contentRect(sheet, imposition.sheetMargins);

  // A saddle-stitched booklet is always two pages across, one down: the sheet
  // is folded once down the middle.
  const cols = imposition.mode === 'booklet' ? 2 : imposition.cols;
  const rowCount = imposition.mode === 'booklet' ? 1 : imposition.rows;

  const gutterX = imposition.gutterX;
  const gutterY = imposition.gutterY;
  const w = (area.w - gutterX * (cols - 1)) / cols;
  const h = (area.h - gutterY * (rowCount - 1)) / rowCount;

  const slots: Slot[] = [];
  let index = 0;
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        id: idFor('slot', index),
        index,
        x: area.x + c * (w + gutterX),
        y: area.y + r * (h + gutterY),
        w: Math.max(1, w),
        h: Math.max(1, h),
        rotation: imposition.slotRotation,
        enabled: true,
      });
      index++;
    }
  }
  return slots;
}

/** Slots in fill order, ignoring disabled ones. */
export const orderedSlots = (slots: Slot[]): Slot[] =>
  slots.filter((s) => s.enabled).slice().sort((a, b) => a.index - b.index);

/**
 * Mirrors slots horizontally about the sheet centre.
 *
 * On a duplex press the reverse side is flipped over the long edge, so a slot
 * that prints on the left of the front lands on the right of the back. Without
 * this, two-sided output is misregistered by exactly one slot width.
 */
export function mirrorSlots(slots: Slot[], sheet: Size, bindingEdge: 'left' | 'top'): Slot[] {
  return slots.map((slot) => ({
    ...slot,
    x: bindingEdge === 'left' ? sheet.w - slot.x - slot.w : slot.x,
    y: bindingEdge === 'top' ? sheet.h - slot.y - slot.h : slot.y,
  }));
}

/* ---------------------------------------------------------- page ordering */

export function planSheets(pageCount: number, imposition: Imposition): Sheet[] {
  const slots = orderedSlots(generateSlots(imposition));
  if (slots.length === 0 || pageCount === 0) return [];

  const sheetSize = resolvePageSize(imposition.sheet);
  const perSide = slots.length;

  switch (imposition.mode) {
    case 'booklet':
      return planBooklet(pageCount, slots, sheetSize, imposition);
    case 'cutstack':
      return planCutStack(pageCount, slots, sheetSize, imposition, perSide);
    default:
      return planSequential(pageCount, slots, sheetSize, imposition, perSide);
  }
}

function sideSlots(
  slots: Slot[],
  side: 'front' | 'back',
  sheetSize: Size,
  imposition: Imposition
): Slot[] {
  return side === 'back' && imposition.mirrorBackSide
    ? mirrorSlots(slots, sheetSize, imposition.bindingEdge)
    : slots;
}

function planSequential(
  pageCount: number,
  slots: Slot[],
  sheetSize: Size,
  imposition: Imposition,
  perSide: number
): Sheet[] {
  const sides = imposition.duplex ? 2 : 1;
  const perSheet = perSide * sides;
  const sheetCount = Math.ceil(pageCount / perSheet);
  const sheets: Sheet[] = [];

  for (let s = 0; s < sheetCount; s++) {
    for (let side = 0; side < sides; side++) {
      const which: 'front' | 'back' = side === 0 ? 'front' : 'back';
      const base = s * perSheet + side * perSide;
      sheets.push({
        index: s,
        side: which,
        placements: sideSlots(slots, which, sheetSize, imposition).map((slot, i) => ({
          slot,
          pageIndex: pageAt(base + i, pageCount, imposition),
        })),
      });
    }
  }
  return sheets;
}

/**
 * Cut-and-stack: after printing, the stack is guillotined into `perSide` piles
 * and the piles are stacked to give a single sequential run. Slot j therefore
 * takes the j-th consecutive block of pages rather than interleaving.
 */
function planCutStack(
  pageCount: number,
  slots: Slot[],
  sheetSize: Size,
  imposition: Imposition,
  perSide: number
): Sheet[] {
  const sides = imposition.duplex ? 2 : 1;
  const sheetCount = Math.ceil(pageCount / (perSide * sides));
  const perPile = sheetCount * sides;
  const sheets: Sheet[] = [];

  for (let s = 0; s < sheetCount; s++) {
    for (let side = 0; side < sides; side++) {
      const which: 'front' | 'back' = side === 0 ? 'front' : 'back';
      sheets.push({
        index: s,
        side: which,
        placements: sideSlots(slots, which, sheetSize, imposition).map((slot, i) => ({
          slot,
          pageIndex: pageAt(i * perPile + s * sides + side, pageCount, imposition),
        })),
      });
    }
  }
  return sheets;
}

/**
 * Saddle-stitch order. Sheets are folded together and stapled through the
 * spine, so the outermost sheet carries the first and last pages. Page count is
 * padded to a multiple of four because that is what one folded sheet holds.
 */
function planBooklet(
  pageCount: number,
  slots: Slot[],
  sheetSize: Size,
  imposition: Imposition
): Sheet[] {
  const padded = Math.ceil(pageCount / 4) * 4;
  const sheetCount = padded / 4;
  const sheets: Sheet[] = [];

  for (let s = 0; s < sheetCount; s++) {
    // 1-based page numbers, converted to indices below.
    const front = [padded - 2 * s, 1 + 2 * s];
    const back = [2 + 2 * s, padded - 1 - 2 * s];

    for (const [side, order] of [
      ['front', front],
      ['back', back],
    ] as const) {
      sheets.push({
        index: s,
        side,
        placements: sideSlots(slots, side, sheetSize, imposition).map((slot, i) => ({
          slot,
          pageIndex: order[i] !== undefined ? pageAt(order[i] - 1, pageCount, imposition) : null,
        })),
      });
    }
  }
  return sheets;
}

/** Resolves an out-of-range index according to the padding policy. */
function pageAt(index: number, pageCount: number, imposition: Imposition): number | null {
  if (index < 0 || index >= pageCount) {
    return imposition.padWith === 'blank' ? null : null;
  }
  return index;
}

/* --------------------------------------------------------- slot placement */

/**
 * Fits a page into a slot, honouring rotation and the scale policy. Returns the
 * area the page will actually cover, which the exporter converts to PDF
 * coordinates and the editor draws directly.
 */
export function placeInSlot(
  slot: Slot,
  pageSize: Size,
  imposition: Imposition
): Placement {
  const rotated = slot.rotation === 90 || slot.rotation === 270;
  const effective: Size = rotated ? { w: pageSize.h, h: pageSize.w } : pageSize;

  const fit = imposition.scaleToFit
    ? Math.min(slot.w / effective.w, slot.h / effective.h)
    : 1;
  const scale = fit * imposition.extraScale;

  const w = effective.w * scale;
  const h = effective.h * scale;

  return {
    rect: {
      x: slot.x + (slot.w - w) / 2,
      y: slot.y + (slot.h - h) / 2,
      w,
      h,
    },
    rotation: slot.rotation,
    scale,
  };
}

/* -------------------------------------------------------------- summaries */

export interface ImpositionSummary {
  slotsPerSide: number;
  sheetCount: number;
  sheetSize: Size;
  pageSize: Size;
  /** Scale applied to each page, as a percentage. */
  scalePercent: number;
  /** True when pages are being enlarged past their trim size. */
  upscaled: boolean;
  notes: string[];
}

export function summarise(
  pageCount: number,
  imposition: Imposition,
  pageSize: Size
): ImpositionSummary {
  const slots = orderedSlots(generateSlots(imposition));
  const sheets = planSheets(pageCount, imposition);
  const sheetSize = resolvePageSize(imposition.sheet);
  const scale = slots.length ? placeInSlot(slots[0], pageSize, imposition).scale : 1;
  const notes: string[] = [];

  if (imposition.mode === 'booklet') {
    notes.push(
      'Booklet order assumes the sheets are folded together and stapled through the spine. Print double-sided, flipping on the short edge for portrait sheets.'
    );
    if (pageCount % 4 !== 0) {
      notes.push(
        `Page count padded from ${pageCount} to ${Math.ceil(pageCount / 4) * 4} — a folded sheet always holds four pages.`
      );
    }
  }
  if (imposition.mode === 'cutstack') {
    notes.push(
      `Cut-and-stack: print all sheets, guillotine into ${slots.length} piles, then stack the piles in slot order.`
    );
  }
  if (scale > 1.001) {
    notes.push('Pages are being enlarged to fill their slots, which will soften any raster images.');
  }

  return {
    slotsPerSide: slots.length,
    sheetCount: sheets.length,
    sheetSize,
    pageSize,
    scalePercent: Math.round(scale * 1000) / 10,
    upscaled: scale > 1.001,
    notes,
  };
}
