/**
 * Builds the PDF in the browser.
 *
 * The whole render pipeline is isomorphic — pdf-lib, the drawing IR and the
 * imposition maths all run happily in a tab — so with notebooks stored locally
 * there is no reason to upload anything just to get a file back. The server is
 * still asked for MathJax vectors, because that is the one piece a browser
 * bundle cannot reasonably carry.
 */
import { collectMathRequests, compileNotebook } from '../compile/notebook';
import { exportNotebookPdf } from '../export/pdf';
import { slugify } from '../defaults';
import type { MathCache } from '../latex/types';
import type { Notebook } from '../types/notebook';
import { api } from './api';
import { listAssets, readAssetBytes } from './storage';

export interface BuildPdfOptions {
  notebook: Notebook;
  mode: 'imposed' | 'flat';
  /** Formulas already rendered by the editor, so they are not fetched twice. */
  math?: MathCache;
}

export async function buildNotebookPdf({
  notebook,
  mode,
  math = {},
}: BuildPdfOptions): Promise<Blob> {
  // Anything the editor has not rendered yet — a formula edited a moment ago,
  // or a notebook opened straight onto the export step.
  const missing = collectMathRequests(notebook).filter((request) => !math[request.key]);
  let resolved = math;

  if (missing.length > 0) {
    const { blobs } = await api.renderMath(missing);
    resolved = { ...math, ...blobs };
  }

  const assets = await listAssets();
  const compiled = compileNotebook(notebook, { assets, math: resolved });

  const bytes = await exportNotebookPdf({
    notebook,
    pages: compiled.pages,
    assets,
    loadAsset: readAssetBytes,
    mode,
  });

  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function pdfFileName(notebook: Notebook, mode: 'imposed' | 'flat'): string {
  const base = slugify(notebook.output.fileName || notebook.name) || 'notebook';
  return `${base}${mode === 'flat' ? '-pages' : ''}.pdf`;
}

/** Triggers a download of `blob` without leaving the page. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadJson(data: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}
