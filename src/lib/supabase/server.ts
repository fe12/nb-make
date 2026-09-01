import 'server-only';

/**
 * Server-side Supabase clients.
 *
 * A fresh client per request, never a module-level singleton: the session is
 * read from that request's cookies, so a shared instance would leak one user's
 * session into another user's render.
 */
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  bannedAt: string | null;
}

/**
 * Client bound to the incoming request's cookies. Returns null when Supabase
 * is not configured so callers can fall back to local-only behaviour.
 */
export async function getServerSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. Harmless: proxy.ts refreshes
          // the session on every request, so the write here is only ever a
          // duplicate of one that already happened.
        }
      },
    },
  });
}

/**
 * The signed-in user, with their profile role.
 *
 * Uses `getUser()`, not `getSession()`. getSession reads the cookie without
 * verifying it, so a forged cookie would pass; getUser validates the token with
 * the auth server. Anything that gates access must use this.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, role, banned_at')
    .eq('id', data.user.id)
    .single();

  return {
    id: data.user.id,
    email: data.user.email ?? '',
    displayName: profile?.display_name || (data.user.email ?? '').split('@')[0],
    // Default to the least privilege if the profile row has not appeared yet.
    role: profile?.role === 'admin' ? 'admin' : 'user',
    bannedAt: profile?.banned_at ?? null,
  };
}

export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user?.role === 'admin' && !user.bannedAt ? user : null;
}

/**
 * Service-role client. Bypasses every RLS policy, so it is used only where an
 * admin action genuinely cannot be expressed as a policy -- listing auth
 * accounts, deleting a user. Never import this from a Client Component; the
 * `server-only` import above turns that into a build error.
 */
export function getServiceSupabase(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
