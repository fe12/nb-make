/**
 * Browser-side persistence.
 *
 * Notebooks are small JSON documents, so they live in `localStorage` where they
 * can be read synchronously and eyeballed in devtools. Image bytes would blow
 * the ~5 MB localStorage budget in one upload, so they live in IndexedDB
 * instead. Nothing is sent anywhere: the server is only ever asked to render
 * LaTeX, never to store.
 */
import { newId } from '../ids';
import type { AssetIndex, AssetMeta } from '../assets';
import { zNotebook, type Notebook, type NotebookSummary } from '../types/notebook';
import { defaultPageSize, resolvePageSize } from '../units';

const NOTEBOOK_PREFIX = 'nb-make:notebook:';
const SETTINGS_KEY = 'nb-make:settings';

export class StorageError extends Error {}

/* ------------------------------------------------------------ change feed */

/**
 * Notifies interested code that browser storage changed.
 *
 * The sync layer needs to know when a notebook is written so it can schedule a
 * push. An event beats polling, and beats threading a callback through every
 * caller of `writeNotebook`.
 */
export type StorageEvent = { type: 'write' | 'delete'; id: string };

const listeners = new Set<(event: StorageEvent) => void>();

export function onStorageChange(listener: (event: StorageEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: StorageEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A misbehaving subscriber must not break the write that triggered it.
    }
  }
}

/* ------------------------------------------------------------- notebooks */

function readRaw(id: string): unknown | null {
  try {
    const raw = localStorage.getItem(NOTEBOOK_PREFIX + id);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Parses a stored notebook, tolerating documents written by older versions.
 * A file that cannot be repaired is skipped rather than breaking the listing.
 */
function parseNotebook(raw: unknown): Notebook | null {
  const parsed = zNotebook.safeParse(raw);
  if (parsed.success) return parsed.data;

  const repaired = zNotebook.safeParse(migrate(raw));
  return repaired.success ? repaired.data : null;
}

function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data = { ...(raw as Record<string, unknown>) };

  if (!data.stats) data.stats = null;
  if (!data.pageSize) data.pageSize = defaultPageSize('A5', 'portrait');
  if (!Array.isArray(data.templates)) data.templates = [];
  if (!Array.isArray(data.content)) data.content = [];

  // `advanceDates` arrived with sequenced sections; older groups simply repeat.
  if (Array.isArray(data.content)) {
    data.content = (data.content as Array<Record<string, unknown>>).map((item) =>
      item && item.kind === 'group' && item.advanceDates === undefined
        ? { ...item, advanceDates: false }
        : item
    );
  }
  return data;
}

export function listNotebookIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(NOTEBOOK_PREFIX)) ids.push(key.slice(NOTEBOOK_PREFIX.length));
  }
  return ids;
}

export function readNotebook(id: string): Notebook | null {
  const raw = readRaw(id);
  return raw === null ? null : parseNotebook(raw);
}

export function writeNotebook(notebook: Notebook): Notebook {
  const next: Notebook = { ...notebook, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(NOTEBOOK_PREFIX + next.id, JSON.stringify(next));
  } catch (error) {
    // Quota is the realistic failure here, and silently losing an edit would be
    // much worse than surfacing it.
    throw new StorageError(
      isQuotaError(error)
        ? 'Browser storage is full. Export a notebook to JSON and delete it to free space.'
        : 'Could not save to browser storage.'
    );
  }
  emit({ type: 'write', id: next.id });
  return next;
}

export function deleteNotebook(id: string): void {
  localStorage.removeItem(NOTEBOOK_PREFIX + id);
  emit({ type: 'delete', id });
}

export function duplicateNotebook(id: string): Notebook | null {
  const source = readNotebook(id);
  if (!source) return null;

  const now = new Date().toISOString();
  return writeNotebook({
    ...structuredClone(source),
    id: newId('nb'),
    name: `${source.name} copy`,
    createdAt: now,
    updatedAt: now,
  });
}

export function listNotebooks(): NotebookSummary[] {
  const summaries: NotebookSummary[] = [];
  for (const id of listNotebookIds()) {
    const notebook = readNotebook(id);
    if (notebook) summaries.push(summarise(notebook));
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function summarise(notebook: Notebook): NotebookSummary {
  const size = resolvePageSize(notebook.pageSize);
  const label =
    notebook.pageSize.name === 'Custom'
      ? `${round(size.w)}×${round(size.h)} mm`
      : `${notebook.pageSize.name} ${notebook.pageSize.orientation}`;

  return {
    id: notebook.id,
    name: notebook.name,
    description: notebook.description,
    pageSizeLabel: label,
    pageCount: notebook.stats?.pageCount ?? 0,
    templateCount: notebook.templates.length,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/* ---------------------------------------------------------------- assets */

const DB_NAME = 'nb-make';
const DB_VERSION = 1;
const ASSET_STORE = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new StorageError('IndexedDB unavailable'));
  });
  return dbPromise;
}

interface AssetRecord extends AssetMeta {
  bytesData: ArrayBuffer;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(ASSET_STORE, mode);
        const request = run(tx.objectStore(ASSET_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new StorageError('Asset store failed'));
      })
  );
}

const toMeta = (record: AssetRecord): AssetMeta => {
  const { bytesData: _bytes, ...meta } = record;
  void _bytes;
  return meta;
};

export async function listAssets(): Promise<AssetIndex> {
  const records = await transact<AssetRecord[]>('readonly', (store) => store.getAll());
  const index: AssetIndex = {};
  for (const record of records) index[record.id] = toMeta(record);
  return index;
}

export async function readAssetBytes(id: string): Promise<Uint8Array | null> {
  const record = await transact<AssetRecord | undefined>('readonly', (store) => store.get(id));
  return record ? new Uint8Array(record.bytesData) : null;
}

export async function saveAsset(file: File): Promise<AssetMeta> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new StorageError('Only PNG and JPEG images can be embedded in a PDF.');
  }

  const buffer = await file.arrayBuffer();
  const dimensions = await measureImage(file);

  const record: AssetRecord = {
    id: newId('img'),
    name: file.name.slice(0, 120) || 'image',
    mime: file.type,
    width: dimensions.width,
    height: dimensions.height,
    bytes: buffer.byteLength,
    createdAt: new Date().toISOString(),
    bytesData: buffer,
  };

  await transact('readwrite', (store) => store.put(record));
  return toMeta(record);
}

export async function deleteAsset(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}

/** Intrinsic pixel size, which the layout engine needs to honour aspect ratio. */
function measureImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      // A 4:3 guess keeps a corrupt upload from breaking the page layout.
      resolve({ width: 4, height: 3 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/* -------------------------------------------------------------- settings */

export interface AppSettings {
  themeId: string;
}

export const DEFAULT_SETTINGS: AppSettings = { themeId: 'graph' };

export function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A theme preference is not worth failing an interaction over.
  }
}

/* ------------------------------------------------------- import / export */

/** Wrapper written by "export", so an import can sanity-check what it is given. */
export interface NotebookBundle {
  format: 'nb-make/notebook';
  version: 1;
  exportedAt: string;
  notebooks: Notebook[];
  /** Base64 image bytes, keyed by asset id, for assets the notebooks use. */
  assets: Record<string, { meta: AssetMeta; data: string }>;
}

export async function exportBundle(ids: string[]): Promise<NotebookBundle> {
  const notebooks = ids.map(readNotebook).filter((n): n is Notebook => n !== null);

  // Only ship the images these notebooks actually reference — exporting one
  // notebook should not drag the whole image library along.
  const needed = new Set<string>();
  for (const notebook of notebooks) {
    for (const template of notebook.templates) {
      for (const block of template.blocks) {
        if (block.content.type === 'image' && block.content.assetId) {
          needed.add(block.content.assetId);
        }
      }
    }
  }

  const index = await listAssets();
  const assets: NotebookBundle['assets'] = {};
  for (const id of needed) {
    const meta = index[id];
    const bytes = await readAssetBytes(id);
    if (meta && bytes) assets[id] = { meta, data: bytesToBase64(bytes) };
  }

  return {
    format: 'nb-make/notebook',
    version: 1,
    exportedAt: new Date().toISOString(),
    notebooks,
    assets,
  };
}

export interface ImportResult {
  imported: Notebook[];
  skipped: number;
  assetCount: number;
}

/**
 * Imports a bundle, always under fresh notebook ids so an import can never
 * overwrite something already in the browser. Asset ids are preserved when
 * free and remapped when they collide.
 */
export async function importBundle(raw: unknown): Promise<ImportResult> {
  const bundle = raw as Partial<NotebookBundle>;
  const incoming = Array.isArray(bundle?.notebooks)
    ? bundle.notebooks
    : // Also accept a bare notebook, which is what a hand-edited file tends to be.
      [raw as Notebook];

  const existingAssets = await listAssets();
  const assetIdMap = new Map<string, string>();
  let assetCount = 0;

  for (const [id, entry] of Object.entries(bundle?.assets ?? {})) {
    const targetId = existingAssets[id] ? newId('img') : id;
    assetIdMap.set(id, targetId);
    try {
      await transact('readwrite', (store) =>
        store.put({ ...entry.meta, id: targetId, bytesData: base64ToBytes(entry.data).buffer })
      );
      assetCount++;
    } catch {
      // A single unreadable image should not abort the whole import.
    }
  }

  const imported: Notebook[] = [];
  let skipped = 0;

  for (const candidate of incoming) {
    const notebook = parseNotebook(candidate);
    if (!notebook) {
      skipped++;
      continue;
    }

    const now = new Date().toISOString();
    const remapped: Notebook = {
      ...notebook,
      id: newId('nb'),
      createdAt: notebook.createdAt || now,
      updatedAt: now,
      templates: notebook.templates.map((template) => ({
        ...template,
        blocks: template.blocks.map((block) =>
          block.content.type === 'image' && assetIdMap.has(block.content.assetId)
            ? {
                ...block,
                content: { ...block.content, assetId: assetIdMap.get(block.content.assetId)! },
              }
            : block
        ),
      })),
    };

    imported.push(writeNotebook(remapped));
  }

  return { imported, skipped, assetCount };
}

/* ---------------------------------------------------------------- base64 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a multi-megabyte image cannot blow the argument limit.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
