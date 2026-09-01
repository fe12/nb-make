/**
 * The drawing IR.
 *
 * Every page — pattern, preset, LaTeX block, image, calendar — is compiled down
 * to a flat-ish tree of these ops. Two backends consume the tree: `svg.ts` for
 * the in-browser preview and `pdf.ts` for export. Because both read the same
 * ops, what you see in the designer is what lands in the PDF.
 *
 * Coordinates are millimetres, origin top-left, Y increasing downward.
 */

export interface Stroke {
  color: string;
  /** Line width in mm. */
  width: number;
  /** Dash pattern in mm. */
  dash?: number[];
  opacity?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export interface Fill {
  color: string;
  opacity?: number;
}

export type FontFamily = 'helvetica' | 'times' | 'courier';

export interface FontSpec {
  family: FontFamily;
  bold?: boolean;
  italic?: boolean;
}

export const defaultFont = (): FontSpec => ({ family: 'helvetica' });

export type TextAlign = 'left' | 'center' | 'right';
/** `alphabetic` puts the anchor on the baseline, as in SVG/PDF. */
export type TextBaseline = 'alphabetic' | 'top' | 'middle' | 'bottom';

/**
 * Affine transform, SVG's `matrix(a b c d e f)` convention:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const translate = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];

export const scaleM = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];

export function rotateM(degrees: number, cx = 0, cy = 0): Matrix {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // translate(cx,cy) · rotate(r) · translate(-cx,-cy)
  return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
}

/** Matrix product `m1 · m2` — m2 is applied first, then m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor implied by a matrix — used to scale stroke widths. */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/** True when a matrix has no rotation or skew, so rects stay rects. */
export function isAxisAligned(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
}

/** Rotation in degrees, assuming a rotation+uniform-scale+translate matrix. */
export function matrixRotation(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

export interface LineOp {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Stroke;
}

export interface RectOp {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius in mm. */
  radius?: number;
  fill?: Fill;
  stroke?: Stroke;
}

export interface EllipseOp {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PolylineOp {
  kind: 'polyline';
  /** Flat `[x0, y0, x1, y1, ...]` list. */
  points: number[];
  closed?: boolean;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PathOp {
  kind: 'path';
  /** SVG path data, in mm. */
  d: string;
  fill?: Fill;
  stroke?: Stroke;
  fillRule?: 'nonzero' | 'evenodd';
}

export interface TextOp {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  font: FontSpec;
  /** Font size in mm (not points) so it scales with the rest of the geometry. */
  size: number;
  color: string;
  opacity?: number;
  align?: TextAlign;
  baseline?: TextBaseline;
  /** Clockwise degrees about the anchor point. */
  rotate?: number;
  /** Extra spacing between characters, in mm. */
  letterSpacing?: number;
}

export interface ImageOp {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Asset id resolved by the renderer against the asset store. */
  assetId: string;
  opacity?: number;
  rotate?: number;
}

export interface GroupOp {
  kind: 'group';
  ops: Op[];
  matrix?: Matrix;
  opacity?: number;
  /** Axis-aligned clip applied in the group's *own* coordinate space. */
  clip?: { x: number; y: number; w: number; h: number };
}

export type Op =
  | LineOp
  | RectOp
  | EllipseOp
  | PolylineOp
  | PathOp
  | TextOp
  | ImageOp
  | GroupOp;

export const group = (ops: Op[], matrix?: Matrix): GroupOp => ({ kind: 'group', ops, matrix });

/** Collects every asset id referenced anywhere in a tree. */
export function collectAssetIds(ops: Op[], into = new Set<string>()): Set<string> {
  for (const op of ops) {
    if (op.kind === 'image') into.add(op.assetId);
    else if (op.kind === 'group') collectAssetIds(op.ops, into);
  }
  return into;
}

/**
 * Pushes group matrices down into leaf ops, producing a tree whose groups carry
 * only clips and opacity. The PDF backend wants this: pdf-lib's text and image
 * primitives take their own rotation/scale arguments rather than inheriting a
 * CTM cleanly, so resolving transforms in software avoids a whole class of
 * mirrored-text bugs.
 */
export function flatten(ops: Op[], parent: Matrix = IDENTITY): Op[] {
  const out: Op[] = [];
  for (const op of ops) out.push(...flattenOp(op, parent));
  return out;
}

function flattenOp(op: Op, m: Matrix): Op[] {
  const s = matrixScale(m);

  switch (op.kind) {
    case 'group': {
      const next = op.matrix ? multiply(m, op.matrix) : m;
      const inner = flatten(op.ops, next);
      // A clip is expressed in the group's own space, so it has to stay a group.
      if (op.clip || op.opacity !== undefined) {
        const [cx, cy] = op.clip ? applyMatrix(next, op.clip.x, op.clip.y) : [0, 0];
        return [
          {
            kind: 'group',
            ops: inner,
            opacity: op.opacity,
            clip: op.clip
              ? { x: cx, y: cy, w: op.clip.w * s, h: op.clip.h * s }
              : undefined,
          },
        ];
      }
      return inner;
    }

    case 'line': {
      const [x1, y1] = applyMatrix(m, op.x1, op.y1);
      const [x2, y2] = applyMatrix(m, op.x2, op.y2);
      return [{ ...op, x1, y1, x2, y2, stroke: scaleStroke(op.stroke, s) }];
    }

    case 'rect': {
      if (isAxisAligned(m)) {
        const [x, y] = applyMatrix(m, op.x, op.y);
        const w = op.w * m[0];
        const h = op.h * m[3];
        return [
          {
            ...op,
            // A negative scale flips the rect; normalise back to positive extents.
            x: w < 0 ? x + w : x,
            y: h < 0 ? y + h : y,
            w: Math.abs(w),
            h: Math.abs(h),
            radius: op.radius === undefined ? undefined : op.radius * s,
            stroke: op.stroke && scaleStroke(op.stroke, s),
          },
        ];
      }
      // Rotated: degrade to a polygon so the backends never see a skewed rect.
      const corners: number[] = [];
      for (const [px, py] of [
        [op.x, op.y],
        [op.x + op.w, op.y],
        [op.x + op.w, op.y + op.h],
        [op.x, op.y + op.h],
      ] as const) {
        corners.push(...applyMatrix(m, px, py));
      }
      return [
        {
          kind: 'polyline',
          points: corners,
          closed: true,
          fill: op.fill,
          stroke: op.stroke && scaleStroke(op.stroke, s),
        },
      ];
    }

    case 'ellipse': {
      const [cx, cy] = applyMatrix(m, op.cx, op.cy);
      return [
        {
          ...op,
          cx,
          cy,
          rx: op.rx * s,
          ry: op.ry * s,
          stroke: op.stroke && scaleStroke(op.stroke, s),
        },
      ];
    }

    case 'polyline': {
      const pts: number[] = [];
      for (let i = 0; i < op.points.length; i += 2) {
        pts.push(...applyMatrix(m, op.points[i], op.points[i + 1]));
      }
      return [{ ...op, points: pts, stroke: op.stroke && scaleStroke(op.stroke, s) }];
    }

    case 'path': {
      return [
        {
          ...op,
          d: transformPathData(op.d, m),
          stroke: op.stroke && scaleStroke(op.stroke, s),
        },
      ];
    }

    case 'text': {
      const [x, y] = applyMatrix(m, op.x, op.y);
      return [
        {
          ...op,
          x,
          y,
          size: op.size * s,
          letterSpacing: op.letterSpacing === undefined ? undefined : op.letterSpacing * s,
          rotate: (op.rotate ?? 0) + matrixRotation(m),
        },
      ];
    }

    case 'image': {
      const [x, y] = applyMatrix(m, op.x, op.y);
      return [
        {
          ...op,
          x,
          y,
          w: op.w * s,
          h: op.h * s,
          rotate: (op.rotate ?? 0) + matrixRotation(m),
        },
      ];
    }
  }
}

function scaleStroke(stroke: Stroke, s: number): Stroke {
  if (s === 1) return stroke;
  return {
    ...stroke,
    width: stroke.width * s,
    dash: stroke.dash?.map((d) => d * s),
  };
}

/**
 * Applies a matrix to SVG path data. Handles the absolute command subset that
 * our own generators and the MathJax importer emit — relative commands are
 * converted to absolute first by `normalizePathData`.
 */
export function transformPathData(d: string, m: Matrix): string {
  if (m === IDENTITY) return d;
  const s = matrixScale(m);
  const tokens = tokenizePath(d);
  const out: string[] = [];

  for (const { cmd, args } of tokens) {
    switch (cmd) {
      case 'M':
      case 'L':
      case 'T': {
        out.push(cmd);
        for (let i = 0; i < args.length; i += 2) {
          out.push(...applyMatrix(m, args[i], args[i + 1]).map(fmt));
        }
        break;
      }
      case 'C':
      case 'S':
      case 'Q': {
        out.push(cmd);
        for (let i = 0; i < args.length; i += 2) {
          out.push(...applyMatrix(m, args[i], args[i + 1]).map(fmt));
        }
        break;
      }
      case 'H': {
        // Horizontal lines stop being horizontal under rotation, so they are
        // not representable without the current point. `normalizePathData`
        // removes them before we get here.
        out.push('H', ...args.map((a) => fmt(m[0] * a + m[4])));
        break;
      }
      case 'V': {
        out.push('V', ...args.map((a) => fmt(m[3] * a + m[5])));
        break;
      }
      case 'A': {
        // rx ry rot large sweep x y
        for (let i = 0; i < args.length; i += 7) {
          const [x, y] = applyMatrix(m, args[i + 5], args[i + 6]);
          out.push(
            'A',
            fmt(args[i] * s),
            fmt(args[i + 1] * s),
            fmt(args[i + 2] + matrixRotation(m)),
            String(args[i + 3]),
            String(args[i + 4]),
            fmt(x),
            fmt(y)
          );
        }
        break;
      }
      case 'Z':
        out.push('Z');
        break;
      default:
        break;
    }
  }
  return out.join(' ');
}

interface PathToken {
  cmd: string;
  args: number[];
}

/** Splits path data into absolute-command tokens. */
export function tokenizePath(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let match: RegExpExecArray | null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  while ((match = re.exec(d)) !== null) {
    const raw = match[1];
    const cmd = raw.toUpperCase();
    const relative = raw !== cmd;
    const args = (match[2].match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);

    if (cmd === 'Z') {
      tokens.push({ cmd: 'Z', args: [] });
      cx = startX;
      cy = startY;
      continue;
    }

    const arity = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[cmd] ?? 2;
    for (let i = 0; i + arity <= args.length; i += arity) {
      const chunk = args.slice(i, i + arity);
      let abs: number[];

      switch (cmd) {
        case 'H':
          abs = [relative ? cx + chunk[0] : chunk[0]];
          cx = abs[0];
          break;
        case 'V':
          abs = [relative ? cy + chunk[0] : chunk[0]];
          cy = abs[0];
          break;
        case 'A':
          abs = [
            chunk[0],
            chunk[1],
            chunk[2],
            chunk[3],
            chunk[4],
            relative ? cx + chunk[5] : chunk[5],
            relative ? cy + chunk[6] : chunk[6],
          ];
          cx = abs[5];
          cy = abs[6];
          break;
        default: {
          abs = chunk.map((v, j) => (relative ? (j % 2 === 0 ? cx + v : cy + v) : v));
          cx = abs[abs.length - 2];
          cy = abs[abs.length - 1];
        }
      }

      // Implicit repeats after an `M` are line-tos, per the SVG spec.
      const emitted = i > 0 && cmd === 'M' ? 'L' : cmd;
      tokens.push({ cmd: emitted, args: abs });

      if (cmd === 'M' && i === 0) {
        startX = cx;
        startY = cy;
      }
    }
  }
  return tokens;
}

/**
 * Rewrites path data into absolute commands, expanding H/V into L so that any
 * later transform can rotate them safely.
 */
export function normalizePathData(d: string): string {
  const tokens = tokenizePath(d);
  const out: string[] = [];
  let cx = 0;
  let cy = 0;

  for (const { cmd, args } of tokens) {
    if (cmd === 'H') {
      cx = args[0];
      out.push('L', fmt(cx), fmt(cy));
    } else if (cmd === 'V') {
      cy = args[0];
      out.push('L', fmt(cx), fmt(cy));
    } else if (cmd === 'Z') {
      out.push('Z');
    } else {
      out.push(cmd, ...args.map(fmt));
      if (cmd !== 'A') {
        cx = args[args.length - 2];
        cy = args[args.length - 1];
      } else {
        cx = args[5];
        cy = args[6];
      }
    }
  }
  return out.join(' ');
}

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export { fmt as formatNumber };
