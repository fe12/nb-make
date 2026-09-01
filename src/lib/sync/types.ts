/**
 * The shape a notebook takes in Postgres, and the mapping to and from the
 * local document.
 *
 * Deliberately free of browser and server APIs: the sync engine, the route
 * handlers and the seed script all need this, and they run in three different
 * environments.
 *
 * The whole `Notebook` is stored as one `jsonb` column rather than being
 * shredded into tables. It is a document the render pipeline owns end to end,
 * and normalising it would mean every schema change to a page block became a
 * migration. The columns alongside it are only what the platform needs to
 * *query* on -- listing, sorting and moderation.
 */
import type { Notebook } from '../types/notebook';
import { resolvePageSize } from '../units';

export interface RemoteNotebookRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  doc: Notebook;
  revision: number;
  page_count: number;
  template_count: number;
  page_size_label: string;
  is_published: boolean;
  is_featured: boolean;
  published_at: string | null;
  like_count: number;
  save_count: number;
  view_count: number;
  rating_count: number;
  rating_avg: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A community listing entry: the row plus its author, minus the document. */
export interface CommunityNotebook extends Omit<RemoteNotebookRow, 'doc'> {
  doc?: Notebook;
  author: { id: string; display_name: string } | null;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
  my_rating?: number | null;
}

export const pageSizeLabel = (notebook: Notebook): string => {
  const size = resolvePageSize(notebook.pageSize);
  const round = (n: number) => Math.round(n * 10) / 10;
  return notebook.pageSize.name === 'Custom'
    ? `${round(size.w)}×${round(size.h)} mm`
    : `${notebook.pageSize.name} ${notebook.pageSize.orientation}`;
};

/**
 * The columns a push writes. `revision` is supplied by the caller because the
 * server compares it against the stored row before accepting the write.
 */
export function toRemoteColumns(
  notebook: Notebook,
  ownerId: string,
  revision: number
): Omit<
  RemoteNotebookRow,
  | 'is_published'
  | 'is_featured'
  | 'published_at'
  | 'like_count'
  | 'save_count'
  | 'view_count'
  | 'rating_count'
  | 'rating_avg'
  | 'deleted_at'
> {
  return {
    id: notebook.id,
    owner_id: ownerId,
    name: notebook.name,
    description: notebook.description,
    doc: notebook,
    revision,
    page_count: notebook.stats?.pageCount ?? 0,
    template_count: notebook.templates.length,
    page_size_label: pageSizeLabel(notebook),
    created_at: notebook.createdAt,
    updated_at: notebook.updatedAt,
  };
}

/** Sort orders offered by the community browser. */
export const COMMUNITY_SORTS = {
  trending: { label: 'Trending', column: 'view_count', ascending: false },
  rating: { label: 'Top rated', column: 'rating_avg', ascending: false },
  likes: { label: 'Most liked', column: 'like_count', ascending: false },
  saves: { label: 'Most saved', column: 'save_count', ascending: false },
  newest: { label: 'Newest', column: 'published_at', ascending: false },
} as const;

export type CommunitySort = keyof typeof COMMUNITY_SORTS;
