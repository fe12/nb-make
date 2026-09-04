'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { PageThumb } from '@/components/PagePreview';
import { PageSizePicker } from '@/components/PageSizePicker';
import { BlockCanvas } from '@/components/designer/BlockCanvas';
import { CanvasViewport } from '@/components/designer/CanvasViewport';
import { BlockInspector, labelFor } from '@/components/designer/BlockInspector';
import { PalettePanel } from '@/components/designer/PalettePanel';
import { PatternEditor } from '@/components/designer/PatternEditor';
import {
  Button,
  EmptyState,
  Field,
  Modal,
  Notice,
  NumberInput,
  Panel,
  SectionLabel,
  Segmented,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/controls';
import { useNotebook } from '@/lib/client/store';
import {
  deleteSavedPage,
  insertFromLibrary,
  saveToLibrary,
  useSavedPages,
  type SavedPage,
} from '@/lib/client/pagelibrary';
import { compileTemplate } from '@/lib/compile/page';
import { newId } from '@/lib/ids';
import { presetsByCategory } from '@/lib/presets';
import { BLOCK_LABELS, BLOCK_TYPES, defaultBlockContent, type BlockType, type PageTemplate } from '@/lib/types/page';
import { contentRect, resolvePageSize, type Margins } from '@/lib/units';

export function PageDesigner() {
  const { notebook, update, assets, math } = useNotebook();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    notebook.templates[0]?.id ?? null
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [tab, setTab] = useState<'page' | 'blocks'>('page');
  const [addingPreset, setAddingPreset] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<PageTemplate | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null);
  const savedPages = useSavedPages();

  const template =
    notebook.templates.find((t) => t.id === selectedTemplateId) ?? notebook.templates[0] ?? null;

  const size = template?.sizeOverride
    ? resolvePageSize(template.sizeOverride)
    : resolvePageSize(notebook.pageSize);
  const margins = template?.marginsOverride ?? notebook.margins;
  const content = contentRect(size, margins);

  const compiled = useMemo(
    () =>
      template
        ? compileTemplate(template, { size, margins, assets, math, palette: notebook.palette })
        : null,
    [template, size, margins, assets, math, notebook.palette]
  );

  /* --------------------------------------------------------- mutations */

  const patchTemplate = (
    id: string,
    recipe: (t: PageTemplate) => PageTemplate,
    history = true
  ) =>
    update(
      (draft) => ({
        ...draft,
        templates: draft.templates.map((t) =>
          t.id === id ? { ...recipe(t), updatedAt: new Date().toISOString() } : t
        ),
      }),
      { history }
    );

  const addTemplates = (built: PageTemplate[]) => {
    if (built.length === 0) return;
    update((draft) => ({ ...draft, templates: [...draft.templates, ...built] }));
    setSelectedTemplateId(built[0].id);
    setAddingPreset(false);
  };

  const duplicateTemplate = (id: string) => {
    const source = notebook.templates.find((t) => t.id === id);
    if (!source) return;
    const copy: PageTemplate = {
      ...structuredClone(source),
      id: newId('tpl'),
      name: `${source.name} copy`,
      // A duplicate is meant to fork the design, so it must not keep updating
      // the library entry its source is linked to.
      libraryId: undefined,
      blocks: source.blocks.map((b) => ({ ...structuredClone(b), id: newId('blk') })),
    };
    update((draft) => ({ ...draft, templates: [...draft.templates, copy] }));
    setSelectedTemplateId(copy.id);
  };

  /** Snapshots the current design into the browser-wide page library. */
  const saveCurrentToLibrary = () => {
    if (!template) return;
    const { entry, libraryId } = saveToLibrary(template);
    if (template.libraryId !== libraryId) {
      patchTemplate(template.id, (t) => ({ ...t, libraryId }), false);
    }
    setLibraryNotice(`Saved “${entry.name}” to your page library.`);
  };

  const addSavedPages = (entries: SavedPage[]) => {
    if (entries.length === 0) return;
    const built = entries.map(insertFromLibrary);
    update((draft) => ({ ...draft, templates: [...draft.templates, ...built] }));
    setSelectedTemplateId(built[0].id);
    setAddingPreset(false);
  };

  const deleteTemplate = (id: string) => {
    update((draft) => ({
      ...draft,
      templates: draft.templates.filter((t) => t.id !== id),
      // Drop any running-order entries that pointed at the deleted design, so
      // the notebook never references a template that no longer exists.
      content: draft.content
        .map((item) =>
          item.kind === 'group'
            ? { ...item, items: item.items.filter((i) => i.kind !== 'template' || i.templateId !== id) }
            : item
        )
        .filter((item) => item.kind !== 'template' || item.templateId !== id),
    }));
    setSelectedTemplateId((current) =>
      current === id ? (notebook.templates.find((t) => t.id !== id)?.id ?? null) : current
    );
  };

  const addBlock = (type: BlockType) => {
    if (!template) return;
    const block = {
      id: newId('blk'),
      name: '',
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.25 },
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      padding: 0,
      content: defaultBlockContent(type),
    };
    patchTemplate(template.id, (t) => ({ ...t, blocks: [...t.blocks, block] }));
    setSelectedBlockId(block.id);
    setTab('blocks');
  };

  const selectedBlock = template?.blocks.find((b) => b.id === selectedBlockId) ?? null;

  /* ------------------------------------------------------------ render */

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-5 py-4 lg:h-[calc(var(--screen-h)-10rem)] lg:grid-cols-[230px_minmax(0,1fr)_360px]">
      {/* Designs list */}
      <aside className="space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <Panel
          title="Page designs"
          description={`${notebook.templates.length} in this notebook`}
          bodyClassName="p-2.5"
          actions={
            <Button size="sm" variant="primary" onClick={() => setAddingPreset(true)}>
              Add
            </Button>
          }
        >
          {notebook.templates.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] text-ink-400">
              No designs yet. Add one from a preset to get started.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {notebook.templates.map((t) => (
                <li key={t.id}>
                  <TemplateCard
                    template={t}
                    selected={t.id === template?.id}
                    notebookMargins={notebook.margins}
                    onSelect={() => {
                      setSelectedTemplateId(t.id);
                      setSelectedBlockId(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </aside>

      {/* Canvas */}
      <section className="flex min-w-0 flex-col lg:min-h-0">
        {!template ? (
          <EmptyState
            title="No page design selected"
            description="A page design describes one page: its ruling, margins and any blocks placed on it. Add one from the presets to begin."
            action={
              <Button variant="primary" onClick={() => setAddingPreset(true)}>
                Choose a preset
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                value={template.name}
                className="h-8 w-64 font-medium"
                onChange={(event) => {
                  const name = event.target.value;
                  patchTemplate(template.id, (t) => ({ ...t, name }), false);
                }}
              />
              <span className="text-[11px] text-ink-400">
                {round(size.w)} × {round(size.h)} mm
              </span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" onClick={() => duplicateTemplate(template.id)}>
                  Duplicate
                </Button>
                <Button size="sm" onClick={saveCurrentToLibrary}>
                  {template.libraryId ? 'Update in library' : 'Save to library'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTemplateToDelete(template)}>
                  Delete
                </Button>
              </div>
            </div>

            <CanvasViewport pageSize={size}>
                <BlockCanvas
                  ops={compiled?.ops ?? []}
                  size={size}
                  content={content}
                  blocks={template.blocks}
                  selectedId={selectedBlockId}
                  onSelect={(id) => {
                    setSelectedBlockId(id);
                    if (id) setTab('blocks');
                  }}
                  onChange={(id, rect) =>
                    patchTemplate(
                      template.id,
                      (t) => ({
                        ...t,
                        blocks: t.blocks.map((b) => (b.id === id ? { ...b, rect } : b)),
                      }),
                      // Dragging fires continuously; one undo entry is recorded
                      // by onCommit when the gesture ends.
                      false
                    )
                  }
                  onRotate={(id, rotation) =>
                    patchTemplate(
                      template.id,
                      (t) => ({
                        ...t,
                        blocks: t.blocks.map((b) => (b.id === id ? { ...b, rotation } : b)),
                      }),
                      false
                    )
                  }
                  onCommit={() => patchTemplate(template.id, (t) => ({ ...t }))}
                />
            </CanvasViewport>

            {compiled && compiled.warnings.length > 0 && (
              <Notice tone="warn">{[...new Set(compiled.warnings)].join(' ')}</Notice>
            )}

            {libraryNotice && (
              <Notice>
                {libraryNotice} It is available from “Add → Saved pages” in every
                notebook on this browser.
              </Notice>
            )}
          </div>
        )}
      </section>

      {/* Inspector */}
      <aside className="min-w-0 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {template && (
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'page', label: 'Page & ruling' },
                { value: 'blocks', label: `Blocks (${template.blocks.length})` },
              ]}
            />

            {tab === 'page' ? (
              <>
                <Panel title="Ruling">
                  <PatternEditor
                    pattern={template.pattern}
                    onChange={(pattern) => patchTemplate(template.id, (t) => ({ ...t, pattern }))}
                  />
                </Panel>
                <PalettePanel />
                <PageSettings template={template} patch={patchTemplate} />
              </>
            ) : (
              <>
                <Panel
                  title="Blocks"
                  description="Drag on the page to move; drag a corner to resize."
                  bodyClassName="p-2.5"
                  actions={<AddBlockMenu onAdd={addBlock} />}
                >
                  {template.blocks.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-ink-400">
                      No blocks. Add text, an image, a table or a nested pattern area.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {template.blocks.map((block, index) => (
                        <li key={block.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedBlockId(block.id)}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px]',
                              block.id === selectedBlockId
                                ? 'bg-accent-50 text-accent-700'
                                : 'text-ink-700 hover:bg-ink-100'
                            )}
                          >
                            <span className="w-4 shrink-0 text-[10px] text-ink-400">{index + 1}</span>
                            <span className="truncate">{block.name || labelFor(block.content)}</span>
                            {!block.visible && (
                              <span className="ml-auto text-[9.5px] text-ink-400">hidden</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                {selectedBlock && (
                  <BlockInspector
                    block={selectedBlock}
                    content={content}
                    onChange={(next) =>
                      patchTemplate(template.id, (t) => ({
                        ...t,
                        blocks: t.blocks.map((b) => (b.id === next.id ? next : b)),
                      }))
                    }
                    onDelete={() => {
                      patchTemplate(template.id, (t) => ({
                        ...t,
                        blocks: t.blocks.filter((b) => b.id !== selectedBlock.id),
                      }));
                      setSelectedBlockId(null);
                    }}
                    onDuplicate={() => {
                      const copy = {
                        ...structuredClone(selectedBlock),
                        id: newId('blk'),
                        rect: {
                          ...selectedBlock.rect,
                          x: Math.min(0.95, selectedBlock.rect.x + 0.03),
                          y: Math.min(0.95, selectedBlock.rect.y + 0.03),
                        },
                      };
                      patchTemplate(template.id, (t) => ({ ...t, blocks: [...t.blocks, copy] }));
                      setSelectedBlockId(copy.id);
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
      </aside>

      <PresetModal
        open={addingPreset}
        onClose={() => setAddingPreset(false)}
        onAdd={addTemplates}
        onAddSaved={addSavedPages}
        savedPages={savedPages}
        onDeleteSaved={(id) => deleteSavedPage(id)}
        pageSize={notebook.pageSize}
      />
      <Modal
        open={templateToDelete !== null}
        onClose={() => setTemplateToDelete(null)}
        title="Delete page design?"
        description="This also removes every running-order entry that uses this design."
        footer={
          <>
            <Button onClick={() => setTemplateToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (templateToDelete) deleteTemplate(templateToDelete.id);
                setTemplateToDelete(null);
              }}
            >
              Delete design
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          “{templateToDelete?.name || 'Untitled page'}” cannot be restored after saving.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function TemplateCard({
  template,
  selected,
  notebookMargins,
  onSelect,
}: {
  template: PageTemplate;
  selected: boolean;
  notebookMargins: Margins;
  onSelect: () => void;
}) {
  const { notebook, assets, math } = useNotebook();
  const size = template.sizeOverride
    ? resolvePageSize(template.sizeOverride)
    : resolvePageSize(notebook.pageSize);

  const compiled = useMemo(
    () =>
      compileTemplate(template, {
        size,
        margins: template.marginsOverride ?? notebookMargins,
        assets,
        math,
        palette: notebook.palette,
      }),
    [template, size, notebookMargins, assets, math, notebook.palette]
  );

  return (
    <PageThumb
      ops={compiled.ops}
      size={size}
      height={92}
      selected={selected}
      onClick={onSelect}
      label={template.name}
    />
  );
}

function PageSettings({
  template,
  patch,
}: {
  template: PageTemplate;
  patch: (id: string, recipe: (t: PageTemplate) => PageTemplate, history?: boolean) => void;
}) {
  const { notebook } = useNotebook();
  const margins = template.marginsOverride ?? notebook.margins;

  const setMargin = (key: keyof Margins, value: number) =>
    patch(template.id, (t) => ({
      ...t,
      marginsOverride: { ...(t.marginsOverride ?? notebook.margins), [key]: value },
    }));

  return (
    <Panel title="Page settings">
      <div className="space-y-3">
        <Field label="Description">
          <TextArea
            rows={2}
            value={template.description}
            placeholder="What this page is for"
            onChange={(event) => {
              const description = event.target.value;
              patch(template.id, (t) => ({ ...t, description }), false);
            }}
          />
        </Field>

        <div>
          <SectionLabel>Margins</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Field key={side} label={side[0].toUpperCase() + side.slice(1)}>
                <NumberInput
                  value={margins[side]}
                  min={0}
                  max={100}
                  step={0.5}
                  suffix="mm"
                  onChange={(value) => setMargin(side, value)}
                />
              </Field>
            ))}
          </div>
          {template.marginsOverride && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 w-full"
              onClick={() => patch(template.id, (t) => ({ ...t, marginsOverride: null }))}
            >
              Use the notebook margins
            </Button>
          )}
        </div>

        <Toggle
          checked={template.sizeOverride !== null}
          onChange={(on) =>
            patch(template.id, (t) => ({
              ...t,
              sizeOverride: on ? notebook.pageSize : null,
            }))
          }
          label="Override the page size"
          hint="Normally off, so retargeting the notebook moves every page at once."
        />

        {template.sizeOverride && (
          <PageSizePicker
            value={template.sizeOverride}
            label="This page's size"
            onChange={(sizeOverride) => patch(template.id, (t) => ({ ...t, sizeOverride }))}
          />
        )}

        <Field
          label="Type scale when the page size changes"
          hint="Proportional keeps the design looking the same at a smaller trim size."
        >
          <Select
            value={template.typeScale}
            onChange={(event) => {
              const typeScale = event.target.value as PageTemplate['typeScale'];
              patch(template.id, (t) => ({ ...t, typeScale }));
            }}
          >
            <option value="proportional">Scale type with the page</option>
            <option value="fixed">Keep type at its millimetre size</option>
          </Select>
        </Field>

        <Field label="Background fill">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={template.background ?? '#ffffff'}
              className="h-7 w-9 rounded"
              onChange={(event) => {
                const background = event.target.value;
                patch(template.id, (t) => ({ ...t, background }));
              }}
            />
            {template.background && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => patch(template.id, (t) => ({ ...t, background: null }))}
              >
                None
              </Button>
            )}
          </div>
        </Field>
      </div>
    </Panel>
  );
}

function AddBlockMenu({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="primary" onClick={() => setOpen((v) => !v)}>
        Add block
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg">
            {BLOCK_TYPES.map((type) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(type);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-700 hover:bg-ink-100"
                >
                  {BLOCK_LABELS[type]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PresetModal({
  open,
  onClose,
  onAdd,
  onAddSaved,
  savedPages,
  onDeleteSaved,
  pageSize,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (templates: PageTemplate[]) => void;
  onAddSaved: (entries: SavedPage[]) => void;
  savedPages: SavedPage[];
  onDeleteSaved: (id: string) => void;
  pageSize: PageTemplate['authoredFor'];
}) {
  const [chosenPresets, setChosenPresets] = useState<string[]>([]);
  const [chosenPages, setChosenPages] = useState<string[]>([]);
  const groups = presetsByCategory();
  const total = chosenPresets.length + chosenPages.length;

  const add = () => {
    // Saved pages first, so a reused design keeps its place ahead of presets
    // in the notebook's design list.
    const fromLibrary = savedPages.filter((page) => chosenPages.includes(page.id));
    if (fromLibrary.length > 0) onAddSaved(fromLibrary);

    const built = groups
      .flatMap((group) => group.presets)
      .filter((preset) => chosenPresets.includes(preset.id))
      .map((preset) => preset.build({ pageSize }));
    if (built.length > 0) onAdd(built);

    setChosenPresets([]);
    setChosenPages([]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add page designs"
      description="Presets and saved pages are copied into the notebook — edit them freely afterwards."
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} disabled={total === 0}>
            Add {total || ''} design{total === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {savedPages.length > 0 && (
          <div>
            <SectionLabel>Your saved pages</SectionLabel>
            <ul className="grid gap-2 sm:grid-cols-2">
              {savedPages.map((page) => (
                <li key={page.id}>
                  <SavedPageRow
                    page={page}
                    selected={chosenPages.includes(page.id)}
                    notebookPageSize={pageSize}
                    onToggle={() =>
                      setChosenPages((current) =>
                        current.includes(page.id)
                          ? current.filter((id) => id !== page.id)
                          : [...current, page.id]
                      )
                    }
                    onDelete={() => {
                      onDeleteSaved(page.id);
                      setChosenPages((current) => current.filter((id) => id !== page.id));
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.category}>
            <SectionLabel>{group.category}</SectionLabel>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.presets.map((preset) => {
                const active = chosenPresets.includes(preset.id);
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setChosenPresets((current) =>
                          current.includes(preset.id)
                            ? current.filter((id) => id !== preset.id)
                            : [...current, preset.id]
                        )
                      }
                      className={clsx(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-accent-500 bg-accent-50'
                          : 'border-ink-200 hover:border-ink-300'
                      )}
                    >
                      <div className="text-[12.5px] font-medium text-ink-900">{preset.name}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
                        {preset.description}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * A library entry in the Add-designs picker. The preview compiles the saved
 * template against the *notebook's* page size, so what you see is the adapted
 * result, not the size it was designed at.
 */
function SavedPageRow({
  page,
  selected,
  notebookPageSize,
  onToggle,
  onDelete,
}: {
  page: SavedPage;
  selected: boolean;
  notebookPageSize: PageTemplate['authoredFor'];
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { notebook, assets, math } = useNotebook();
  const size = resolvePageSize(notebookPageSize);

  const compiled = useMemo(
    () =>
      compileTemplate(page.template, {
        size,
        margins: notebook.margins,
        assets,
        math,
        palette: notebook.palette,
      }),
    [page.template, size, notebook.margins, notebook.palette, assets, math]
  );

  const authored = resolvePageSize(page.template.authoredFor);
  const adapts =
    Math.abs(authored.w - size.w) > 0.05 || Math.abs(authored.h - size.h) > 0.05;

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected ? 'border-accent-500 bg-accent-50' : 'border-ink-200 hover:border-ink-300'
      )}
    >
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="shrink-0">
          <PageThumb ops={compiled.ops} size={size} height={64} selected={selected} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium text-ink-900">{page.name}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
            {adapts ? (
              <>
                Designed for {labelSize(page.template.authoredFor)} — adapts to this
                notebook's {labelSize(notebookPageSize)}
              </>
            ) : (
              <>Sized for this notebook</>
            )}
          </div>
        </div>
      </button>
      <Button
        size="sm"
        variant="ghost"
        title="Remove from your page library"
        onClick={onDelete}
      >
        ✕
      </Button>
    </div>
  );
}

function labelSize(spec: PageTemplate['authoredFor']): string {
  return spec.name === 'Custom'
    ? `${round(resolvePageSize(spec).w)}×${round(resolvePageSize(spec).h)} mm`
    : spec.name;
}

const round = (n: number) => Math.round(n * 10) / 10;
