/**
 * Text metrics shared by the preview and the PDF exporter.
 *
 * We deliberately restrict ourselves to the PDF standard-14 fonts. That keeps
 * exports small (no embedded font programs) and — more importantly — lets us
 * measure text with the exact same AFM tables pdf-lib uses internally, so a
 * line that wraps a certain way in the preview wraps identically in the PDF.
 */
import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';
import type { FontFamily, FontSpec } from './ops';

export type StandardFontKey =
  | 'Helvetica'
  | 'HelveticaBold'
  | 'HelveticaOblique'
  | 'HelveticaBoldOblique'
  | 'TimesRoman'
  | 'TimesRomanBold'
  | 'TimesRomanItalic'
  | 'TimesRomanBoldItalic'
  | 'Courier'
  | 'CourierBold'
  | 'CourierOblique'
  | 'CourierBoldOblique';

const TABLE: Record<FontFamily, Record<string, StandardFontKey>> = {
  helvetica: {
    '': 'Helvetica',
    b: 'HelveticaBold',
    i: 'HelveticaOblique',
    bi: 'HelveticaBoldOblique',
  },
  times: {
    '': 'TimesRoman',
    b: 'TimesRomanBold',
    i: 'TimesRomanItalic',
    bi: 'TimesRomanBoldItalic',
  },
  courier: {
    '': 'Courier',
    b: 'CourierBold',
    i: 'CourierOblique',
    bi: 'CourierBoldOblique',
  },
};

export function fontKey(spec: FontSpec): StandardFontKey {
  const style = `${spec.bold ? 'b' : ''}${spec.italic ? 'i' : ''}`;
  return TABLE[spec.family]?.[style] ?? 'Helvetica';
}

/** CSS stack approximating each standard font, for the SVG preview. */
export const CSS_FONT_STACK: Record<FontFamily, string> = {
  helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  times: '"Times New Roman", Times, "Liberation Serif", serif',
  courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

const cache = new Map<StandardFontKey, Font>();

function load(key: StandardFontKey): Font {
  let font = cache.get(key);
  if (!font) {
    font = Font.load(FontNames[key]);
    cache.set(key, font);
  }
  return font;
}

/** Glyph advance in 1/1000 em, or 0 when the character is unrepresentable. */
function glyphWidth(font: Font, codePoint: number): number {
  const encoded = Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint)
    ? Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint)
    : null;
  if (!encoded) return 0;
  return font.getWidthOfGlyph(encoded.name) ?? 0;
}

/**
 * Width of `text` at `size`, in whatever unit `size` is given in (we pass mm).
 * `letterSpacing` is in the same unit.
 */
export function measureText(
  text: string,
  spec: FontSpec,
  size: number,
  letterSpacing = 0
): number {
  const font = load(fontKey(spec));
  let width = 0;
  let count = 0;
  for (const ch of text) {
    width += glyphWidth(font, ch.codePointAt(0)!);
    count++;
  }
  return (width / 1000) * size + Math.max(0, count - 1) * letterSpacing;
}

export interface FontMetrics {
  /** Distance from baseline to the top of tall glyphs, as a fraction of em. */
  ascender: number;
  /** Negative, as a fraction of em. */
  descender: number;
  capHeight: number;
  xHeight: number;
  /** Sensible default leading, as a multiple of font size. */
  lineHeight: number;
}

export function metricsOf(spec: FontSpec): FontMetrics {
  const font = load(fontKey(spec));
  return {
    ascender: (font.Ascender ?? 718) / 1000,
    descender: (font.Descender ?? -207) / 1000,
    capHeight: (font.CapHeight ?? 700) / 1000,
    xHeight: (font.XHeight ?? 520) / 1000,
    lineHeight: 1.2,
  };
}

/** Strips characters the standard fonts cannot encode, so export never fails. */
export function sanitizeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t') {
      out += ch;
    } else if (Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) {
      out += ch;
    } else {
      out += SUBSTITUTIONS[ch] ?? '?';
    }
  }
  return out;
}

const SUBSTITUTIONS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '--',
  '…': '...',
  ' ': ' ',
  '−': '-',
  '•': '-',
};

export interface WrapOptions {
  font: FontSpec;
  size: number;
  maxWidth: number;
  letterSpacing?: number;
}

/**
 * Greedy word wrap. Words longer than the line are broken mid-word so a long
 * URL can never overflow the page.
 */
export function wrapText(text: string, opts: WrapOptions): string[] {
  const { font, size, maxWidth, letterSpacing = 0 } = opts;
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, font, size, letterSpacing) <= maxWidth || !current) {
        // Even with no room, we must place at least one word to make progress.
        if (measureText(candidate, font, size, letterSpacing) > maxWidth && !current) {
          const pieces = breakLongWord(word, opts);
          lines.push(...pieces.slice(0, -1));
          current = pieces[pieces.length - 1];
          continue;
        }
        current = candidate;
      } else {
        lines.push(current);
        if (measureText(word, font, size, letterSpacing) > maxWidth) {
          const pieces = breakLongWord(word, opts);
          lines.push(...pieces.slice(0, -1));
          current = pieces[pieces.length - 1];
        } else {
          current = word;
        }
      }
    }
    lines.push(current);
  }
  return lines;
}

function breakLongWord(word: string, opts: WrapOptions): string[] {
  const { font, size, maxWidth, letterSpacing = 0 } = opts;
  const pieces: string[] = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    if (current && measureText(candidate, font, size, letterSpacing) > maxWidth) {
      pieces.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  pieces.push(current);
  return pieces;
}
