/**
 * LaTeX support is deliberately scoped: MathJax handles the *maths*, and we
 * handle a small, well-defined prose subset around it. A full TeX engine would
 * mean shipping a TeX distribution, which is at odds with the app being a
 * self-contained local tool.
 *
 * The split that makes this work: MathJax only ever answers "what does this
 * formula look like, as vectors, in em units?". All line breaking and page
 * layout happens in shared code, so the browser preview and the PDF exporter
 * produce byte-identical geometry.
 */

export interface MathPath {
  /** Path data in em units, baseline at y = 0, Y increasing downward. */
  d: string;
  fill?: string;
}

export interface MathBlob {
  paths: MathPath[];
  /** Advance width, in em. */
  width: number;
  /** Extent above the baseline, in em. */
  ascent: number;
  /** Extent below the baseline, in em. */
  descent: number;
}

export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  /** Multiplier on the base font size. */
  scale?: number;
}

export type LatexNode =
  | { type: 'text'; text: string; style: InlineStyle }
  | { type: 'math'; key: string; tex: string; display: boolean }
  | { type: 'break' };

export type ParagraphKind = 'para' | 'heading' | 'item' | 'display' | 'spacer';

export interface LatexParagraph {
  kind: ParagraphKind;
  /** 1 = section, 2 = subsection, 3 = subsubsection. */
  level?: number;
  /** Bullet or number rendered in the hanging indent. */
  marker?: string;
  /** Indent depth for nested lists. */
  depth?: number;
  align?: 'left' | 'center' | 'right';
  nodes: LatexNode[];
}

export interface LatexDocument {
  paragraphs: LatexParagraph[];
  /** Every distinct formula key the document references. */
  mathKeys: string[];
  /** Formulas keyed for the renderer to resolve. */
  formulas: Record<string, { tex: string; display: boolean }>;
  /** Non-fatal problems worth surfacing in the editor. */
  warnings: string[];
}

export type MathCache = Record<string, MathBlob>;

/** FNV-1a. Stable across client and server, which is all we need for cache keys. */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const mathKeyFor = (tex: string, display: boolean): string =>
  `${display ? 'd' : 'i'}_${hashKey(tex)}`;
