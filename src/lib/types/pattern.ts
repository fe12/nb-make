import { z } from 'zod';
import { zColor } from './common';

/**
 * Background rulings. Each variant carries only the knobs that make sense for
 * it, which is what lets the designer render a meaningful control panel by
 * switching on `type` alone.
 *
 * All spacings are in millimetres and are *absolute* by default: a 5 mm dot
 * grid stays 5 mm whether the page is A4 or A6, which is what people actually
 * want from ruled paper. `scaleWithPage` opts into proportional behaviour.
 */

const mm = (min: number, max: number, def: number) =>
  z.number().min(min).max(max).default(def);

export const zPatternSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('blank') }),

  z.object({
    type: z.literal('ruled'),
    spacing: mm(2, 40, 7),
    color: zColor.default('#b9c6d4'),
    width: mm(0.02, 3, 0.2),
    dashed: z.boolean().default(false),
    /** Extra space before the first rule, measured from the top of the area. */
    topOffset: mm(0, 100, 0),
    marginRule: z
      .object({
        enabled: z.boolean().default(false),
        side: z.enum(['left', 'right', 'both']).default('left'),
        offset: mm(0, 100, 20),
        color: zColor.default('#e8a2a2'),
        width: mm(0.02, 3, 0.25),
      })
      .default({ enabled: false, side: 'left', offset: 20, color: '#e8a2a2', width: 0.25 }),
    headerRule: z
      .object({
        enabled: z.boolean().default(false),
        offset: mm(0, 100, 18),
        color: zColor.default('#e8a2a2'),
        width: mm(0.02, 3, 0.25),
      })
      .default({ enabled: false, offset: 18, color: '#e8a2a2', width: 0.25 }),
  }),

  z.object({
    type: z.literal('dots'),
    spacingX: mm(1, 40, 5),
    spacingY: mm(1, 40, 5),
    /** Dot diameter. */
    size: mm(0.05, 4, 0.5),
    color: zColor.default('#9fb3c8'),
    shape: z.enum(['round', 'square', 'cross']).default('round'),
  }),

  z.object({
    type: z.literal('grid'),
    spacingX: mm(1, 40, 5),
    spacingY: mm(1, 40, 5),
    color: zColor.default('#cfdae5'),
    width: mm(0.02, 3, 0.15),
  }),

  z.object({
    type: z.literal('graph'),
    minor: mm(0.5, 20, 2),
    majorEvery: z.number().int().min(2).max(20).default(5),
    minorColor: zColor.default('#dbe6f0'),
    majorColor: zColor.default('#a9bfd4'),
    minorWidth: mm(0.02, 2, 0.1),
    majorWidth: mm(0.02, 3, 0.22),
  }),

  z.object({
    type: z.literal('isometric'),
    spacing: mm(1, 30, 5),
    color: zColor.default('#cfdae5'),
    width: mm(0.02, 2, 0.15),
    showVerticals: z.boolean().default(true),
  }),

  z.object({
    type: z.literal('hexagon'),
    /** Circumradius of each hexagon. */
    size: mm(1, 40, 6),
    orientation: z.enum(['pointy', 'flat']).default('pointy'),
    color: zColor.default('#cfdae5'),
    width: mm(0.02, 2, 0.15),
  }),

  z.object({
    type: z.literal('triangle'),
    spacing: mm(1, 30, 8),
    color: zColor.default('#cfdae5'),
    width: mm(0.02, 2, 0.15),
  }),

  z.object({
    type: z.literal('polar'),
    rings: z.number().int().min(1).max(40).default(10),
    sectors: z.number().int().min(2).max(72).default(24),
    color: zColor.default('#cfdae5'),
    width: mm(0.02, 2, 0.15),
    axisColor: zColor.default('#8fa5ba'),
    axisWidth: mm(0.02, 2, 0.25),
  }),

  z.object({
    type: z.literal('logscale'),
    kind: z.enum(['semilog-x', 'semilog-y', 'loglog']).default('semilog-y'),
    decades: z.number().int().min(1).max(8).default(3),
    /** Linear divisions per unit on the non-logarithmic axis. */
    linearDivisions: z.number().int().min(2).max(50).default(10),
    color: zColor.default('#dbe6f0'),
    majorColor: zColor.default('#a9bfd4'),
    width: mm(0.02, 2, 0.1),
    majorWidth: mm(0.02, 2, 0.22),
  }),

  z.object({
    type: z.literal('music'),
    staves: z.number().int().min(1).max(20).default(10),
    /** Gap between the five lines of one staff. */
    lineSpacing: mm(1, 8, 2),
    /** Blank space between staves. */
    staffGap: mm(2, 60, 14),
    color: zColor.default('#5b6b7b'),
    width: mm(0.02, 2, 0.18),
  }),

  z.object({
    type: z.literal('tablature'),
    systems: z.number().int().min(1).max(16).default(8),
    strings: z.number().int().min(3).max(8).default(6),
    lineSpacing: mm(1, 10, 3),
    systemGap: mm(2, 60, 16),
    color: zColor.default('#5b6b7b'),
    width: mm(0.02, 2, 0.18),
  }),

  z.object({
    type: z.literal('handwriting'),
    /** Baseline-to-baseline distance of one writing band. */
    bandHeight: mm(4, 40, 12),
    /** x-height as a fraction of the band. */
    xHeightRatio: z.number().min(0.1).max(0.9).default(0.4),
    showAscender: z.boolean().default(true),
    showDescender: z.boolean().default(true),
    dashedMidline: z.boolean().default(true),
    baselineColor: zColor.default('#7f95aa'),
    guideColor: zColor.default('#cfdae5'),
    width: mm(0.02, 2, 0.18),
    slant: z
      .object({
        enabled: z.boolean().default(false),
        angleDeg: z.number().min(0).max(45).default(20),
        spacing: mm(3, 60, 15),
        color: zColor.default('#e3e9f0'),
      })
      .default({ enabled: false, angleDeg: 20, spacing: 15, color: '#e3e9f0' }),
  }),

  z.object({
    type: z.literal('seyes'),
    /** Height of one writing line; the classic French ruling is 8 mm. */
    unit: mm(4, 20, 8),
    subDivisions: z.number().int().min(2).max(8).default(4),
    verticalSpacing: mm(4, 40, 8),
    mainColor: zColor.default('#8fa5ba'),
    subColor: zColor.default('#d8e2ec'),
    verticalColor: zColor.default('#e0c4c4'),
    width: mm(0.02, 2, 0.15),
  }),

  z.object({
    type: z.literal('genkoyoshi'),
    columns: z.number().int().min(4).max(40).default(20),
    rows: z.number().int().min(4).max(40).default(20),
    /** Gutter between columns, for furigana. */
    gutter: mm(0, 8, 2),
    color: zColor.default('#c9b8b8'),
    width: mm(0.02, 2, 0.15),
    direction: z.enum(['vertical-rtl', 'horizontal-ltr']).default('vertical-rtl'),
  }),

  z.object({
    type: z.literal('dottedthirds'),
    bandHeight: mm(4, 40, 12),
    color: zColor.default('#9fb3c8'),
    width: mm(0.02, 2, 0.18),
    dotSpacing: mm(0.5, 6, 1.5),
  }),
]);

export type PatternSpec = z.infer<typeof zPatternSpec>;
export type PatternType = PatternSpec['type'];

export const zPattern = z.object({
  /** Whether the ruling fills the whole sheet or stops at the margins. */
  area: z.enum(['content', 'full']).default('content'),
  opacity: z.number().min(0).max(1).default(1),
  /** Centre the ruling in its area instead of anchoring to the top-left. */
  align: z.enum(['start', 'center']).default('start'),
  offsetX: z.number().min(-100).max(100).default(0),
  offsetY: z.number().min(-100).max(100).default(0),
  /** Scale spacings proportionally when the page differs from the design size. */
  scaleWithPage: z.boolean().default(false),
  spec: zPatternSpec,
});

export type Pattern = z.infer<typeof zPattern>;

export const PATTERN_LABELS: Record<PatternType, string> = {
  blank: 'Blank',
  ruled: 'Ruled / lined',
  dots: 'Dot grid',
  grid: 'Square grid',
  graph: 'Graph (major + minor)',
  isometric: 'Isometric',
  hexagon: 'Hexagonal',
  triangle: 'Triangular',
  polar: 'Polar',
  logscale: 'Logarithmic',
  music: 'Music staves',
  tablature: 'Guitar tablature',
  handwriting: 'Handwriting guides',
  seyes: 'Seyes (French ruled)',
  genkoyoshi: 'Genkō yōshi',
  dottedthirds: 'Dotted thirds',
};

export const PATTERN_TYPES = Object.keys(PATTERN_LABELS) as PatternType[];

/** A ready-to-use instance of each pattern, for the "add pattern" menu. */
export function defaultPatternSpec(type: PatternType): PatternSpec {
  return zPatternSpec.parse({ type } as never);
}

export function defaultPattern(type: PatternType = 'dots'): Pattern {
  return zPattern.parse({ spec: { type } });
}
