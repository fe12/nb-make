'use client';

import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { PagePreview } from '@/components/PagePreview';
import type { Op } from '@/lib/render/ops';
import type { Block } from '@/lib/types/page';
import type { Rect, Size } from '@/lib/units';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'rotate';

/**
 * Resize handles, with the corner each one holds still.
 *
 * `anchor` is expressed in half-extents from the block centre: the south-east
 * handle pins the north-west corner at (-1, -1), the east handle pins the west
 * edge at (-1, 0), and so on. Keeping that anchor fixed *in screen space* is
 * what makes resizing a rotated block behave — otherwise the block appears to
 * slide sideways as it grows.
 */
const HANDLES: Array<{
  id: Exclude<Handle, 'move' | 'rotate'>;
  className: string;
  /** Direction the handle points, in degrees clockwise from north. */
  angle: number;
  anchor: [number, number];
}> = [
  { id: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', angle: 315, anchor: [1, 1] },
  { id: 'n', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', angle: 0, anchor: [0, 1] },
  { id: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', angle: 45, anchor: [-1, 1] },
  { id: 'e', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', angle: 90, anchor: [-1, 0] },
  { id: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', angle: 135, anchor: [-1, -1] },
  { id: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', angle: 180, anchor: [0, -1] },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', angle: 225, anchor: [1, -1] },
  { id: 'w', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', angle: 270, anchor: [1, 0] },
];

/** Cursor for a handle once the block has been rotated. */
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
const cursorFor = (angle: number, rotation: number): string =>
  CURSORS[Math.round((((angle + rotation) % 180) + 180) % 180 / 45) % 4];

interface DragState {
  handle: Handle;
  blockId: string;
  startRect: Block['rect'];
  startRotation: number;
  startX: number;
  startY: number;
  containerWidth: number;
  containerHeight: number;
  /** Block centre in page millimetres when the gesture began. */
  centreX: number;
  centreY: number;
}

/**
 * The page preview with a direct-manipulation layer on top.
 *
 * Blocks are dragged in millimetres and snapped to a 1 mm grid (hold Alt for
 * fine positioning), because print layout is a millimetre medium — snapping to
 * screen pixels would produce values that look arbitrary in the inspector.
 */
export function BlockCanvas({
  ops,
  size,
  content,
  blocks,
  selectedId,
  onSelect,
  onChange,
  onRotate,
  onCommit,
  showGuides = true,
}: {
  ops: Op[];
  size: Size;
  content: Rect;
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called continuously while dragging — should not push undo history. */
  onChange: (id: string, rect: Block['rect']) => void;
  onRotate: (id: string, rotation: number) => void;
  /** Called once when a drag finishes, to record a single undo entry. */
  onCommit: () => void;
  showGuides?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);

  const toPageFraction = useCallback(
    (rect: Block['rect']) => ({
      left: ((content.x + rect.x * content.w) / size.w) * 100,
      top: ((content.y + rect.y * content.h) / size.h) * 100,
      width: ((rect.w * content.w) / size.w) * 100,
      height: ((rect.h * content.h) / size.h) * 100,
    }),
    [content, size]
  );

  const onPointerDown = (event: React.PointerEvent, block: Block, handle: Handle) => {
    if (block.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;

    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = {
      handle,
      blockId: block.id,
      startRect: block.rect,
      startRotation: block.rotation,
      startX: event.clientX,
      startY: event.clientY,
      containerWidth: bounds.width,
      containerHeight: bounds.height,
      centreX: content.x + (block.rect.x + block.rect.w / 2) * content.w,
      centreY: content.y + (block.rect.y + block.rect.h / 2) * content.h,
    };
    setDragging(handle);
    onSelect(block.id);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;

    const mmPerPxX = size.w / state.containerWidth;
    const mmPerPxY = size.h / state.containerHeight;

    if (state.handle === 'rotate') {
      const bounds = container.current?.getBoundingClientRect();
      if (!bounds) return;
      // Angle from the block centre to the pointer, with north as zero.
      const pointerX = (event.clientX - bounds.left) * mmPerPxX;
      const pointerY = (event.clientY - bounds.top) * mmPerPxY;
      const raw =
        (Math.atan2(pointerY - state.centreY, pointerX - state.centreX) * 180) / Math.PI + 90;
      const step = event.altKey ? 1 : 15;
      onRotate(state.blockId, Math.round(normalise(raw) / step) * step);
      return;
    }

    const snap = event.altKey ? 0 : 1;
    const dxMm = snapTo((event.clientX - state.startX) * mmPerPxX, snap);
    const dyMm = snapTo((event.clientY - state.startY) * mmPerPxY, snap);

    const start = state.startRect;
    const minW = content.w > 0 ? 0.5 / content.w : 0.01;
    const minH = content.h > 0 ? 0.5 / content.h : 0.01;

    if (state.handle === 'move') {
      onChange(state.blockId, {
        ...start,
        x: start.x + (content.w > 0 ? dxMm / content.w : 0),
        y: start.y + (content.h > 0 ? dyMm / content.h : 0),
      });
      return;
    }

    const spec = HANDLES.find((h) => h.id === state.handle);
    if (!spec) return;

    // Resizing happens along the block's own axes, so the screen-space drag is
    // rotated back into local space first.
    const rad = (state.startRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localDx = dxMm * cos + dyMm * sin;
    const localDy = -dxMm * sin + dyMm * cos;

    const startWmm = start.w * content.w;
    const startHmm = start.h * content.h;
    // anchor[0] === 1 means the west edge is held, so a drag grows to the west.
    const growX = spec.anchor[0] === 0 ? 0 : -spec.anchor[0];
    const growY = spec.anchor[1] === 0 ? 0 : -spec.anchor[1];
    const newWmm = Math.max(0.5, startWmm + localDx * growX);
    const newHmm = Math.max(0.5, startHmm + localDy * growY);

    // Hold the anchor still in screen space and derive the new centre from it.
    const anchorX = state.centreX + ((spec.anchor[0] * startWmm) / 2) * cos - ((spec.anchor[1] * startHmm) / 2) * sin;
    const anchorY = state.centreY + ((spec.anchor[0] * startWmm) / 2) * sin + ((spec.anchor[1] * startHmm) / 2) * cos;
    const centreX = anchorX - ((spec.anchor[0] * newWmm) / 2) * cos + ((spec.anchor[1] * newHmm) / 2) * sin;
    const centreY = anchorY - ((spec.anchor[0] * newWmm) / 2) * sin - ((spec.anchor[1] * newHmm) / 2) * cos;

    onChange(state.blockId, {
      x: Math.max(-2, (centreX - newWmm / 2 - content.x) / content.w),
      y: Math.max(-2, (centreY - newHmm / 2 - content.y) / content.h),
      w: Math.max(minW, newWmm / content.w),
      h: Math.max(minH, newHmm / content.h),
    });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released; nothing to undo here.
    }
    drag.current = null;
    setDragging(null);
    onCommit();
  };

  const marginGuide = {
    left: (content.x / size.w) * 100,
    top: (content.y / size.h) * 100,
    width: (content.w / size.w) * 100,
    height: (content.h / size.h) * 100,
  };

  return (
    <div
      ref={container}
      className="relative w-full select-none bg-white shadow-[0_2px_10px_rgba(23,31,40,0.14)]"
      style={{ aspectRatio: `${size.w} / ${size.h}` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => onSelect(null)}
    >
      <PagePreview ops={ops} size={size} showShadow={false} className="absolute inset-0 h-full" />

      {showGuides && (
        <div
          className="pointer-events-none absolute border border-dashed border-accent-300/70"
          style={{
            left: `${marginGuide.left}%`,
            top: `${marginGuide.top}%`,
            width: `${marginGuide.width}%`,
            height: `${marginGuide.height}%`,
          }}
        />
      )}

      {blocks.map((block) => {
        const box = toPageFraction(block.rect);
        const selected = block.id === selectedId;
        return (
          <div
            key={block.id}
            role="button"
            tabIndex={0}
            aria-label={block.name || block.content.type}
            className={clsx(
              'absolute transition-colors',
              block.locked ? 'cursor-not-allowed' : 'cursor-move',
              selected
                ? 'border-2 border-accent-500 bg-accent-500/[0.06]'
                : 'border border-transparent hover:border-accent-300 hover:bg-accent-500/[0.03]',
              !block.visible && 'opacity-40'
            )}
            style={{
              left: `${box.left}%`,
              top: `${box.top}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
              // The selection box turns with the block, so the handles sit on
              // the edges you actually see rather than an invisible upright box.
              transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
            }}
            onPointerDown={(event) => onPointerDown(event, block, 'move')}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(block.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(block.id);
            }}
          >
            {selected && !block.locked && (
              <>
                {HANDLES.map((handle) => (
                  <span
                    key={handle.id}
                    onPointerDown={(event) => onPointerDown(event, block, handle.id)}
                    style={{ cursor: cursorFor(handle.angle, block.rotation) }}
                    className={clsx(
                      'absolute h-2 w-2 rounded-[2px] border border-white bg-accent-600 shadow',
                      handle.className
                    )}
                  />
                ))}
                <span
                  onPointerDown={(event) => onPointerDown(event, block, 'rotate')}
                  title="Drag to rotate — hold Alt for 1° steps"
                  className="absolute -top-6 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-accent-600 shadow active:cursor-grabbing"
                />
                <span className="pointer-events-none absolute -top-[18px] left-1/2 h-3 w-px -translate-x-1/2 bg-accent-500/70" />
              </>
            )}
            {selected && (
              <span
                className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-accent-600 px-1.5 py-0.5 text-[9.5px] font-medium text-white"
                // Keep the label upright so it stays readable on a rotated block.
                style={{ transform: block.rotation ? `rotate(${-block.rotation}deg)` : undefined }}
              >
                {block.name || block.content.type}
                {block.rotation ? ` · ${Math.round(block.rotation)}°` : ''}
              </span>
            )}
          </div>
        );
      })}

      {dragging && (
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-ink-900/70 px-1.5 py-0.5 text-[9.5px] text-white">
          {dragging === 'rotate'
            ? 'Snapping to 15° — hold Alt for 1°'
            : 'Snapping to 1 mm — hold Alt for free movement'}
        </div>
      )}
    </div>
  );
}

const snapTo = (value: number, step: number): number =>
  step > 0 ? Math.round(value / step) * step : value;

const normalise = (degrees: number): number => ((degrees % 360) + 360) % 360;
