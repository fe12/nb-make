/**
 * PDF export.
 *
 * Two passes, and the split matters:
 *
 *   1. Every *distinct* page is drawn once into an intermediate document at the
 *      notebook's trim size.
 *   2. Those pages are embedded as form XObjects into the output sheets and
 *      placed by the imposition plan.
 *
 * Because pass 1 is keyed on content, a 200-page dot-grid notebook draws one
 * page of artwork and references it 200 times. It also means imposition gets
 * vector page reuse for free: rotating and scaling a slot is a transform on an
 * XObject, not a re-render.
 */
import {
  degrees,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { AssetIndex } from '../assets';
import type { CompiledPage } from '../compile/notebook';
import { applyBleed, placeInSlot, planSheets } from '../imposition';
import { cropMarks, foldMarks, pageBorder, slotNumber } from '../imposition/marks';
import { collectAssetIds, group, translate, type Op } from '../render/ops';
import { drawOps, FontPool } from '../render/pdf';
import type { Notebook } from '../types/notebook';
import {
  hasBleed,
  mmToPt,
  resolvePageSize,
  type Bleed,
  type Rect,
  type Size,
} from '../units';

export interface ExportOptions {
  notebook: Notebook;
  pages: CompiledPage[];
  assets: AssetIndex;
  /** Reads an asset's bytes; only called for assets the pages actually use. */
  loadAsset: (id: string) => Promise<Uint8Array | null>;
  /**
   * `imposed` applies the print layout; `flat` writes one trim-size page per
   * notebook page, which is what you want for a duplex printer that will do its
   * own scaling, or for proofing.
   */
  mode?: 'imposed' | 'flat';
}

export async function exportNotebookPdf(options: ExportOptions): Promise<Uint8Array> {
  const { notebook, pages, mode = 'imposed' } = options;
  const trimSize = resolvePageSize(notebook.pageSize);

  const inner = await PDFDocument.create();
  const images = await embedImages(inner, pages, options);
  const fontPool = new FontPool(inner);

  // Pass 1 — one intermediate page per distinct content key.
  //
  // A page's box is its trim size grown by its bleed, with the artwork
  // translated into place. Embedding copies this box into a Form XObject whose
  // BBox is the whole thing, which is what lets the overhang survive into the
  // sheets: a trim-sized box would clip the bleed away at this exact line.
  const keyToIndex = new Map<string, number>();
  for (const page of pages) {
    if (keyToIndex.has(page.contentKey)) continue;
    keyToIndex.set(page.contentKey, keyToIndex.size);

    const box = bleedBox(page.size, page.bleed);
    const pdfPage = addEmbeddablePage(inner, box.size);
    const fonts = await fontPool.preload(page.ops);
    // The wrapping group is a pure translation — flatten resolves it into the
    // leaf ops, so stroke batching and everything downstream is unaffected.
    const placed = hasBleed(page.bleed)
      ? [group(page.ops, translate(page.bleed.left, page.bleed.top))]
      : page.ops;
    drawOps({ page: pdfPage, heightMm: box.size.h, fonts, images }, placed);
  }

  if (keyToIndex.size === 0) {
    // An empty notebook still has to produce a valid file.
    addEmbeddablePage(inner, trimSize);
    keyToIndex.set('empty', 0);
  }

  const out = await PDFDocument.create();
  applyMetadata(out, notebook);

  // pdf-lib embeds fonts and images lazily: `embedFont`/`embedPng` only reserve
  // an object number, and the object itself is not registered in the document's
  // context until `save()`/`flush()` runs. `embedPdf` copies pages by walking
  // that context, so an unflushed asset copies across as a dangling reference
  // and is silently dropped by PDF viewers — pictures placed on pages vanished
  // from the final file this way. Flushing the intermediate document first
  // makes the pages reference real, copyable objects.
  await inner.flush();

  const embedded = await out.embedPdf(inner, [...keyToIndex.values()]);
  const byKey = new Map<string, PDFEmbeddedPage>();
  for (const [key, index] of keyToIndex) byKey.set(key, embedded[index]);

  if (mode === 'flat') {
    for (const page of pages) {
      const target = out.addPage([mmToPt(page.size.w), mmToPt(page.size.h)]);
      const art = byKey.get(page.contentKey);
      if (art) {
        // Pages compiled with bleed draw here offset so the trim box lands on
        // the page; the overhang falls outside the MediaBox and viewers clip
        // it. Flat output is meant for a printer doing its own scaling, so the
        // sheet stays at exact trim.
        target.drawPage(art, {
          x: -mmToPt(page.bleed.left),
          y: -mmToPt(page.bleed.bottom),
          width: mmToPt(page.size.w + page.bleed.left + page.bleed.right),
          height: mmToPt(page.size.h + page.bleed.top + page.bleed.bottom),
        });
      }
    }
  } else {
    await drawImposedSheets(out, byKey, options, trimSize);
  }

  if (out.getPageCount() === 0) {
    out.addPage([mmToPt(trimSize.w), mmToPt(trimSize.h)]);
  }

  return out.save({ useObjectStreams: true });
}

async function drawImposedSheets(
  out: PDFDocument,
  byKey: Map<string, PDFEmbeddedPage>,
  options: ExportOptions,
  trimSize: Size
): Promise<void> {
  const { notebook, pages } = options;
  const imposition = notebook.imposition;
  const bleedMm = imposition.bleed;
  // Gutters and sheet margins grow to hold the overhang (see applyBleed);
  // everything downstream — slot generation, placement, marks — uses the
  // grown geometry so the sheet is exactly what the preview showed.
  const effective = applyBleed(imposition, bleedMm);
  const sheetSize = resolvePageSize(effective.sheet);
  const sheets = planSheets(pages.length, effective);
  const fontPool = new FontPool(out);

  for (const sheet of sheets) {
    const target = out.addPage([mmToPt(sheetSize.w), mmToPt(sheetSize.h)]);
    const marks: Op[] = [...foldMarks(sheetSize, effective)];

    for (const placement of sheet.placements) {
      const geometry = placeInSlot(placement.slot, trimSize, effective);
      marks.push(...pageBorder(geometry.rect, effective));
      marks.push(...cropMarks(geometry.rect, imposition, bleedMm));

      if (placement.pageIndex === null) {
        marks.push(...slotNumber(geometry.rect, '—', effective));
        continue;
      }

      const page = pages[placement.pageIndex];
      const art = page && byKey.get(page.contentKey);
      if (!art) continue;

      marks.push(...slotNumber(geometry.rect, String(placement.pageIndex + 1), effective));
      drawPlacedPage(target, art, geometry.rect, geometry.rotation, sheetSize, page.bleed);
    }

    if (marks.length > 0) {
      const fonts = await fontPool.preload(marks);
      drawOps({ page: target, heightMm: sheetSize.h, fonts, images: new Map() }, marks);
    }
  }
}

/**
 * Places an embedded page so that its *trim box* exactly covers `rect` (given
 * in millimetres, top-left origin) after rotating it clockwise by `rotation`,
 * with any bleed hanging outside the rect.
 *
 * The embedded form covers trim + bleed on every side, so the draw anchor is
 * derived from the trim box's centre inside the form: with the form drawn at
 * scale, the anchor must sit at the target centre minus the rotated, scaled
 * offset of the form-space trim centre. One formula covers all four quarter
 * turns and collapses to the plain corner anchor when there is no bleed.
 */
function drawPlacedPage(
  target: PDFPage,
  art: PDFEmbeddedPage,
  rect: Rect,
  rotation: number,
  sheetSize: Size,
  bleed: Bleed
): void {
  // Convert the covered area to PDF coordinates (Y up from the sheet bottom).
  const X = mmToPt(rect.x);
  const Y = mmToPt(sheetSize.h - rect.y - rect.h);
  const W = mmToPt(rect.w);
  const H = mmToPt(rect.h);

  // pdf-lib's rotation is anticlockwise; ours is clockwise on the printed page.
  const theta = (360 - (rotation % 360)) % 360;
  const rad = (theta * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // The form is trim + bleed; the drawn box swaps extents on quarter turns.
  const quarter = theta === 90 || theta === 270;

  // Trim box size in form space (also PDF points).
  const fw = art.width;
  const fh = art.height;
  const trimW = fw - mmToPt(bleed.left) - mmToPt(bleed.right);
  const trimH = fh - mmToPt(bleed.bottom) - mmToPt(bleed.top);

  // The trim box maps onto the (rotated) rect, so the scale is decided by the
  // trim box — NOT by the form: the form is drawn at this scale times its own
  // full size, which is what lets the bleed hang outside the rect. Drawing the
  // form at W×H would squeeze trim + bleed into the trim box.
  const s = quarter ? W / trimH : W / trimW;
  const width = fw * s;
  const height = fh * s;

  // Trim box centre in form space — left bleed plus half the trim width, i.e.
  // the centre's distance from the form's origin. Scaled and rotated, this is
  // the anchor offset from the drawn form's origin.
  const cx = mmToPt(bleed.left) + trimW / 2;
  const cy = mmToPt(bleed.bottom) + trimH / 2;

  target.drawPage(art, {
    x: X + W / 2 - (cx * s * cos - cy * s * sin),
    y: Y + H / 2 - (cx * s * sin + cy * s * cos),
    width,
    height,
    rotate: degrees(theta),
  });
}

/** A page's media box with its bleed included, plus the offset the art sits at. */
function bleedBox(size: Size, bleed: Bleed): { size: Size } {
  return {
    size: {
      w: size.w + bleed.left + bleed.right,
      h: size.h + bleed.top + bleed.bottom,
    },
  };
}

/**
 * Adds a page that is always safe to embed later.
 *
 * pdf-lib refuses to embed a page with no `/Contents`, which a genuinely blank
 * design (the "Blank" preset, or a slot that draws nothing) would otherwise
 * produce. Pushing a balanced, empty graphics-state pair forces a content
 * stream into existence without marking the page.
 */
function addEmbeddablePage(doc: PDFDocument, size: Size): PDFPage {
  const page = doc.addPage([mmToPt(size.w), mmToPt(size.h)]);
  page.pushOperators(pushGraphicsState(), popGraphicsState());
  return page;
}

async function embedImages(
  doc: PDFDocument,
  pages: CompiledPage[],
  options: ExportOptions
): Promise<Map<string, PDFImage>> {
  const ids = new Set<string>();
  for (const page of pages) collectAssetIds(page.ops, ids);

  const images = new Map<string, PDFImage>();
  for (const id of ids) {
    const meta = options.assets[id];
    if (!meta) continue;
    const bytes = await options.loadAsset(id);
    if (!bytes) continue;
    try {
      const image =
        meta.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      images.set(id, image);
    } catch {
      // A corrupt or unsupported image must not fail the whole export; the page
      // simply renders without it.
    }
  }
  return images;
}

function applyMetadata(doc: PDFDocument, notebook: Notebook): void {
  doc.setTitle(notebook.output.title || notebook.name);
  if (notebook.output.author) doc.setAuthor(notebook.output.author);
  doc.setSubject(notebook.description || '');
  doc.setCreator('nb-make');
  doc.setProducer('nb-make');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
}
