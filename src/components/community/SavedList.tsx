'use client';

/**
 * Notebooks you bookmarked from the community.
 *
 * A save is a pointer, not a copy — the author can keep editing it and you see
 * the current version. Copying it into your library is the separate, deliberate
 * action that gives you something of your own.
 */
import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Stars } from '@/components/community/Stars';
import { Button, EmptyState, Notice, Panel, Spinner } from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { listSaved, setSaved } from '@/lib/client/community';
import type { CommunityNotebook } from '@/lib/sync/types';

export function SavedList() {
  const { status } = useAuth();
  const [notebooks, setNotebooks] = useState<CommunityNotebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotebooks(await listSaved());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your saved notebooks.');
      setNotebooks([]);
    }
  }, []);

  useEffect(() => {
    if (status === 'signed-in') void refresh();
    else if (status !== 'loading') setNotebooks([]);
  }, [status, refresh]);

  const unsave = async (id: string) => {
    setBusyId(id);
    try {
      await setSaved(id, false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it.');
    } finally {
      setBusyId(null);
    }
  };

  if (status === 'loading' || notebooks === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-500">
        <Spinner /> Loading…
      </div>
    );
  }

  if (status !== 'signed-in') {
    return (
      <div className="px-5 py-8">
        <EmptyState
          title="Saved notebooks need an account"
          description="Saving is how you keep track of other people's notebooks across devices, so it needs somewhere to keep the list."
          action={
            <Link href="/signin?next=%2Fsaved">
              <Button variant="primary">Sign in</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="w-full px-5 py-6">
      <div className="mb-5">
        <h1 className="font-display text-[32px] leading-none text-ink-900">Saved</h1>
        <p className="mt-2 text-[13px] text-ink-500">
          Bookmarked from the community. These stay in sync with the author&rsquo;s version —
          copy one to your notebooks to get an editable version of your own.
        </p>
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {notebooks.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Browse the community and press Save on anything you want to come back to."
          action={
            <Link href="/community">
              <Button variant="primary">Browse the community</Button>
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {notebooks.map((notebook, index) => (
            <li key={notebook.id} className={clsx('relative pt-2', TILTS[index % 3])}>
              <span className="tape" aria-hidden />
              <Panel className="sketch-card-hover h-full">
                <div className="flex h-full flex-col">
                  <Link href={`/community/${notebook.id}`} className="group">
                    <h3 className="truncate font-display text-[21px] leading-tight text-ink-900 group-hover:text-accent-600">
                      {notebook.name}
                    </h3>
                  </Link>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    by {notebook.author?.display_name || 'someone'}
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    <Stars value={Number(notebook.rating_avg)} size={13} />
                    <span className="text-[11px] text-ink-400">
                      {notebook.page_count} pages · {notebook.page_size_label}
                    </span>
                  </div>

                  <div className="mt-auto flex gap-1.5 pt-3">
                    <Link href={`/community/${notebook.id}`} className="flex-1">
                      <Button size="sm" className="w-full">
                        Open
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === notebook.id}
                      onClick={() => void unsave(notebook.id)}
                    >
                      {busyId === notebook.id ? <Spinner /> : 'Unsave'}
                    </Button>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TILTS = ['-rotate-[0.4deg]', 'rotate-[0.3deg]', '-rotate-[0.15deg]'];
