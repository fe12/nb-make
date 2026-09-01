'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/controls';
import type { Size } from '@/lib/units';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;

/**
 * A fixed-height window onto the page, with zoom and pan.
 *
 * The page used to stretch to whatever width the column had, which meant a
 * tall page pushed the inspector off screen and fine work was impossible. Here
 * the viewport stays put and the page moves inside it: zoom to fit, zoom to
 * 100 % for true millimetre scale, or scroll around at higher magnification.
 */
export function CanvasViewport({
  pageSize,
  children,
  toolbarExtra,
}: {
  pageSize: Size;
  children: ReactNode;
  toolbarExtra?: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [auto, setAuto] = useState(true);

  /** The zoom at which the page just fits the viewport, with a little margin. */
  const measureFit = useCallback(() => {
    const element = viewport.current;
    if (!element) return 1;
    const padding = 48;
    const available = {
      w: Math.max(80, element.clientWidth - padding),
      h: Math.max(80, element.clientHeight - padding),
    };
    // 1 = the page drawn at roughly 96 dpi; that is the reference the zoom
    // percentage is quoted against.
    const basePx = mmToPx(pageSize.w);
    const baseHeightPx = mmToPx(pageSize.h);
    return Math.min(available.w / basePx, available.h / baseHeightPx);
  }, [pageSize.w, pageSize.h]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const update = () => {
      const next = measureFit();
      setFitZoom(next);
      // While in automatic mode the page keeps filling the window as it resizes;
      // an explicit zoom takes over the moment the user picks one.
      setZoom((current) => (auto ? next : current));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureFit, auto]);

  const setExplicit = (next: number) => {
    setAuto(false);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  const step = (direction: 1 | -1) => {
    const sorted = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
    const next = sorted.find((z) => (direction > 0 ? z > zoom + 0.001 : z < zoom - 0.001));
    setExplicit(next ?? zoom);
  };

  /*
   * Registered natively rather than as an `onWheel` prop.
   *
   * React attaches wheel listeners to the root as *passive*, so calling
   * preventDefault() from a JSX handler is ignored and the browser zooms the
   * whole page instead. A non-passive listener on the viewport itself is the
   * only way to claim the gesture — and it catches trackpad pinch too, which
   * also arrives as a ctrl-wheel event.
   */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setExplicit(zoomRef.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const widthPx = mmToPx(pageSize.w) * zoom;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => step(-1)} aria-label="Zoom out" title="Zoom out">
          −
        </Button>
        <span className="w-14 text-center text-[11.5px] font-medium tabular-nums text-ink-600">
          {Math.round(zoom * 100)}%
        </span>
        <Button size="sm" onClick={() => step(1)} aria-label="Zoom in" title="Zoom in">
          +
        </Button>
        <Button
          size="sm"
          variant={auto ? 'primary' : 'secondary'}
          onClick={() => {
            setAuto(true);
            setZoom(measureFit());
          }}
          title="Fit the page in the window"
        >
          Fit
        </Button>
        <Button
          size="sm"
          variant={!auto && Math.abs(zoom - 1) < 0.001 ? 'primary' : 'secondary'}
          onClick={() => setExplicit(1)}
          title="Show the page at roughly its printed size"
        >
          100%
        </Button>
        {toolbarExtra}
        <span className="ml-auto hidden text-[10.5px] text-ink-400 sm:block">
          Ctrl + scroll to zoom
        </span>
      </div>

      <div
        ref={viewport}
        className="paper-surface sketch-box sketch-border min-h-0 flex-1 overflow-auto border-ink-200"
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <div style={{ width: widthPx, flexShrink: 0 }}>{children}</div>
        </div>
      </div>

      <p className="mt-1.5 text-[10.5px] text-ink-400">
        {Math.round(pageSize.w * 10) / 10} × {Math.round(pageSize.h * 10) / 10} mm
        {zoom > fitZoom * 1.02 ? ' — scroll or drag the scrollbars to pan' : ''}
      </p>
    </div>
  );
}

/** Millimetres at ~96 dpi, the reference scale the zoom percentage quotes. */
const mmToPx = (mm: number): number => (mm / 25.4) * 96;
