/**
 * Unit handling.
 *
 * The whole application works in **millimetres** with a top-left origin and a
 * downward Y axis (screen conventions). Conversion to PostScript points and the
 * PDF's bottom-left origin happens once, at the moment we emit the PDF. Keeping
 * a single internal unit is what lets the SVG preview and the PDF renderer share
 * their geometry code verbatim.
 */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt: number): number => (pt * MM_PER_INCH) / PT_PER_INCH;
export const mmToIn = (mm: number): number => mm / MM_PER_INCH;
export const inToMm = (inch: number): number => inch * MM_PER_INCH;

/** Pixels at a given DPI — used for rasterising image placement decisions. */
export const mmToPx = (mm: number, dpi = 96): number => (mm / MM_PER_INCH) * dpi;
export const pxToMm = (px: number, dpi = 96): number => (px / dpi) * MM_PER_INCH;

export interface Size {
  /** width in mm */
  w: number;
  /** height in mm */
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const uniformMargins = (mm: number): Margins => ({
  top: mm,
  right: mm,
  bottom: mm,
  left: mm,
});

/** Named stock sizes, all portrait (w < h), in mm. */
export const PAPER_SIZES = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  A7: { w: 74, h: 105 },
  A8: { w: 52, h: 74 },
  B5: { w: 176, h: 250 },
  B6: { w: 125, h: 176 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  Executive: { w: 184.15, h: 266.7 },
  Pocket: { w: 89, h: 140 },
  Travelers: { w: 110, h: 210 },
  HalfLetter: { w: 139.7, h: 215.9 },
  Index3x5: { w: 76.2, h: 127 },
  Square: { w: 148, h: 148 },
} as const satisfies Record<string, Size>;

export type PaperName = keyof typeof PAPER_SIZES;

/** Non-empty tuples, so `z.enum` can consume them without a cast. */
export const PAPER_NAMES = Object.keys(PAPER_SIZES) as [PaperName, ...PaperName[]];

export type PageSizeName = PaperName | 'Custom';

export const PAGE_SIZE_NAMES = [...PAPER_NAMES, 'Custom'] as [
  PageSizeName,
  ...PageSizeName[],
];

export type Orientation = 'portrait' | 'landscape';

/** Applies an orientation to a stock size. */
export function orient(size: Size, orientation: Orientation): Size {
  return orientation === 'landscape' ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
}

/**
 * Resolves a page-size specification to concrete millimetres. `custom` carries
 * its own dimensions; named sizes are looked up and then oriented.
 */
export function resolvePageSize(spec: PageSizeSpec): Size {
  const base = spec.name === 'Custom' ? { w: spec.width, h: spec.height } : PAPER_SIZES[spec.name];
  return orient(base, spec.orientation);
}

export interface PageSizeSpec {
  name: PageSizeName;
  orientation: Orientation;
  /** Only meaningful when `name === 'Custom'`. */
  width: number;
  height: number;
}

export const defaultPageSize = (
  name: PaperName = 'A5',
  orientation: Orientation = 'portrait'
): PageSizeSpec => ({
  name,
  orientation,
  width: PAPER_SIZES[name].w,
  height: PAPER_SIZES[name].h,
});

/** The drawable box remaining after margins are removed. */
export function contentRect(size: Size, margins: Margins): Rect {
  return {
    x: margins.left,
    y: margins.top,
    w: Math.max(0, size.w - margins.left - margins.right),
    h: Math.max(0, size.h - margins.top - margins.bottom),
  };
}

/** Largest uniform scale that fits `inner` inside `outer`. */
export function fitScale(inner: Size, outer: Size): number {
  if (inner.w <= 0 || inner.h <= 0) return 1;
  return Math.min(outer.w / inner.w, outer.h / inner.h);
}

export const roundTo = (value: number, decimals = 3): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
