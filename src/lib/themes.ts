/**
 * Colour themes.
 *
 * Every theme supplies the same set of `--nb-*` custom properties, which the
 * Tailwind `ink-*` / `accent-*` scales are defined in terms of. Switching a
 * theme is therefore one attribute on `<html>` — no component knows a theme
 * exists.
 */

export interface Theme {
  id: string;
  name: string;
  /** Two swatches for the picker. */
  swatch: [string, string];
  dark?: boolean;
  vars: Record<string, string>;
}

interface Palette {
  ink: [string, string, string, string, string, string, string, string, string, string];
  accent: [string, string, string, string, string, string, string];
  paper: string;
  /** Ink used for the hand-drawn borders and doodles. */
  sketch: string;
  danger: [string, string, string];
}

const build = (
  id: string,
  name: string,
  palette: Palette,
  dark = false
): Theme => ({
  id,
  name,
  dark,
  swatch: [palette.accent[4], palette.ink[dark ? 8 : 1]],
  vars: {
    '--nb-ink-50': palette.ink[0],
    '--nb-ink-100': palette.ink[1],
    '--nb-ink-200': palette.ink[2],
    '--nb-ink-300': palette.ink[3],
    '--nb-ink-400': palette.ink[4],
    '--nb-ink-500': palette.ink[5],
    '--nb-ink-600': palette.ink[6],
    '--nb-ink-700': palette.ink[7],
    '--nb-ink-800': palette.ink[8],
    '--nb-ink-900': palette.ink[9],
    '--nb-accent-50': palette.accent[0],
    '--nb-accent-100': palette.accent[1],
    '--nb-accent-300': palette.accent[2],
    '--nb-accent-500': palette.accent[3],
    '--nb-accent-600': palette.accent[4],
    '--nb-accent-700': palette.accent[5],
    '--nb-accent-ink': palette.accent[6],
    '--nb-danger-100': palette.danger[0],
    '--nb-danger-500': palette.danger[1],
    '--nb-danger-600': palette.danger[2],
    '--nb-paper': palette.paper,
    '--nb-sketch': palette.sketch,
  },
});

export const THEMES: Theme[] = [
  build('graph', 'Graph paper', {
    ink: [
      '#f7f9fb', '#eef2f6', '#dde5ee', '#c4d1e0', '#93a6bb',
      '#6b7f96', '#4e6076', '#3a4959', '#26313d', '#171f28',
    ],
    accent: ['#eef4fb', '#d8e6f6', '#8ab2dd', '#3d75b0', '#2f5d8a', '#264c72', '#ffffff'],
    paper: '#ffffff',
    sketch: '#2f5d8a',
    danger: ['#fbe6e6', '#c04b4b', '#a53c3c'],
  }),

  build('kraft', 'Kraft & ink', {
    ink: [
      '#fdfaf4', '#f6efe2', '#eadfc9', '#d8c8a8', '#b3a184',
      '#8c7c63', '#6b5d48', '#524634', '#382f22', '#221c14',
    ],
    accent: ['#fbf1e3', '#f4ddbe', '#dda86a', '#b9762a', '#9c601e', '#7d4c17', '#ffffff'],
    paper: '#fffdf8',
    sketch: '#9c601e',
    danger: ['#fae7e1', '#c25a3f', '#a34630'],
  }),

  build('meadow', 'Meadow', {
    ink: [
      '#f6faf6', '#ecf3ec', '#dae7db', '#bcd2be', '#8caa90',
      '#67856c', '#4c6851', '#3a503e', '#27362a', '#17211a',
    ],
    accent: ['#edf7ef', '#d6ecda', '#8fca9c', '#4f9d64', '#3d7f4f', '#2f663e', '#ffffff'],
    paper: '#fefffe',
    sketch: '#3d7f4f',
    danger: ['#fae6e6', '#bf5050', '#a13f3f'],
  }),

  build('blossom', 'Blossom', {
    ink: [
      '#fdf7fa', '#f7edf3', '#eedbe6', '#dfbdd0', '#bc90a8',
      '#98708a', '#78566d', '#5e4256', '#402c3a', '#281a24',
    ],
    accent: ['#fceef5', '#f7d9e8', '#e29ec0', '#c25d92', '#a44878', '#853a61', '#ffffff'],
    paper: '#fffcfe',
    sketch: '#a44878',
    danger: ['#fae4e4', '#c04f56', '#a23f46'],
  }),

  build('citrus', 'Citrus', {
    ink: [
      '#fdfaf3', '#f8f2e4', '#efe4c9', '#dfcf9f', '#b8a877',
      '#93855b', '#736847', '#585036', '#3b3623', '#242116',
    ],
    accent: ['#fff5e0', '#ffe7b8', '#f4c15e', '#dc9a12', '#b87d0a', '#946307', '#3b3623'],
    paper: '#fffef9',
    sketch: '#b87d0a',
    danger: ['#fae7de', '#c9603a', '#a94b2b'],
  }),

  build(
    'midnight',
    'Midnight',
    {
      ink: [
        '#161a21', '#1c222b', '#293240', '#384457', '#7c8ba1',
        '#9aa8bd', '#b6c2d4', '#cfd8e6', '#e6ecf5', '#f5f8fc',
      ],
      accent: ['#1b2733', '#22323f', '#3f6d99', '#5d9ad0', '#7ab0e0', '#96c3ea', '#0f141a'],
      paper: '#20262f',
      sketch: '#7ab0e0',
      danger: ['#3a2224', '#e0736f', '#ef8a86'],
    },
    true
  ),

  build(
    'ink',
    'Ink & slate',
    {
      ink: [
        '#141414', '#1c1c1c', '#2a2a2a', '#3b3b3b', '#7d7d7d',
        '#9a9a9a', '#b8b8b8', '#d2d2d2', '#e8e8e8', '#f7f7f7',
      ],
      accent: ['#1e1e1e', '#282828', '#6f6f6f', '#a8a8a8', '#c9c9c9', '#e0e0e0', '#141414'],
      paper: '#212121',
      sketch: '#c9c9c9',
      danger: ['#3a2020', '#e07a7a', '#ee9090'],
    },
    true
  ),
];

export const DEFAULT_THEME_ID = 'graph';

export const getTheme = (id: string): Theme =>
  THEMES.find((theme) => theme.id === id) ?? THEMES[0];

/** Inline `style` object applying a theme, for the picker's live swatches. */
export const themeStyle = (theme: Theme): React.CSSProperties =>
  theme.vars as unknown as React.CSSProperties;
