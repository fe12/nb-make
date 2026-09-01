/**
 * The notebook's own colour palette.
 *
 * Distinct from the *app* themes in `themes.ts`, which only restyle the editor
 * chrome. This palette is part of the document: it decides what the printed
 * pages look like, and it travels with the notebook's JSON.
 *
 * Any colour anywhere in the model — a ruling, a block, a generator parameter —
 * may be either a literal like `#2f5d8a` or a role reference like
 * `theme:accent`. References are left unresolved right up until a page has been
 * compiled to drawing ops, then substituted in a single pass. That is what lets
 * one palette change repaint every page, including the parametric ones, without
 * each generator having to know a palette exists.
 */

export const PALETTE_ROLES = ['primary', 'secondary', 'secondaryAlt', 'accent'] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

export interface NotebookPalette {
  /** Main ink: body text, headings, the darkest marks on the page. */
  primary: string;
  /** Rules and structural lines. */
  secondary: string;
  /** Hairlines, tints and light fills. */
  secondaryAlt: string;
  /** Highlights: accent rules, badges, emphasised numbers. */
  accent: string;
}

export const ROLE_LABELS: Record<PaletteRole, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  secondaryAlt: 'Secondary 2',
  accent: 'Accent',
};

export const ROLE_HINTS: Record<PaletteRole, string> = {
  primary: 'Body text and the darkest marks',
  secondary: 'Rules and structural lines',
  secondaryAlt: 'Hairlines and light tints',
  accent: 'Highlights and emphasis',
};

export const DEFAULT_PALETTE: NotebookPalette = {
  primary: '#1c2733',
  secondary: '#b9c6d4',
  secondaryAlt: '#dde7f0',
  accent: '#2f5d8a',
};

/** Ready-made palettes, offered in the editor the way Canva offers colour sets. */
export interface PalettePreset {
  id: string;
  name: string;
  palette: NotebookPalette;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: 'classic', name: 'Classic blue', palette: DEFAULT_PALETTE },
  {
    id: 'graphite',
    name: 'Graphite',
    palette: { primary: '#1a1a1a', secondary: '#b4b4b4', secondaryAlt: '#e0e0e0', accent: '#555555' },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    palette: { primary: '#3b2f22', secondary: '#c8b28c', secondaryAlt: '#eadfc9', accent: '#9c601e' },
  },
  {
    id: 'forest',
    name: 'Forest',
    palette: { primary: '#1f2e22', secondary: '#a8c4ac', secondaryAlt: '#dcebde', accent: '#3d7f4f' },
  },
  {
    id: 'plum',
    name: 'Plum',
    palette: { primary: '#2e1f2a', secondary: '#cfa9c0', secondaryAlt: '#eedbe6', accent: '#a44878' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    palette: { primary: '#122b33', secondary: '#9ec4cf', secondaryAlt: '#d9ecf1', accent: '#1c7f96' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    palette: { primary: '#3a2318', secondary: '#e0b49a', secondaryAlt: '#f7e3d6', accent: '#c9522e' },
  },
  {
    id: 'mono',
    name: 'Pure black',
    palette: { primary: '#000000', secondary: '#8a8a8a', secondaryAlt: '#d4d4d4', accent: '#000000' },
  },
];

/* ------------------------------------------------------------- references */

const PREFIX = 'theme:';

export const themeRef = (role: PaletteRole): string => `${PREFIX}${role}`;

/** The role a colour points at, or null when it is a literal. */
export function roleOf(color: string): PaletteRole | null {
  if (!color.startsWith(PREFIX)) return null;
  const role = color.slice(PREFIX.length) as PaletteRole;
  return PALETTE_ROLES.includes(role) ? role : null;
}

export const isThemeRef = (color: string): boolean => roleOf(color) !== null;

/**
 * Resolves one colour against a palette. Unknown references fall back to the
 * primary role rather than producing an invalid colour, so a palette edited in
 * an older version can never make a page fail to draw.
 */
export function resolveColor(color: string, palette: NotebookPalette): string {
  const role = roleOf(color);
  if (!role) return color;
  return palette[role] ?? palette.primary;
}

export function coercePalette(raw: unknown): NotebookPalette {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PALETTE;
  const value = raw as Partial<NotebookPalette>;
  const pick = (role: PaletteRole) =>
    typeof value[role] === 'string' && value[role] ? (value[role] as string) : DEFAULT_PALETTE[role];
  return {
    primary: pick('primary'),
    secondary: pick('secondary'),
    secondaryAlt: pick('secondaryAlt'),
    accent: pick('accent'),
  };
}
