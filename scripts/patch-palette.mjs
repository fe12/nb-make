import { readFileSync, writeFileSync } from 'node:fs';

const edit = (path, pairs) => {
  let s = readFileSync(path, 'utf8');
  for (const [from, to, label] of pairs) {
    if (!s.includes(from)) throw new Error(`${path}: not found — ${label}`);
    s = s.replace(from, to);
  }
  writeFileSync(path, s);
  console.log('patched', path);
};

/* --- 1. zColor must accept `theme:<role>` references -------------------- */
edit('src/lib/types/common.ts', [
  [
    `export const zColor = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\)|[a-z]+)$/, 'Expected a CSS colour');`,
    `/**
 * A colour is either a literal or a \`theme:<role>\` reference into the
 * notebook's palette. References survive all the way to the drawing ops and are
 * resolved in one pass there, so a palette change repaints every page.
 */
export const zColor = z
  .string()
  .regex(
    /^(theme:(primary|secondary|secondaryAlt|accent)|#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\)|[a-z]+)$/,
    'Expected a CSS colour or a theme colour'
  );`,
    'zColor regex',
  ],
]);

/* --- 2. the notebook carries a palette ---------------------------------- */
edit('src/lib/types/notebook.ts', [
  [
    `  templates: z.array(zPageTemplate).default([]),`,
    `  /**
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
  templates: z.array(zPageTemplate).default([]),`,
    'palette field',
  ],
  [
    `import { zAlign, zColor, zFont, zMargins, zPageSize } from './common';`,
    `import { DEFAULT_PALETTE } from '../palette';
import { zAlign, zColor, zFont, zMargins, zPageSize } from './common';`,
    'palette import',
  ],
]);

/* --- 3. resolve the palette when a page is compiled --------------------- */
edit('src/lib/compile/page.ts', [
  [
    `import { renderPattern } from '../render/patterns';`,
    `import { applyPalette } from '../render/palette';
import { renderPattern } from '../render/patterns';`,
    'page palette import',
  ],
  [
    `export interface CompilePageOptions {
  size: Size;
  margins: Margins;
  assets: AssetIndex;
  math: MathCache;
  pageNumber?: PageNumberContext;
}`,
    `export interface CompilePageOptions {
  size: Size;
  margins: Margins;
  assets: AssetIndex;
  math: MathCache;
  pageNumber?: PageNumberContext;
  /** Resolves \`theme:*\` colours. Omit to leave references unresolved. */
  palette?: NotebookPalette;
}`,
    'page options',
  ],
  [
    `  return { ops, missingMath: [...missingMath], warnings };
}`,
    `  return {
    ops: options.palette ? applyPalette(ops, options.palette) : ops,
    missingMath: [...missingMath],
    warnings,
  };
}`,
    'page return',
  ],
  [
    `import { contentRect, resolvePageSize, type Margins, type Rect, type Size } from '../units';`,
    `import type { NotebookPalette } from '../palette';
import { contentRect, resolvePageSize, type Margins, type Rect, type Size } from '../units';`,
    'page palette type',
  ],
]);

/* --- 4. notebook compile passes the palette through --------------------- */
edit('src/lib/compile/notebook.ts', [
  [
    `        const compiled = compileTemplate(source.template, {
          size,
          margins: notebook.margins,
          assets: options.assets,
          math: options.math,
        });`,
    `        const compiled = compileTemplate(source.template, {
          size,
          margins: notebook.margins,
          assets: options.assets,
          math: options.math,
          palette: notebook.palette,
        });`,
    'template compile palette',
  ],
  [
    `    } else {
      baseOps = source.ops;
      baseKey = source.key;
    }`,
    `    } else {
      // Generated pages emit theme references too; resolve them once per
      // distinct ops array so repeated pages keep sharing one array.
      let resolved = generatedPalette.get(source.ops);
      if (!resolved) {
        resolved = applyPalette(source.ops, notebook.palette);
        generatedPalette.set(source.ops, resolved);
      }
      baseOps = resolved;
      baseKey = source.key;
    }`,
    'generated palette',
  ],
  [
    `  const templateCache = new Map<string, Op[]>();`,
    `  const templateCache = new Map<string, Op[]>();
  const generatedPalette = new Map<Op[], Op[]>();`,
    'generated palette cache',
  ],
  [
    `import type { Op } from '../render/ops';`,
    `import type { Op } from '../render/ops';
import { applyPalette } from '../render/palette';`,
    'notebook palette import',
  ],
]);

/* --- 5. new notebooks start from the default palette -------------------- */
edit('src/lib/defaults.ts', [
  [
    `    pageSize,
    margins: uniformMargins(10),`,
    `    pageSize,
    margins: uniformMargins(10),
    palette: input.palette ?? DEFAULT_PALETTE,`,
    'defaults palette',
  ],
  [
    `export interface NewNotebookInput {
  name: string;`,
    `export interface NewNotebookInput {
  name: string;
  palette?: NotebookPalette;`,
    'defaults input',
  ],
  [
    `import { newId } from './ids';`,
    `import { newId } from './ids';
import { DEFAULT_PALETTE, type NotebookPalette } from './palette';`,
    'defaults import',
  ],
]);

/* --- 6. generators default to palette roles ----------------------------- */
edit('src/lib/parametric/registry.ts', [
  [
    `export const accentField: ParamField = {
  key: 'accentColor',
  label: 'Accent colour',
  type: 'color',
  default: '#2f5d8a',
};

export const ruleField: ParamField = {
  key: 'ruleColor',
  label: 'Rule colour',
  type: 'color',
  default: '#b9c6d4',
};`,
    `// Defaulting to palette roles is what makes a generated page follow the
// notebook's colours out of the box; a per-entry override is still just a
// literal colour.
export const accentField: ParamField = {
  key: 'accentColor',
  label: 'Accent colour',
  type: 'color',
  default: themeRef('accent'),
};

export const ruleField: ParamField = {
  key: 'ruleColor',
  label: 'Rule colour',
  type: 'color',
  default: themeRef('secondary'),
};`,
    'generator colour defaults',
  ],
  [
    `import type { Margins, Rect, Size } from '../units';`,
    `import { themeRef } from '../palette';
import type { Margins, Rect, Size } from '../units';`,
    'registry palette import',
  ],
]);

/* --- 7. the generator drawing theme follows the palette ----------------- */
edit('src/lib/parametric/draw.ts', [
  [
    `export const DEFAULT_THEME: Theme = {
  ink: '#1c2733',
  muted: '#7b8a99',
  rule: '#b9c6d4',
  hairline: '#dde5ee',
  accent: '#2f5d8a',
  accentInk: '#ffffff',
  fill: '#eef3f8',
  font: { family: 'helvetica' },
};`,
    `/**
 * Generated pages draw in palette roles rather than fixed colours, so they
 * restyle with the notebook. \`accentInk\` stays white because it sits on top of
 * the accent colour and has to stay legible whatever that is.
 */
export const DEFAULT_THEME: Theme = {
  ink: themeRef('primary'),
  muted: themeRef('secondary'),
  rule: themeRef('secondary'),
  hairline: themeRef('secondaryAlt'),
  accent: themeRef('accent'),
  accentInk: '#ffffff',
  fill: themeRef('secondaryAlt'),
  font: { family: 'helvetica' },
};`,
    'generator theme roles',
  ],
  [
    `import type { Rect } from '../units';`,
    `import { themeRef } from '../palette';
import type { Rect } from '../units';`,
    'draw palette import',
  ],
]);

console.log('palette wiring complete');
