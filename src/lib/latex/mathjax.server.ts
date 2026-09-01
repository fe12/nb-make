/**
 * Server-only bridge to MathJax.
 *
 * Its single job is to answer "what does this formula look like as vectors, in
 * em units, with the baseline at y = 0?". Nothing about page layout leaks in
 * here, which is why the same blob can be laid out identically by the browser
 * preview and the PDF exporter.
 *
 * MathJax ships CommonJS with internal dynamic requires, so it is loaded
 * through `createRequire` and kept out of the bundler's way via
 * `serverExternalPackages` in next.config.ts.
 */
import { createRequire } from 'node:module';
import {
  IDENTITY,
  multiply,
  scaleM,
  transformPathData,
  type Matrix,
} from '../render/ops';
import type { MathBlob, MathPath } from './types';

const require = createRequire(import.meta.url);

/** MathJax emits 1000 internal units per em. */
const UNITS_PER_EM = 1000;

interface LiteNode {
  kind: string;
  attributes?: Record<string, string>;
  children?: LiteNode[];
  value?: string;
}

interface MathJaxBundle {
  adaptor: {
    outerHTML(node: unknown): string;
  };
  doc: {
    convert(tex: string, options: { display: boolean }): unknown;
    reset?(): void;
  };
}

let bundle: MathJaxBundle | null = null;

function getBundle(): MathJaxBundle {
  if (bundle) return bundle;

  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages, inlineMath: [] }),
    // `fontCache: 'none'` inlines every glyph as a <path>. That costs a few
    // bytes but means a blob is fully self-contained — no <use> references to
    // resolve, which would not survive being embedded in a PDF.
    OutputJax: new SVG({ fontCache: 'none' }),
  });

  bundle = { adaptor, doc };
  return bundle;
}

export interface RenderMathResult {
  blob?: MathBlob;
  error?: string;
}

/** Renders one formula. Errors are returned, never thrown. */
export function renderMath(tex: string, display: boolean): RenderMathResult {
  if (!tex.trim()) {
    return { blob: { paths: [], width: 0, ascent: 0, descent: 0 } };
  }
  try {
    const { adaptor, doc } = getBundle();
    doc.reset?.();
    const node = doc.convert(tex, { display });
    const html = adaptor.outerHTML(node);
    return { blob: svgToBlob(html) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function renderMathBatch(
  requests: Array<{ key: string; tex: string; display: boolean }>
): { blobs: Record<string, MathBlob>; errors: Record<string, string> } {
  const blobs: Record<string, MathBlob> = {};
  const errors: Record<string, string> = {};
  for (const { key, tex, display } of requests) {
    if (blobs[key] || errors[key]) continue;
    const { blob, error } = renderMath(tex, display);
    if (blob) blobs[key] = blob;
    else errors[key] = error ?? 'Unknown error';
  }
  return { blobs, errors };
}

/**
 * Flattens MathJax's nested `<g transform>` SVG into absolute path data.
 *
 * The output coordinate system is the SVG viewBox scaled by 1/1000. MathJax
 * already places the baseline at y = 0 and flips glyphs downward with an inner
 * `scale(1,-1)`, so no extra offset is needed.
 */
function svgToBlob(html: string): MathBlob {
  const svgStart = html.indexOf('<svg');
  if (svgStart < 0) throw new Error('MathJax produced no SVG');
  const svg = html.slice(svgStart);

  const viewBox = svg.match(/viewBox="([-\d.eE+ ]+)"/);
  if (!viewBox) throw new Error('MathJax SVG had no viewBox');
  const [, minY, vbWidth, vbHeight] = viewBox[1].trim().split(/\s+/).map(Number);

  const root = parseXml(svg);
  const paths: MathPath[] = [];
  walk(root, scaleM(1 / UNITS_PER_EM), undefined, paths);

  return {
    paths,
    width: vbWidth / UNITS_PER_EM,
    ascent: -minY / UNITS_PER_EM,
    descent: (minY + vbHeight) / UNITS_PER_EM,
  };
}

function walk(node: LiteNode, matrix: Matrix, fill: string | undefined, out: MathPath[]): void {
  const attrs = node.attributes ?? {};
  let m = matrix;
  if (attrs.transform) m = multiply(m, parseTransform(attrs.transform));

  let currentFill = fill;
  if (attrs.fill && attrs.fill !== 'currentColor' && attrs.fill !== 'none') {
    currentFill = attrs.fill;
  }

  switch (node.kind) {
    case 'path': {
      if (attrs.d) out.push({ d: transformPathData(attrs.d, m), fill: currentFill });
      break;
    }
    case 'rect': {
      const x = Number(attrs.x ?? 0);
      const y = Number(attrs.y ?? 0);
      const w = Number(attrs.width ?? 0);
      const h = Number(attrs.height ?? 0);
      if (w > 0 && h > 0) {
        const d = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
        out.push({ d: transformPathData(d, m), fill: currentFill });
      }
      break;
    }
    case 'line': {
      // Stroked lines are rare in MathJax output; approximate with a thin quad
      // so the exporter only ever has to deal with filled paths.
      const x1 = Number(attrs.x1 ?? 0);
      const y1 = Number(attrs.y1 ?? 0);
      const x2 = Number(attrs.x2 ?? 0);
      const y2 = Number(attrs.y2 ?? 0);
      const t = Number(attrs['stroke-width'] ?? 50) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * t;
      const ny = (dx / len) * t;
      const d =
        `M ${x1 + nx} ${y1 + ny} L ${x2 + nx} ${y2 + ny} ` +
        `L ${x2 - nx} ${y2 - ny} L ${x1 - nx} ${y1 - ny} Z`;
      out.push({ d: transformPathData(d, m), fill: currentFill });
      break;
    }
    default:
      break;
  }

  for (const child of node.children ?? []) walk(child, m, currentFill, out);
}

/** Parses `translate/scale/matrix/rotate` transform lists. */
export function parseTransform(input: string): Matrix {
  let m: Matrix = IDENTITY;
  const re = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(input)) !== null) {
    const args = (match[2].match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    switch (match[1]) {
      case 'translate':
        m = multiply(m, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
        break;
      case 'scale':
        m = multiply(m, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
        break;
      case 'matrix':
        m = multiply(m, [args[0], args[1], args[2], args[3], args[4], args[5]] as Matrix);
        break;
      case 'rotate': {
        const r = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        m = multiply(m, [cos, sin, -sin, cos, 0, 0]);
        break;
      }
    }
  }
  return m;
}

/**
 * Minimal XML reader for MathJax's own output. It is not a general parser — it
 * only needs to handle the well-formed, attribute-simple markup MathJax emits.
 */
export function parseXml(source: string): LiteNode {
  const root: LiteNode = { kind: '#root', children: [] };
  const stack: LiteNode[] = [root];
  const tag = /<\/?([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(source)) !== null) {
    const [full, name, rawAttrs, selfClose] = match;
    const closing = full.startsWith('</');

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const attributes: Record<string, string> = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(rawAttrs)) !== null) {
      attributes[a[1]] = decodeEntities(a[2]);
    }

    const node: LiteNode = { kind: name, attributes, children: [] };
    stack[stack.length - 1].children!.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
