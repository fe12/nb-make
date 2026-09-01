export interface RGB {
  r: number;
  g: number;
  b: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  transparent: '#00000000',
};

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and a few names into
 * normalised 0..1 components plus alpha.
 */
export function parseColor(input: string): RGB & { a: number } {
  const value = (NAMED[input.trim().toLowerCase()] ?? input).trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16) / 255;
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]),
        g: expand(hex[1]),
        b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return {
      r: (parts[0] ?? 0) / 255,
      g: (parts[1] ?? 0) / 255,
      b: (parts[2] ?? 0) / 255,
      a: parts[3] ?? 1,
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

export const toHex = ({ r, g, b }: RGB): string => {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

/**
 * Relative luminance, for picking a readable ink colour against a fill.
 */
export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const readableInk = (background: string): string =>
  luminance(background) > 0.5 ? '#111111' : '#ffffff';

/** Mixes toward white; handy for deriving minor grid lines from a major colour. */
export function lighten(color: string, amount: number): string {
  const { r, g, b } = parseColor(color);
  return toHex({
    r: r + (1 - r) * amount,
    g: g + (1 - g) * amount,
    b: b + (1 - b) * amount,
  });
}
