/**
 * End-to-end check: build a notebook, compile it, export a PDF.
 * Run: npm run check:pipeline   (writes ./tmp/*.pdf)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileNotebook, collectMathRequests } from '../src/lib/compile/notebook';
import { createNotebook } from '../src/lib/defaults';
import { exportNotebookPdf } from '../src/lib/export/pdf';
import { renderMathBatch } from '../src/lib/latex/mathjax.server';
import { newId } from '../src/lib/ids';
import { PRESETS } from '../src/lib/presets';
import { GENERATORS, defaultParams } from '../src/lib/parametric';
import { summarise, planSheets, generateSlots } from '../src/lib/imposition';
import { defaultPageSize, resolvePageSize } from '../src/lib/units';
import type { ContentItem, Notebook } from '../src/lib/types/notebook';
import { defaultBlockContent } from '../src/lib/types/page';

mkdirSync('tmp', { recursive: true });

function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  console.log(`  ${label}: ${(performance.now() - t0).toFixed(0)} ms`);
  return out;
}

/* ---------------------------------------------------- 1. every preset ---- */

console.log('\n== presets ==');
const pageSize = defaultPageSize('A5', 'portrait');
const presetNotebook = createNotebook({
  name: 'Preset gallery',
  pageSize,
  presetIds: PRESETS.map((p) => p.id),
});
presetNotebook.content = presetNotebook.templates.map(
  (t): ContentItem => ({ kind: 'template', id: newId('item'), templateId: t.id, count: 1, label: '' })
);

const mathRequests = collectMathRequests(presetNotebook);
const { blobs, errors: mathErrors } = renderMathBatch(mathRequests);
if (Object.keys(mathErrors).length) console.log('  math errors:', mathErrors);

const presetCompiled = timed('compile', () =>
  compileNotebook(presetNotebook, { assets: {}, math: blobs })
);
console.log(`  ${presetCompiled.pages.length} pages, ${presetCompiled.totalPages} total`);
for (const page of presetCompiled.pages) {
  console.log(`   ${String(countOps(page.ops)).padStart(6)} ops  ${page.label}`);
}
if (presetCompiled.warnings.length) console.log('  warnings:', [...new Set(presetCompiled.warnings)]);
if (presetCompiled.missingMath.length) console.log('  MISSING MATH:', presetCompiled.missingMath);

/* ------------------------------------------------- 2. every generator ---- */

console.log('\n== generators ==');
const genNotebook = createNotebook({ name: 'Generator gallery', pageSize, presetIds: ['blank'] });
genNotebook.content = GENERATORS.map(
  (g): ContentItem => ({
    kind: 'parametric',
    id: newId('item'),
    generatorId: g.id,
    params: capParams(g.id, defaultParams(g)),
    baseTemplateId: null,
    label: '',
  })
);

const genCompiled = timed('compile', () =>
  compileNotebook(genNotebook, { assets: {}, math: {} })
);
console.log(`  ${genCompiled.pages.length} pages from ${GENERATORS.length} generators`);
const perGenerator = new Map<string, number>();
for (const page of genCompiled.pages) {
  perGenerator.set(page.sourceItemId, (perGenerator.get(page.sourceItemId) ?? 0) + 1);
}
genNotebook.content.forEach((item) => {
  if (item.kind !== 'parametric') return;
  const count = perGenerator.get(item.id) ?? 0;
  const flag = count === 0 ? '  <-- PRODUCED NOTHING' : '';
  console.log(`   ${String(count).padStart(4)} pages  ${item.generatorId}${flag}`);
});
if (genCompiled.warnings.length) console.log('  warnings:', [...new Set(genCompiled.warnings)]);

/* -------------------------------------------------------- 3. exports ---- */

console.log('\n== export ==');
await exportAndReport('preset-gallery', presetNotebook, presetCompiled.pages);
await exportAndReport('generator-gallery', genNotebook, genCompiled.pages);

/* --------------------------------------------- 4. dedup + imposition ---- */

console.log('\n== dedup (200 identical dot-grid pages) ==');
const bulk = createNotebook({ name: 'Bulk', pageSize, presetIds: ['dots-5'] });
bulk.content = [
  { kind: 'template', id: newId('item'), templateId: bulk.templates[0].id, count: 200, label: '' },
];
const bulkCompiled = compileNotebook(bulk, { assets: {}, math: {} });
const distinct = new Set(bulkCompiled.pages.map((p) => p.contentKey)).size;
console.log(`  ${bulkCompiled.pages.length} pages -> ${distinct} distinct artwork page(s)`);
await exportAndReport('bulk-200', bulk, bulkCompiled.pages);

console.log('\n== imposition modes ==');
for (const mode of ['grid', 'booklet', 'cutstack'] as const) {
  const nb: Notebook = structuredClone(bulk);
  nb.imposition.mode = mode;
  nb.imposition.rows = 2;
  nb.imposition.cols = 2;
  nb.imposition.duplex = mode !== 'grid';
  const slots = generateSlots(nb.imposition);
  const sheets = planSheets(bulkCompiled.pages.length, nb.imposition);
  const summary = summarise(bulkCompiled.pages.length, nb.imposition, resolvePageSize(nb.pageSize));
  const placed = new Set<number>();
  for (const sheet of sheets) {
    for (const p of sheet.placements) if (p.pageIndex !== null) placed.add(p.pageIndex);
  }
  console.log(
    `  ${mode.padEnd(9)} slots=${slots.length} sheets=${sheets.length} scale=${summary.scalePercent}% coverage=${placed.size}/${bulkCompiled.pages.length}`
  );
  if (placed.size !== bulkCompiled.pages.length) {
    console.log('    !! not every page was placed');
  }
}

/* ------------------------------------- 5. resize retarget (A4 -> A6) ---- */

console.log('\n== retarget A4 design to A6 ==');
const latex = createNotebook({
  name: 'LaTeX retarget',
  pageSize: defaultPageSize('A4', 'portrait'),
  presetIds: ['latex-sheet'],
});
const latexMath = renderMathBatch(collectMathRequests(latex)).blobs;
for (const target of ['A4', 'A6'] as const) {
  const nb: Notebook = structuredClone(latex);
  nb.pageSize = defaultPageSize(target, 'portrait');
  const compiled = compileNotebook(nb, { assets: {}, math: latexMath });
  const textOps = countKind(compiled.pages[0]?.ops ?? [], 'text');
  console.log(`  ${target}: ${countOps(compiled.pages[0]?.ops ?? [])} ops (${textOps} text runs)`);
  if (compiled.warnings.length) console.log('    warnings:', [...new Set(compiled.warnings)]);
}

/* --------------------------------------------------- 6. graph block ---- */

console.log('\n== graph block ==');
const graphNotebook = createNotebook({ name: 'Graph block', pageSize, presetIds: ['blank'] });
graphNotebook.templates[0].blocks.push({
  id: newId('blk'),
  name: 'Plot grid',
  rect: { x: 0.04, y: 0.08, w: 0.92, h: 0.78 },
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  padding: 0,
  content: defaultBlockContent('graph'),
});
const graphCompiled = compileNotebook(graphNotebook, { assets: {}, math: {} });
const graphLines = countKind(graphCompiled.pages[0]?.ops ?? [], 'line');
const graphLabels = countKind(graphCompiled.pages[0]?.ops ?? [], 'text');
console.log(`  ${graphLines} lines, ${graphLabels} axis labels`);
if (graphLines < 40 || graphLabels < 40) throw new Error('Graph block did not render its grid and labels.');
await exportAndReport('graph-block', graphNotebook, graphCompiled.pages);

console.log('\nAll checks finished.');

/* ------------------------------------------------------------- helpers -- */

async function exportAndReport(name: string, notebook: Notebook, pages: typeof presetCompiled.pages) {
  const t0 = performance.now();
  const bytes = await exportNotebookPdf({
    notebook,
    pages,
    assets: {},
    loadAsset: async () => null,
  });
  const path = `tmp/${name}.pdf`;
  writeFileSync(path, bytes);
  console.log(
    `  ${path}: ${(bytes.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms`
  );
}

function countOps(ops: unknown[]): number {
  let total = 0;
  for (const op of ops as Array<{ kind: string; ops?: unknown[] }>) {
    total += op.kind === 'group' ? countOps(op.ops ?? []) : 1;
  }
  return total;
}

function countKind(ops: unknown[], kind: string): number {
  let total = 0;
  for (const op of ops as Array<{ kind: string; ops?: unknown[] }>) {
    if (op.kind === 'group') total += countKind(op.ops ?? [], kind);
    else if (op.kind === kind) total++;
  }
  return total;
}

/** Keeps the smoke test quick by trimming generators that default to a year. */
function capParams(id: string, params: Record<string, unknown>): Record<string, unknown> {
  const caps: Record<string, Record<string, unknown>> = {
    'calendar-month': { scope: 'range', monthCount: 2 },
    'calendar-week': { weekCount: 2 },
    'daily-planner': { dayCount: 2 },
    'meal-planner': { weekCount: 2 },
    'habit-tracker': { scope: 'single' },
    'cornell-notes': { pageCount: 2 },
    storyboard: { pageCount: 2 },
    'budget-ledger': { pageCount: 2 },
    'workout-log': { pageCount: 2 },
    'reading-log': { pageCount: 2 },
    kanban: { pageCount: 2 },
  };
  return { ...params, ...(caps[id] ?? {}) };
}
