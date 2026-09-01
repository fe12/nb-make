/**
 * Assertions for imposition ordering and placement.
 * Run: npm run check:imposition
 */
import { generateSlots, placeInSlot, planSheets } from '../src/lib/imposition';
import { createNotebook } from '../src/lib/defaults';
import { defaultPageSize, resolvePageSize } from '../src/lib/units';
import type { Imposition } from '../src/lib/types/notebook';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

function assert(label: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

const base = createNotebook({ name: 'test', pageSize: defaultPageSize('A5', 'portrait') });

function impositionWith(patch: Partial<Imposition>): Imposition {
  return { ...structuredClone(base.imposition), ...patch };
}

/** 1-based page numbers per sheet side, for readability. */
function order(pageCount: number, imposition: Imposition): number[][] {
  return planSheets(pageCount, imposition).map((sheet) =>
    sheet.placements.map((p) => (p.pageIndex === null ? 0 : p.pageIndex + 1))
  );
}

console.log('\n== booklet (saddle stitch) ==');
// One folded sheet holds four pages. The outermost sheet carries the first and
// last pages, so an 8-page booklet imposes as 8|1, 2|7, 6|3, 4|5.
const booklet = impositionWith({ mode: 'booklet', duplex: true, mirrorBackSide: false });
check('8 pages', order(8, booklet), [
  [8, 1],
  [2, 7],
  [6, 3],
  [4, 5],
]);
// A 6-page booklet pads to 8; the two missing pages become blanks (0).
check('6 pages pads to 8', order(6, booklet), [
  [0, 1],
  [2, 0],
  [6, 3],
  [4, 5],
]);

console.log('\n== sequential grid ==');
const grid = impositionWith({ mode: 'grid', rows: 2, cols: 2, duplex: false });
check('8 pages, 4-up, single sided', order(8, grid), [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
]);

const gridDuplex = impositionWith({ mode: 'grid', rows: 2, cols: 2, duplex: true, mirrorBackSide: false });
check('8 pages, 4-up, duplex', order(8, gridDuplex), [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
]);

console.log('\n== cut and stack ==');
// Print all sheets, guillotine into N piles, stack the piles: each slot takes a
// consecutive block, so pile j reads sequentially top to bottom.
const cut = impositionWith({ mode: 'cutstack', rows: 2, cols: 2, duplex: false });
check('8 pages, 4-up', order(8, cut), [
  [1, 3, 5, 7],
  [2, 4, 6, 8],
]);

console.log('\n== coverage: every page placed exactly once ==');
for (const [label, imposition] of [
  ['grid', grid],
  ['grid duplex', gridDuplex],
  ['cutstack', cut],
  ['booklet', booklet],
] as const) {
  for (const pageCount of [1, 7, 8, 33, 100]) {
    const placed: number[] = [];
    for (const sheet of planSheets(pageCount, imposition)) {
      for (const p of sheet.placements) if (p.pageIndex !== null) placed.push(p.pageIndex);
    }
    const unique = new Set(placed);
    assert(
      `${label} / ${pageCount} pages`,
      unique.size === pageCount && placed.length === pageCount,
      `placed ${placed.length}, unique ${unique.size}`
    );
  }
}

console.log('\n== duplex mirroring ==');
const mirrored = impositionWith({ mode: 'grid', rows: 1, cols: 2, duplex: true, mirrorBackSide: true });
const sheets = planSheets(4, mirrored);
const sheetSize = resolvePageSize(mirrored.sheet);
const frontX = sheets[0].placements.map((p) => p.slot.x);
const backX = sheets[1].placements.map((p) => p.slot.x);
// Slot i on the back must sit where slot i's mirror image lands on the front.
assert(
  'back side is mirrored horizontally',
  backX.every((x, i) => {
    const slot = sheets[0].placements[i].slot;
    return Math.abs(x - (sheetSize.w - frontX[i] - slot.w)) < 1e-6;
  }),
  `front ${JSON.stringify(frontX)} back ${JSON.stringify(backX)}`
);

console.log('\n== placement geometry ==');
const pageSize = resolvePageSize(base.pageSize);
const twoUp = impositionWith({ mode: 'grid', rows: 2, cols: 1 });
const slot = generateSlots(twoUp)[0];
const flat = placeInSlot(slot, pageSize, twoUp);
// A5 (148x210) into a 200x143.5 slot is limited by height: 143.5/210.
check('unrotated scale', Math.round(flat.scale * 1000) / 1000, Math.round((143.5 / 210) * 1000) / 1000);
assert(
  'unrotated page is centred in its slot',
  Math.abs(flat.rect.x + flat.rect.w / 2 - (slot.x + slot.w / 2)) < 1e-6 &&
    Math.abs(flat.rect.y + flat.rect.h / 2 - (slot.y + slot.h / 2)) < 1e-6
);

const turned = placeInSlot({ ...slot, rotation: 90 }, pageSize, twoUp);
// Rotated, the page presents 210x148, so the limit becomes width: 200/210.
check('rotated scale', Math.round(turned.scale * 1000) / 1000, Math.round((200 / 210) * 1000) / 1000);
check(
  'rotated covered area is transposed',
  [Math.round(turned.rect.w * 10) / 10, Math.round(turned.rect.h * 10) / 10],
  [Math.round(210 * (200 / 210) * 10) / 10, Math.round(148 * (200 / 210) * 10) / 10]
);

assert(
  'page never exceeds its slot',
  turned.rect.w <= slot.w + 1e-6 && turned.rect.h <= slot.h + 1e-6,
  `${turned.rect.w}x${turned.rect.h} vs ${slot.w}x${slot.h}`
);

console.log(failures === 0 ? '\nAll imposition checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
