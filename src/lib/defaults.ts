import { newId } from './ids';
import { DEFAULT_PALETTE, type NotebookPalette } from './palette';
import { getPreset } from './presets';
import { zNotebook, type ContentItem, type Notebook } from './types/notebook';
import { defaultPageSize, uniformMargins, type PageSizeSpec } from './units';

export interface NewNotebookInput {
  name: string;
  palette?: NotebookPalette;
  description?: string;
  pageSize?: PageSizeSpec;
  /** Preset ids to seed the notebook's page designs with. */
  presetIds?: string[];
  sheet?: PageSizeSpec;
}

/**
 * Creates a notebook that is immediately useful: an A5 trim size, one dot-grid
 * design, and a 2-up A4 imposition. Starting from a blank notebook with no
 * pages makes the first run feel broken, so the defaults produce something that
 * already exports.
 */
export function createNotebook(input: NewNotebookInput): Notebook {
  const now = new Date().toISOString();
  const pageSize = input.pageSize ?? defaultPageSize('A5', 'portrait');
  const presetIds = input.presetIds?.length ? input.presetIds : ['dots-5'];

  const templates = presetIds
    .map((id) => getPreset(id)?.build({ pageSize }))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const content: ContentItem[] = templates.length
    ? [
        {
          kind: 'template',
          id: newId('item'),
          templateId: templates[0].id,
          count: 32,
          label: '',
        },
      ]
    : [];

  return zNotebook.parse({
    id: newId('nb'),
    name: input.name,
    description: input.description ?? '',
    pageSize,
    margins: uniformMargins(10),
    palette: input.palette ?? DEFAULT_PALETTE,
    templates,
    content,
    imposition: {
      sheet: input.sheet ?? defaultPageSize('A4', 'portrait'),
      sheetMargins: uniformMargins(5),
      mode: 'grid',
      rows: 2,
      cols: 1,
      gutterX: 0,
      gutterY: 0,
      bleed: 0,
      slotRotation: 0,
      scaleToFit: true,
      extraScale: 1,
      duplex: false,
      mirrorBackSide: true,
      bindingEdge: 'left',
      slots: [],
      cropMarks: { enabled: true, length: 4, offset: 1.5, color: '#000000', width: 0.15 },
      foldMarks: false,
      pageBorder: { enabled: false, color: '#c8d4e0', width: 0.15 },
      padWith: 'blank',
      showSlotNumbers: false,
    },
    output: {
      fileName: slugify(input.name) || 'notebook',
      title: input.name,
      author: '',
      pageNumbering: {
        enabled: false,
        format: '{n}',
        startAt: 1,
        skipFirst: 0,
        position: 'bottom-center',
        margin: 8,
        font: { family: 'helvetica', bold: false, italic: false },
        size: 3,
        color: '#8fa5ba',
        align: 'center',
      },
    },
    createdAt: now,
    updatedAt: now,
  });
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
