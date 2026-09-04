/**
 * The page library: notebook-independent pages kept in `localStorage`.
 *
 * A template normally lives inside one notebook. The library lifts a page out
 * so the same design can be dropped into any notebook — and because block
 * rects are fractions of the content box and `authoredFor`/`typeScale` drive
 * type scaling, a page designed at A4 adapts to an A5 notebook on insert
 * without any conversion step: the compiler already does the work.
 *
 * Semantics follow the presets: inserting copies the template into the\n * notebook, so the notebook never depends on the library afterwards. The link\n * runs the other way — `template.libraryId` says which entry \"Save to library\"\n * should update, which keeps re-saves from piling up duplicates.
 *
 * Like notebooks, the library is browser-local and is never synced; it travels
 * with an import/export bundle instead.
 */
import { useSyncExternalStore } from 'react';
import { newId } from '../ids';
import { zPageTemplate, type PageTemplate } from '../types/page';

const PAGE_PREFIX = 'nb-make:page:';

export interface SavedPage {
  id: string;
  name: string;
  template: PageTemplate;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------- change feed */

/**
 * Same pattern as storage.ts's notebook feed: writers notify listeners so the
 * UI can refresh without polling. Only same-tab updates fire; the library is
 * small enough that cross-tab drift is not worth an extra `storage` listener.
 */
const listeners = new Set<() => void>();

export function onPageLibraryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must not break the write that triggered it.
    }
  }
}

/* ---------------------------------------------------------------- reads */

function readRaw(id: string): SavedPage | null {
  try {
    const raw = localStorage.getItem(PAGE_PREFIX + id);
    if (raw === null) return null;
    return parseSavedPage(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * A record this version cannot read is skipped rather than thrown, so one bad
 * entry cannot blank the picker.
 */
function parseSavedPage(raw: unknown): SavedPage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const template = zPageTemplate.safeParse(record.template);
  if (!template.success) return null;
  return {
    id: typeof record.id === 'string' ? record.id : newId('pg'),
    name: typeof record.name === 'string' ? record.name : 'Untitled page',
    template: template.data,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

/**
 * Cached snapshot. `useSyncExternalStore` calls `getSnapshot` after every
 * render and re-renders whenever the returned value's identity changes, so
 * this must be the same array until a write actually happens — building a
 * fresh one per call is an infinite re-render loop, not a subtle slowdown.
 * All writes in this module invalidate it.
 */
let snapshot: SavedPage[] | null = null;

export function listSavedPages(): SavedPage[] {
  if (snapshot) return snapshot;
  const pages: SavedPage[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PAGE_PREFIX)) continue;
      const page = readRaw(key.slice(PAGE_PREFIX.length));
      if (page) pages.push(page);
    }
  } catch {
    // localStorage unavailable (private mode, disabled): report an empty
    // library rather than breaking the designer.
  }
  snapshot = pages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return snapshot;
}

export function savedPageExists(id: string): boolean {
  try {
    return localStorage.getItem(PAGE_PREFIX + id) !== null;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- writes */

/**
 * Creates or updates the library entry for `template` and returns it, together
 * with the `libraryId` the caller should stamp onto the notebook's copy of the
 * template so future saves update the same entry.
 */
export function saveToLibrary(template: PageTemplate): { entry: SavedPage; libraryId: string } {
  const now = new Date().toISOString();
  const existing = template.libraryId ? readRaw(template.libraryId) : null;

  if (existing) {
    const entry: SavedPage = {
      ...existing,
      name: template.name || existing.name,
      template,
      updatedAt: now,
    };
    writeRaw(entry);
    return { entry, libraryId: entry.id };
  }

  const entry: SavedPage = {
    id: newId('pg'),
    name: template.name || 'Untitled page',
    template,
    createdAt: now,
    updatedAt: now,
  };
  writeRaw(entry);
  return { entry, libraryId: entry.id };
}

/** Directly writes an entry (used by bundle import); ids are the caller's. */
export function writeSavedPage(entry: SavedPage): void {
  writeRaw(entry);
}

function writeRaw(entry: SavedPage): void {
  try {
    localStorage.setItem(PAGE_PREFIX + entry.id, JSON.stringify(entry));
  } catch {
    // Quota or private mode: the save silently does not stick. Surfacing a
    // quota error here would mean threading a result through the designer for
    // a case the notebook writer already covers with its own message.
    return;
  }
  snapshot = null;
  emitChange();
}

export function deleteSavedPage(id: string): void {
  try {
    localStorage.removeItem(PAGE_PREFIX + id);
  } catch {
    return;
  }
  snapshot = null;
  emitChange();
}

/* ---------------------------------------------------------------- hooks */

/**
 * Live view of the library for client components. `useSyncExternalStore`
 * subscribes to the change feed above, so saving or deleting from the picker
 * updates every open list without remounting.
 */
export function useSavedPages(): SavedPage[] {
  // `getSnapshot` returns the cached array (stable between writes) and the
  // change feed triggers the re-read exactly when it is invalidated — the
  // contract `useSyncExternalStore` needs to settle.
  return useSyncExternalStore(onPageLibraryChange, listSavedPages, () => EMPTY);
}

const EMPTY: SavedPage[] = [];

/* -------------------------------------------------------------- inserts */

/**
 * Clones a saved page for use inside a notebook.
 *
 * Fresh ids throughout, `libraryId` kept so re-saving updates the entry, and
 * `sizeOverride` cleared: an override is a property of the notebook it was
 * saved in, and the point of the library is that a page follows its new
 * notebook's trim size. `authoredFor` and `typeScale` are untouched — they are
 * what makes the design adapt.
 */
export function insertFromLibrary(entry: SavedPage): PageTemplate {
  const template = structuredClone(entry.template);
  return {
    ...template,
    id: newId('tpl'),
    libraryId: entry.id,
    sizeOverride: null,
    blocks: template.blocks.map((block) => ({ ...structuredClone(block), id: newId('blk') })),
  };
}
