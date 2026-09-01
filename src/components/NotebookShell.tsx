'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button, Spinner, TextInput } from '@/components/ui/controls';
import { useNotebook } from '@/lib/client/store';

const STEPS = [
  { slug: 'design', label: 'Design pages', hint: 'Patterns, presets, blocks' },
  { slug: 'order', label: 'Build notebook', hint: 'Order and repeats' },
  { slug: 'print', label: 'Print layout', hint: 'Imposition onto sheets' },
  { slug: 'export', label: 'Export', hint: 'Generate the PDF' },
] as const;

export function NotebookShell({ children }: { children: ReactNode }) {
  const { notebook, update, saveState, saveError, saveNow, undo, redo, canUndo, canRedo } =
    useNotebook();
  const pathname = usePathname();
  const [editingName, setEditingName] = useState(false);

  const current = STEPS.findIndex((step) => pathname.endsWith(`/${step.slug}`));
  const activeIndex = current === -1 ? 0 : current;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b-2 border-dashed border-ink-300 bg-paper">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-3 px-5 py-2.5">
          <Link href="/" className="text-[12px] text-ink-500 hover:text-accent-600">
            ← Notebooks
          </Link>

          <div className="h-4 w-px bg-ink-200" />

          {editingName ? (
            <TextInput
              autoFocus
              value={notebook.name}
              className="h-7 w-56 py-0.5 text-[13px] font-semibold"
              onChange={(event) => {
                const name = event.target.value;
                update((draft) => ({ ...draft, name }), { history: false });
              }}
              onBlur={() => setEditingName(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="sketch-box truncate px-1.5 py-0.5 font-display text-[20px] leading-tight text-ink-900 hover:bg-ink-100"
              title="Rename"
            >
              {notebook.name}
            </button>
          )}

          <SaveBadge state={saveState} error={saveError} onRetry={saveNow} />

          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
              Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
              Redo
            </Button>
          </div>
        </div>

        <nav className="mx-auto w-full max-w-[1800px] px-5">
          <ol className="flex flex-wrap gap-1 pb-2">
            {STEPS.map((step, index) => {
              const active = index === activeIndex;
              return (
                <li key={step.slug}>
                  <Link
                    href={`/notebooks/${notebook.id}/${step.slug}`}
                    className={clsx(
                      'sketch-pill flex items-baseline gap-2 px-3 py-1.5 transition-colors',
                      active
                        ? 'doodle-underline bg-accent-50 text-accent-700'
                        : 'text-ink-500 hover:bg-ink-100'
                    )}
                  >
                    <span
                      className={clsx(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold',
                        active
                          ? 'border-ink-800 bg-accent-600 text-accent-ink'
                          : 'border-ink-300 bg-ink-100 text-ink-600'
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="font-display text-[16px] leading-none">{step.label}</span>
                    <span className="hidden text-[10.5px] text-ink-400 lg:inline">{step.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      <div className="flex-1">{children}</div>
    </div>
  );
}

function SaveBadge({
  state,
  error,
  onRetry,
}: {
  state: string;
  error: string | null;
  onRetry: () => void;
}) {
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? undefined}
        className="sketch-pill border border-danger-500 bg-danger-100 px-2 py-0.5 text-[10.5px] font-medium text-danger-600"
      >
        Save failed — retry
      </button>
    );
  }

  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'dirty'
        ? 'Unsaved changes'
        : state === 'saved'
          ? 'Saved'
          : 'Up to date';

  return (
    <span className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
      {state === 'saving' && <Spinner className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}
