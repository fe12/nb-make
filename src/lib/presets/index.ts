/**
 * Built-in page presets.
 *
 * A preset is a *recipe*, not a stored record: choosing one copies a fully
 * editable `PageTemplate` into the notebook. Nothing stays linked back here, so
 * upgrading the app can never mutate a design someone has already tuned.
 */
import { newId } from '../ids';
import type { Block, PageTemplate } from '../types/page';
import { zPageTemplate, defaultBlockContent } from '../types/page';
import { zPattern, type PatternSpec } from '../types/pattern';
import type { PageSizeSpec } from '../units';

export interface PresetContext {
  pageSize: PageSizeSpec;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  category: 'Plain' | 'Ruled' | 'Grids' | 'Specialist' | 'Composite';
  build(ctx: PresetContext): PageTemplate;
}

/** Builds a template from a pattern spec plus optional blocks. */
function template(
  ctx: PresetContext,
  name: string,
  spec: PatternSpec,
  extra: {
    presetId: string;
    description?: string;
    blocks?: Block[];
    area?: 'content' | 'full';
    background?: string | null;
  }
): PageTemplate {
  return zPageTemplate.parse({
    id: newId('tpl'),
    name,
    description: extra.description ?? '',
    presetId: extra.presetId,
    sizeOverride: null,
    marginsOverride: null,
    background: extra.background ?? null,
    pattern: zPattern.parse({ spec, area: extra.area ?? 'content' }),
    blocks: extra.blocks ?? [],
    authoredFor: ctx.pageSize,
    typeScale: 'proportional',
  });
}

const block = (
  rect: { x: number; y: number; w: number; h: number },
  content: Block['content'],
  overrides: Partial<Block> = {}
): Block => ({
  id: newId('blk'),
  name: '',
  rect,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  padding: 0,
  content,
  ...overrides,
});

const patternPreset = (
  id: string,
  name: string,
  description: string,
  category: Preset['category'],
  spec: PatternSpec,
  area: 'content' | 'full' = 'content'
): Preset => ({
  id,
  name,
  description,
  category,
  build: (ctx) => template(ctx, name, spec, { presetId: id, description, area }),
});

export const PRESETS: Preset[] = [
  patternPreset('blank', 'Blank', 'Nothing at all — a clean page.', 'Plain', { type: 'blank' }),

  patternPreset(
    'ruled-7',
    'Ruled 7 mm',
    'Standard lined paper.',
    'Ruled',
    { type: 'ruled', spacing: 7, color: 'theme:secondary', width: 0.2, dashed: false, topOffset: 0,
      marginRule: { enabled: false, side: 'left', offset: 20, color: 'theme:accent', width: 0.25 },
      headerRule: { enabled: false, offset: 18, color: 'theme:accent', width: 0.25 } }
  ),

  patternPreset(
    'ruled-margin',
    'Ruled with margin',
    'Lined paper with a red margin rule and a header line.',
    'Ruled',
    { type: 'ruled', spacing: 8, color: 'theme:secondary', width: 0.2, dashed: false, topOffset: 0,
      marginRule: { enabled: true, side: 'left', offset: 22, color: 'theme:accent', width: 0.3 },
      headerRule: { enabled: true, offset: 16, color: 'theme:accent', width: 0.3 } },
    'full'
  ),

  patternPreset(
    'dots-5',
    'Dot grid 5 mm',
    'The bullet-journal default.',
    'Grids',
    { type: 'dots', spacingX: 5, spacingY: 5, size: 0.5, color: 'theme:secondary', shape: 'round' }
  ),

  patternPreset(
    'dots-35',
    'Dot grid 3.5 mm',
    'A finer dot grid for small pages.',
    'Grids',
    { type: 'dots', spacingX: 3.5, spacingY: 3.5, size: 0.4, color: 'theme:secondary', shape: 'round' }
  ),

  patternPreset(
    'grid-5',
    'Square grid 5 mm',
    'Plain squared paper.',
    'Grids',
    { type: 'grid', spacingX: 5, spacingY: 5, color: 'theme:secondaryAlt', width: 0.15 }
  ),

  patternPreset(
    'graph-2-10',
    'Graph 2 mm / 10 mm',
    'Fine graph paper with emphasised centimetre lines.',
    'Grids',
    { type: 'graph', minor: 2, majorEvery: 5, minorColor: 'theme:secondaryAlt', majorColor: 'theme:accent', minorWidth: 0.1, majorWidth: 0.22 }
  ),

  patternPreset(
    'isometric',
    'Isometric',
    'Triangular grid for 3D sketching.',
    'Grids',
    { type: 'isometric', spacing: 5, color: 'theme:secondaryAlt', width: 0.15, showVerticals: true }
  ),

  patternPreset(
    'hexagon',
    'Hexagonal',
    'Hex grid for maps and organic chemistry.',
    'Grids',
    { type: 'hexagon', size: 6, orientation: 'pointy', color: 'theme:secondaryAlt', width: 0.15 }
  ),

  patternPreset(
    'triangle',
    'Triangular',
    'Equilateral triangle grid.',
    'Grids',
    { type: 'triangle', spacing: 8, color: 'theme:secondaryAlt', width: 0.15 }
  ),

  patternPreset(
    'polar',
    'Polar',
    'Concentric rings and radial spokes.',
    'Specialist',
    { type: 'polar', rings: 10, sectors: 24, color: 'theme:secondaryAlt', width: 0.15, axisColor: 'theme:secondary', axisWidth: 0.25 }
  ),

  patternPreset(
    'semilog',
    'Semi-log',
    'Logarithmic vertical axis, linear horizontal.',
    'Specialist',
    { type: 'logscale', kind: 'semilog-y', decades: 3, linearDivisions: 10, color: 'theme:secondaryAlt', majorColor: 'theme:accent', width: 0.1, majorWidth: 0.22 }
  ),

  patternPreset(
    'music',
    'Music staves',
    'Five-line staves for manuscript.',
    'Specialist',
    { type: 'music', staves: 10, lineSpacing: 2, staffGap: 14, color: 'theme:secondary', width: 0.18 }
  ),

  patternPreset(
    'tab',
    'Guitar tablature',
    'Six-string tab systems.',
    'Specialist',
    { type: 'tablature', systems: 8, strings: 6, lineSpacing: 3, systemGap: 16, color: 'theme:secondary', width: 0.18 }
  ),

  patternPreset(
    'handwriting',
    'Handwriting guides',
    'Ascender, midline and baseline bands for practice.',
    'Ruled',
    { type: 'handwriting', bandHeight: 12, xHeightRatio: 0.4, showAscender: true, showDescender: true,
      dashedMidline: true, baselineColor: 'theme:secondary', guideColor: 'theme:secondaryAlt', width: 0.18,
      slant: { enabled: false, angleDeg: 20, spacing: 15, color: 'theme:secondaryAlt' } }
  ),

  patternPreset(
    'calligraphy',
    'Calligraphy slant',
    'Writing bands with slant guides for italic hands.',
    'Ruled',
    { type: 'handwriting', bandHeight: 14, xHeightRatio: 0.42, showAscender: true, showDescender: true,
      dashedMidline: false, baselineColor: 'theme:secondary', guideColor: 'theme:secondaryAlt', width: 0.16,
      slant: { enabled: true, angleDeg: 22, spacing: 12, color: 'theme:secondaryAlt' } }
  ),

  patternPreset(
    'seyes',
    'Seyes ruling',
    'French school ruling, 8 mm with sub-divisions.',
    'Ruled',
    { type: 'seyes', unit: 8, subDivisions: 4, verticalSpacing: 8, mainColor: 'theme:secondary', subColor: 'theme:secondaryAlt', verticalColor: 'theme:accent', width: 0.15 }
  ),

  patternPreset(
    'genkoyoshi',
    'Genkō yōshi',
    'Japanese manuscript squares with furigana gutters.',
    'Specialist',
    { type: 'genkoyoshi', columns: 20, rows: 20, gutter: 2, color: 'theme:secondary', width: 0.15, direction: 'vertical-rtl' }
  ),

  patternPreset(
    'dotted-thirds',
    'Dotted thirds',
    'Primary-school handwriting rules.',
    'Ruled',
    { type: 'dottedthirds', bandHeight: 12, color: 'theme:secondary', width: 0.18, dotSpacing: 1.5 }
  ),

  /* ------------------------------------------------------------ composite */

  {
    id: 'titled-notes',
    name: 'Titled notes',
    description: 'A heading and date field above a ruled writing area.',
    category: 'Composite',
    build: (ctx) =>
      template(ctx, 'Titled notes', { type: 'blank' }, {
        presetId: 'titled-notes',
        description: 'A heading and date field above a ruled writing area.',
        blocks: [
          block({ x: 0, y: 0, w: 0.68, h: 0.06 }, {
            ...defaultBlockContent('text'),
            type: 'text',
            text: 'Title',
            size: 7,
            font: { family: 'helvetica', bold: true, italic: false },
            valign: 'middle',
          } as Block['content']),
          block({ x: 0.7, y: 0, w: 0.3, h: 0.06 }, {
            ...defaultBlockContent('fields'),
            type: 'fields',
            items: ['Date'],
            columns: 1,
          } as Block['content']),
          block({ x: 0, y: 0.08, w: 1, h: 0.92 }, {
            ...defaultBlockContent('pattern'),
            type: 'pattern',
            pattern: zPattern.parse({ spec: { type: 'ruled', spacing: 7 } }),
          } as Block['content']),
        ],
      }),
  },

  {
    id: 'split-dot-ruled',
    name: 'Split: dots and rules',
    description: 'Dot grid on the top half for sketching, rules below for notes.',
    category: 'Composite',
    build: (ctx) =>
      template(ctx, 'Split: dots and rules', { type: 'blank' }, {
        presetId: 'split-dot-ruled',
        description: 'Dot grid on the top half for sketching, rules below for notes.',
        blocks: [
          block({ x: 0, y: 0, w: 1, h: 0.48 }, {
            ...defaultBlockContent('pattern'),
            type: 'pattern',
            pattern: zPattern.parse({ spec: { type: 'dots', spacingX: 5, spacingY: 5 } }),
            border: { enabled: true, color: 'theme:secondaryAlt', width: 0.25, radius: 1 },
          } as Block['content']),
          block({ x: 0, y: 0.52, w: 1, h: 0.48 }, {
            ...defaultBlockContent('pattern'),
            type: 'pattern',
            pattern: zPattern.parse({ spec: { type: 'ruled', spacing: 7 } }),
          } as Block['content']),
        ],
      }),
  },

  {
    id: 'latex-sheet',
    name: 'LaTeX sheet',
    description: 'A full-page LaTeX block that reflows and rescales to the target page size.',
    category: 'Composite',
    build: (ctx) =>
      template(ctx, 'LaTeX sheet', { type: 'blank' }, {
        presetId: 'latex-sheet',
        description: 'A full-page LaTeX block that reflows and rescales to the target page size.',
        blocks: [
          block({ x: 0, y: 0, w: 1, h: 1 }, {
            ...defaultBlockContent('latex'),
            type: 'latex',
            source: [
              '\\section{Formula sheet}',
              '',
              'The quadratic roots of $ax^2 + bx + c = 0$ are',
              '',
              '$$ x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} $$',
              '',
              '\\begin{itemize}',
              '\\item The discriminant $b^2 - 4ac$ decides how many real roots there are.',
              '\\item Edit this block to paste your own LaTeX.',
              '\\end{itemize}',
            ].join('\n'),
          } as Block['content']),
        ],
      }),
  },

  {
    id: 'photo-page',
    name: 'Image with caption',
    description: 'A large image area with caption rules beneath.',
    category: 'Composite',
    build: (ctx) =>
      template(ctx, 'Image with caption', { type: 'blank' }, {
        presetId: 'photo-page',
        description: 'A large image area with caption rules beneath.',
        blocks: [
          block({ x: 0, y: 0, w: 1, h: 0.72 }, {
            ...defaultBlockContent('image'),
            type: 'image',
            fit: 'contain',
          } as Block['content']),
          block({ x: 0, y: 0.76, w: 1, h: 0.24 }, {
            ...defaultBlockContent('pattern'),
            type: 'pattern',
            pattern: zPattern.parse({ spec: { type: 'ruled', spacing: 7 } }),
          } as Block['content']),
        ],
      }),
  },

  {
    id: 'checklist-page',
    name: 'Checklist',
    description: 'A heading over a long run of tick boxes.',
    category: 'Composite',
    build: (ctx) =>
      template(ctx, 'Checklist', { type: 'blank' }, {
        presetId: 'checklist-page',
        description: 'A heading over a long run of tick boxes.',
        blocks: [
          block({ x: 0, y: 0, w: 1, h: 0.07 }, {
            ...defaultBlockContent('text'),
            type: 'text',
            text: 'Checklist',
            size: 7,
            font: { family: 'helvetica', bold: true, italic: false },
            valign: 'middle',
          } as Block['content']),
          block({ x: 0, y: 0.09, w: 1, h: 0.91 }, {
            ...defaultBlockContent('checklist'),
            type: 'checklist',
            blankRows: 30,
          } as Block['content']),
        ],
      }),
  },
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export const getPreset = (id: string): Preset | undefined => BY_ID.get(id);

export const PRESET_CATEGORIES = ['Plain', 'Ruled', 'Grids', 'Specialist', 'Composite'] as const;

export function presetsByCategory(): Array<{ category: string; presets: Preset[] }> {
  return PRESET_CATEGORIES.map((category) => ({
    category,
    presets: PRESETS.filter((p) => p.category === category),
  })).filter((group) => group.presets.length > 0);
}
