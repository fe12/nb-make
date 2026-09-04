import { z } from 'zod';
import { DEFAULT_PALETTE } from '../palette';
import { zAlign, zColor, zFont, zMargins, zPageSize } from './common';
import { zPageTemplate } from './page';

/**
 * A leaf in the notebook's running order: either N copies of a designed page,
 * or a parametric generator that expands into however many pages its
 * parameters imply (a year of calendars, a month of habit trackers, …).
 */
export const zLeafItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('template'),
    id: z.string(),
    templateId: z.string(),
    count: z.number().int().min(1).max(2000).default(1),
    label: z.string().default(''),
  }),
  z.object({
    kind: z.literal('parametric'),
    id: z.string(),
    generatorId: z.string(),
    /** Validated by the generator itself, not here. */
    params: z.record(z.string(), z.unknown()).default({}),
    /** Optional design to inherit margins/pattern/background from. */
    baseTemplateId: z.string().nullable().default(null),
    label: z.string().default(''),
  }),
]);

export type LeafItem = z.infer<typeof zLeafItem>;

/**
 * A repeated run of leaves. Modelling repetition here rather than by
 * duplicating leaves is what makes "20 × [dot grid, dot grid, ruled]" a
 * one-line edit instead of sixty entries.
 */
export const zContentItem = z.discriminatedUnion('kind', [
  ...zLeafItem.options,
  z.object({
    kind: z.literal('group'),
    id: z.string(),
    label: z.string().default('Section'),
    repeat: z.number().int().min(1).max(500).default(1),
    items: z.array(zLeafItem).default([]),
    /**
     * Steps dated generators forward once per repetition, so
     * `12 × [monthly calendar, …]` walks January to December instead of
     * printing the same month twelve times. Generators that are not dated are
     * unaffected and simply repeat.
     */
    advanceDates: z.boolean().default(false),
  }),
]);

export type ContentItem = z.infer<typeof zContentItem>;

export const zSlot = z.object({
  id: z.string(),
  /** Position in the fill order; pages are poured into slots by this index. */
  index: z.number().int().min(0),
  /** Millimetres on the output sheet, top-left origin. */
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  enabled: z.boolean().default(true),
});

export type Slot = z.infer<typeof zSlot>;

export const zImposition = z.object({
  /** The physical sheet that goes into the printer. */
  sheet: zPageSize,
  sheetMargins: zMargins,
  /**
   * `grid` and `booklet` regenerate slots from rows/cols; `manual` means the
   * user has dragged them and we must not clobber their arrangement.
   */
  mode: z.enum(['grid', 'booklet', 'cutstack', 'manual']).default('grid'),
  rows: z.number().int().min(1).max(12).default(2),
  cols: z.number().int().min(1).max(12).default(2),
  gutterX: z.number().min(0).max(100).default(0),
  gutterY: z.number().min(0).max(100).default(0),
  /**
   * Print bleed in millimetres: how far page-wide artwork (a full-page ruling,
   * the background) runs past the trim edge, so an imprecise cut never leaves a
   * bald strip. Imposition grows gutters and sheet margins to make room.
   */
  bleed: z.number().min(0).max(20).default(0),
  /** Rotate every slot, e.g. two A5 landscape pages on a portrait A4. */
  slotRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  /** Shrink pages to fit their slot when the trim size is larger. */
  scaleToFit: z.boolean().default(true),
  /** Extra manual scale applied on top, 1 = none. */
  extraScale: z.number().min(0.1).max(3).default(1),
  duplex: z.boolean().default(false),
  /** Mirror slot order on the reverse so long-edge duplex lines up. */
  mirrorBackSide: z.boolean().default(true),
  bindingEdge: z.enum(['left', 'top']).default('left'),
  slots: z.array(zSlot).default([]),
  cropMarks: z
    .object({
      enabled: z.boolean().default(false),
      length: z.number().min(1).max(20).default(4),
      offset: z.number().min(0).max(20).default(1.5),
      color: zColor.default('#000000'),
      width: z.number().min(0.02).max(2).default(0.15),
    })
    .default({ enabled: false, length: 4, offset: 1.5, color: '#000000', width: 0.15 }),
  foldMarks: z.boolean().default(false),
  pageBorder: z
    .object({
      enabled: z.boolean().default(false),
      color: zColor.default('#c8d4e0'),
      width: z.number().min(0.02).max(2).default(0.15),
    })
    .default({ enabled: false, color: '#c8d4e0', width: 0.15 }),
  /** Fill unused slots on the last sheet rather than leaving them empty. */
  padWith: z.enum(['blank', 'none']).default('blank'),
  showSlotNumbers: z.boolean().default(false),
});

export const zOutput = z.object({
  fileName: z.string().default('notebook'),
  title: z.string().default(''),
  author: z.string().default(''),
  pageNumbering: z
    .object({
      enabled: z.boolean().default(false),
      /** `{n}` and `{total}` are substituted. */
      format: z.string().default('{n}'),
      startAt: z.number().int().min(0).max(10000).default(1),
      /** Skip numbering the first N pages (covers, title pages). */
      skipFirst: z.number().int().min(0).max(100).default(0),
      position: z
        .enum([
          'bottom-center',
          'bottom-outer',
          'bottom-inner',
          'bottom-left',
          'bottom-right',
          'top-center',
          'top-outer',
        ])
        .default('bottom-center'),
      margin: z.number().min(0).max(60).default(8),
      font: zFont.default({ family: 'helvetica', bold: false, italic: false }),
      size: z.number().min(1).max(20).default(3),
      color: zColor.default('#8fa5ba'),
      align: zAlign.default('center'),
    })
    .default({
      enabled: false,
      format: '{n}',
      startAt: 1,
      skipFirst: 0,
      position: 'bottom-center',
      margin: 8,
      font: { family: 'helvetica', bold: false, italic: false },
      size: 3,
      color: '#8fa5ba',
      align: 'center',
    }),
});

export type Imposition = z.infer<typeof zImposition>;
export type Output = z.infer<typeof zOutput>;

export const zNotebook = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).default('Untitled notebook'),
  description: z.string().default(''),
  /** Finished (trim) size of a single notebook page. */
  pageSize: zPageSize,
  margins: zMargins,
  /**
   * Colours the pages are drawn with. Blocks, rulings and generators reference
   * these by role, so editing the palette restyles the whole notebook.
   */
  palette: z
    .object({
      primary: zColor,
      secondary: zColor,
      secondaryAlt: zColor,
      accent: zColor,
    })
    .default(DEFAULT_PALETTE),
  templates: z.array(zPageTemplate).default([]),
  content: z.array(zContentItem).default([]),
  imposition: zImposition,
  output: zOutput,
  /**
   * Derived counts, cached on save. Expanding the running order means running
   * every generator, which is too slow to redo for each row of the dashboard —
   * and a stale count here is only ever cosmetic.
   */
  stats: z
    .object({
      pageCount: z.number().int().min(0),
      sheetCount: z.number().int().min(0),
      computedAt: z.string(),
    })
    .nullable()
    .default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Notebook = z.infer<typeof zNotebook>;

/** Trimmed-down shape used by the dashboard listing. */
export interface NotebookSummary {
  id: string;
  name: string;
  description: string;
  pageSizeLabel: string;
  pageCount: number;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}
