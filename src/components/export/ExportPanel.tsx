'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  ColorInput,
  Field,
  Notice,
  NumberInput,
  Panel,
  SectionLabel,
  Segmented,
  Select,
  Spinner,
  TextInput,
  Toggle,
} from '@/components/ui/controls';
import { buildNotebookPdf, downloadBlob, pdfFileName } from '@/lib/client/export';
import { useCompiled, useNotebook } from '@/lib/client/store';
import { summarise } from '@/lib/imposition';
import type { Output } from '@/lib/types/notebook';
import { resolvePageSize } from '@/lib/units';

export function ExportPanel() {
  const { notebook, update, saveNow, saveState, math } = useNotebook();
  const compiled = useCompiled(1);
  const [busy, setBusy] = useState<'imposed' | 'flat' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pageSize = resolvePageSize(notebook.pageSize);
  const sheetSize = resolvePageSize(notebook.imposition.sheet);
  const summary = useMemo(
    () => summarise(compiled.totalPages, notebook.imposition, pageSize),
    [compiled.totalPages, notebook.imposition, pageSize]
  );

  const setOutput = (recipe: (o: Output) => Output) =>
    update((draft) => ({ ...draft, output: recipe(draft.output) }));

  const numbering = notebook.output.pageNumbering;
  const setNumbering = (patch: Partial<Output['pageNumbering']>) =>
    setOutput((o) => ({ ...o, pageNumbering: { ...o.pageNumbering, ...patch } }));

  /** Renders the PDF in this tab; nothing is uploaded. */
  const download = async (mode: 'imposed' | 'flat', open = false) => {
    setBusy(mode);
    setError(null);
    try {
      await saveNow();
      const blob = await buildNotebookPdf({ notebook, mode, math });
      if (open) {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        downloadBlob(blob, pdfFileName(notebook, mode));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const empty = compiled.totalPages === 0;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="space-y-3">
        <Panel title="Ready to export" description="Everything is generated locally.">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="Pages" value={String(compiled.totalPages)} />
            <Stat
              label="Trim size"
              value={`${round(pageSize.w)} × ${round(pageSize.h)} mm`}
            />
            <Stat
              label="Sheet size"
              value={`${round(sheetSize.w)} × ${round(sheetSize.h)} mm`}
            />
            <Stat
              label="Sheet sides"
              value={`${summary.sheetCount} @ ${summary.slotsPerSide}-up`}
            />
          </dl>

          {empty && (
            <div className="mt-3">
              <Notice tone="warn">
                This notebook has no pages yet. Add some on the “Build notebook” step.
              </Notice>
            </div>
          )}

          {error && (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={empty || busy !== null}
              onClick={() => download('imposed')}
            >
              {busy === 'imposed' && <Spinner />} Download imposed PDF
            </Button>
            <Button disabled={empty || busy !== null} onClick={() => download('flat')}>
              {busy === 'flat' && <Spinner />} Download page-per-page PDF
            </Button>
            <Button disabled={empty || busy !== null} onClick={() => download('imposed', true)}>
              Open in a new tab
            </Button>
          </div>

          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
            The imposed PDF is what you print: {summary.slotsPerSide} page
            {summary.slotsPerSide === 1 ? '' : 's'} per {round(sheetSize.w)} × {round(sheetSize.h)} mm
            sheet, scaled to {summary.scalePercent}%. The page-per-page version writes one trim-size
            page per notebook page, which is handy for proofing or for a printer that will do its own
            imposition. Print at 100% / “actual size” — any “fit to page” setting will change the
            ruling spacing.
          </p>

          {saveState === 'dirty' && (
            <p className="mt-2 text-[10.5px] text-ink-400">
              Unsaved edits are written to browser storage before the PDF is generated.
            </p>
          )}
        </Panel>

        {summary.notes.map((note) => (
          <Notice key={note} tone="info">
            {note}
          </Notice>
        ))}

        {compiled.warnings.length > 0 && (
          <Notice tone="warn">{[...new Set(compiled.warnings)].join(' ')}</Notice>
        )}
      </section>

      <aside className="space-y-3">
        <Panel title="Document">
          <div className="space-y-3">
            <Field label="File name" hint=".pdf is added automatically.">
              <TextInput
                value={notebook.output.fileName}
                onChange={(event) => {
                  const fileName = event.target.value;
                  setOutput((o) => ({ ...o, fileName }));
                }}
              />
            </Field>
            <Field label="Title">
              <TextInput
                value={notebook.output.title}
                placeholder={notebook.name}
                onChange={(event) => {
                  const title = event.target.value;
                  setOutput((o) => ({ ...o, title }));
                }}
              />
            </Field>
            <Field label="Author">
              <TextInput
                value={notebook.output.author}
                onChange={(event) => {
                  const author = event.target.value;
                  setOutput((o) => ({ ...o, author }));
                }}
              />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Page numbers"
          description="Applied to every notebook page before imposition."
        >
          <div className="space-y-3">
            <Toggle
              checked={numbering.enabled}
              onChange={(enabled) => setNumbering({ enabled })}
              label="Number the pages"
            />

            {numbering.enabled && (
              <>
                <Field
                  label="Format"
                  hint="{n} number · {total} total · {title} notebook name"
                >
                  <TextInput
                    value={numbering.format}
                    onChange={(event) => setNumbering({ format: event.target.value })}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start at">
                    <NumberInput
                      value={numbering.startAt}
                      min={0}
                      max={10000}
                      step={1}
                      onChange={(startAt) => setNumbering({ startAt })}
                    />
                  </Field>
                  <Field label="Skip first" hint="Leaves covers unnumbered.">
                    <NumberInput
                      value={numbering.skipFirst}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(skipFirst) => setNumbering({ skipFirst })}
                    />
                  </Field>
                </div>

                <Field label="Position">
                  <Select
                    value={numbering.position}
                    onChange={(event) =>
                      setNumbering({ position: event.target.value as typeof numbering.position })
                    }
                  >
                    <option value="bottom-center">Bottom centre</option>
                    <option value="bottom-outer">Bottom outer edge</option>
                    <option value="bottom-inner">Bottom inner edge</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                    <option value="top-center">Top centre</option>
                    <option value="top-outer">Top outer edge</option>
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Distance from edge">
                    <NumberInput
                      value={numbering.margin}
                      min={0}
                      max={60}
                      step={0.5}
                      suffix="mm"
                      onChange={(margin) => setNumbering({ margin })}
                    />
                  </Field>
                  <Field label="Size">
                    <NumberInput
                      value={numbering.size}
                      min={1}
                      max={20}
                      step={0.1}
                      suffix="mm"
                      onChange={(size) => setNumbering({ size })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Typeface">
                    <Select
                      value={numbering.font.family}
                      onChange={(event) =>
                        setNumbering({
                          font: {
                            ...numbering.font,
                            family: event.target.value as typeof numbering.font.family,
                          },
                        })
                      }
                    >
                      <option value="helvetica">Sans</option>
                      <option value="times">Serif</option>
                      <option value="courier">Mono</option>
                    </Select>
                  </Field>
                  <Field label="Colour">
                    <ColorInput value={numbering.color} onChange={(color) => setNumbering({ color })} />
                  </Field>
                </div>

                <SectionLabel>Style</SectionLabel>
                <Segmented
                  value={numbering.font.bold ? 'bold' : 'regular'}
                  onChange={(value) =>
                    setNumbering({ font: { ...numbering.font, bold: value === 'bold' } })
                  }
                  options={[
                    { value: 'regular', label: 'Regular' },
                    { value: 'bold', label: 'Bold' },
                  ]}
                />

                <Notice tone="info">
                  “Outer” and “inner” alternate sides as the pages turn, the way a bound book is
                  numbered.
                </Notice>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Where things live">
          <p className="text-[11.5px] leading-relaxed text-ink-600">
            Notebooks are kept in this browser&rsquo;s local storage and images in IndexedDB. The PDF
            is built in this tab — nothing is uploaded. Use{' '}
            <strong className="font-semibold">Export JSON</strong> on the dashboard to back up or move
            a notebook to another browser.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
