import type { Rect } from '../units';
import type { Op, Stroke } from './ops';

export const stroke = (
  color: string,
  width: number,
  extra: Partial<Stroke> = {}
): Stroke => ({ color, width, ...extra });

export const hLine = (rect: Rect, y: number, s: Stroke): Op => ({
  kind: 'line',
  x1: rect.x,
  y1: y,
  x2: rect.x + rect.w,
  y2: y,
  stroke: s,
});

export const vLine = (rect: Rect, x: number, s: Stroke): Op => ({
  kind: 'line',
  x1: x,
  y1: rect.y,
  x2: x,
  y2: rect.y + rect.h,
  stroke: s,
});

/**
 * First tick coordinate for a repeating ruling.
 *
 * `center` distributes the leftover space evenly so a grid looks deliberate on
 * an area that is not an exact multiple of the spacing; `start` anchors to the
 * area edge, which is what ruled paper wants.
 */
export function firstTick(
  start: number,
  length: number,
  spacing: number,
  align: 'start' | 'center',
  offset: number
): number {
  if (spacing <= 0) return start;
  if (align === 'center') {
    const leftover = length - Math.floor(length / spacing) * spacing;
    return start + leftover / 2 + offset;
  }
  return start + offset;
}

/** Ticks from `from`, stepping by `spacing`, staying within `[lo, hi]`. */
export function ticks(from: number, spacing: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  if (spacing <= 0) return out;
  // Walk backwards first so a positive offset never leaves a bald strip.
  let v = from;
  while (v - spacing >= lo - 1e-9) v -= spacing;
  for (; v <= hi + 1e-9; v += spacing) {
    if (v >= lo - 1e-9) out.push(round(v));
  }
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Liang–Barsky clip of an infinite line through `(px,py)` with direction
 * `(dx,dy)` against a rect. Returns null when the line misses.
 */
export function clipLineToRect(
  rect: Rect,
  px: number,
  py: number,
  dx: number,
  dy: number
): [number, number, number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const p = [-dx, dx, -dy, dy];
  const q = [px - rect.x, rect.x + rect.w - px, py - rect.y, rect.y + rect.h - py];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  if (t0 > t1) return null;
  return [px + t0 * dx, py + t0 * dy, px + t1 * dx, py + t1 * dy];
}

/**
 * A family of parallel lines at `angleDeg`, separated by `perpSpacing`
 * measured perpendicular to the lines, clipped to `rect`.
 *
 * Having one primitive for this keeps isometric, triangular and calligraphy
 * slant rulings to a couple of lines each.
 */
export function parallelLines(
  rect: Rect,
  angleDeg: number,
  perpSpacing: number,
  s: Stroke,
  phase = 0
): Op[] {
  if (perpSpacing <= 0) return [];
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Unit normal to the line direction.
  const nx = -dy;
  const ny = dx;

  // Project the rect corners onto the normal to find the range of offsets.
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const [cx, cy] of corners) {
    const d = cx * nx + cy * ny;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }

  const ops: Op[] = [];
  const kStart = Math.ceil((min - phase) / perpSpacing);
  const kEnd = Math.floor((max - phase) / perpSpacing);
  // Guard against pathological spacings producing millions of lines.
  if (kEnd - kStart > 5000) return ops;

  for (let k = kStart; k <= kEnd; k++) {
    const offset = k * perpSpacing + phase;
    const clipped = clipLineToRect(rect, nx * offset, ny * offset, dx, dy);
    if (clipped) {
      ops.push({
        kind: 'line',
        x1: clipped[0],
        y1: clipped[1],
        x2: clipped[2],
        y2: clipped[3],
        stroke: s,
      });
    }
  }
  return ops;
}

/** Regular polygon vertices as a flat point list. */
export function regularPolygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  startAngleDeg = -90
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((startAngleDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
  }
  return pts;
}

/** True when a rect is large enough to be worth drawing into. */
export const isDrawable = (rect: Rect): boolean => rect.w > 0.01 && rect.h > 0.01;

export function insetRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    w: Math.max(0, rect.w - by * 2),
    h: Math.max(0, rect.h - by * 2),
  };
}
