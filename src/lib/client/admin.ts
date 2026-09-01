'use client';

/**
 * Admin queries.
 *
 * These are ordinary client queries. They work because `is_admin()` widens the
 * row-level security policies for an admin, not because the UI decides to show
 * them — the same call from a normal account returns nothing, or an error from
 * the RPCs. There is no privileged key in the browser.
 */
import { requireSupabase } from '../supabase/client';
import type { CommunityNotebook } from '../sync/types';

export interface AdminOverview {
  users: number;
  admins: number;
  banned: number;
  newUsers7d: number;
  notebooks: number;
  published: number;
  likes: number;
  saves: number;
  ratings: number;
  openReports: number;
  avgRating: number;
  totalPages: number;
  signupsByDay: Array<{ day: string; count: number }>;
}

export async function getOverview(): Promise<AdminOverview> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('admin_overview');
  if (error) throw new Error(error.message);
  return data as AdminOverview;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  bio: string;
  role: 'user' | 'admin';
  banned_at: string | null;
  created_at: string;
  notebook_count?: number;
}

export async function listUsers(search = ''): Promise<AdminUser[]> {
  const supabase = requireSupabase();

  let request = supabase
    .from('profiles')
    .select('id, email, display_name, bio, role, banned_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (search.trim()) {
    const term = `%${search.trim()}%`;
    request = request.or(`email.ilike.${term},display_name.ilike.${term}`);
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const users = (data ?? []) as AdminUser[];

  // One grouped count would be nicer, but PostgREST has no group-by; for a
  // couple of hundred rows a single fetch of ids and a tally in memory beats
  // a query per user.
  const { data: owners } = await supabase
    .from('notebooks')
    .select('owner_id')
    .is('deleted_at', null);

  const tally = new Map<string, number>();
  for (const row of (owners ?? []) as Array<{ owner_id: string }>) {
    tally.set(row.owner_id, (tally.get(row.owner_id) ?? 0) + 1);
  }
  for (const user of users) user.notebook_count = tally.get(user.id) ?? 0;

  return users;
}

export async function setUserRole(id: string, role: 'user' | 'admin'): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  if (error) throw new Error(error.message);

  // The write can succeed while the guard trigger silently reverts it, so
  // confirm rather than trusting the absence of an error.
  const { data } = await supabase.from('profiles').select('role').eq('id', id).single();
  if (data?.role !== role) {
    throw new Error('The change did not take effect — you may no longer be an admin.');
  }
}

export async function setUserBanned(id: string, banned: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ banned_at: banned ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------- notebooks */

const ADMIN_LIST_COLUMNS =
  'id, owner_id, name, description, page_count, template_count, page_size_label, ' +
  'is_published, is_featured, published_at, like_count, save_count, view_count, ' +
  'rating_count, rating_avg, created_at, updated_at, deleted_at, ' +
  'author:public_profiles!notebooks_owner_id_fkey(id, display_name)';

export async function listAllNotebooks(
  filter: 'all' | 'published' | 'unpublished' = 'all',
  search = ''
): Promise<CommunityNotebook[]> {
  const supabase = requireSupabase();

  let request = supabase
    .from('notebooks')
    .select(ADMIN_LIST_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (filter === 'published') request = request.eq('is_published', true);
  if (filter === 'unpublished') request = request.eq('is_published', false);
  if (search.trim()) request = request.ilike('name', `%${search.trim()}%`);

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CommunityNotebook[];
}

export async function setFeatured(id: string, featured: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('notebooks').update({ is_featured: featured }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Takes a notebook out of the community without touching the author's copy. */
export async function unpublish(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('notebooks')
    .update({ is_published: false, is_featured: false })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/* --------------------------------------------------------------- reports */

export interface AdminReport {
  id: string;
  notebook_id: string;
  reason: string;
  status: 'open' | 'dismissed' | 'actioned';
  created_at: string;
  notebook: { name: string; is_published: boolean } | null;
  reporter: { display_name: string } | null;
}

export async function listReports(status: 'open' | 'all' = 'open'): Promise<AdminReport[]> {
  const supabase = requireSupabase();

  let request = supabase
    .from('notebook_reports')
    .select(
      'id, notebook_id, reason, status, created_at, ' +
        'notebook:notebooks!notebook_reports_notebook_id_fkey(name, is_published), ' +
        'reporter:public_profiles!notebook_reports_reporter_id_fkey(display_name)'
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (status === 'open') request = request.eq('status', 'open');

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AdminReport[];
}

export async function resolveReport(
  id: string,
  status: 'dismissed' | 'actioned'
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('notebook_reports').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}
