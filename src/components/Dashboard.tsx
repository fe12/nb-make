'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageSizePicker } from '@/components/PageSizePicker';
import {
  Button,
  EmptyState,
  Field,
  Modal,
  Notice,
  Panel,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { listMyPublishState, setPublished } from '@/lib/client/community';
import { downloadJson } from '@/lib/client/export';
import * as storage from '@/lib/client/storage';
import { useSync } from '@/lib/client/sync-context';
import { createNotebook } from '@/lib/defaults';
import { presetsByCategory } from '@/lib/presets';
import type { NotebookSummary } from '@/lib/types/notebook';
import { defaultPageSize, type PageSizeSpec } from '@/lib/units';

export function Dashboard() {
  const router = useRouter();
  const { status } = useAuth();
  const { syncNow, removeRemote } = useSync();
  const [notebooks, setNotebooks] = useState<NotebookSummary[] | null>(null);
  const [published, setPublishedState] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NotebookSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // localStorage is only available in the browser, so the list is read after
  // mount rather than during render.
  const refresh = useCallback(() => setNotebooks(storage.listNotebooks()), []);
  useEffect(refresh, [refresh]);

  // Which notebooks are live in the community. Only meaningful with an
  // account, so signed-out visitors never see a publish control at all.
  const refreshPublished = useCallback(async () => {
    if (status !== 'signed-in') {
      setPublishedState({});
      return;
    }
    try {
      setPublishedState(await listMyPublishState());
    } catch {
      // A failed lookup just means the badges are missing, not that the
      // library is broken.
    }
  }, [status]);

  useEffect(() => {
    void refreshPublished();
  }, [refreshPublished]);

  /**
   * Publishing needs the notebook to exist on the server, so an unsynced one is
   * pushed first — otherwise the update would match no row and silently do
   * nothing.
   */
  const togglePublish = (summary: NotebookSummary) =>
    guard(summary.id, async () => {
      const notebook = storage.readNotebook(summary.id);
      if (!notebook) throw new Error('That notebook is no longer in this browser.');

      const next = !published[summary.id];
      if (next) await syncNow();
      await setPublished(notebook, next);
      await refreshPublished();
      setNote(
        next
          ? `“${summary.name}” is now in the community.`
          : `“${summary.name}” has been unpublished.`
      );
    });

  const guard = async (id: string, run: () => Promise<void> | void) => {
    setBusyId(id);
    setError(null);
    try {
      await run();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const exportOne = (summary: NotebookSummary) =>
    guard(summary.id, async () => {
      const bundle = await storage.exportBundle([summary.id]);
      downloadJson(bundle, `${slug(summary.name)}.nbmake.json`);
      setNote(`Exported “${summary.name}”.`);
    });

  const exportAll = async () => {
    setError(null);
    try {
      const ids = (notebooks ?? []).map((n) => n.id);
      if (ids.length === 0) return;
      const bundle = await storage.exportBundle(ids);
      downloadJson(bundle, `nb-make-all-${new Date().toISOString().slice(0, 10)}.json`);
      setNote(`Exported ${ids.length} notebook${ids.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    setNote(null);
    try {
      let imported = 0;
      let skipped = 0;
      let assets = 0;
      for (const file of Array.from(files)) {
        const result = await storage.importBundle(JSON.parse(await file.text()));
        imported += result.imported.length;
        skipped += result.skipped;
        assets += result.assetCount;
      }
      refresh();
      setNote(
        imported === 0
          ? 'That file contained no readable notebooks.'
          : `Imported ${imported} notebook${imported === 1 ? '' : 's'}` +
              (assets ? ` and ${assets} image${assets === 1 ? '' : 's'}` : '') +
              (skipped ? ` — ${skipped} entry could not be read.` : '.')
      );
    } catch (err) {
      setError(
        err instanceof Error ? `Import failed: ${err.message}` : 'That file is not valid JSON.'
      );
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] leading-none text-ink-900">Notebooks</h1>
          <p className="mt-2 text-[13px] text-ink-500">
            Design pages, arrange them, impose onto a printable sheet, and export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            multiple
            className="hidden"
            onChange={(event) => importFiles(event.target.files)}
          />
          <Button onClick={() => importInput.current?.click()}>Import JSON</Button>
          <Button onClick={exportAll} disabled={!notebooks?.length}>
            Export all
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New notebook
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {note && (
        <div className="mb-4">
          <Notice tone="info">{note}</Notice>
        </div>
      )}

      {notebooks === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
          <Spinner /> Reading browser storage…
        </div>
      ) : notebooks.length === 0 ? (
        <EmptyState
          title="Nothing on the desk yet"
          description="A notebook holds your page designs, the order they appear in, and how they get imposed onto printable sheets. Everything is kept in this browser — export to JSON to back it up or move it."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first notebook
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((notebook, index) => (
            <li key={notebook.id}>
              <NotebookCard
                notebook={notebook}
                tilt={index % 3}
                busy={busyId === notebook.id}
                onOpen={() => router.push(`/notebooks/${notebook.id}/design`)}
                onDuplicate={() =>
                  guard(notebook.id, () => {
                    storage.duplicateNotebook(notebook.id);
                  })
                }
                onExport={() => exportOne(notebook)}
                onDelete={() => setConfirmDelete(notebook)}
                published={published[notebook.id]}
                canPublish={status === 'signed-in'}
                onTogglePublish={() => togglePublish(notebook)}
              />
            </li>
          ))}
        </ul>
      )}

      <CreateNotebookModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push(`/notebooks/${id}/design`)}
      />

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name}”?`}
        description="It is removed from this browser. Images are shared between notebooks and are kept."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busyId !== null}
              onClick={() =>
                confirmDelete &&
                guard(confirmDelete.id, async () => {
                  storage.deleteNotebook(confirmDelete.id);
                  // Tombstone the account's copy too, or the next sync would
                  // pull it straight back down.
                  await removeRemote(confirmDelete.id);
                  setConfirmDelete(null);
                })
              }
            >
              Delete notebook
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          This cannot be undone. If you might want it back, export it to JSON first.
        </p>
      </Modal>
    </div>
  );
}

const TILTS = ['-rotate-[0.5deg]', 'rotate-[0.4deg]', '-rotate-[0.2deg]'];

function NotebookCard({
  notebook,
  tilt,
  busy,
  onOpen,
  onDuplicate,
  onExport,
  onDelete,
  published,
  canPublish,
  onTogglePublish,
}: {
  notebook: NotebookSummary;
  tilt: number;
  busy: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  published?: boolean;
  canPublish: boolean;
  onTogglePublish: () => void;
}) {
  return (
    <div className={clsx('relative pt-2', TILTS[tilt])}>
      <span className="tape" aria-hidden />
      <Panel className="sketch-card-hover h-full">
        <div className="flex h-full flex-col">
          <button type="button" onClick={onOpen} className="group text-left">
            <h3 className="truncate font-display text-[22px] leading-tight text-ink-900 group-hover:text-accent-600">
              {notebook.name}
              {published && (
                <span className="ml-2 align-middle rounded bg-accent-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent-700">
                  Published
                </span>
              )}
            </h3>
            {notebook.description && (
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-500">
                {notebook.description}
              </p>
            )}
          </button>

          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
            <div className="flex gap-1">
              <dt className="text-ink-400">Size</dt>
              <dd className="font-semibold text-ink-700">{notebook.pageSizeLabel}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-ink-400">Pages</dt>
              <dd className="font-semibold text-ink-700">{notebook.pageCount || '—'}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-ink-400">Designs</dt>
              <dd className="font-semibold text-ink-700">{notebook.templateCount}</dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="text-[10.5px] text-ink-400">
              {busy ? 'Working…' : `Edited ${formatRelative(notebook.updatedAt)}`}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={onExport} disabled={busy}>
                Export
              </Button>
              <Button size="sm" variant="ghost" onClick={onDuplicate} disabled={busy}>
                Copy
              </Button>
              {canPublish && (
                <Button
                  size="sm"
                  variant={published ? 'primary' : 'ghost'}
                  onClick={onTogglePublish}
                  disabled={busy}
                  title={
                    published
                      ? 'Remove it from the community'
                      : 'Share it on the community page'
                  }
                >
                  {published ? 'Unpublish' : 'Publish'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
                Delete
              </Button>
              <Button size="sm" onClick={onOpen}>
                Open
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function CreateNotebookModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pageSize, setPageSize] = useState<PageSizeSpec>(defaultPageSize('A5', 'portrait'));
  const [sheet, setSheet] = useState<PageSizeSpec>(defaultPageSize('A4', 'portrait'));
  const [presetIds, setPresetIds] = useState<string[]>(['dots-5']);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPresetIds((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id]
    );

  const submit = () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const notebook = storage.writeNotebook(
        createNotebook({
          name: name.trim(),
          description: description.trim(),
          pageSize,
          sheet,
          presetIds,
        })
      );
      onCreated(notebook.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the notebook');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New notebook"
      description="You can change any of this later."
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Create notebook
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}

        <Field label="Name">
          <TextInput
            value={name}
            autoFocus
            placeholder="Field journal"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </Field>

        <Field label="Description" hint="Optional — shown on the dashboard.">
          <TextArea
            value={description}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sketch-box border-[1.5px] border-ink-200 p-3">
            <PageSizePicker value={pageSize} onChange={setPageSize} label="Finished page size" />
            <p className="mt-2 text-[10.5px] leading-snug text-ink-400">
              The trim size of one notebook page — what you get after cutting.
            </p>
          </div>
          <div className="sketch-box border-[1.5px] border-ink-200 p-3">
            <PageSizePicker value={sheet} onChange={setSheet} label="Printed sheet size" />
            <p className="mt-2 text-[10.5px] leading-snug text-ink-400">
              What goes through the printer. Several pages are imposed onto each sheet.
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 font-display text-[16px] text-ink-600">
            Start with these page designs
          </div>
          <div className="sketch-box max-h-56 space-y-3 overflow-y-auto border-[1.5px] border-ink-200 p-3">
            {presetsByCategory().map((group) => (
              <div key={group.category}>
                <div className="mb-1.5 font-display text-[14px] text-ink-500">{group.category}</div>
                <div className="flex flex-wrap gap-1.5">
                  {group.presets.map((preset) => {
                    const active = presetIds.includes(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.description}
                        onClick={() => toggle(preset.id)}
                        className={clsx(
                          'sketch-pill border-[1.5px] px-2.5 py-1 text-[11px] transition-colors',
                          active
                            ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700'
                            : 'border-ink-200 bg-paper text-ink-600 hover:border-ink-400'
                        )}
                      >
                        {preset.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'notebook';

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'recently';
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
