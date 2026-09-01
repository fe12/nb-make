'use client';

/**
 * Drives sync for the whole app.
 *
 * Sits above the editor rather than inside it, because everything that touches
 * browser storage should be mirrored — a rename from the dashboard as much as a
 * page edit. It listens to the storage change feed instead of being called
 * explicitly, so no future caller can forget to trigger a push.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Notebook } from '../types/notebook';
import { useAuth } from './auth';
import * as storage from './storage';
import {
  beaconFlush,
  countForeign,
  deleteRemote,
  isForeignOutcome,
  markSynced,
  mergeWithRemote,
  needsPush,
  pushNotebooks,
  readSyncMap,
  setSyncUser,
  signatureOf,
  type MergeReport,
} from './sync';

/** Longer than the local autosave: responsiveness comes from localStorage. */
const PUSH_DELAY = 2500;

export type SyncPhase = 'off' | 'idle' | 'pending' | 'syncing' | 'error';

interface SyncStore {
  phase: SyncPhase;
  error: string | null;
  lastSyncedAt: string | null;
  pendingCount: number;
  /** Notebooks the server had a newer copy of; surfaced so the user is told. */
  conflicts: string[];
  /** In this browser but owned by another account — informational, not an error. */
  foreignCount: number;
  syncNow: () => Promise<void>;
  mergeNow: () => Promise<MergeReport | null>;
  removeRemote: (id: string) => Promise<void>;
}

const Context = createContext<SyncStore | null>(null);

export function useSync(): SyncStore {
  const store = useContext(Context);
  if (!store) throw new Error('useSync must be used inside <SyncProvider>');
  return store;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const enabled = status === 'signed-in' && Boolean(user);

  const [phase, setPhase] = useState<SyncPhase>('off');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [foreignCount, setForeignCount] = useState(0);

  /*
   * Set synchronously during render, not in an effect: the merge below and the
   * storage listener both read the sync map, and either could run before an
   * effect had a chance to point it at the right account.
   */
  setSyncUser(user?.id ?? null);

  // Read inside listeners that must not be re-registered on every change.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const dirtyNotebooks = useCallback((): Notebook[] => {
    const map = readSyncMap();
    const dirty: Notebook[] = [];
    for (const id of storage.listNotebookIds()) {
      const notebook = storage.readNotebook(id);
      if (notebook && needsPush(notebook, map)) dirty.push(notebook);
    }
    return dirty;
  }, []);

  const syncNow = useCallback(async () => {
    if (!enabledRef.current) return;
    const dirty = dirtyNotebooks();
    if (dirty.length === 0) {
      setPhase('idle');
      setPendingCount(0);
      return;
    }

    setPhase('syncing');
    try {
      const outcomes = await pushNotebooks(dirty);
      const stale = outcomes.filter((o) => o.status === 'stale').map((o) => o.id);
      // Someone else's notebooks left in this browser are expected, not broken.
      const failed = outcomes.filter((o) => o.status === 'error' && !isForeignOutcome(o));

      setConflicts(stale);
      setForeignCount(countForeign());
      if (failed.length > 0) {
        setError(failed[0].message ?? 'Some notebooks could not be synced.');
        setPhase('error');
      } else {
        setError(null);
        setPhase('idle');
        setLastSyncedAt(new Date().toISOString());
      }
      setPendingCount(dirtyNotebooks().length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setPhase('error');
    }
  }, [dirtyNotebooks]);

  /* ------------------------------------------------- merge at sign-in */

  const mergeNow = useCallback(async (): Promise<MergeReport | null> => {
    if (!enabledRef.current) return null;
    setPhase('syncing');
    try {
      const report = await mergeWithRemote();
      setError(null);
      setPhase('idle');
      setLastSyncedAt(new Date().toISOString());
      setPendingCount(dirtyNotebooks().length);
      setForeignCount(countForeign());
      return report;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge with the server');
      setPhase('error');
      return null;
    }
  }, [dirtyNotebooks]);

  // Runs once per signed-in session, keyed on the user id so switching account
  // re-merges rather than trusting the previous account's bookkeeping.
  const mergedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !user) {
      if (!enabled) setPhase('off');
      return;
    }
    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;
    void mergeNow();
  }, [enabled, user, mergeNow]);

  // Signing out must not leave another account's revision numbers behind: the
  // next user's first push would be judged against them and rejected as stale.
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    if (user) {
      previousUser.current = user.id;
      return;
    }
    if (previousUser.current) {
      previousUser.current = null;
      mergedFor.current = null;
      // Deliberately *not* cleared: the records are per-account, and throwing
      // them away is what used to make the next sign-in fork every notebook.
      setPhase('off');
      setPendingCount(0);
      setConflicts([]);
      setForeignCount(0);
    }
  }, [user]);

  /* --------------------------------------------------- debounced push */

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = storage.onStorageChange((event) => {
      if (event.type === 'delete') {
        void deleteRemote([event.id]);
        return;
      }
      setPendingCount(dirtyNotebooks().length);
      setPhase((current) => (current === 'syncing' ? current : 'pending'));

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void syncNow(), PUSH_DELAY);
    });

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, syncNow, dirtyNotebooks]);

  /* ------------------------------------------------------ unload flush */

  useEffect(() => {
    if (!enabled) return;

    /**
     * `pagehide` rather than `beforeunload`: it fires for tab close, navigation
     * *and* when a mobile browser freezes the page into the back/forward cache,
     * which `beforeunload` misses entirely.
     */
    const onPageHide = () => {
      const dirty = dirtyNotebooks();
      if (dirty.length === 0) return;
      // Optimistically record the revision the beacon is carrying. The request
      // is fire-and-forget, so there is no response to learn it from; a wrong
      // guess only costs one rejected push, which the next merge repairs.
      const map = readSyncMap();
      if (beaconFlush(dirty)) {
        for (const notebook of dirty) {
          markSynced(notebook.id, (map[notebook.id]?.revision ?? 0) + 1, signatureOf(notebook));
        }
      }
    };

    // Hiding the tab is the common way to lose the last edit; flush properly
    // there, where a real request can still complete and be acknowledged.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void syncNow();
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, dirtyNotebooks, syncNow]);

  const value = useMemo<SyncStore>(
    () => ({
      phase: enabled ? phase : 'off',
      error,
      lastSyncedAt,
      pendingCount,
      conflicts,
      foreignCount,
      syncNow,
      mergeNow,
      removeRemote: async (id: string) => {
        if (enabledRef.current) await deleteRemote([id]);
      },
    }),
    [enabled, phase, error, lastSyncedAt, pendingCount, conflicts, foreignCount, syncNow, mergeNow]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
