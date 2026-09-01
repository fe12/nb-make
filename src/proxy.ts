/**
 * Session refresh and route guarding.
 *
 * Next 16 renamed Middleware to Proxy; the file must sit next to `app/`, so it
 * lives in `src/` and exports `proxy` rather than `middleware`.
 *
 * Two jobs:
 *
 * 1. Refresh the Supabase session. Access tokens are short-lived, and only a
 *    request that runs before rendering can write the rotated token back as a
 *    cookie. Skipping this is what causes the classic "randomly signed out
 *    after an hour" bug.
 * 2. Bounce signed-out visitors away from the account-only areas. This is a
 *    convenience redirect, not the security boundary -- the data itself is
 *    protected by row-level security in Postgres, so a forged cookie gets a
 *    nicer redirect but still no rows.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/config';

/** Areas that make no sense without an account. */
const PRIVATE_PREFIXES = ['/saved', '/settings', '/admin'];
const ADMIN_PREFIX = '/admin';

export async function proxy(request: NextRequest) {
  // Local-only deployment: nothing to refresh and nothing to guard.
  if (!isSupabaseConfigured()) return NextResponse.next();

  // Reassigned by setAll below. Every rotated cookie has to be attached to the
  // response that is actually returned, or the refresh is lost and the next
  // request starts the cycle again.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the token with the auth server and triggers the refresh. Must be
  // getUser, not getSession: getSession trusts the cookie without checking it.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const { pathname } = request.nextUrl;
  const isPrivate = PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isPrivate && !user) {
    const signin = request.nextUrl.clone();
    signin.pathname = '/signin';
    // So the user lands back where they were aiming after signing in.
    signin.searchParams.set('next', pathname);
    return withCookies(NextResponse.redirect(signin), response);
  }

  if (user && pathname.startsWith(ADMIN_PREFIX)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, banned_at')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || profile.banned_at) {
      const home = request.nextUrl.clone();
      home.pathname = '/';
      home.search = '';
      return withCookies(NextResponse.redirect(home), response);
    }
  }

  return response;
}

/**
 * Carries refreshed auth cookies onto a redirect. Building a new response
 * throws away whatever `setAll` wrote, which would drop a token rotation that
 * happened on this very request.
 */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the icon files. Without the negative
     * match this would run on every CSS and image request, adding an auth
     * round trip to each one.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon-|apple-icon|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};
