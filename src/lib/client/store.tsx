'use client';

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
import { setAssetUrlResolver, type AssetIndex } from '../assets';
import { collectMathRequests, compileNotebook, type CompiledNotebook } from '../compile/notebook';
import type { MathCache } from '../latex/types';
import type { Notebook } from '../types/notebook';
import { uniformBleed } from '../units';
import { api } from './api';
import { PaletteProvider } from './palette-context';
import * as storage from './storage';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface NotebookStore {
  notebook: Notebook;
  update: (recipe: (draft: Notebook) => Notebook, options?: { history?: boolean }) => void;
  saveState: SaveState;
  saveError: string | null;
  saveNow: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  assets: AssetIndex;
  refreshAssets: () => Promise<void>;
  math: MathCache;
  mathErrors: Record<string, string>;
  mathPending: boolean;
}

const Context = createContext<NotebookStore | null>(null);

export function useNotebook(): NotebookStore {
  const store = useContext(Context);
  if (!store) throw new Error('useNotebook must be used inside <NotebookProvider>');
  return store;
}

const HISTORY_LIMIT = 40;
const AUTOSAVE_DELAY = 700;

export function NotebookProvider({
  initial,
  children,
}: {
  initial: Notebook;
  children: ReactNode;
}) {
  const [notebook, setNotebook] = useState(initial);
  const [assets, setAssets] = useState<AssetIndex>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const past = useRef<Notebook[]>([]);
  const future = useRef<Notebook[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  /* ------------------------------------------------------------- editing */

  const update = useCallback(
    (recipe: (draft: Notebook) => Notebook, options?: { history?: boolean }) => {
      setNotebook((current) => {
        const next = recipe(current);
        if (next === current) return current;

        if (options?.history !== false) {
          past.current = [...past.current.slice(-HISTORY_LIMIT + 1), current];
          future.current = [];
          setHistoryVersion((v) => v + 1);
        }
        return next;
      });
      setSaveState('dirty');
    },
    []
  );

  const undo = useCallback(() => {
    setNotebook((current) => {
      const previous = past.current.pop();
      if (!previous) return current;
      future.current = [current, ...future.current.slice(0, HISTORY_LIMIT)];
      setHistoryVersion((v) => v + 1);
      setSaveState('dirty');
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setNotebook((current) => {
      const [next, ...rest] = future.current;
      if (!next) return current;
      future.current = rest;
      past.current = [...past.current, current];
      setHistoryVersion((v) => v + 1);
      setSaveState('dirty');
      return next;
    });
  }, []);

  /* ------------------------------------------------------------ autosave */

  // Held in a ref so the save timer always writes the newest snapshot, even if
  // several edits land inside one debounce window.
  const latest = useRef(notebook);
  latest.current = notebook;

  const persist = useCallback(async () => {
    const snapshot = latest.current;
    setSaveState('saving');
    try {
      const saved = storage.writeNotebook(snapshot);
      setSaveError(null);
      // Only settle to "saved" if nothing changed while the write was running;
      // otherwise the next debounce round will pick it up.
      setSaveState((state) =>
        latest.current === snapshot && state === 'saving' ? 'saved' : 'dirty'
      );
      setNotebook((current) =>
        current === snapshot ? { ...current, updatedAt: saved.updatedAt } : current
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save');
      setSaveState('error');
    }
  }, []);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(persist, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [saveState, notebook, persist]);

  // A background tab is a common place to lose the last edit; flush on hide.
  useEffect(() => {
    const flush = () => {
      if (saveState === 'dirty') void persist();
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [saveState, persist]);

  /* -------------------------------------------------------------- assets */

  /**
   * Blob URLs for the images currently in IndexedDB.
   *
   * They are minted once per asset and revoked when the set changes, so the
   * SVG preview can point an `<img>` at bytes that never touch the network.
   */
  const objectUrls = useRef(new Map<string, string>());

  const refreshAssets = useCallback(async () => {
    const index = await storage.listAssets();
    setAssets(index);

    for (const [id, url] of objectUrls.current) {
      if (!index[id]) {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(id);
      }
    }
    for (const id of Object.keys(index)) {
      if (objectUrls.current.has(id)) continue;
      const bytes = await storage.readAssetBytes(id);
      if (!bytes) continue;
      const blob = new Blob([bytes as BlobPart], { type: index[id].mime });
      objectUrls.current.set(id, URL.createObjectURL(blob));
    }
    // Re-render so previews pick up the new URLs.
    setAssets({ ...index });
  }, []);

  useEffect(() => {
    setAssetUrlResolver((id) => objectUrls.current.get(id) ?? '');
    void refreshAssets();
    const urls = objectUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [refreshAssets]);

  /* ---------------------------------------------------------------- math */

  const [math, setMath] = useState<MathCache>({});
  const [mathErrors, setMathErrors] = useState<Record<string, string>>({});
  const [mathPending, setMathPending] = useState(false);
  const requested = useRef(new Set<string>());

  const mathRequests = useMemo(() => collectMathRequests(notebook), [notebook]);

  /**
   * Keyed on *which* formulas exist, not on the notebook object.
   *
   * Every edit — including autosave writing back `updatedAt` — produces a new
   * notebook object. Depending on that identity would restart this effect
   * constantly, and an in-flight render would be torn down after its keys were
   * already marked as requested, so the formulas would never arrive.
   */
  const requestSignature = mathRequests
    .map((r) => r.key)
    .sort()
    .join(',');

  useEffect(() => {
    const missing = mathRequests.filter((r) => !requested.current.has(r.key));
    if (missing.length === 0) return;
    for (const r of missing) requested.current.add(r.key);

    let active = true;
    setMathPending(true);
    api
      .renderMath(missing)
      .then((result) => {
        // Merge unconditionally: a rendered formula stays valid however the
        // notebook has changed while the request was in flight.
        setMath((current) => ({ ...current, ...result.blobs }));
        if (Object.keys(result.errors).length) {
          setMathErrors((current) => ({ ...current, ...result.errors }));
        }
      })
      .catch(() => {
        // Allow a retry on the next edit rather than wedging the cache.
        for (const r of missing) requested.current.delete(r.key);
      })
      .finally(() => {
        if (active) setMathPending(false);
      });

    return () => {
      active = false;
    };
    // `mathRequests` is intentionally not a dependency; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSignature]);

  /* ---------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (event.key === 's') {
        event.preventDefault();
        void persist();
        return;
      }
      if (typing) return;

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, persist]);

  const value = useMemo<NotebookStore>(
    () => ({
      notebook,
      update,
      saveState,
      saveError,
      saveNow: persist,
      undo,
      redo,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      assets,
      refreshAssets,
      math,
      mathErrors,
      mathPending,
    }),
    // `historyVersion` is what makes canUndo/canRedo re-read the refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      notebook,
      update,
      saveState,
      saveError,
      persist,
      undo,
      redo,
      assets,
      refreshAssets,
      math,
      mathErrors,
      mathPending,
      historyVersion,
    ]
  );

  return (
    <Context.Provider value={value}>
      <PaletteProvider palette={notebook.palette}>{children}</PaletteProvider>
    </Context.Provider>
  );
}

/**
 * Compiles the whole notebook. Expensive for long runs, so callers that only
 * need a thumbnail strip should pass a `limit`.
 */
export function useCompiled(limit?: number): CompiledNotebook {
  const { notebook, assets, math } = useNotebook();
  return useMemo(
    () =>
      compileNotebook(notebook, {
        assets,
        math,
        limit,
        // The print preview must show the bleed the exporter will draw. Other
        // consumers (page lists) render inside a page-sized SVG, which clips
        // the overhang on its own.
        bleed: uniformBleed(notebook.imposition.bleed),
      }),
    [notebook, assets, math, limit]
  );
}
