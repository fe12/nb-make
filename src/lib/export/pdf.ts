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
import { placeInSlot, planSheets } from '../imposition';
import { cropMarks, foldMarks, pageBorder, slotNumber } from '../imposition/marks';
import { collectAssetIds, type Op } from '../render/ops';
import { drawOps, FontPool } from '../render/pdf';
import type { Notebook } from '../types/notebook';
import { mmToPt, resolvePageSize, type Rect, type Size } from '../units';

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
  const keyToIndex = new Map<string, number>();
  for (const page of pages) {
    if (keyToIndex.has(page.contentKey)) continue;
    keyToIndex.set(page.contentKey, keyToIndex.size);

    const pdfPage = addEmbeddablePage(inner, page.size);
    const fonts = await fontPool.preload(page.ops);
    drawOps({ page: pdfPage, heightMm: page.size.h, fonts, images }, page.ops);
  }

  if (keyToIndex.size === 0) {
    // An empty notebook still has to produce a valid file.
    addEmbeddablePage(inner, trimSize);
    keyToIndex.set('empty', 0);
  }

  const out = await PDFDocument.create();
  applyMetadata(out, notebook);

  const embedded = await out.embedPdf(inner, [...keyToIndex.values()]);
  const byKey = new Map<string, PDFEmbeddedPage>();
  for (const [key, index] of keyToIndex) byKey.set(key, embedded[index]);

  if (mode === 'flat') {
    for (const page of pages) {
      const target = out.addPage([mmToPt(page.size.w), mmToPt(page.size.h)]);
      const art = byKey.get(page.contentKey);
      if (art) {
        target.drawPage(art, {
          x: 0,
          y: 0,
          width: mmToPt(page.size.w),
          height: mmToPt(page.size.h),
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
  const sheetSize = resolvePageSize(imposition.sheet);
  const sheets = planSheets(pages.length, imposition);
  const fontPool = new FontPool(out);

  for (const sheet of sheets) {
    const target = out.addPage([mmToPt(sheetSize.w), mmToPt(sheetSize.h)]);
    const marks: Op[] = [...foldMarks(sheetSize, imposition)];

    for (const placement of sheet.placements) {
      const geometry = placeInSlot(placement.slot, trimSize, imposition);
      marks.push(...pageBorder(geometry.rect, imposition));
      marks.push(...cropMarks(geometry.rect, imposition));

      if (placement.pageIndex === null) {
        marks.push(...slotNumber(geometry.rect, '—', imposition));
        continue;
      }

      const page = pages[placement.pageIndex];
      const art = page && byKey.get(page.contentKey);
      if (!art) continue;

      marks.push(...slotNumber(geometry.rect, String(placement.pageIndex + 1), imposition));
      drawPlacedPage(target, art, geometry.rect, geometry.rotation, sheetSize);
    }

    if (marks.length > 0) {
      const fonts = await fontPool.preload(marks);
      drawOps({ page: target, heightMm: sheetSize.h, fonts, images: new Map() }, marks);
    }
  }
}

/**
 * Places an embedded page so that it exactly covers `rect` (given in
 * millimetres, top-left origin) after rotating it clockwise by `rotation`.
 *
 * pdf-lib emits `translate(x,y) · rotate(θ) · scale(...)`, and rotates
 * anticlockwise in PDF's Y-up space. Each quarter turn therefore needs a
 * different anchor corner — hence the explicit four-case table rather than a
 * general formula that would be harder to verify.
 */
function drawPlacedPage(
  target: PDFPage,
  art: PDFEmbeddedPage,
  rect: Rect,
  rotation: number,
  sheetSize: Size
): void {
  // Convert the covered area to PDF coordinates (Y up from the sheet bottom).
  const X = mmToPt(rect.x);
  const Y = mmToPt(sheetSize.h - rect.y - rect.h);
  const W = mmToPt(rect.w);
  const H = mmToPt(rect.h);

  // pdf-lib's rotation is anticlockwise; ours is clockwise on the printed page.
  const theta = (360 - (rotation % 360)) % 360;

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  switch (theta) {
    case 90:
      x = X + W;
      y = Y;
      width = H;
      height = W;
      break;
    case 180:
      x = X + W;
      y = Y + H;
      width = W;
      height = H;
      break;
    case 270:
      x = X;
      y = Y + H;
      width = H;
      height = W;
      break;
    default:
      x = X;
      y = Y;
      width = W;
      height = H;
  }

  target.drawPage(art, { x, y, width, height, rotate: degrees(theta) });
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
