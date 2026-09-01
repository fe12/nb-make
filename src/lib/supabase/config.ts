/**
 * Whether this deployment has a Supabase project behind it.
 *
 * nb-make works without one: notebooks live in the browser and the PDF is
 * generated there too. Accounts, sync and the community are additive, so every
 * entry point checks here first and degrades to local-only rather than
 * throwing. That also means a fresh clone runs before `.env.local` is filled in.
 *
 * These two values are safe in the browser bundle. The anon key grants exactly
 * what the row-level security policies allow and nothing more.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/**
 * Supabase renamed this key. New projects issue a *publishable* key
 * (`sb_publishable_…`); older ones issue an *anon* key (a JWT). They play the
 * same role -- the public, RLS-constrained credential -- so either is accepted
 * and whichever is present wins.
 *
 * These two values are inlined into the browser bundle. That is safe by
 * design: the key grants exactly what the row-level security policies allow.
 * The secret key is a different variable and never appears here.
 */
export const SUPABASE_ANON_KEY = firstFilled(
  // Referenced as full literals, not built up dynamically: Next inlines
  // `process.env.NEXT_PUBLIC_*` by textual substitution at build time, so a
  // computed key name would compile to undefined in the browser.
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Treats an empty variable as absent -- .env files usually leave the unused one blank. */
function firstFilled(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? '';
}

export const isSupabaseConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Public URL of an uploaded notebook image. */
export const assetPublicUrl = (path: string): string =>
  `${SUPABASE_URL}/storage/v1/object/public/notebook-assets/${path}`;

export const ASSET_BUCKET = 'notebook-assets';
