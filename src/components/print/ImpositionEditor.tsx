'use client';

import { useMemo, useState } from 'react';
import { PageSizePicker } from '@/components/PageSizePicker';
import { SheetCanvas } from '@/components/print/SheetCanvas';
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
  Slider,
  Toggle,
} from '@/components/ui/controls';
import { useCompiled, useNotebook } from '@/lib/client/store';
import { generateSlots, placeInSlot, planSheets, summarise } from '@/lib/imposition';
import type { Imposition, Slot } from '@/lib/types/notebook';
import { resolvePageSize, type Margins } from '@/lib/units';

/** Compiling every page just to preview a sheet would be wasteful on long runs. */
const PREVIEW_PAGE_LIMIT = 240;

export function ImpositionEditor() {
  const { notebook, update } = useNotebook();
  const compiled = useCompiled(PREVIEW_PAGE_LIMIT);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const imposition = notebook.imposition;
  const pageSize = resolvePageSize(notebook.pageSize);

  const patch = (recipe: (i: Imposition) => Imposition, options?: { history?: boolean }) =>
    update((draft) => ({ ...draft, imposition: recipe(draft.imposition) }), options);

  // Layout modes generate slots; `manual` keeps whatever the user arranged.
  const slots = useMemo(() => generateSlots(imposition), [imposition]);

  const sheets = useMemo(
    () => planSheets(compiled.totalPages, imposition),
    [compiled.totalPages, imposition]
  );
  const summary = useMemo(
    () => summarise(compiled.totalPages, imposition, pageSize),
    [compiled.totalPages, imposition, pageSize]
  );

  const currentSheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))] ?? null;
  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;

  /**
   * Switches to manual mode and writes the current generated slots in, so the
   * first drag starts from exactly what was on screen rather than resetting.
   */
  const editSlot = (id: string, slotPatch: Partial<Slot>, options?: { history?: boolean }) =>
    patch(
      (current) => ({
        ...current,
        mode: 'manual',
        slots: (current.mode === 'manual' ? current.slots : generateSlots(current)).map((slot) =>
          slot.id === id ? { ...slot, ...slotPatch } : slot
        ),
      }),
      options
    );

  const resetSlots = () =>
    patch((current) => ({ ...current, mode: 'grid', slots: [] }));

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={sheetIndex === 0}
            onClick={() => setSheetIndex((i) => Math.max(0, i - 1))}
          >
            ← Previous
          </Button>
          <span className="text-[12px] font-medium text-ink-700">
            {sheets.length === 0
              ? 'No sheets'
              : `Sheet ${(currentSheet?.index ?? 0) + 1} of ${Math.max(
                  1,
                  ...sheets.map((s) => s.index + 1)
                )} — ${currentSheet?.side ?? 'front'}`}
          </span>
          <Button
            size="sm"
            disabled={sheetIndex >= sheets.length - 1}
            onClick={() => setSheetIndex((i) => Math.min(sheets.length - 1, i + 1))}
          >
            Next →
          </Button>

          <span className="ml-auto text-[11px] text-ink-500">
            {summary.slotsPerSide} per side · {summary.sheetCount} sheet side
            {summary.sheetCount === 1 ? '' : 's'} · pages at {summary.scalePercent}%
          </span>
        </div>

        <div className="surface-grid flex justify-center rounded-lg border border-ink-200 p-6">
          <div className="w-full" style={{ maxWidth: 620 }}>
            <SheetCanvas
              sheet={currentSheet}
              pages={compiled.pages}
              imposition={imposition}
              pageSize={pageSize}
              selectedSlotId={selectedSlotId}
              onSelectSlot={setSelectedSlotId}
              onSlotChange={editSlot}
              onCommit={() => patch((current) => ({ ...current }))}
              editable={currentSheet?.side !== 'back'}
            />
          </div>
        </div>

        {summary.notes.map((note) => (
          <Notice key={note} tone="info">
            {note}
          </Notice>
        ))}

        {compiled.totalPages > compiled.pages.length && (
          <Notice tone="warn">
            Previewing the first {compiled.pages.length} of {compiled.totalPages} pages. The export
            includes all of them.
          </Notice>
        )}

        {selectedSlot && (
          <Panel
            title={`Slot ${selectedSlot.index + 1}`}
            description="Position and orientation of one page on the sheet."
            actions={
              <Button size="sm" variant="ghost" onClick={() => setSelectedSlotId(null)}>
                Deselect
              </Button>
            }
          >
            <div className="grid gap-2.5 sm:grid-cols-4">
              <Field label="X">
                <NumberInput
                  value={round(selectedSlot.x)}
                  step={0.5}
                  suffix="mm"
                  onChange={(x) => editSlot(selectedSlot.id, { x })}
                />
              </Field>
              <Field label="Y">
                <NumberInput
                  value={round(selectedSlot.y)}
                  step={0.5}
                  suffix="mm"
                  onChange={(y) => editSlot(selectedSlot.id, { y })}
                />
              </Field>
              <Field label="Width">
                <NumberInput
                  value={round(selectedSlot.w)}
                  min={5}
                  step={0.5}
                  suffix="mm"
                  onChange={(w) => editSlot(selectedSlot.id, { w })}
                />
              </Field>
              <Field label="Height">
                <NumberInput
                  value={round(selectedSlot.h)}
                  min={5}
                  step={0.5}
                  suffix="mm"
                  onChange={(h) => editSlot(selectedSlot.id, { h })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Orientation">
                  <Segmented
                    value={selectedSlot.rotation}
                    onChange={(rotation) => editSlot(selectedSlot.id, { rotation })}
                    options={[
                      { value: 0, label: '0°' },
                      { value: 90, label: '90°' },
                      { value: 180, label: '180°' },
                      { value: 270, label: '270°' },
                    ]}
                  />
                </Field>
              </div>
              <Field label="Fill order">
                <NumberInput
                  value={selectedSlot.index + 1}
                  min={1}
                  max={slots.length}
                  step={1}
                  onChange={(value) => editSlot(selectedSlot.id, { index: Math.round(value) - 1 })}
                />
              </Field>
              <div className="flex items-end pb-1.5">
                <Toggle
                  checked={selectedSlot.enabled}
                  onChange={(enabled) => editSlot(selectedSlot.id, { enabled })}
                  label="In use"
                />
              </div>
            </div>
            <p className="mt-2 text-[10.5px] text-ink-400">
              Page fills {round(placeInSlot(selectedSlot, pageSize, imposition).rect.w)} ×{' '}
              {round(placeInSlot(selectedSlot, pageSize, imposition).rect.h)} mm of this slot.
            </p>
          </Panel>
        )}
      </section>

      <aside className="space-y-3">
        <Panel title="Sheet">
          <div className="space-y-3">
            <PageSizePicker
              value={imposition.sheet}
              label="Printed sheet"
              onChange={(sheet) => patch((current) => ({ ...current, sheet }))}
            />
            <div>
              <SectionLabel>Sheet margins</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <Field key={side} label={side[0].toUpperCase() + side.slice(1)}>
                    <NumberInput
                      value={imposition.sheetMargins[side]}
                      min={0}
                      max={100}
                      step={0.5}
                      suffix="mm"
                      onChange={(value) =>
                        patch((current) => ({
                          ...current,
                          sheetMargins: { ...current.sheetMargins, [side]: value } as Margins,
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-ink-400">
                Most desktop printers cannot print closer than about 5 mm to the edge.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Arrangement">
          <div className="space-y-3">
            <Field label="Layout mode">
              <Select
                value={imposition.mode}
                onChange={(event) => {
                  // Read the value before the updater runs: React may invoke an
                  // updater later (or twice in development), by which point the
                  // controlled <select> has been reconciled back to its prop.
                  const mode = event.target.value as Imposition['mode'];
                  patch((current) => ({
                    ...current,
                    mode,
                    // Entering manual mode seeds the slots from whatever the
                    // grid was showing; leaving it discards them so the
                    // regenerated grid is consistent.
                    slots: mode === 'manual' ? generateSlots(current) : [],
                    duplex: mode === 'booklet' ? true : current.duplex,
                  }));
                }}
              >
                <option value="grid">Grid — pages in reading order</option>
                <option value="booklet">Booklet — saddle-stitch fold order</option>
                <option value="cutstack">Cut and stack — guillotine into piles</option>
                <option value="manual">Manual — arrange slots by hand</option>
              </Select>
            </Field>

            {imposition.mode === 'manual' ? (
              <Notice tone="info">
                Slots are placed by hand. Drag them on the sheet, or edit the numbers when one is
                selected.
                <div className="mt-1.5">
                  <Button size="sm" onClick={resetSlots}>
                    Back to a generated grid
                  </Button>
                </div>
              </Notice>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Rows">
                  <NumberInput
                    value={imposition.rows}
                    min={1}
                    max={12}
                    step={1}
                    disabled={imposition.mode === 'booklet'}
                    onChange={(rows) => patch((current) => ({ ...current, rows }))}
                  />
                </Field>
                <Field label="Columns">
                  <NumberInput
                    value={imposition.cols}
                    min={1}
                    max={12}
                    step={1}
                    disabled={imposition.mode === 'booklet'}
                    onChange={(cols) => patch((current) => ({ ...current, cols }))}
                  />
                </Field>
              </div>
            )}

            {imposition.mode === 'booklet' && (
              <p className="text-[10.5px] text-ink-400">
                A booklet is always two pages across and one down — that is what folding a sheet in
                half gives you.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Field label="Gutter X">
                <NumberInput
                  value={imposition.gutterX}
                  min={0}
                  max={100}
                  step={0.5}
                  suffix="mm"
                  onChange={(gutterX) => patch((current) => ({ ...current, gutterX }))}
                />
              </Field>
              <Field label="Gutter Y">
                <NumberInput
                  value={imposition.gutterY}
                  min={0}
                  max={100}
                  step={0.5}
                  suffix="mm"
                  onChange={(gutterY) => patch((current) => ({ ...current, gutterY }))}
                />
              </Field>
            </div>

            <Field label="Rotate every slot">
              <Segmented
                value={imposition.slotRotation}
                onChange={(slotRotation) =>
                  patch((current) => ({
                    ...current,
                    slotRotation,
                    slots: current.mode === 'manual' ? current.slots : [],
                  }))
                }
                options={[
                  { value: 0, label: '0°' },
                  { value: 90, label: '90°' },
                  { value: 180, label: '180°' },
                  { value: 270, label: '270°' },
                ]}
              />
            </Field>

            <Toggle
              checked={imposition.scaleToFit}
              onChange={(scaleToFit) => patch((current) => ({ ...current, scaleToFit }))}
              label="Scale pages to fill their slot"
              hint="Off prints pages at their true trim size, which is what you want for an accurate ruling."
            />

            <Field label="Extra scale">
              <Slider
                value={imposition.extraScale}
                min={0.2}
                max={2}
                step={0.01}
                onChange={(extraScale) => patch((current) => ({ ...current, extraScale }))}
              />
            </Field>

            {summary.upscaled && (
              <Notice tone="warn">
                Pages are being enlarged above their trim size. Rulings stay crisp because they are
                vectors, but any placed images will soften.
              </Notice>
            )}
          </div>
        </Panel>

        <Panel title="Double-sided">
          <div className="space-y-3">
            <Toggle
              checked={imposition.duplex}
              onChange={(duplex) => patch((current) => ({ ...current, duplex }))}
              label="Print both sides"
              disabled={imposition.mode === 'booklet'}
              hint={
                imposition.mode === 'booklet'
                  ? 'Always on for booklets.'
                  : 'Generates a back side for every sheet.'
              }
            />
            {imposition.duplex && (
              <>
                <Toggle
                  checked={imposition.mirrorBackSide}
                  onChange={(mirrorBackSide) => patch((current) => ({ ...current, mirrorBackSide }))}
                  label="Mirror slots on the reverse"
                  hint="Needed so the back lines up after the sheet is flipped."
                />
                <Field label="Flip edge">
                  <Segmented
                    value={imposition.bindingEdge}
                    onChange={(bindingEdge) => patch((current) => ({ ...current, bindingEdge }))}
                    options={[
                      { value: 'left', label: 'Long edge' },
                      { value: 'top', label: 'Short edge' },
                    ]}
                  />
                </Field>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Printer's marks">
          <div className="space-y-3">
            <Toggle
              checked={imposition.cropMarks.enabled}
              onChange={(enabled) =>
                patch((current) => ({
                  ...current,
                  cropMarks: { ...current.cropMarks, enabled },
                }))
              }
              label="Crop marks"
              hint="Corner rules showing where to cut."
            />
            {imposition.cropMarks.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Length">
                  <NumberInput
                    value={imposition.cropMarks.length}
                    min={1}
                    max={20}
                    step={0.5}
                    suffix="mm"
                    onChange={(length) =>
                      patch((current) => ({ ...current, cropMarks: { ...current.cropMarks, length } }))
                    }
                  />
                </Field>
                <Field label="Offset">
                  <NumberInput
                    value={imposition.cropMarks.offset}
                    min={0}
                    max={20}
                    step={0.5}
                    suffix="mm"
                    onChange={(offset) =>
                      patch((current) => ({ ...current, cropMarks: { ...current.cropMarks, offset } }))
                    }
                  />
                </Field>
              </div>
            )}

            <Toggle
              checked={imposition.foldMarks}
              onChange={(foldMarks) => patch((current) => ({ ...current, foldMarks }))}
              label="Fold line"
            />

            <Toggle
              checked={imposition.pageBorder.enabled}
              onChange={(enabled) =>
                patch((current) => ({
                  ...current,
                  pageBorder: { ...current.pageBorder, enabled },
                }))
              }
              label="Outline each page"
            />
            {imposition.pageBorder.enabled && (
              <Field label="Outline colour">
                <ColorInput
                  value={imposition.pageBorder.color}
                  onChange={(color) =>
                    patch((current) => ({ ...current, pageBorder: { ...current.pageBorder, color } }))
                  }
                />
              </Field>
            )}

            <Toggle
              checked={imposition.showSlotNumbers}
              onChange={(showSlotNumbers) => patch((current) => ({ ...current, showSlotNumbers }))}
              label="Print slot numbers"
              hint="Useful when proofing a manual arrangement — turn off for the real run."
            />
          </div>
        </Panel>
      </aside>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
