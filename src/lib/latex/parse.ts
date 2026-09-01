/**
 * Parses the supported LaTeX subset into paragraphs of styled runs and maths
 * placeholders. Runs isomorphically — the editor uses it for live preview, the
 * exporter uses the identical output.
 *
 * Supported: paragraphs, `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, `\\` breaks,
 * sectioning, itemize/enumerate, center, textbf/textit/emph/texttt/underline,
 * `%` comments, and the usual escaped specials. Anything else is passed through
 * as literal text rather than silently dropped, and noted in `warnings`.
 */
import type {
  InlineStyle,
  LatexDocument,
  LatexNode,
  LatexParagraph,
} from './types';
import { mathKeyFor } from './types';

const HEADING_LEVELS: Record<string, number> = {
  title: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
};

interface ListState {
  ordered: boolean;
  counter: number;
}

export function parseLatex(source: string): LatexDocument {
  const warnings: string[] = [];
  const formulas: Record<string, { tex: string; display: boolean }> = {};
  const paragraphs: LatexParagraph[] = [];

  const body = stripPreamble(stripComments(source), warnings);
  const lists: ListState[] = [];
  let align: 'left' | 'center' | 'right' = 'left';

  // Split into blocks on blank lines, but keep display maths and environment
  // markers on their own so they can never be glued to surrounding prose.
  for (const raw of splitBlocks(body)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const env = chunk.match(/^\\(begin|end)\{(itemize|enumerate|center|flushleft|flushright)\}$/);
    if (env) {
      const [, which, name] = env;
      if (name === 'itemize' || name === 'enumerate') {
        if (which === 'begin') lists.push({ ordered: name === 'enumerate', counter: 0 });
        else lists.pop();
      } else if (which === 'begin') {
        align = name === 'center' ? 'center' : name === 'flushright' ? 'right' : 'left';
      } else {
        align = 'left';
      }
      continue;
    }

    const heading = chunk.match(/^\\(title|section|subsection|subsubsection|paragraph)\*?\{([\s\S]*)\}$/);
    if (heading) {
      paragraphs.push({
        kind: 'heading',
        level: HEADING_LEVELS[heading[1]],
        align: heading[1] === 'title' ? 'center' : align,
        nodes: parseInline(heading[2], formulas, warnings, {}),
      });
      continue;
    }

    const display = chunk.match(/^(?:\$\$([\s\S]*)\$\$|\\\[([\s\S]*)\\\])$/);
    if (display) {
      const tex = (display[1] ?? display[2]).trim();
      const key = mathKeyFor(tex, true);
      formulas[key] = { tex, display: true };
      paragraphs.push({
        kind: 'display',
        align: 'center',
        nodes: [{ type: 'math', key, tex, display: true }],
      });
      continue;
    }

    if (/^\\item\b/.test(chunk)) {
      for (const item of chunk.split(/(?=\\item\b)/)) {
        const text = item.replace(/^\\item\s*/, '').trim();
        if (!text) continue;
        const list = lists[lists.length - 1];
        const marker = list
          ? list.ordered
            ? `${++list.counter}.`
            : '\u2022'
          : '\u2022';
        paragraphs.push({
          kind: 'item',
          marker,
          depth: Math.max(1, lists.length),
          align,
          nodes: parseInline(text, formulas, warnings, {}),
        });
      }
      continue;
    }

    paragraphs.push({
      kind: 'para',
      align,
      nodes: parseInline(chunk, formulas, warnings, {}),
    });
  }

  return {
    paragraphs,
    formulas,
    mathKeys: Object.keys(formulas),
    warnings,
  };
}

/** Removes `%` comments, honouring `\%`. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '%' && line[i - 1] !== '\\') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * Accepts either a bare fragment or a full document. When a `document`
 * environment is present we use its body and ignore the preamble, so pasting a
 * complete `.tex` file does something sensible.
 */
function stripPreamble(source: string, warnings: string[]): string {
  const doc = source.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (doc) {
    if (/\\usepackage/.test(source)) {
      warnings.push('Preamble ignored: \\usepackage directives have no effect here.');
    }
    return doc[1];
  }
  return source;
}

/**
 * Splits into layout blocks. Blank lines separate paragraphs; display maths and
 * list/alignment environment markers are promoted to their own blocks so the
 * caller can treat them structurally.
 */
function splitBlocks(source: string): string[] {
  const normalized = source
    .replace(/\\(begin|end)\{(itemize|enumerate|center|flushleft|flushright)\}/g, '\n\n\\$1{$2}\n\n')
    .replace(/(\$\$[\s\S]*?\$\$)/g, '\n\n$1\n\n')
    .replace(/(\\\[[\s\S]*?\\\])/g, '\n\n$1\n\n');
  return normalized.split(/\n\s*\n/);
}

const STYLE_COMMANDS: Record<string, InlineStyle> = {
  textbf: { bold: true },
  bf: { bold: true },
  textit: { italic: true },
  emph: { italic: true },
  it: { italic: true },
  texttt: { mono: true },
  tt: { mono: true },
  underline: {},
  textrm: {},
  textsf: {},
  large: { scale: 1.2 },
  Large: { scale: 1.44 },
  huge: { scale: 1.7 },
  small: { scale: 0.85 },
  footnotesize: { scale: 0.75 },
};

const ESCAPES: Record<string, string> = {
  '\\&': '&',
  '\\%': '%',
  '\\$': '$',
  '\\#': '#',
  '\\_': '_',
  '\\{': '{',
  '\\}': '}',
  '\\ ': ' ',
  '~': ' ',
  '\\ldots': '…',
  '\\dots': '…',
  '\\textbackslash': '\\',
  '\\LaTeX': 'LaTeX',
  '\\TeX': 'TeX',
  "\\'e": 'é',
  '\\"o': 'ö',
};

/** Parses one paragraph's worth of text into styled runs and maths nodes. */
export function parseInline(
  input: string,
  formulas: Record<string, { tex: string; display: boolean }>,
  warnings: string[],
  style: InlineStyle
): LatexNode[] {
  const nodes: LatexNode[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: collapse(buffer), style });
      buffer = '';
    }
  };

  while (i < input.length) {
    const rest = input.slice(i);

    // Inline maths: $…$ or \(…\)
    const inlineMath = rest.match(/^\$(?!\$)((?:[^$\\]|\\.)*)\$/) ?? rest.match(/^\\\(([\s\S]*?)\\\)/);
    if (inlineMath) {
      flush();
      const tex = inlineMath[1].trim();
      const key = mathKeyFor(tex, false);
      formulas[key] = { tex, display: false };
      nodes.push({ type: 'math', key, tex, display: false });
      i += inlineMath[0].length;
      continue;
    }

    if (rest.startsWith('\\\\')) {
      flush();
      nodes.push({ type: 'break' });
      i += 2;
      continue;
    }

    // Styling commands with a braced argument.
    const styled = rest.match(/^\\([a-zA-Z]+)\s*\{/);
    if (styled && STYLE_COMMANDS[styled[1]]) {
      const open = i + styled[0].length - 1;
      const close = matchBrace(input, open);
      if (close > 0) {
        flush();
        const inner = input.slice(open + 1, close);
        const merged = mergeStyle(style, STYLE_COMMANDS[styled[1]]);
        nodes.push(...parseInline(inner, formulas, warnings, merged));
        i = close + 1;
        continue;
      }
    }

    // Size switches without an argument, e.g. `{\large ...}`.
    const bare = rest.match(/^\\([a-zA-Z]+)\b\s?/);
    if (bare) {
      const escaped = ESCAPES[`\\${bare[1]}`];
      if (escaped !== undefined) {
        buffer += escaped;
        i += bare[0].length;
        continue;
      }
      if (STYLE_COMMANDS[bare[1]]) {
        // Applies to the remainder of this group.
        flush();
        const merged = mergeStyle(style, STYLE_COMMANDS[bare[1]]);
        nodes.push(...parseInline(input.slice(i + bare[0].length), formulas, warnings, merged));
        return nodes;
      }
      warnings.push(`Unsupported command \\${bare[1]} was rendered as plain text.`);
      buffer += `\\${bare[1]}`;
      i += bare[0].length;
      continue;
    }

    // Two-character escapes such as \& or \%.
    const esc = ESCAPES[rest.slice(0, 2)];
    if (esc !== undefined && rest[0] === '\\') {
      buffer += esc;
      i += 2;
      continue;
    }

    if (rest[0] === '~') {
      buffer += ' ';
      i += 1;
      continue;
    }

    if (rest[0] === '{' || rest[0] === '}') {
      i += 1;
      continue;
    }

    buffer += rest[0];
    i += 1;
  }

  flush();
  return nodes;
}

function mergeStyle(base: InlineStyle, add: InlineStyle): InlineStyle {
  return {
    bold: add.bold ?? base.bold,
    italic: add.italic ?? base.italic,
    mono: add.mono ?? base.mono,
    scale: (base.scale ?? 1) * (add.scale ?? 1),
  };
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i++) {
    if (input[i] === '\\') {
      i++;
      continue;
    }
    if (input[i] === '{') depth++;
    else if (input[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * TeX collapses runs of whitespace (including single newlines) to one space,
 * and turns `---`/`--` into em and en dashes and `` ` `` pairs into curly
 * quotes. Reproducing the ligatures matters because otherwise pasted prose
 * renders with visibly wrong punctuation.
 */
const collapse = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/`/g, '‘');
