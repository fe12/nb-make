'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { NotebookShell } from '@/components/NotebookShell';
import { Button, Spinner } from '@/components/ui/controls';
import { NotebookProvider } from '@/lib/client/store';
import { readNotebook } from '@/lib/client/storage';
import type { Notebook } from '@/lib/types/notebook';

/**
 * Loads a notebook out of browser storage.
 *
 * This has to happen in an effect rather than during render: `localStorage`
 * does not exist while Next renders the page on the server, so the first paint
 * is always the loading state.
 */
export function NotebookWorkspace({ id, children }: { id: string; children: ReactNode }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'ready'; notebook: Notebook }
  >({ status: 'loading' });

  useEffect(() => {
    const notebook = readNotebook(id);
    setState(notebook ? { status: 'ready', notebook } : { status: 'missing' });
  }, [id]);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-24 text-sm text-ink-500">
        <Spinner /> Opening notebook…
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-2xl text-ink-900">Notebook not found</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          Notebooks are stored in this browser. This one may have been deleted, or opened in a
          different browser or profile. If you have a JSON export, import it from the dashboard.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/">
            <Button variant="primary">Back to notebooks</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <NotebookProvider initial={state.notebook}>
      <NotebookShell>{children}</NotebookShell>
    </NotebookProvider>
  );
}
