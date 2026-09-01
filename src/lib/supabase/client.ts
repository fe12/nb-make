'use client';

/**
 * The browser Supabase client.
 *
 * A singleton: `createBrowserClient` keeps one auth state machine and one
 * refresh timer per instance, and creating a second one causes duplicate token
 * refreshes that race each other for the same cookie.
 *
 * Returns null when the project is not configured, so callers must handle the
 * local-only case rather than assume an account exists.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/**
 * For code paths that only run once a session exists and would be unreadable
 * if every line had to re-check for null.
 */
export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error(
      'This needs a Supabase project. Add NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server.'
    );
  }
  return supabase;
}
