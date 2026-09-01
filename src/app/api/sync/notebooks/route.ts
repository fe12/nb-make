/**
 * Notebook sync.
 *
 * Writes go through this handler rather than straight to Supabase from the
 * browser for one reason: `navigator.sendBeacon` cannot set an Authorization
 * header, so the unload flush has to be a same-origin request that carries the
 * session cookie. Routing the *normal* push through here too means the closing
 * beacon and the debounced save share one code path instead of two that drift.
 *
 * Reads stay on the client (supabase-js + RLS), because they need no such
 * workaround and benefit from going direct.
 */
import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { zNotebook } from '@/lib/types/notebook';
import { pageSizeLabel } from '@/lib/sync/types';

/** A single push outcome, mirrored by the client's SyncOutcome. */
interface Outcome {
  id: string;
  status: 'ok' | 'stale' | 'error';
  revision?: number;
  /** Present on `stale`: the newer copy the server already had. */
  doc?: unknown;
  message?: string;
}

export async function POST(request: Request) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Sync is not configured.' }, { status: 501 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 });
  }

  const payload = body as {
    notebooks?: Array<{ doc?: unknown; revision?: number }>;
    deletes?: string[];
  };

  const outcomes: Outcome[] = [];

  for (const entry of payload.notebooks ?? []) {
    // Validate against the same schema the editor uses. A document that would
    // not load locally has no business being stored.
    const parsed = zNotebook.safeParse(entry.doc);
    if (!parsed.success) {
      outcomes.push({ id: idOf(entry.doc), status: 'error', message: 'Invalid notebook document.' });
      continue;
    }

    const doc = parsed.data;
    const revision = Number.isFinite(entry.revision) ? Number(entry.revision) : 1;

    const { data, error } = await supabase.rpc('push_notebook', {
      p_id: doc.id,
      p_doc: doc,
      p_revision: Math.max(1, Math.trunc(revision)),
      p_name: doc.name,
      p_description: doc.description,
      p_page_count: doc.stats?.pageCount ?? 0,
      p_template_count: doc.templates.length,
      p_page_size_label: pageSizeLabel(doc),
      p_created_at: doc.createdAt,
      p_updated_at: doc.updatedAt,
    });

    if (error) {
      outcomes.push({ id: doc.id, status: 'error', message: error.message });
      continue;
    }

    const result = data as { status: 'ok' | 'stale'; revision: number; doc?: unknown };
    outcomes.push({
      id: doc.id,
      status: result.status,
      revision: result.revision,
      doc: result.doc,
    });
  }

  // Tombstones rather than row deletes: a device that was offline when the
  // notebook was deleted would otherwise push it straight back on reconnect.
  for (const id of payload.deletes ?? []) {
    const { error } = await supabase
      .from('notebooks')
      .update({ deleted_at: new Date().toISOString(), is_published: false })
      .eq('id', id)
      .eq('owner_id', user.id);
    outcomes.push(
      error
        ? { id, status: 'error', message: error.message }
        : { id, status: 'ok' }
    );
  }

  return NextResponse.json({ outcomes });
}

/**
 * Everything the signed-in user has on the server, documents included, for the
 * merge that runs at sign-in.
 */
export async function GET() {
  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ notebooks: [] });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data, error } = await supabase
    .from('notebooks')
    .select('id, doc, revision, updated_at, is_published')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notebooks: data ?? [] });
}

const idOf = (doc: unknown): string => {
  const id = (doc as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : 'unknown';
};
