'use client';

/**
 * Local-first sync.
 *
 * The local write stays primary and synchronous — the editor never waits on the
 * network, and everything still works signed out or offline. This layer mirrors
 * that local state to Postgres afterwards.
 *
 * Three things push:
 *   - a debounced background push while editing (slower than the local
 *     autosave, because the network is not where responsiveness comes from),
 *   - a flush when the tab is hidden,
 *   - `navigator.sendBeacon` on `pagehide`, which is the only thing a browser
 *     reliably delivers once a page is being torn down.
 *
 * Conflicts are resolved by revision number, never by silently overwriting.
 */
import { newId } from '../ids';
import type { Notebook } from '../types/notebook';
import { zNotebook } from '../types/notebook';
import * as storage from './storage';

const SYNC_KEY = 'nb-make:sync';
const ENDPOINT = '/api/sync/notebooks';

/**
 * Whose bookkeeping to read and write.
 *
 * Sync state is stored per account. Signing out used to wipe it, which meant
 * signing back in found no baseline for notebooks that were already in this
 * browser -- and "no baseline" reads as "both sides changed", so every notebook
 * forked into a duplicate on every sign-in cycle. Keeping the records separated
 * by user gives the right answer for both cases: your own baseline survives,
 * and another account never sees it.
 */
let currentUser: string | null = null;

export function setSyncUser(userId: string | null): void {
  currentUser = userId;
}

export interface SyncRecord {
  /** Revision the server last acknowledged for this notebook. */
  revision: number;
  syncedAt: string;
  /** Hash of the document as it was when the server acknowledged it. */
  signature: string;
  /**
   * Set when the server says this notebook belongs to a different account.
   *
   * Happens on a shared browser: signing out keeps notebooks in local storage
   * (deliberately -- they are the user's work), so the next account finds
   * someone else's documents sitting there. Pushing them is correctly refused,
   * and without this marker the engine would retry on every edit and show a
   * permanent sync failure for a situation that is not an error.
   */
  notMine?: boolean;
}

export type SyncMap = Record<string, SyncRecord>;

export interface SyncOutcome {
  id: string;
  status: 'ok' | 'stale' | 'error';
  revision?: number;
  doc?: unknown;
  message?: string;
}

/* ------------------------------------------------------------ local state */

type SyncStore = Record<string, SyncMap>;

function readStore(): SyncStore {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    return raw ? (JSON.parse(raw) as SyncStore) : {};
  } catch {
    return {};
  }
}

export function readSyncMap(): SyncMap {
  if (!currentUser) return {};
  return readStore()[currentUser] ?? {};
}

function writeSyncMap(map: SyncMap): void {
  if (!currentUser) return;
  try {
    const store = readStore();
    store[currentUser] = map;
    localStorage.setItem(SYNC_KEY, JSON.stringify(store));
  } catch {
    // Losing sync bookkeeping costs an extra push later; it is not worth
    // failing an edit over.
  }
}

export function markSynced(id: string, revision: number, signature: string): void {
  const map = readSyncMap();
  map[id] = { revision, syncedAt: new Date().toISOString(), signature };
  writeSyncMap(map);
}

export function forgetSynced(id: string): void {
  const map = readSyncMap();
  delete map[id];
  writeSyncMap(map);
}

/** Forgets one account's bookkeeping. Only used when wiping local data. */
export function clearSyncState(userId?: string): void {
  try {
    if (!userId) {
      localStorage.removeItem(SYNC_KEY);
      return;
    }
    const store = readStore();
    delete store[userId];
    localStorage.setItem(SYNC_KEY, JSON.stringify(store));
  } catch {
    /* nothing to clear */
  }
}

/**
 * Cheap content signature, used only to decide whether a document differs from
 * the copy the server acknowledged. `updatedAt` is unusable for this because
 * saving rewrites it even when nothing meaningful changed.
 */
export function signatureOf(notebook: Notebook): string {
  const { updatedAt: _updatedAt, stats: _stats, ...rest } = notebook;
  void _updatedAt;
  void _stats;
  const json = JSON.stringify(rest);

  // FNV-1a. Not cryptographic — it only has to notice edits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + ':' + json.length.toString(36);
}

export const needsPush = (notebook: Notebook, map: SyncMap = readSyncMap()): boolean => {
  const record = map[notebook.id];
  if (record?.notMine) return false;
  return record?.signature !== signatureOf(notebook);
};

/** Notebooks in this browser that belong to a different account. */
export function countForeign(map: SyncMap = readSyncMap()): number {
  return Object.values(map).filter((record) => record.notMine).length;
}

const FOREIGN_MESSAGE = 'belongs to another account';

export const isForeignOutcome = (outcome: SyncOutcome): boolean =>
  outcome.status === 'error' && Boolean(outcome.message?.includes(FOREIGN_MESSAGE));

function markForeign(id: string): void {
  const map = readSyncMap();
  map[id] = {
    revision: map[id]?.revision ?? 0,
    syncedAt: new Date().toISOString(),
    signature: map[id]?.signature ?? '',
    notMine: true,
  };
  writeSyncMap(map);
}

/* ------------------------------------------------------------------ push */

function payloadFor(notebooks: Notebook[], map: SyncMap) {
  return {
    notebooks: notebooks.map((doc) => ({
      doc,
      // One past whatever the server acknowledged. The server rejects anything
      // lower than what it holds, which is what catches a second device.
      revision: (map[doc.id]?.revision ?? 0) + 1,
    })),
  };
}

export async function pushNotebooks(notebooks: Notebook[]): Promise<SyncOutcome[]> {
  if (notebooks.length === 0) return [];
  const map = readSyncMap();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadFor(notebooks, map)),
    // Lets the request outlive a navigation, so a push started just before the
    // user clicks away still completes.
    keepalive: notebooks.length === 1,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? `Sync failed (${response.status})`);
  }

  const { outcomes } = (await response.json()) as { outcomes: SyncOutcome[] };
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  // Divergent local copies rescued below, pushed once the loop has finished.
  const forked: Notebook[] = [];

  for (const outcome of outcomes) {
    const local = byId.get(outcome.id);
    if (outcome.status === 'ok' && local && outcome.revision !== undefined) {
      markSynced(outcome.id, outcome.revision, signatureOf(local));
    }
    if (isForeignOutcome(outcome)) {
      markForeign(outcome.id);
      continue;
    }
    if (outcome.status === 'stale' && local && outcome.revision !== undefined) {
      /*
       * Another device won the race. Keep both: the server's copy takes the
       * shared id, and this device's version is preserved beside it.
       *
       * Simply adopting the server's revision -- which is what this used to do
       * -- left the local document differing from the baseline it had just
       * recorded, so the next tick would push it straight over the top and
       * destroy the other device's work anyway.
       */
      const parsed = zNotebook.safeParse(outcome.doc);
      if (!parsed.success) continue;

      const server = parsed.data;
      storage.writeNotebook(server);
      markSynced(outcome.id, outcome.revision, signatureOf(server));

      // Only worth keeping if it actually differs from what the server had.
      if (signatureOf(local) !== signatureOf(server)) {
        forked.push(
          storage.writeNotebook({
            ...local,
            id: newId('nb'),
            name: `${local.name} (this device)`,
            updatedAt: new Date().toISOString(),
          })
        );
      }
    }
  }

  // Get the rescued copies onto the server so they are not left local-only.
  if (forked.length > 0) await pushNotebooks(forked);

  return outcomes;
}

/**
 * Last-ditch flush as the page goes away.
 *
 * `sendBeacon` is queued by the browser and delivered even after the document
 * is gone, which `fetch` is not guaranteed to be. It cannot set headers, so the
 * request authenticates with the session cookie — the reason this goes to our
 * own route handler rather than to Supabase directly.
 */
export function beaconFlush(notebooks: Notebook[]): boolean {
  if (notebooks.length === 0) return true;
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;

  try {
    const body = new Blob([JSON.stringify(payloadFor(notebooks, readSyncMap()))], {
      type: 'application/json',
    });
    return navigator.sendBeacon(ENDPOINT, body);
  } catch {
    return false;
  }
}

export async function deleteRemote(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletes: ids }),
  });
  for (const id of ids) forgetSynced(id);
}

/* ------------------------------------------------------------------ pull */

interface RemoteRow {
  id: string;
  doc: unknown;
  revision: number;
  updated_at: string;
  is_published: boolean;
}

export async function pullRemote(): Promise<RemoteRow[]> {
  const response = await fetch(ENDPOINT, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not read the server copy (${response.status})`);
  const { notebooks } = (await response.json()) as { notebooks: RemoteRow[] };
  return notebooks;
}

export interface MergeReport {
  pulled: number;
  pushed: number;
  forked: number;
  failed: number;
  /** Left alone because they belong to a different account. */
  foreign: number;
}

/**
 * Reconciles browser storage with the account, called after signing in.
 *
 * Rules, in order:
 *   - only on the server  -> copy it down
 *   - only in the browser -> push it up (this is what adopts work done before
 *     the account existed)
 *   - both, one side changed -> take the changed side
 *   - both changed since the last sync -> keep the local copy and save the
 *     server's alongside it under a new id
 *
 * That last case is the only genuinely ambiguous one, and duplicating is the
 * one resolution that cannot lose work. Silently picking the newer timestamp
 * would quietly discard whatever the other device did.
 */
export async function mergeWithRemote(): Promise<MergeReport> {
  const report: MergeReport = { pulled: 0, pushed: 0, forked: 0, failed: 0, foreign: 0 };

  const remote = await pullRemote();
  const map = readSyncMap();
  const localIds = new Set(storage.listNotebookIds());
  const toPush: Notebook[] = [];

  for (const row of remote) {
    const parsed = zNotebook.safeParse(row.doc);
    if (!parsed.success) {
      report.failed++;
      continue;
    }
    const server = parsed.data;
    const local = storage.readNotebook(row.id);

    if (!local) {
      // Either new to this browser, or deleted here. A tombstone would have
      // removed it from `remote`, so this is genuinely a copy-down.
      storage.writeNotebook(server);
      markSynced(row.id, row.revision, signatureOf(server));
      report.pulled++;
      continue;
    }

    const record = map[row.id];
    const localSignature = signatureOf(local);

    // Byte-identical: nothing to reconcile, just adopt the server's revision as
    // the baseline for future comparisons.
    if (localSignature === signatureOf(server)) {
      markSynced(row.id, row.revision, localSignature);
      continue;
    }

    if (!record) {
      /*
       * No baseline to compare against -- first sign-in on this browser. There
       * is no way to tell which side diverged, so the newer timestamp wins.
       * Forking here instead would duplicate every notebook the first time an
       * account signs in on a machine that already has its work.
       */
      if (Date.parse(server.updatedAt) >= Date.parse(local.updatedAt)) {
        storage.writeNotebook(server);
        markSynced(row.id, row.revision, signatureOf(server));
        report.pulled++;
      } else {
        toPush.push(local);
      }
      continue;
    }

    const localChanged = record.signature !== localSignature;
    const remoteChanged = record.revision !== row.revision;

    if (!localChanged && !remoteChanged) continue;

    if (!localChanged && remoteChanged) {
      storage.writeNotebook(server);
      markSynced(row.id, row.revision, signatureOf(server));
      report.pulled++;
      continue;
    }

    if (localChanged && !remoteChanged) {
      toPush.push(local);
      continue;
    }

    // Both moved. Keep local as the one the user is looking at, and land the
    // server's version next to it rather than throwing either away.
    const fork: Notebook = {
      ...server,
      id: newId('nb'),
      name: `${server.name} (from another device)`,
      updatedAt: new Date().toISOString(),
    };
    storage.writeNotebook(fork);
    toPush.push(local, fork);
    report.forked++;
  }

  // Anything the server has never seen.
  const remoteIds = new Set(remote.map((row) => row.id));
  for (const id of localIds) {
    if (remoteIds.has(id)) continue;
    // Skip ones an earlier attempt already established are someone else's.
    if (readSyncMap()[id]?.notMine) {
      report.foreign++;
      continue;
    }
    const local = storage.readNotebook(id);
    if (local) toPush.push(local);
  }

  if (toPush.length > 0) {
    // De-duplicate: a forked notebook can be queued twice.
    const unique = [...new Map(toPush.map((n) => [n.id, n])).values()];
    const outcomes = await pushNotebooks(unique);
    report.pushed += outcomes.filter((o) => o.status === 'ok').length;
    report.foreign += outcomes.filter(isForeignOutcome).length;
    report.failed += outcomes.filter(
      (o) => o.status === 'error' && !isForeignOutcome(o)
    ).length;
  }

  return report;
}
