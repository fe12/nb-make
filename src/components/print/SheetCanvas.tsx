'use client';

import clsx from 'clsx';
import { useRef, useState } from 'react';
import { PagePreview } from '@/components/PagePreview';
import type { CompiledPage } from '@/lib/compile/notebook';
import { placeInSlot, applyBleed, type Sheet } from '@/lib/imposition';
import { cropMarks, foldMarks, pageBorder } from '@/lib/imposition/marks';
import { renderOps } from '@/lib/render/svg';
import type { Op } from '@/lib/render/ops';
import type { Imposition, Slot } from '@/lib/types/notebook';
import { contentRect, hasBleed, resolvePageSize, ZERO_BLEED, type Size } from '@/lib/units';

type Handle = 'move' | 'se' | 'e' | 's';

interface DragState {
  slotId: string;
  handle: Handle;
  start: Slot;
  startX: number;
  startY: number;
  width: number;
  height: number;
}

/**
 * The printed sheet, with every slot directly manipulable.
 *
 * Slots are the single source of truth for placement: the layout modes merely
 * *generate* them. Dragging one switches the imposition to `manual` so a
 * hand-tuned arrangement is never silently regenerated.
 */
export function SheetCanvas({
  sheet,
  pages,
  imposition,
  pageSize,
  selectedSlotId,
  onSelectSlot,
  onSlotChange,
  onCommit,
  editable = true,
}: {
  sheet: Sheet | null;
  pages: CompiledPage[];
  imposition: Imposition;
  pageSize: Size;
  selectedSlotId: string | null;
  onSelectSlot: (id: string | null) => void;
  /** Patches one slot in the notebook's authoritative slot list. */
  onSlotChange: (id: string, patch: Partial<Slot>, options?: { history?: boolean }) => void;
  onCommit: () => void;
  /**
   * Back sides are derived from the front by mirroring, so their slot
   * coordinates are not the stored ones and must not be dragged.
   */
  editable?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const sheetSize = resolvePageSize(imposition.sheet);
  const printable = contentRect(sheetSize, imposition.sheetMargins);
  // The same growth the exporter applies, so the preview is the printed sheet.
  const effective = applyBleed(imposition, imposition.bleed);
  const bleedMm = imposition.bleed;

  const pct = (value: number, axis: 'w' | 'h') => (value / sheetSize[axis]) * 100;

  // Marks are produced by the same code the exporter uses, so what is shown
  // here is literally what gets printed.
  const markOps: Op[] = [...foldMarks(sheetSize, effective)];
  for (const placement of sheet?.placements ?? []) {
    const geometry = placeInSlot(placement.slot, pageSize, effective);
    markOps.push(...pageBorder(geometry.rect, effective));
    markOps.push(...cropMarks(geometry.rect, imposition, bleedMm));
  }

  const onPointerDown = (event: React.PointerEvent, slot: Slot, handle: Handle) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;

    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      slotId: slot.id,
      handle,
      start: slot,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    setDragging(true);
    onSelectSlot(slot.id);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state || !sheet) return;

    const snap = event.altKey ? 0 : 1;
    const dx = snapTo(((event.clientX - state.startX) / state.width) * sheetSize.w, snap);
    const dy = snapTo(((event.clientY - state.startY) / state.height) * sheetSize.h, snap);

    const patch: Partial<Slot> =
      state.handle === 'move'
        ? { x: state.start.x + dx, y: state.start.y + dy }
        : state.handle === 'e'
          ? { w: Math.max(5, state.start.w + dx) }
          : state.handle === 's'
            ? { h: Math.max(5, state.start.h + dy) }
            : { w: Math.max(5, state.start.w + dx), h: Math.max(5, state.start.h + dy) };

    // History is recorded once, by onCommit, when the gesture ends.
    onSlotChange(state.slotId, patch, { history: false });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Already released — nothing to clean up.
    }
    drag.current = null;
    setDragging(false);
    onCommit();
  };

  return (
    <div
      ref={container}
      className="relative w-full select-none bg-white shadow-[0_2px_14px_rgba(23,31,40,0.16)]"
      style={{ aspectRatio: `${sheetSize.w} / ${sheetSize.h}` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => onSelectSlot(null)}
    >
      {/* Printable area guide */}
      <div
        className="pointer-events-none absolute border border-dashed border-ink-300"
        style={{
          left: `${pct(printable.x, 'w')}%`,
          top: `${pct(printable.y, 'h')}%`,
          width: `${pct(printable.w, 'w')}%`,
          height: `${pct(printable.h, 'h')}%`,
        }}
      />

      {sheet?.placements.map((placement) => {
        const slot = placement.slot;
        const geometry = placeInSlot(slot, pageSize, effective);
        const page = placement.pageIndex === null ? null : pages[placement.pageIndex];
        const selected = slot.id === selectedSlotId;
        const rotated = slot.rotation === 90 || slot.rotation === 270;

        // The drawn page keeps its own aspect; the covered area is its bounding
        // box, so a rotated page is sized transposed and then rotated in CSS.
        // With bleed the preview box grows by the overhang on every side —
        // uniform bleed grows both visual axes equally, rotation or not.
        const bleedPad = hasBleed(page?.bleed ?? ZERO_BLEED)
          ? 2 * bleedMm * geometry.scale
          : 0;
        const drawnW = (rotated ? geometry.rect.h : geometry.rect.w) + bleedPad;
        const drawnH = (rotated ? geometry.rect.w : geometry.rect.h) + bleedPad;

        return (
          <div key={slot.id}>
            {/* Page artwork */}
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${pct(geometry.rect.x + geometry.rect.w / 2, 'w')}%`,
                top: `${pct(geometry.rect.y + geometry.rect.h / 2, 'h')}%`,
                width: `${pct(drawnW, 'w')}%`,
                height: `${pct(drawnH, 'h')}%`,
                transform: `translate(-50%, -50%) rotate(${slot.rotation}deg)`,
              }}
            >
              {page ? (
                <PagePreview
                  ops={page.ops}
                  size={pageSize}
                  viewBox={
                    hasBleed(page.bleed)
                      ? {
                          x: -page.bleed.left,
                          y: -page.bleed.top,
                          w: pageSize.w + page.bleed.left + page.bleed.right,
                          h: pageSize.h + page.bleed.top + page.bleed.bottom,
                        }
                      : undefined
                  }
                  showShadow={false}
                  className="h-full ring-[0.5px] ring-ink-200"
                />
              ) : (
                <div className="grid h-full place-items-center border border-dashed border-ink-300 bg-ink-50/50 text-[10px] text-ink-400">
                  blank
                </div>
              )}
            </div>

            {/* Interaction layer, on the slot rather than the artwork */}
            <div
              role="button"
              tabIndex={0}
              aria-label={`Slot ${slot.index + 1}`}
              className={clsx(
                'absolute border-2 transition-colors',
                editable ? 'cursor-move' : 'cursor-default',
                selected
                  ? 'border-accent-500 bg-accent-500/[0.07]'
                  : 'border-transparent hover:border-accent-300 hover:bg-accent-500/[0.04]',
                !slot.enabled && 'opacity-40'
              )}
              style={{
                left: `${pct(slot.x, 'w')}%`,
                top: `${pct(slot.y, 'h')}%`,
                width: `${pct(slot.w, 'w')}%`,
                height: `${pct(slot.h, 'h')}%`,
              }}
              onPointerDown={(event) => onPointerDown(event, slot, 'move')}
              onClick={(event) => {
                event.stopPropagation();
                onSelectSlot(slot.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelectSlot(slot.id);
              }}
            >
              <span
                className={clsx(
                  'absolute left-1 top-1 grid h-4 min-w-4 place-items-center rounded px-1 text-[9px] font-bold',
                  selected ? 'bg-accent-600 text-white' : 'bg-ink-900/45 text-white'
                )}
              >
                {slot.index + 1}
              </span>
              {placement.pageIndex !== null && (
                <span className="absolute right-1 top-1 rounded bg-ink-900/45 px-1 text-[9px] font-medium text-white">
                  p{placement.pageIndex + 1}
                </span>
              )}

              {selected && editable && (
                <>
                  <span
                    onPointerDown={(event) => onPointerDown(event, slot, 'se')}
                    style={{ cursor: 'nwse-resize' }}
                    className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-[2px] border border-white bg-accent-600 shadow"
                  />
                  <span
                    onPointerDown={(event) => onPointerDown(event, slot, 'e')}
                    style={{ cursor: 'ew-resize' }}
                    className="absolute -right-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[2px] border border-white bg-accent-600 shadow"
                  />
                  <span
                    onPointerDown={(event) => onPointerDown(event, slot, 's')}
                    style={{ cursor: 'ns-resize' }}
                    className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-[2px] border border-white bg-accent-600 shadow"
                  />
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Printer's marks, drawn from the same ops the exporter uses */}
      {markOps.length > 0 && (
        <svg
          viewBox={`0 0 ${sheetSize.w} ${sheetSize.h}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {renderOps(markOps, 'mark')}
        </svg>
      )}

      {!editable && (
        <div className="pointer-events-none absolute left-1 bottom-1 rounded bg-ink-900/60 px-1.5 py-0.5 text-[9.5px] text-white">
          Reverse side — mirrored from the front automatically
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-ink-900/70 px-1.5 py-0.5 text-[9.5px] text-white">
          Snapping to 1 mm — hold Alt for free movement
        </div>
      )}
    </div>
  );
}

const snapTo = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;
