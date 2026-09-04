'use client';

import clsx from 'clsx';
import { memo, type ReactNode } from 'react';
import { renderOps } from '@/lib/render/svg';
import type { Op } from '@/lib/render/ops';
import type { Size } from '@/lib/units';

/**
 * Draws a compiled page. The SVG viewBox is in millimetres, so the ops need no
 * conversion and the preview is geometrically identical to the exported PDF.
 */
export const PagePreview = memo(function PagePreview({
  ops,
  size,
  viewBox,
  className,
  background = '#ffffff',
  overlay,
  showShadow = true,
  onClick,
  title,
}: {
  ops: Op[];
  size: Size;
  /**
   * Overrides the visible millimetre box, e.g. `-3 -3 153 213` to show a
   * page's bleed overhang around its trim. `size` still sets the aspect.
   */
  viewBox?: { x: number; y: number; w: number; h: number };
  className?: string;
  background?: string;
  /** Editor chrome (selection handles, guides) drawn in the same mm space. */
  overlay?: ReactNode;
  showShadow?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const box = viewBox ?? { x: 0, y: 0, w: size.w, h: size.h };
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className={clsx(
        'block h-auto w-full',
        showShadow && 'shadow-[0_1px_3px_rgba(23,31,40,0.16)]',
        onClick && 'cursor-pointer',
        className
      )}
      style={{ aspectRatio: `${box.w} / ${box.h}`, background }}
      onClick={onClick}
      role={onClick ? 'button' : 'img'}
      aria-label={title}
      // Rulings are hairlines; without this they vanish at small zoom levels.
      shapeRendering="geometricPrecision"
    >
      {renderOps(ops)}
      {overlay}
    </svg>
  );
});

/** Small fixed-height thumbnail for lists and pickers. */
export function PageThumb({
  ops,
  size,
  height = 120,
  selected,
  onClick,
  label,
  badge,
}: {
  ops: Op[];
  size: Size;
  height?: number;
  selected?: boolean;
  onClick?: () => void;
  label?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={clsx(
          'relative rounded-sm ring-1 transition-shadow',
          selected ? 'ring-2 ring-accent-500' : 'ring-ink-200 hover:ring-ink-300'
        )}
        style={{ height, width: (height * size.w) / size.h }}
      >
        <PagePreview
          ops={ops}
          size={size}
          onClick={onClick}
          showShadow={false}
          className="h-full rounded-sm"
        />
        {badge && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-accent-600 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
            {badge}
          </span>
        )}
      </div>
      {label && (
        <span className="max-w-full truncate text-[10.5px] leading-tight text-ink-500">
          {label}
        </span>
      )}
    </div>
  );
}
