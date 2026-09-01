'use client';

/**
 * The platform's left-hand navigation.
 *
 * Shown on the library, community, saved, settings and admin pages — but not
 * inside the notebook editor, which needs its full width for the page canvas
 * and already carries its own step navigation.
 *
 * Admin entries are rendered from the client's view of the profile, which is a
 * convenience only. Every admin route is also gated in `proxy.ts` and every
 * admin query is gated by row-level security, so a user who forged the flag
 * would see the links and then get nothing back.
 */
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { useSync } from '@/lib/client/sync-context';

interface Item {
  href: string;
  label: string;
  hint: string;
  icon: string;
  requiresAccount?: boolean;
}

const MAIN: Item[] = [
  { href: '/', label: 'My notebooks', hint: 'Everything in this browser', icon: '❏' },
  { href: '/community', label: 'Community', hint: 'Published by other people', icon: '❖' },
  { href: '/saved', label: 'Saved', hint: 'Your bookmarks', icon: '★', requiresAccount: true },
  { href: '/settings', label: 'Settings', hint: 'Account and data', icon: '⚙', requiresAccount: true },
];

const ADMIN: Item[] = [
  { href: '/admin', label: 'Overview', hint: 'Platform metrics', icon: '▤' },
  { href: '/admin/users', label: 'Users', hint: 'Roles and bans', icon: '☺' },
  { href: '/admin/notebooks', label: 'Notebooks', hint: 'Moderate published work', icon: '❏' },
  { href: '/admin/reports', label: 'Reports', hint: 'Flagged content', icon: '⚑' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, isAdmin, profile, user, signOut } = useAuth();
  const { phase, pendingCount, lastSyncedAt, syncNow } = useSync();
  const [signingOut, setSigningOut] = useState(false);

  const signedIn = status === 'signed-in';

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <nav className="flex h-full flex-col gap-4 p-3" aria-label="Main">
      <ul className="space-y-1">
        {MAIN.map((item) => (
          <li key={item.href}>
            <NavLink
              item={item}
              active={isActive(pathname, item.href)}
              // Signed-out users still see Saved and Settings; the link goes to
              // sign-in rather than vanishing, so the feature is discoverable.
              href={
                item.requiresAccount && !signedIn && status !== 'unconfigured'
                  ? `/signin?next=${encodeURIComponent(item.href)}`
                  : item.href
              }
              disabled={item.requiresAccount && status === 'unconfigured'}
            />
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div>
          <div className="mb-1.5 px-2 font-display text-[13px] tracking-wide text-ink-400">
            Admin
          </div>
          <ul className="space-y-1">
            {ADMIN.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(pathname, item.href)} href={item.href} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-2">
        {signedIn ? (
          <div className="sketch-box border-[1.5px] border-ink-200 p-2.5">
            <div className="truncate font-display text-[15px] text-ink-800">
              {profile?.display_name || 'Your account'}
            </div>
            <div className="truncate text-[10.5px] text-ink-400">{user?.email}</div>

            <button
              type="button"
              onClick={() => void syncNow()}
              className="mt-1.5 block w-full text-left text-[10.5px] text-ink-400 hover:text-accent-600"
              title="Push any unsynced notebooks now"
            >
              {phase === 'syncing' ? (
                <span className="inline-flex items-center gap-1">
                  <Spinner className="h-2.5 w-2.5" /> syncing…
                </span>
              ) : phase === 'pending' ? (
                `${pendingCount} notebook${pendingCount === 1 ? '' : 's'} to sync`
              ) : lastSyncedAt ? (
                `synced ${timeAgo(lastSyncedAt)}`
              ) : (
                'sync now'
              )}
            </button>

            <Button
              size="sm"
              variant="ghost"
              className="mt-2 w-full"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
            >
              {signingOut && <Spinner />} Log out
            </Button>
          </div>
        ) : status === 'unconfigured' ? (
          <p className="px-2 text-[10.5px] leading-relaxed text-ink-400">
            Running local-only. Notebooks live in this browser; add a Supabase project to
            enable accounts and the community.
          </p>
        ) : (
          <div className="sketch-box border-[1.5px] border-dashed border-ink-300 p-2.5">
            <p className="text-[11px] leading-relaxed text-ink-500">
              Your notebooks are saved in this browser. Sign in to back them up and publish
              them.
            </p>
            <Link href="/signin" className="mt-2 block">
              <Button size="sm" variant="primary" className="w-full">
                Sign in
              </Button>
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

function NavLink({
  item,
  active,
  href,
  disabled,
}: {
  item: Item;
  active: boolean;
  href: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="flex cursor-not-allowed items-center gap-2.5 rounded px-2 py-1.5 text-[13px] text-ink-300">
        <span aria-hidden className="w-4 text-center">
          {item.icon}
        </span>
        {item.label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'sketch-box group flex items-center gap-2.5 px-2 py-1.5 transition-colors',
        active
          ? 'border-[1.5px] border-accent-500 bg-accent-50 text-accent-700'
          : 'border-[1.5px] border-transparent text-ink-700 hover:border-ink-200 hover:bg-ink-50'
      )}
    >
      <span aria-hidden className="w-4 text-center text-[13px]">
        {item.icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-tight">{item.label}</span>
        <span className="block truncate text-[10px] leading-tight text-ink-400">{item.hint}</span>
      </span>
    </Link>
  );
}

/** `/` must match exactly, or it would light up on every page. */
const isActive = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/**
 * Small-screen replacement for the sidebar.
 *
 * The full panel is hidden below `md` because it would eat half the width, so
 * the same destinations appear as a scrollable strip under the header.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { status, isAdmin } = useAuth();
  const items = isAdmin ? [...MAIN, ADMIN[0]] : MAIN;

  return (
    <nav
      className="flex gap-1.5 overflow-x-auto border-b-2 border-dashed border-ink-200 px-4 py-2 md:hidden"
      aria-label="Main"
    >
      {items.map((item) => {
        const needsSignIn =
          item.requiresAccount && status !== 'signed-in' && status !== 'unconfigured';
        return (
          <Link
            key={item.href}
            href={needsSignIn ? `/signin?next=${encodeURIComponent(item.href)}` : item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={clsx(
              'sketch-pill shrink-0 border-[1.5px] px-3 py-1 text-[12px] transition-colors',
              isActive(pathname, item.href)
                ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700'
                : 'border-ink-200 text-ink-600'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
