/**
 * Expands a notebook's running order into a flat list of compiled pages.
 *
 * Repetition is resolved here rather than being stored: "20 × [dot, dot,
 * ruled]" stays three entries on disk and becomes sixty pages at compile time.
 * Pages that are byte-identical share an ops array by reference, which the PDF
 * exporter exploits to embed the artwork once and reference it many times.
 */
import type { AssetIndex } from '../assets';
import { parseLatex } from '../latex/parse';
import type { MathCache } from '../latex/types';
import { getGenerator, coerceParams, paramsForStep, type GeneratedPage } from '../parametric';
import type { Op } from '../render/ops';
import { applyPalette } from '../render/palette';
import type { Notebook } from '../types/notebook';
import type { PageTemplate } from '../types/page';
import { contentRect, hasBleed, resolvePageSize, type Bleed, type Size, ZERO_BLEED } from '../units';
import { compileTemplate, formatPageNumber, type PageNumberContext } from './page';

export interface CompiledPage {
  index: number;
  label: string;
  size: Size;
  /**
   * The bleed the page was compiled with. Export sizes its intermediate page
   * box by this so the overhanging artwork survives embedding; zero bleed is
   * the historical behaviour.
   */
  bleed: Bleed;
  ops: Op[];
  /**
   * Identical pages share a key. The exporter embeds one XObject per distinct
   * key, which is what keeps a 200-page dot-grid notebook small.
   */
  contentKey: string;
  /** Where this page came from, for highlighting in the UI. */
  sourceItemId: string;
}

export interface CompileNotebookOptions {
  assets: AssetIndex;
  math: MathCache;
  /** Stop after this many pages, for fast previews. */
  limit?: number;
  /**
   * Print bleed, in millimetres past the trim edge. Only template-based pages
   * honour it — parametric generators draw self-contained artwork and are left
   * exactly as authored.
   */
  bleed?: Bleed;
}

export interface CompiledNotebook {
  pages: CompiledPage[];
  /** Total the notebook would produce, even when `limit` truncated the result. */
  totalPages: number;
  missingMath: string[];
  warnings: string[];
}

export function compileNotebook(
  notebook: Notebook,
  options: CompileNotebookOptions
): CompiledNotebook {
  const size = resolvePageSize(notebook.pageSize);
  const content = contentRect(size, notebook.margins);
  const templates = new Map(notebook.templates.map((t) => [t.id, t]));
  const bleed = options.bleed ?? ZERO_BLEED;
  // Folded into content keys so a bled and an un-bled compile of the same
  // design never share embedded artwork.
  const bleedKey = hasBleed(bleed)
    ? `@b${bleed.top},${bleed.right},${bleed.bottom},${bleed.left}`
    : '';

  const missingMath = new Set<string>();
  const warnings: string[] = [];

  // Pass 1: expand the running order into page sources without compiling.
  const sources = expandSources(notebook, templates, { size, content }, warnings);
  const totalPages = sources.length;
  const limit = options.limit ?? Infinity;

  // Pass 2: compile, caching by template so repeated pages share an ops array.
  const templateCache = new Map<string, Op[]>();
  const generatedPalette = new Map<Op[], Op[]>();
  const numbering = notebook.output.pageNumbering;
  const pages: CompiledPage[] = [];

  for (let i = 0; i < Math.min(sources.length, limit); i++) {
    const source = sources[i];
    let baseOps: Op[];
    let baseKey: string;

    if (source.kind === 'template') {
      const cached = templateCache.get(source.template.id);
      if (cached) {
        baseOps = cached;
      } else {
        const compiled = compileTemplate(source.template, {
          size,
          margins: notebook.margins,
          assets: options.assets,
          math: options.math,
          palette: notebook.palette,
          bleed,
        });
        compiled.missingMath.forEach((k) => missingMath.add(k));
        compiled.warnings.forEach((w) => warnings.push(w));
        baseOps = compiled.ops;
        templateCache.set(source.template.id, baseOps);
      }
      baseKey = `t:${source.template.id}${bleedKey}`;
    } else {
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
    }

    const info: PageNumberContext = {
      number: numbering.startAt + Math.max(0, i - numbering.skipFirst),
      total: totalPages,
      title: notebook.name,
      isRecto: i % 2 === 0,
    };

    const overlay =
      numbering.enabled && i >= numbering.skipFirst
        ? pageNumberOverlay(size, notebook, info)
        : [];

    const overlayKey = overlay.length ? `#${formatPageNumber(numbering.format, info)}` : '';

    pages.push({
      index: i,
      label: source.label,
      size,
      bleed,
      // Concatenating only when there is an overlay preserves the shared
      // reference in the common case.
      ops: overlay.length ? [...baseOps, ...overlay] : baseOps,
      contentKey: `${baseKey}${overlayKey}`,
      sourceItemId: source.itemId,
    });
  }

  return { pages, totalPages, missingMath: [...missingMath], warnings };
}

type PageSource =
  | { kind: 'template'; template: PageTemplate; label: string; itemId: string }
  | { kind: 'parametric'; ops: Op[]; key: string; label: string; itemId: string };

function expandSources(
  notebook: Notebook,
  templates: Map<string, PageTemplate>,
  geometry: { size: Size; content: ReturnType<typeof contentRect> },
  warnings: string[]
): PageSource[] {
  const sources: PageSource[] = [];
  // Generated pages that repeat share an ops array; give each array one key.
  const generatedKeys = new Map<Op[], string>();
  let generatedSeq = 0;

  const keyFor = (ops: Op[]): string => {
    let key = generatedKeys.get(ops);
    if (!key) {
      key = `g:${generatedSeq++}`;
      generatedKeys.set(ops, key);
    }
    return key;
  };

  /**
   * Generator output cached by id + parameters.
   *
   * A repeating section calls into the same generator once per repetition. When
   * the parameters are identical the pages are too, so reusing the result keeps
   * the ops arrays reference-equal — which is what lets the exporter embed the
   * artwork once instead of once per repeat.
   */
  const generatedCache = new Map<string, GeneratedPage[]>();

  const pushLeaf = (
    item: Extract<Notebook['content'][number], { kind: 'template' | 'parametric' }>,
    step: number | null
  ) => {
    if (item.kind === 'template') {
      const template = templates.get(item.templateId);
      if (!template) {
        warnings.push(`Skipped a missing page design (${item.templateId}).`);
        return;
      }
      for (let i = 0; i < item.count; i++) {
        sources.push({
          kind: 'template',
          template,
          label: item.label || template.name,
          itemId: item.id,
        });
      }
      return;
    }

    const generator = getGenerator(item.generatorId);
    if (!generator) {
      warnings.push(`Skipped an unknown generator (${item.generatorId}).`);
      return;
    }

    const params = coerceParams(generator, paramsForStep(generator, item.params, step));
    const cacheKey = `${generator.id}:${JSON.stringify(params)}`;

    let generated = generatedCache.get(cacheKey);
    if (!generated) {
      try {
        generated = generator.generate(params, {
          size: geometry.size,
          content: geometry.content,
          margins: notebook.margins,
        });
      } catch (error) {
        warnings.push(
          `${generator.name} failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
      generatedCache.set(cacheKey, generated);
    }

    for (const page of generated) {
      sources.push({
        kind: 'parametric',
        ops: page.ops,
        key: keyFor(page.ops),
        label: item.label || page.label,
        itemId: item.id,
      });
    }
  };

  for (const item of notebook.content) {
    if (item.kind === 'group') {
      for (let r = 0; r < item.repeat; r++) {
        for (const leaf of item.items) pushLeaf(leaf, item.advanceDates ? r : null);
      }
    } else {
      pushLeaf(item, null);
    }
  }

  return sources;
}

/** Notebook-wide page number, drawn outside the block system. */
function pageNumberOverlay(size: Size, notebook: Notebook, info: PageNumberContext): Op[] {
  const cfg = notebook.output.pageNumbering;
  const value = formatPageNumber(cfg.format, info);
  if (!value) return [];

  const top = cfg.position.startsWith('top');
  const y = top ? cfg.margin : size.h - cfg.margin;

  let x: number;
  let align: 'left' | 'center' | 'right';

  switch (cfg.position) {
    case 'bottom-left':
      x = notebook.margins.left;
      align = 'left';
      break;
    case 'bottom-right':
      x = size.w - notebook.margins.right;
      align = 'right';
      break;
    case 'bottom-outer':
    case 'top-outer':
      // On a bound book the outer edge alternates: right on recto, left on verso.
      x = info.isRecto ? size.w - notebook.margins.right : notebook.margins.left;
      align = info.isRecto ? 'right' : 'left';
      break;
    case 'bottom-inner':
      x = info.isRecto ? notebook.margins.left : size.w - notebook.margins.right;
      align = info.isRecto ? 'left' : 'right';
      break;
    default:
      x = size.w / 2;
      align = 'center';
  }

  return [
    {
      kind: 'text',
      x,
      y,
      text: value,
      font: { family: cfg.font.family, bold: cfg.font.bold, italic: cfg.font.italic },
      size: cfg.size,
      color: cfg.color,
      align,
      baseline: top ? 'top' : 'alphabetic',
    },
  ];
}

/**
 * Every formula the notebook references, so the caller can render them in one
 * batch before compiling instead of discovering them page by page.
 */
export function collectMathRequests(
  notebook: Notebook
): Array<{ key: string; tex: string; display: boolean }> {
  const out = new Map<string, { key: string; tex: string; display: boolean }>();
  for (const template of notebook.templates) {
    for (const block of template.blocks) {
      if (block.content.type !== 'latex' || !block.content.source.trim()) continue;
      const doc = parseLatex(block.content.source);
      for (const key of doc.mathKeys) {
        if (!out.has(key)) out.set(key, { key, ...doc.formulas[key] });
      }
    }
  }
  return [...out.values()];
}
