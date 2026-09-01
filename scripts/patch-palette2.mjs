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

edit('src/lib/compile/notebook.ts', [
  [
    `          assets: options.assets,
          math: options.math,
        });`,
    `          assets: options.assets,
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
      // Generated pages emit theme references too. Resolving once per distinct
      // ops array keeps repeated pages sharing one array, which is what the
      // exporter's de-duplication depends on.
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

edit('src/lib/defaults.ts', [
  [
    `    margins: uniformMargins(10),`,
    `    margins: uniformMargins(10),
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
 * restyle with the notebook. \`accentInk\` stays white: it sits on top of the
 * accent colour and has to stay legible whatever that is.
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
