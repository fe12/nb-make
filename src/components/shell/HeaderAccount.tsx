'use client';

/**
 * Account state in the header: sync status when signed in, a sign-in link when
 * not, and nothing at all when the deployment has no Supabase project.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, Spinner } from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { useSync } from '@/lib/client/sync-context';

export function HeaderAccount() {
  const { status, profile, user } = useAuth();
  const pathname = usePathname();

  // Local-only build: advertising accounts that cannot exist would be a lie.
  if (status === 'unconfigured') {
    return (
      <span className="hidden text-[11px] text-ink-400 sm:block">Local only</span>
    );
  }

  if (status === 'loading') return <Spinner className="text-ink-400" />;

  if (status === 'signed-out') {
    return (
      <div className="flex items-center gap-1.5">
        <Link href={`/signin?next=${encodeURIComponent(pathname)}`}>
          <Button size="sm" variant="ghost">
            Sign in
          </Button>
        </Link>
        <Link href="/signup">
          <Button size="sm" variant="primary">
            Sign up
          </Button>
        </Link>
      </div>
    );
  }

  const name = profile?.display_name || user?.email?.split('@')[0] || 'Account';

  return (
    <div className="flex items-center gap-2">
      <SyncBadge />
      <Link
        href="/settings"
        className="sketch-pill hidden items-center gap-1.5 border-[1.5px] border-ink-300 px-2.5 py-1 text-[11.5px] text-ink-700 hover:border-accent-500 hover:text-accent-700 sm:inline-flex"
        title={user?.email ?? undefined}
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-accent-500 text-[9px] font-bold text-accent-ink">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-[110px] truncate">{name}</span>
      </Link>
    </div>
  );
}

/** Reassurance that work is leaving the browser, and a nudge when it is not. */
function SyncBadge() {
  const { phase, pendingCount, error, syncNow } = useSync();

  if (phase === 'off') return null;

  if (phase === 'error') {
    return (
      <button
        type="button"
        onClick={() => void syncNow()}
        title={error ?? 'Sync failed'}
        className="sketch-pill border-[1.5px] border-danger-500 px-2 py-0.5 text-[10.5px] font-semibold text-danger-600"
      >
        Sync failed — retry
      </button>
    );
  }

  const label =
    phase === 'syncing'
      ? 'Syncing…'
      : phase === 'pending'
        ? `${pendingCount} to sync`
        : 'Synced';

  return (
    <span
      className="hidden items-center gap-1.5 text-[10.5px] text-ink-400 sm:inline-flex"
      title="Notebooks are saved in this browser first, then mirrored to your account."
    >
      {phase === 'syncing' && <Spinner className="h-3 w-3" />}
      {label}
    </span>
  );
}
