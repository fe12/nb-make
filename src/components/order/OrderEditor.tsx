'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { PageThumb } from '@/components/PagePreview';
import { GeneratorParams } from '@/components/order/GeneratorParams';
import {
  Button,
  EmptyState,
  Modal,
  Notice,
  NumberInput,
  Panel,
  SectionLabel,
  Select,
  TextInput,
  Toggle,
} from '@/components/ui/controls';
import { useCompiled, useNotebook } from '@/lib/client/store';
import { newId } from '@/lib/ids';
import {
  GENERATORS,
  SEQUENCE_UNIT_LABEL,
  coerceParams,
  defaultParams,
  generatorsByCategory,
  getGenerator,
} from '@/lib/parametric';
import type { ContentItem, LeafItem } from '@/lib/types/notebook';
import { resolvePageSize } from '@/lib/units';

/** How many pages to compile for the preview strip. */
const PREVIEW_LIMIT = 60;

export function OrderEditor() {
  const { notebook, update } = useNotebook();
  const compiled = useCompiled(PREVIEW_LIMIT);
  const size = resolvePageSize(notebook.pageSize);
  const [adding, setAdding] = useState<null | { groupId?: string }>(null);
  const [itemToDelete, setItemToDelete] = useState<ContentItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const setContent = (recipe: (items: ContentItem[]) => ContentItem[]) =>
    update((draft) => ({ ...draft, content: recipe(draft.content) }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setContent((items) => {
      const from = items.findIndex((i) => i.id === active.id);
      const to = items.findIndex((i) => i.id === over.id);
      return from === -1 || to === -1 ? items : arrayMove(items, from, to);
    });
  };

  const addItem = (item: ContentItem, groupId?: string) => {
    setContent((items) =>
      groupId
        ? items.map((existing) =>
            existing.id === groupId && existing.kind === 'group'
              ? { ...existing, items: [...existing.items, item as LeafItem] }
              : existing
          )
        : [...items, item]
    );
    setAdding(null);
  };

  // Cache the derived page count on the notebook so the dashboard can show it
  // without re-running every generator. Done in an effect, never during render.
  const totalPages = compiled.totalPages;
  useEffect(() => {
    update((draft) => {
      if (draft.stats?.pageCount === totalPages) return draft;
      return {
        ...draft,
        stats: {
          pageCount: totalPages,
          sheetCount: draft.stats?.sheetCount ?? 0,
          computedAt: new Date().toISOString(),
        },
      };
    }, { history: false });
  }, [totalPages, update]);

  return (
    <div className="mx-auto grid w-full max-w-[1800px] gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="space-y-3">
        <Panel
          title="Running order"
          description={`${compiled.totalPages} page${compiled.totalPages === 1 ? '' : 's'} in total — drag to reorder`}
          actions={
            <>
              <Button
                size="sm"
                onClick={() =>
                  setContent((items) => [
                    ...items,
                    {
                      kind: 'group',
                      id: newId('item'),
                      label: 'Section',
                      repeat: 12,
                      items: [],
                      advanceDates: true,
                    },
                  ])
                }
              >
                Add repeating section
              </Button>
              <Button size="sm" variant="primary" onClick={() => setAdding({})}>
                Add pages
              </Button>
            </>
          }
        >
          {notebook.content.length === 0 ? (
            <EmptyState
              title="The notebook is empty"
              description="Add a run of a page design, or a parametric generator like a calendar that expands into many pages at once."
              action={
                <Button variant="primary" onClick={() => setAdding({})}>
                  Add pages
                </Button>
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={notebook.content.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {notebook.content.map((item) => (
                    <SortableRow key={item.id} id={item.id}>
                      <ItemCard
                        item={item}
                        onChange={(next) =>
                          setContent((items) => items.map((i) => (i.id === next.id ? next : i)))
                        }
                        onDelete={() => setItemToDelete(item)}
                        onAddToGroup={() => setAdding({ groupId: item.id })}
                      />
                    </SortableRow>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </Panel>

        {compiled.warnings.length > 0 && (
          <Notice tone="warn">{[...new Set(compiled.warnings)].join(' ')}</Notice>
        )}
      </section>

      <aside>
        <Panel
          title="Pages"
          description={
            compiled.totalPages > compiled.pages.length
              ? `Showing the first ${compiled.pages.length} of ${compiled.totalPages}`
              : `${compiled.pages.length} page${compiled.pages.length === 1 ? '' : 's'}`
          }
          bodyClassName="p-2.5"
        >
          {compiled.pages.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-ink-400">Nothing to preview yet.</p>
          ) : (
            <ul className="grid max-h-[calc(var(--screen-h)*0.7)] grid-cols-3 gap-2.5 overflow-y-auto">
              {compiled.pages.map((page) => (
                <li key={`${page.index}`}>
                  <PageThumb
                    ops={page.ops}
                    size={size}
                    height={104}
                    label={`${page.index + 1}. ${page.label}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </aside>

      <AddPagesModal
        open={adding !== null}
        groupId={adding?.groupId}
        onClose={() => setAdding(null)}
        onAdd={addItem}
      />
      <Modal
        open={itemToDelete !== null}
        onClose={() => setItemToDelete(null)}
        title="Remove pages from the running order?"
        description="The page design or generator remains available; only this entry is removed."
        footer={
          <>
            <Button onClick={() => setItemToDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (itemToDelete) setContent((items) => items.filter((item) => item.id !== itemToDelete.id));
                setItemToDelete(null);
              }}
            >
              Remove pages
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-600">
          {itemToDelete?.kind === 'group'
            ? `This removes the “${itemToDelete.label || 'Section'}” repeating section and its pages.`
            : 'This removes this page entry from the notebook.'}
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{
        // `CSS.Translate` rather than `CSS.Transform`: dnd-kit puts a scale
        // factor in the transform so an item can morph into the size of the one
        // it is displacing. Rows here differ wildly in height (a one-line entry
        // vs. an expanded section), so that scale stretches the dragged card.
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={clsx('relative', isDragging && 'z-10 opacity-80')}
    >
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="shrink-0 cursor-grab rounded border border-ink-200 bg-ink-50 px-1.5 text-ink-400 hover:text-ink-600 active:cursor-grabbing"
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </li>
  );
}

function ItemCard({
  item,
  onChange,
  onDelete,
  onAddToGroup,
}: {
  item: ContentItem;
  onChange: (next: ContentItem) => void;
  onDelete: () => void;
  onAddToGroup: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (item.kind === 'group') {
    const pagesPerRepeat = item.items.reduce(
      (total, leaf) => total + (leaf.kind === 'template' ? leaf.count : 1),
      0
    );
    const datedLeaves = describeSequences(item.items, item.repeat);

    return (
      <div className="rounded-md border border-ink-200 bg-ink-50/60 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={item.label}
            className="h-7 w-40 py-0.5 text-[12px] font-medium"
            onChange={(event) => onChange({ ...item, label: event.target.value })}
          />
          <span className="text-[11px] text-ink-500">repeat</span>
          <div className="w-20">
            <NumberInput
              value={item.repeat}
              min={1}
              max={500}
              step={1}
              onChange={(repeat) => onChange({ ...item, repeat })}
            />
          </div>
          <span className="text-[11px] text-ink-400">
            × {item.items.length} entr{item.items.length === 1 ? 'y' : 'ies'}
          </span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" onClick={onAddToGroup}>
              Add entry
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              Remove
            </Button>
          </div>
        </div>

        {item.items.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-400">
            Empty. Add entries and they will repeat as a block — useful for patterns like two dot-grid
            pages followed by one ruled page.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {item.items.map((leaf) => (
              <li key={leaf.id}>
                <LeafCard
                  leaf={leaf}
                  compact
                  onChange={(next) =>
                    onChange({
                      ...item,
                      items: item.items.map((l) => (l.id === next.id ? next : l)),
                    })
                  }
                  onDelete={() =>
                    onChange({ ...item, items: item.items.filter((l) => l.id !== leaf.id) })
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {datedLeaves.length > 0 && (
          <div className="mt-2.5 border-t border-ink-200 pt-2.5">
            <Toggle
              checked={item.advanceDates}
              onChange={(advanceDates) => onChange({ ...item, advanceDates })}
              label="Advance dates each repeat"
              hint={`Steps ${datedLeaves
                .map((d) => d.name)
                .join(' and ')} forward one ${datedLeaves[0].unit} per repeat instead of repeating the same one.`}
            />
            {item.advanceDates && (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-500">
                {datedLeaves.map((dated) => (
                  <span key={dated.id} className="mr-3 inline-block">
                    <span className="text-ink-400">{dated.name}:</span>{' '}
                    <span className="font-medium text-ink-700">{dated.preview}</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}

        <p className="mt-2 text-[10.5px] text-ink-400">
          Produces {pagesPerRepeat * item.repeat} pages.
        </p>
      </div>
    );
  }

  return (
    <LeafCard
      leaf={item}
      onChange={onChange}
      onDelete={onDelete}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    />
  );
}

function LeafCard({
  leaf,
  onChange,
  onDelete,
  compact,
  expanded,
  onToggle,
}: {
  leaf: LeafItem;
  onChange: (next: LeafItem) => void;
  onDelete: () => void;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { notebook } = useNotebook();
  const [localOpen, setLocalOpen] = useState(false);
  const open = expanded ?? localOpen;
  const toggle = onToggle ?? (() => setLocalOpen((v) => !v));

  if (leaf.kind === 'template') {
    const template = notebook.templates.find((t) => t.id === leaf.templateId);
    return (
      <div
        className={clsx(
          'flex flex-wrap items-center gap-2 rounded-md border bg-white p-2.5',
          compact ? 'border-ink-200' : 'border-ink-200'
        )}
      >
        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-500">
          Design
        </span>
        <Select
          value={leaf.templateId}
          className="h-7 w-52 py-0.5 text-[12px]"
          onChange={(event) => onChange({ ...leaf, templateId: event.target.value })}
        >
          {notebook.templates.length === 0 && <option value="">No designs available</option>}
          {notebook.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <span className="text-[11px] text-ink-500">×</span>
        <div className="w-20">
          <NumberInput
            value={leaf.count}
            min={1}
            max={2000}
            step={1}
            onChange={(count) => onChange({ ...leaf, count })}
          />
        </div>
        {!template && <span className="text-[11px] text-danger-500">Design missing</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onDelete}>
          Remove
        </Button>
      </div>
    );
  }

  const generator = getGenerator(leaf.generatorId);

  return (
    <div className="rounded-md border border-ink-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <span className="rounded bg-accent-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent-700">
          Generated
        </span>
        <span className="text-[12.5px] font-medium text-ink-900">
          {generator?.name ?? leaf.generatorId}
        </span>
        {!generator && <span className="text-[11px] text-danger-500">Unknown generator</span>}
        <div className="ml-auto flex gap-1">
          <Button size="sm" onClick={toggle}>
            {open ? 'Hide options' : 'Options'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Remove
          </Button>
        </div>
      </div>

      {open && generator && (
        <div className="border-t border-ink-200 p-2.5">
          <p className="mb-2.5 text-[11px] leading-snug text-ink-500">{generator.description}</p>
          <GeneratorParams
            generator={generator}
            params={leaf.params}
            onChange={(params) => onChange({ ...leaf, params })}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function AddPagesModal({
  open,
  groupId,
  onClose,
  onAdd,
}: {
  open: boolean;
  groupId?: string;
  onClose: () => void;
  onAdd: (item: ContentItem, groupId?: string) => void;
}) {
  const { notebook } = useNotebook();
  const [tab, setTab] = useState<'design' | 'generated'>('design');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={groupId ? 'Add an entry to the section' : 'Add pages'}
      width="max-w-2xl"
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-md border border-ink-300 bg-ink-50 p-0.5">
          {(['design', 'generated'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={clsx(
                'flex-1 rounded px-2 py-1 text-[12px] font-medium',
                tab === value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'
              )}
            >
              {value === 'design' ? 'A page design' : 'A parametric generator'}
            </button>
          ))}
        </div>

        {tab === 'design' ? (
          notebook.templates.length === 0 ? (
            <Notice tone="warn">
              This notebook has no page designs yet. Add one on the “Design pages” step first.
            </Notice>
          ) : (
            <ul className="space-y-1.5">
              {notebook.templates.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onAdd(
                        {
                          kind: 'template',
                          id: newId('item'),
                          templateId: template.id,
                          count: 16,
                          label: '',
                        },
                        groupId
                      )
                    }
                    className="w-full rounded-md border border-ink-200 px-3 py-2 text-left hover:border-accent-400 hover:bg-accent-50"
                  >
                    <div className="text-[12.5px] font-medium text-ink-900">{template.name}</div>
                    {template.description && (
                      <div className="mt-0.5 text-[11px] text-ink-500">{template.description}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-y-4">
            {generatorsByCategory().map((group) => (
              <div key={group.category}>
                <SectionLabel>{group.category}</SectionLabel>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {group.generators.map((generator) => (
                    <li key={generator.id}>
                      <button
                        type="button"
                        onClick={() =>
                          onAdd(
                            {
                              kind: 'parametric',
                              id: newId('item'),
                              generatorId: generator.id,
                              params: defaultParams(generator),
                              baseTemplateId: null,
                              label: '',
                            },
                            groupId
                          )
                        }
                        className="h-full w-full rounded-md border border-ink-200 px-3 py-2 text-left hover:border-accent-400 hover:bg-accent-50"
                      >
                        <div className="text-[12.5px] font-medium text-ink-900">
                          {generator.name}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
                          {generator.description}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-[10.5px] text-ink-400">
              {GENERATORS.length} generators available.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Summarises what a repeating section's dated entries will step through, e.g.
 * "Jan 2026 -> Feb 2026 -> ... -> Dec 2026". Shown so the effect of the toggle
 * is visible before anything is generated.
 */
function describeSequences(
  items: LeafItem[],
  repeat: number
): Array<{ id: string; name: string; unit: string; preview: string }> {
  const out: Array<{ id: string; name: string; unit: string; preview: string }> = [];

  for (const leaf of items) {
    if (leaf.kind !== 'parametric') continue;
    const generator = getGenerator(leaf.generatorId);
    if (!generator?.sequence) continue;

    const params = coerceParams(generator, leaf.params);
    const label = (step: number) => generator.sequence!.labelFor(params, step);
    const preview =
      repeat <= 3
        ? Array.from({ length: repeat }, (_, i) => label(i)).join(' → ')
        : `${label(0)} → ${label(1)} → … → ${label(repeat - 1)}`;

    out.push({
      id: leaf.id,
      name: generator.name,
      unit: SEQUENCE_UNIT_LABEL[generator.sequence.unit],
      preview,
    });
  }
  return out;
}
