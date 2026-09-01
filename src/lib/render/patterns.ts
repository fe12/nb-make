/**
 * Turns a `Pattern` into drawing ops confined to a rectangle.
 *
 * Every generator emits geometry that is already inside `area`, so nothing here
 * relies on clipping. That matters because clipping is the one primitive the
 * PDF backend has to hand-roll, and rulings are by far the most op-heavy thing
 * we draw.
 */
import type { Rect } from '../units';
import type { Pattern, PatternSpec } from '../types/pattern';
import {
  firstTick,
  hLine,
  isDrawable,
  parallelLines,
  regularPolygon,
  stroke,
  ticks,
  vLine,
} from './geometry';
import type { Op, Stroke } from './ops';

export interface PatternContext {
  /** Multiplier applied to millimetre spacings when `scaleWithPage` is set. */
  scale: number;
}

export function renderPattern(
  pattern: Pattern,
  area: Rect,
  ctx: PatternContext = { scale: 1 }
): Op[] {
  if (!isDrawable(area) || pattern.spec.type === 'blank') return [];

  const s = pattern.scaleWithPage ? ctx.scale : 1;
  const ops = build(pattern, area, s);
  if (ops.length === 0) return ops;

  return pattern.opacity < 1
    ? [{ kind: 'group', ops, opacity: pattern.opacity }]
    : ops;
}

function build(pattern: Pattern, area: Rect, s: number): Op[] {
  const { align, offsetX, offsetY } = pattern;
  const spec = pattern.spec;

  switch (spec.type) {
    case 'blank':
      return [];
    case 'ruled':
      return ruled(spec, area, s, align, offsetX, offsetY);
    case 'dots':
      return dots(spec, area, s, align, offsetX, offsetY);
    case 'grid':
      return grid(spec, area, s, align, offsetX, offsetY);
    case 'graph':
      return graph(spec, area, s, align, offsetX, offsetY);
    case 'isometric':
      return isometric(spec, area, s, offsetX);
    case 'hexagon':
      return hexagon(spec, area, s);
    case 'triangle':
      return triangle(spec, area, s, offsetX, offsetY);
    case 'polar':
      return polar(spec, area, s);
    case 'logscale':
      return logscale(spec, area, s);
    case 'music':
      return music(spec, area, s, offsetY);
    case 'tablature':
      return tablature(spec, area, s, offsetY);
    case 'handwriting':
      return handwriting(spec, area, s, offsetY);
    case 'seyes':
      return seyes(spec, area, s);
    case 'genkoyoshi':
      return genkoyoshi(spec, area);
    case 'dottedthirds':
      return dottedThirds(spec, area, s, offsetY);
  }
}

type Of<T extends PatternSpec['type']> = Extract<PatternSpec, { type: T }>;

/* ------------------------------------------------------------------ ruled */

function ruled(
  p: Of<'ruled'>,
  area: Rect,
  s: number,
  align: 'start' | 'center',
  ox: number,
  oy: number
): Op[] {
  const spacing = p.spacing * s;
  const line = stroke(p.color, p.width * s, p.dashed ? { dash: [1.2 * s, 1.2 * s] } : {});
  const ops: Op[] = [];

  const start = firstTick(area.y, area.h, spacing, align, oy + p.topOffset * s);
  for (const y of ticks(start, spacing, area.y, area.y + area.h)) {
    ops.push(hLine(area, y, line));
  }

  if (p.headerRule.enabled) {
    const y = area.y + p.headerRule.offset * s;
    if (y >= area.y && y <= area.y + area.h) {
      ops.push(hLine(area, y, stroke(p.headerRule.color, p.headerRule.width * s)));
    }
  }

  if (p.marginRule.enabled) {
    const rule = stroke(p.marginRule.color, p.marginRule.width * s);
    const off = p.marginRule.offset * s + ox;
    if (p.marginRule.side === 'left' || p.marginRule.side === 'both') {
      ops.push(vLine(area, area.x + off, rule));
    }
    if (p.marginRule.side === 'right' || p.marginRule.side === 'both') {
      ops.push(vLine(area, area.x + area.w - off, rule));
    }
  }
  return ops;
}

/* ------------------------------------------------------------------- dots */

function dots(
  p: Of<'dots'>,
  area: Rect,
  s: number,
  align: 'start' | 'center',
  ox: number,
  oy: number
): Op[] {
  const sx = p.spacingX * s;
  const sy = p.spacingY * s;
  const r = (p.size * s) / 2;
  const xs = ticks(firstTick(area.x, area.w, sx, align, ox), sx, area.x, area.x + area.w);
  const ys = ticks(firstTick(area.y, area.h, sy, align, oy), sy, area.y, area.y + area.h);
  if (xs.length * ys.length > 60000) return [];

  const ops: Op[] = [];
  for (const y of ys) {
    for (const x of xs) {
      if (p.shape === 'round') {
        ops.push({ kind: 'ellipse', cx: x, cy: y, rx: r, ry: r, fill: { color: p.color } });
      } else if (p.shape === 'square') {
        ops.push({
          kind: 'rect',
          x: x - r,
          y: y - r,
          w: r * 2,
          h: r * 2,
          fill: { color: p.color },
        });
      } else {
        const arm = r * 2;
        const line = stroke(p.color, Math.max(0.05, r));
        ops.push(
          { kind: 'line', x1: x - arm, y1: y, x2: x + arm, y2: y, stroke: line },
          { kind: 'line', x1: x, y1: y - arm, x2: x, y2: y + arm, stroke: line }
        );
      }
    }
  }
  return ops;
}

/* ------------------------------------------------------------------- grid */

function grid(
  p: Of<'grid'>,
  area: Rect,
  s: number,
  align: 'start' | 'center',
  ox: number,
  oy: number
): Op[] {
  const sx = p.spacingX * s;
  const sy = p.spacingY * s;
  const line = stroke(p.color, p.width * s);
  const ops: Op[] = [];
  for (const x of ticks(firstTick(area.x, area.w, sx, align, ox), sx, area.x, area.x + area.w)) {
    ops.push(vLine(area, x, line));
  }
  for (const y of ticks(firstTick(area.y, area.h, sy, align, oy), sy, area.y, area.y + area.h)) {
    ops.push(hLine(area, y, line));
  }
  return ops;
}

/* ------------------------------------------------------------------ graph */

function graph(
  p: Of<'graph'>,
  area: Rect,
  s: number,
  align: 'start' | 'center',
  ox: number,
  oy: number
): Op[] {
  const step = p.minor * s;
  const minorLine = stroke(p.minorColor, p.minorWidth * s);
  const majorLine = stroke(p.majorColor, p.majorWidth * s);
  const ops: Op[] = [];

  const x0 = firstTick(area.x, area.w, step, align, ox);
  const y0 = firstTick(area.y, area.h, step, align, oy);

  const classify = (v: number, origin: number) => {
    const n = Math.round((v - origin) / step);
    return n % p.majorEvery === 0;
  };

  for (const x of ticks(x0, step, area.x, area.x + area.w)) {
    ops.push(vLine(area, x, classify(x, x0) ? majorLine : minorLine));
  }
  for (const y of ticks(y0, step, area.y, area.y + area.h)) {
    ops.push(hLine(area, y, classify(y, y0) ? majorLine : minorLine));
  }
  return ops;
}

/* -------------------------------------------------------------- isometric */

function isometric(p: Of<'isometric'>, area: Rect, s: number, ox: number): Op[] {
  const spacing = p.spacing * s;
  const line = stroke(p.color, p.width * s);
  const ops: Op[] = [];

  // The two 30° families define the triangles; verticals are optional.
  ops.push(...parallelLines(area, 30, spacing, line));
  ops.push(...parallelLines(area, -30, spacing, line));
  if (p.showVerticals) {
    // Vertical spacing that lines up with the lattice the 30° families create.
    const vSpacing = spacing / Math.cos((30 * Math.PI) / 180);
    for (const x of ticks(area.x + ox, vSpacing, area.x, area.x + area.w)) {
      ops.push(vLine(area, x, line));
    }
  }
  return ops;
}

/* ---------------------------------------------------------------- hexagon */

function hexagon(p: Of<'hexagon'>, area: Rect, s: number): Op[] {
  const R = p.size * s;
  if (R < 0.3) return [];
  const pointy = p.orientation === 'pointy';
  const line = stroke(p.color, p.width * s);

  // Lattice pitch for hexagons of circumradius R. Pointy-top hexes are
  // sqrt(3)·R wide and tile every 1.5·R vertically; flat-top is the transpose.
  const colPitch = pointy ? Math.sqrt(3) * R : 1.5 * R;
  const rowPitch = pointy ? 1.5 * R : Math.sqrt(3) * R;

  const cols = Math.ceil(area.w / colPitch) + 2;
  const rows = Math.ceil(area.h / rowPitch) + 2;
  if (cols * rows > 20000) return [];

  const ops: Op[] = [];
  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const cx = pointy
        ? area.x + col * colPitch + (row % 2 === 0 ? 0 : colPitch / 2)
        : area.x + col * colPitch;
      const cy = pointy
        ? area.y + row * rowPitch
        : area.y + row * rowPitch + (col % 2 === 0 ? 0 : rowPitch / 2);

      // Cheap reject before generating vertices.
      if (cx + R < area.x || cx - R > area.x + area.w) continue;
      if (cy + R < area.y || cy - R > area.y + area.h) continue;

      const pts = regularPolygon(cx, cy, R, 6, pointy ? -90 : 0);
      ops.push(...clipPolygonEdges(pts, area, line, true));
    }
  }
  return ops;
}

/** Emits each polygon edge, clipped to the area, dropping edges that miss. */
function clipPolygonEdges(pts: number[], area: Rect, line: Stroke, closed: boolean): Op[] {
  const ops: Op[] = [];
  const n = pts.length / 2;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2];
    const ay = pts[i * 2 + 1];
    const bx = pts[j * 2];
    const by = pts[j * 2 + 1];
    const seg = clipSegment(area, ax, ay, bx, by);
    if (seg) {
      ops.push({ kind: 'line', x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], stroke: line });
    }
  }
  return ops;
}

/** Liang–Barsky for a finite segment (parameter restricted to [0,1]). */
function clipSegment(
  rect: Rect,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number, number, number] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/* --------------------------------------------------------------- triangle */

function triangle(p: Of<'triangle'>, area: Rect, s: number, ox: number, oy: number): Op[] {
  const spacing = p.spacing * s;
  const line = stroke(p.color, p.width * s);
  return [
    ...parallelLines(area, 0, spacing * Math.sin((60 * Math.PI) / 180), line, oy),
    ...parallelLines(area, 60, spacing * Math.sin((60 * Math.PI) / 180), line, ox),
    ...parallelLines(area, -60, spacing * Math.sin((60 * Math.PI) / 180), line, ox),
  ];
}

/* ------------------------------------------------------------------ polar */

function polar(p: Of<'polar'>, area: Rect, s: number): Op[] {
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const maxR = Math.min(area.w, area.h) / 2;
  const line = stroke(p.color, p.width * s);
  const axis = stroke(p.axisColor, p.axisWidth * s);
  const ops: Op[] = [];

  for (let i = 1; i <= p.rings; i++) {
    const r = (maxR * i) / p.rings;
    ops.push({
      kind: 'ellipse',
      cx,
      cy,
      rx: r,
      ry: r,
      stroke: i === p.rings ? axis : line,
    });
  }

  for (let i = 0; i < p.sectors; i++) {
    const a = (i * 2 * Math.PI) / p.sectors;
    const isAxis = p.sectors % 4 === 0 && i % (p.sectors / 4) === 0;
    ops.push({
      kind: 'line',
      x1: cx,
      y1: cy,
      x2: cx + maxR * Math.cos(a),
      y2: cy + maxR * Math.sin(a),
      stroke: isAxis ? axis : line,
    });
  }
  return ops;
}

/* --------------------------------------------------------------- logscale */

function logscale(p: Of<'logscale'>, area: Rect, s: number): Op[] {
  const minor = stroke(p.color, p.width * s);
  const major = stroke(p.majorColor, p.majorWidth * s);
  const ops: Op[] = [];

  const logTicks = (length: number): Array<{ pos: number; major: boolean }> => {
    const out: Array<{ pos: number; major: boolean }> = [];
    const per = length / p.decades;
    for (let d = 0; d < p.decades; d++) {
      for (let m = 1; m <= 9; m++) {
        const pos = d * per + Math.log10(m) * per;
        if (pos <= length + 1e-9) out.push({ pos, major: m === 1 });
      }
    }
    out.push({ pos: length, major: true });
    return out;
  };

  const linTicks = (length: number): Array<{ pos: number; major: boolean }> => {
    const out: Array<{ pos: number; major: boolean }> = [];
    const total = p.decades * p.linearDivisions;
    for (let i = 0; i <= total; i++) {
      out.push({ pos: (length * i) / total, major: i % p.linearDivisions === 0 });
    }
    return out;
  };

  const xIsLog = p.kind === 'semilog-x' || p.kind === 'loglog';
  const yIsLog = p.kind === 'semilog-y' || p.kind === 'loglog';

  for (const t of (xIsLog ? logTicks : linTicks)(area.w)) {
    ops.push(vLine(area, area.x + t.pos, t.major ? major : minor));
  }
  for (const t of (yIsLog ? logTicks : linTicks)(area.h)) {
    // Logarithmic axes read bottom-up, so mirror the offset.
    const y = yIsLog ? area.y + area.h - t.pos : area.y + t.pos;
    ops.push(hLine(area, y, t.major ? major : minor));
  }
  return ops;
}

/* ------------------------------------------------------------------ music */

function music(p: Of<'music'>, area: Rect, s: number, oy: number): Op[] {
  const gap = p.lineSpacing * s;
  const staffHeight = gap * 4;
  const pitch = staffHeight + p.staffGap * s;
  const line = stroke(p.color, p.width * s);
  const ops: Op[] = [];

  for (let i = 0; i < p.staves; i++) {
    const top = area.y + oy + i * pitch;
    if (top + staffHeight > area.y + area.h + 1e-6) break;
    for (let l = 0; l < 5; l++) ops.push(hLine(area, top + l * gap, line));
    // Opening barline, so the staff reads as a system rather than loose rules.
    ops.push({
      kind: 'line',
      x1: area.x,
      y1: top,
      x2: area.x,
      y2: top + staffHeight,
      stroke: line,
    });
    ops.push({
      kind: 'line',
      x1: area.x + area.w,
      y1: top,
      x2: area.x + area.w,
      y2: top + staffHeight,
      stroke: line,
    });
  }
  return ops;
}

/* ------------------------------------------------------------- tablature */

function tablature(p: Of<'tablature'>, area: Rect, s: number, oy: number): Op[] {
  const gap = p.lineSpacing * s;
  const systemHeight = gap * (p.strings - 1);
  const pitch = systemHeight + p.systemGap * s;
  const line = stroke(p.color, p.width * s);
  const ops: Op[] = [];

  for (let i = 0; i < p.systems; i++) {
    const top = area.y + oy + i * pitch;
    if (top + systemHeight > area.y + area.h + 1e-6) break;
    for (let l = 0; l < p.strings; l++) ops.push(hLine(area, top + l * gap, line));
    for (const x of [area.x, area.x + area.w]) {
      ops.push({ kind: 'line', x1: x, y1: top, x2: x, y2: top + systemHeight, stroke: line });
    }
  }
  return ops;
}

/* ----------------------------------------------------------- handwriting */

function handwriting(p: Of<'handwriting'>, area: Rect, s: number, oy: number): Op[] {
  const band = p.bandHeight * s;
  const baseline = stroke(p.baselineColor, p.width * s);
  const guide = stroke(p.guideColor, p.width * s * 0.8);
  const dashed = stroke(p.guideColor, p.width * s * 0.8, { dash: [1.2 * s, 1.2 * s] });
  const ops: Op[] = [];

  const count = Math.floor((area.h - oy) / band);
  for (let i = 0; i < count; i++) {
    const top = area.y + oy + i * band;
    const bottom = top + band;
    // Within a band: ascender line, midline (x-height), baseline, descender.
    const xHeight = band * p.xHeightRatio;
    const midY = bottom - xHeight;

    if (p.showAscender) ops.push(hLine(area, top, guide));
    ops.push(hLine(area, midY, p.dashedMidline ? dashed : guide));
    ops.push(hLine(area, bottom, baseline));
    if (p.showDescender && bottom + xHeight / 2 <= area.y + area.h) {
      ops.push(hLine(area, bottom + xHeight / 2, guide));
    }
  }

  if (p.slant.enabled) {
    // Slant guides lean forward, i.e. bottom-left to top-right.
    const angle = -(90 - p.slant.angleDeg);
    ops.push(
      ...parallelLines(area, angle, p.slant.spacing * s, stroke(p.slant.color, p.width * s * 0.7))
    );
  }
  return ops;
}

/* ------------------------------------------------------------------ seyes */

function seyes(p: Of<'seyes'>, area: Rect, s: number): Op[] {
  const unit = p.unit * s;
  const sub = unit / p.subDivisions;
  const main = stroke(p.mainColor, p.width * s);
  const light = stroke(p.subColor, p.width * s * 0.8);
  const vertical = stroke(p.verticalColor, p.width * s);
  const ops: Op[] = [];

  let index = 0;
  for (let y = area.y; y <= area.y + area.h + 1e-9; y += sub, index++) {
    ops.push(hLine(area, y, index % p.subDivisions === 0 ? main : light));
  }
  for (const x of ticks(area.x, p.verticalSpacing * s, area.x, area.x + area.w)) {
    ops.push(vLine(area, x, vertical));
  }
  return ops;
}

/* ------------------------------------------------------------- genkoyoshi */

function genkoyoshi(p: Of<'genkoyoshi'>, area: Rect): Op[] {
  const line = stroke(p.color, p.width);
  const ops: Op[] = [];
  const vertical = p.direction === 'vertical-rtl';

  // Columns run right-to-left for vertical Japanese text.
  const colCount = vertical ? p.columns : p.rows;
  const rowCount = vertical ? p.rows : p.columns;

  const totalGutter = p.gutter * (colCount - 1);
  const cellW = (area.w - totalGutter) / colCount;
  const cellH = area.h / rowCount;
  const cell = Math.min(cellW, cellH);
  if (cell <= 0.2) return [];

  // Centre the block of cells inside the area.
  const blockW = cell * colCount + totalGutter;
  const blockH = cell * rowCount;
  const originX = area.x + (area.w - blockW) / 2;
  const originY = area.y + (area.h - blockH) / 2;

  for (let c = 0; c < colCount; c++) {
    const x = originX + c * (cell + p.gutter);
    for (let r = 0; r < rowCount; r++) {
      const y = originY + r * cell;
      ops.push({ kind: 'rect', x, y, w: cell, h: cell, stroke: line });
    }
  }
  return ops;
}

/* ----------------------------------------------------------- dotted thirds */

function dottedThirds(p: Of<'dottedthirds'>, area: Rect, s: number, oy: number): Op[] {
  const band = p.bandHeight * s;
  const solid = stroke(p.color, p.width * s);
  const ops: Op[] = [];
  const count = Math.floor((area.h - oy) / band);

  for (let i = 0; i < count; i++) {
    const top = area.y + oy + i * band;
    const bottom = top + band;
    const mid = top + band / 2;
    ops.push(hLine(area, top, solid));
    ops.push(hLine(area, bottom, solid));
    ops.push(
      hLine(area, mid, stroke(p.color, p.width * s, { dash: [p.dotSpacing * s, p.dotSpacing * s] }))
    );
  }
  return ops;
}

/** Rough op count, used to warn before the designer renders something huge. */
export function estimateOpCount(pattern: Pattern, area: Rect): number {
  return renderPattern(pattern, area).length;
}
