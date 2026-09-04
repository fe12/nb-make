import { z } from 'zod';
import { zAlign, zColor, zFont, zMargins, zPageSize, zRelRect, zVAlign } from './common';
import { zPattern } from './pattern';

/**
 * Block contents. A block is a rectangle on the page (in content-box fractions)
 * plus one of these payloads.
 */
export const zBlockContent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().default(''),
    font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
    /** Font size in millimetres, so it lives in the same space as the geometry. */
    size: z.number().min(0.5).max(80).default(4),
    color: zColor.default('#1c2733'),
    align: zAlign.default('left'),
    valign: zVAlign.default('top'),
    lineHeight: z.number().min(0.6).max(4).default(1.35),
    letterSpacing: z.number().min(-1).max(5).default(0),
    /** Shrink the type until the text fits its box. */
    autoFit: z.boolean().default(false),
  }),

  z.object({
    type: z.literal('latex'),
    source: z.string().default(''),
    /**
     * `math` treats the whole source as one formula. `mixed` flows prose and
     * lets `$…$` / `$$…$$` fall through to the maths renderer.
     */
    mode: z.enum(['math', 'mixed']).default('mixed'),
    font: zFont.default({ family: 'times', bold: false, italic: false }),
    size: z.number().min(0.5).max(60).default(3.8),
    color: zColor.default('#1c2733'),
    align: zAlign.default('left'),
    valign: zVAlign.default('top'),
    lineHeight: z.number().min(0.6).max(4).default(1.5),
    /**
     * How the rendered block reacts when the target page is a different size
     * from the one it was written for:
     *  - `reflow` re-wraps prose at the new width and keeps the type size
     *  - `scale`  shrinks the whole block uniformly to fit
     *  - `both`   reflows, then scales down if it still overflows
     */
    fit: z.enum(['reflow', 'scale', 'both']).default('both'),
  }),

  z.object({
    type: z.literal('image'),
    assetId: z.string().default(''),
    fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
    align: zAlign.default('center'),
    valign: zVAlign.default('middle'),
    opacity: z.number().min(0).max(1).default(1),
    /** Draw the image at a reduced opacity as a tracing guide. */
    grayscale: z.boolean().default(false),
  }),

  z.object({
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'line', 'triangle']).default('rect'),
    fill: zColor.optional(),
    stroke: zColor.default('#4a5b6d'),
    strokeWidth: z.number().min(0).max(10).default(0.3),
    radius: z.number().min(0).max(50).default(0),
    dashed: z.boolean().default(false),
  }),

  z.object({
    type: z.literal('pattern'),
    pattern: zPattern,
    /** Optional frame around the patterned area. */
    border: z
      .object({
        enabled: z.boolean().default(false),
        color: zColor.default('#9fb3c8'),
        width: z.number().min(0).max(5).default(0.25),
        radius: z.number().min(0).max(30).default(0),
      })
      .default({ enabled: false, color: '#9fb3c8', width: 0.25, radius: 0 }),
  }),

  z.object({
    /** Cartesian graph with numbered axes, designed for plotting by hand. */
    type: z.literal('graph'),
    xMax: z.number().int().min(1).max(100).default(30),
    yMax: z.number().int().min(1).max(100).default(13),
    xLabelEvery: z.number().int().min(1).max(100).default(1),
    yLabelEvery: z.number().int().min(1).max(100).default(1),
    showGrid: z.boolean().default(true),
    showLabels: z.boolean().default(true),
    showArrows: z.boolean().default(true),
    gridColor: zColor.default('#9aa3ad'),
    gridWidth: z.number().min(0.02).max(3).default(0.15),
    axisColor: zColor.default('#1c2733'),
    axisWidth: z.number().min(0.02).max(3).default(0.28),
    labelColor: zColor.default('#1c2733'),
    labelSize: z.number().min(0.8).max(12).default(2.1),
  }),

  z.object({
    type: z.literal('table'),
    columns: z
      .array(
        z.object({
          label: z.string().default(''),
          /** Relative width; columns are normalised against their sum. */
          weight: z.number().min(0.05).max(20).default(1),
          align: zAlign.default('left'),
        })
      )
      .default([]),
    rows: z.number().int().min(0).max(200).default(12),
    headerHeight: z.number().min(0).max(40).default(7),
    rowHeight: z.number().min(1).max(60).default(7),
    /** Let rows grow to fill the block height instead of using `rowHeight`. */
    fillHeight: z.boolean().default(true),
    font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
    size: z.number().min(0.5).max(30).default(3),
    color: zColor.default('#1c2733'),
    lineColor: zColor.default('#b9c6d4'),
    lineWidth: z.number().min(0).max(4).default(0.2),
    headerFill: zColor.default('#eef3f8'),
    zebraFill: zColor.optional(),
    outerBorder: z.boolean().default(true),
    verticalRules: z.boolean().default(true),
  }),

  z.object({
    type: z.literal('fields'),
    /** Label + write-on rule pairs, e.g. "Date ____". */
    items: z.array(z.string()).default(['Date', 'Topic']),
    columns: z.number().int().min(1).max(6).default(1),
    font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
    size: z.number().min(0.5).max(30).default(3.2),
    color: zColor.default('#5b6b7b'),
    lineColor: zColor.default('#b9c6d4'),
    lineWidth: z.number().min(0).max(4).default(0.2),
    gap: z.number().min(0).max(40).default(2),
  }),

  z.object({
    type: z.literal('checklist'),
    items: z.array(z.string()).default([]),
    /** Rows drawn beyond `items`, left empty to fill in by hand. */
    blankRows: z.number().int().min(0).max(100).default(10),
    boxSize: z.number().min(1).max(20).default(3.5),
    boxShape: z.enum(['square', 'circle']).default('square'),
    rowHeight: z.number().min(2).max(40).default(7),
    font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
    size: z.number().min(0.5).max(30).default(3.2),
    color: zColor.default('#1c2733'),
    lineColor: zColor.default('#c8d4e0'),
    showRule: z.boolean().default(true),
  }),

  z.object({
    type: z.literal('pagenumber'),
    /** `{n}` page number, `{total}` count, `{title}` notebook name. */
    format: z.string().default('{n}'),
    font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
    size: z.number().min(0.5).max(30).default(3),
    color: zColor.default('#8fa5ba'),
    align: zAlign.default('center'),
  }),
]);

export type BlockContent = z.infer<typeof zBlockContent>;
export type BlockType = BlockContent['type'];

export const zBlock = z.object({
  id: z.string(),
  name: z.string().default(''),
  rect: zRelRect,
  /** Clockwise degrees about the block centre. */
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** Inner padding in mm, applied inside the block rect. */
  padding: z.number().min(0).max(50).default(0),
  background: zColor.optional(),
  content: zBlockContent,
});

export type Block = z.infer<typeof zBlock>;

export const zPageTemplate = z.object({
  id: z.string(),
  name: z.string().default('Untitled page'),
  description: z.string().default(''),
  /** Copied from a built-in preset; kept for provenance in the UI. */
  presetId: z.string().optional(),
  /**
   * Overrides the notebook page size. Almost always null — pages normally
   * inherit the notebook so a whole notebook can be retargeted at once.
   */
  sizeOverride: zPageSize.nullable().default(null),
  marginsOverride: zMargins.nullable().default(null),
  background: zColor.nullable().default(null),
  pattern: zPattern,
  blocks: z.array(zBlock).default([]),
  /**
   * The page-library entry this design is linked to, if any. Set when the
   * design was inserted from the library or saved to it, so "Save to library"
   * updates that entry instead of piling up copies. Deliberately not part of
   * the visual design: it is provenance, like `presetId`.
   */
  libraryId: z.string().optional(),
  /**
   * The page size this template's proportions were designed against. Used to
   * decide type scaling when it is rendered at another size.
   */
  authoredFor: zPageSize,
  /**
   * `fixed` keeps millimetre type sizes as authored; `proportional` scales them
   * by the linear ratio between the design size and the render size.
   */
  typeScale: z.enum(['fixed', 'proportional']).default('proportional'),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type PageTemplate = z.infer<typeof zPageTemplate>;

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Text',
  latex: 'LaTeX',
  image: 'Image',
  shape: 'Shape',
  pattern: 'Pattern area',
  graph: 'Graph',
  table: 'Table',
  fields: 'Labelled fields',
  checklist: 'Checklist',
  pagenumber: 'Page number',
};

export const BLOCK_TYPES = Object.keys(BLOCK_LABELS) as BlockType[];

export function defaultBlockContent(type: BlockType): BlockContent {
  const seed: Record<BlockType, unknown> = {
    text: { type: 'text', text: 'Heading' },
    latex: { type: 'latex', source: 'The quadratic roots are $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$.' },
    image: { type: 'image' },
    shape: { type: 'shape' },
    pattern: { type: 'pattern', pattern: { spec: { type: 'dots' } } },
    graph: { type: 'graph' },
    table: {
      type: 'table',
      columns: [
        { label: 'Item', weight: 3 },
        { label: 'Notes', weight: 5 },
        { label: 'Done', weight: 1 },
      ],
    },
    fields: { type: 'fields' },
    checklist: { type: 'checklist' },
    pagenumber: { type: 'pagenumber' },
  };
  return zBlockContent.parse(seed[type]);
}
