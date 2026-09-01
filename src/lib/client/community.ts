'use client';

/**
 * Reads and writes for the community side of the app.
 *
 * These go straight to Supabase rather than through a route handler: they are
 * ordinary queries with no `sendBeacon` problem to work around, and row-level
 * security already decides what each caller may see. Adding a server hop would
 * only add latency and a second place for the rules to drift.
 */
import { newId } from '../ids';
import { requireSupabase } from '../supabase/client';
import { ASSET_BUCKET, assetPublicUrl } from '../supabase/config';
import { COMMUNITY_SORTS, type CommunityNotebook, type CommunitySort } from '../sync/types';
import type { Notebook } from '../types/notebook';
import { zNotebook } from '../types/notebook';
import * as storage from './storage';

/** Columns for a listing card — everything except the document itself. */
const LIST_COLUMNS =
  'id, owner_id, name, description, page_count, template_count, page_size_label, ' +
  'is_published, is_featured, published_at, like_count, save_count, view_count, ' +
  'rating_count, rating_avg, created_at, updated_at, ' +
  'author:public_profiles!notebooks_owner_id_fkey(id, display_name)';

export interface CommunityQuery {
  sort?: CommunitySort;
  search?: string;
  minRating?: number;
  featuredOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCommunity(query: CommunityQuery = {}): Promise<CommunityNotebook[]> {
  const supabase = requireSupabase();
  const sort = COMMUNITY_SORTS[query.sort ?? 'trending'];

  let request = supabase
    .from('notebooks')
    .select(LIST_COLUMNS)
    .eq('is_published', true)
    .is('deleted_at', null);

  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`;
    request = request.or(`name.ilike.${term},description.ilike.${term}`);
  }
  if (query.minRating) request = request.gte('rating_avg', query.minRating);
  if (query.featuredOnly) request = request.eq('is_featured', true);

  const { data, error } = await request
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 24) - 1);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CommunityNotebook[];
}

export interface CommunityDetail extends CommunityNotebook {
  doc: Notebook;
  asset_urls: Record<string, string>;
  reviews: Array<{
    user_id: string;
    rating: number;
    review: string;
    updated_at: string;
    author: { display_name: string } | null;
  }>;
}

export async function getCommunityNotebook(id: string): Promise<CommunityDetail | null> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from('notebooks')
    .select(`${LIST_COLUMNS}, doc, asset_urls`)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: reviews } = await supabase
    .from('notebook_ratings')
    .select('user_id, rating, review, updated_at, author:public_profiles!notebook_ratings_user_id_fkey(display_name)')
    .eq('notebook_id', id)
    .order('updated_at', { ascending: false })
    .limit(50);

  const detail = data as unknown as CommunityDetail;
  detail.reviews = (reviews ?? []) as unknown as CommunityDetail['reviews'];

  const { data: session } = await supabase.auth.getUser();
  if (session.user) {
    const [liked, saved, mine] = await Promise.all([
      supabase.from('notebook_likes').select('notebook_id').eq('notebook_id', id).eq('user_id', session.user.id).maybeSingle(),
      supabase.from('notebook_saves').select('notebook_id').eq('notebook_id', id).eq('user_id', session.user.id).maybeSingle(),
      supabase.from('notebook_ratings').select('rating').eq('notebook_id', id).eq('user_id', session.user.id).maybeSingle(),
    ]);
    detail.liked_by_me = Boolean(liked.data);
    detail.saved_by_me = Boolean(saved.data);
    detail.my_rating = (mine.data as { rating: number } | null)?.rating ?? null;
  }

  return detail;
}

/** Fire-and-forget: a failed view count must never break the page. */
export function recordView(id: string): void {
  const supabase = requireSupabase();
  void supabase.rpc('increment_notebook_view', { target: id });
}

/* ----------------------------------------------------------- engagement */

export async function setLiked(id: string, liked: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to like a notebook.');

  const { error } = liked
    ? await supabase.from('notebook_likes').insert({ notebook_id: id, user_id: data.user.id })
    : await supabase.from('notebook_likes').delete().eq('notebook_id', id).eq('user_id', data.user.id);

  // A duplicate insert means it was already liked, which is the desired state.
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function setSaved(id: string, saved: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to save a notebook.');

  const { error } = saved
    ? await supabase.from('notebook_saves').insert({ notebook_id: id, user_id: data.user.id })
    : await supabase.from('notebook_saves').delete().eq('notebook_id', id).eq('user_id', data.user.id);

  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function rateNotebook(id: string, rating: number, review: string): Promise<void> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to rate a notebook.');

  const { error } = await supabase.from('notebook_ratings').upsert(
    {
      notebook_id: id,
      user_id: data.user.id,
      rating: Math.min(5, Math.max(1, Math.round(rating))),
      review: review.slice(0, 2000),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'notebook_id,user_id' }
  );
  if (error) throw new Error(error.message);
}

export async function clearRating(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from('notebook_ratings').delete().eq('notebook_id', id).eq('user_id', data.user.id);
}

export async function reportNotebook(id: string, reason: string): Promise<void> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to report a notebook.');

  const { error } = await supabase
    .from('notebook_reports')
    .insert({ notebook_id: id, reporter_id: data.user.id, reason: reason.slice(0, 1000) });
  if (error) throw new Error(error.message);
}

export async function listSaved(): Promise<CommunityNotebook[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return [];

  const { data, error } = await supabase
    .from('notebook_saves')
    .select(`created_at, notebook:notebooks!inner(${LIST_COLUMNS})`)
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  // A save survives the notebook being unpublished; hide those rather than
  // showing a card that leads nowhere.
  return (data ?? [])
    .map((row) => (row as unknown as { notebook: CommunityNotebook }).notebook)
    .filter((notebook): notebook is CommunityNotebook => Boolean(notebook?.is_published));
}

/** Which of the signed-in user's notebooks are currently published. */
export async function listMyPublishState(): Promise<Record<string, boolean>> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return {};

  const { data, error } = await supabase
    .from('notebooks')
    .select('id, is_published')
    .eq('owner_id', session.user.id)
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  const state: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ id: string; is_published: boolean }>) {
    state[row.id] = row.is_published;
  }
  return state;
}

/* ------------------------------------------------------------ publishing */

/**
 * Publishes or unpublishes, uploading referenced images the first time.
 *
 * The document is stored as-is; only the image *bytes* need moving, because
 * they live in the author's IndexedDB where nobody else can reach them.
 */
export async function setPublished(notebook: Notebook, published: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) throw new Error('Sign in to publish.');

  const patch: Record<string, unknown> = { is_published: published };

  if (published) {
    patch.asset_urls = await uploadAssets(notebook, session.user.id);
  }

  const { error } = await supabase
    .from('notebooks')
    .update(patch)
    .eq('id', notebook.id)
    .eq('owner_id', session.user.id);

  if (error) throw new Error(error.message);
}

async function uploadAssets(notebook: Notebook, ownerId: string): Promise<Record<string, string>> {
  const supabase = requireSupabase();
  const urls: Record<string, string> = {};

  for (const id of referencedAssets(notebook)) {
    const bytes = await storage.readAssetBytes(id);
    const meta = (await storage.listAssets())[id];
    if (!bytes || !meta) continue;

    const path = `${ownerId}/${id}`;
    const { error } = await supabase.storage
      .from(ASSET_BUCKET)
      .upload(path, new Blob([bytes as BlobPart], { type: meta.mime }), {
        contentType: meta.mime,
        upsert: true,
      });

    // An image that fails to upload should not block publishing the notebook;
    // it simply will not render for other people.
    if (!error) urls[id] = assetPublicUrl(path);
  }

  return urls;
}

const referencedAssets = (notebook: Notebook): string[] => {
  const ids = new Set<string>();
  for (const template of notebook.templates) {
    for (const block of template.blocks) {
      if (block.content.type === 'image' && block.content.assetId) ids.add(block.content.assetId);
    }
  }
  return [...ids];
};

/* -------------------------------------------------------------- cloning */

/**
 * Copies a community notebook into this browser under fresh ids.
 *
 * Images are pulled from the public bucket into IndexedDB so the copy is
 * self-contained: it exports to PDF offline, exactly like one built from
 * scratch, and stops working if the original is ever unpublished.
 */
export async function cloneToLocal(
  detail: Pick<CommunityDetail, 'doc' | 'asset_urls' | 'name'>
): Promise<Notebook> {
  const parsed = zNotebook.safeParse(detail.doc);
  if (!parsed.success) throw new Error('That notebook could not be read.');

  const source = parsed.data;
  const assetMap = await importAssets(detail.asset_urls ?? {});
  const now = new Date().toISOString();

  const clone: Notebook = {
    ...structuredClone(source),
    id: newId('nb'),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    templates: source.templates.map((template) => ({
      ...template,
      blocks: template.blocks.map((block) =>
        block.content.type === 'image' && assetMap.has(block.content.assetId)
          ? { ...block, content: { ...block.content, assetId: assetMap.get(block.content.assetId)! } }
          : block
      ),
    })),
  };

  return storage.writeNotebook(clone);
}

async function importAssets(urls: Record<string, string>): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();

  for (const [assetId, url] of Object.entries(urls)) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const blob = await response.blob();
      const file = new File([blob], `${assetId}.img`, { type: blob.type });
      const saved = await storage.saveAsset(file);
      mapping.set(assetId, saved.id);
    } catch {
      // A missing image degrades that one block, not the whole clone.
    }
  }

  return mapping;
}
