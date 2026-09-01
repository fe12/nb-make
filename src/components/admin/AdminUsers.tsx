'use client';

/**
 * User list, with role and ban controls.
 *
 * Both actions are enforced by `guard_profile_privileges` in Postgres, not
 * here: a non-admin who reached this page would see the buttons and have every
 * change silently reverted. The confirmation prompts exist because demoting
 * yourself is easy to do by accident and awkward to undo.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Notice, Panel, Spinner, TextInput } from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { listUsers, setUserBanned, setUserRole, type AdminUser } from '@/lib/client/admin';

export function AdminUsers() {
  const { user: me, refreshProfile } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers(search));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.');
      setUsers([]);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [refresh, search]);

  const act = async (id: string, run: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await run();
      await refresh();
      // Demoting yourself changes what you are allowed to see; make the rest of
      // the UI catch up rather than leaving stale admin nav on screen.
      if (id === me?.id) await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  };

  const changeRole = (target: AdminUser) => {
    const next = target.role === 'admin' ? 'user' : 'admin';
    if (target.id === me?.id && next === 'user') {
      const ok = window.confirm(
        'Remove your own admin role? You will lose access to these pages immediately, and ' +
          'another admin will have to restore it.'
      );
      if (!ok) return;
    }
    void act(target.id, () => setUserRole(target.id, next));
  };

  return (
    <div className="w-full px-5 py-6">
      <h1 className="mb-1 font-display text-[32px] leading-none text-ink-900">Users</h1>
      <p className="mb-4 text-[13px] text-ink-500">
        {users ? `${users.length} account${users.length === 1 ? '' : 's'}` : 'Loading…'}
      </p>

      <div className="mb-4 max-w-sm">
        <TextInput
          value={search}
          placeholder="Search by email or name…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {users === null ? (
        <div className="flex items-center gap-2 py-12 text-sm text-ink-500">
          <Spinner /> Loading users…
        </div>
      ) : users.length === 0 ? (
        <Panel>
          <p className="text-[13px] text-ink-500">No accounts match.</p>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b-2 border-dashed border-ink-200 text-left text-[10.5px] uppercase tracking-wide text-ink-400">
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Notebooks</th>
                  <th className="px-3 py-2 font-semibold">Joined</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className="border-b border-dashed border-ink-100 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink-800">
                        {row.display_name || '—'}
                        {row.id === me?.id && (
                          <span className="ml-1.5 text-[10px] font-normal text-ink-400">(you)</span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400">{row.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.banned_at
                            ? 'rounded bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger-600'
                            : row.role === 'admin'
                              ? 'rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-700'
                              : 'text-ink-500'
                        }
                      >
                        {row.banned_at ? 'banned' : row.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-600">{row.notebook_count}</td>
                    <td className="px-3 py-2 text-ink-500">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === row.id}
                          onClick={() => changeRole(row)}
                        >
                          {busyId === row.id ? <Spinner /> : row.role === 'admin' ? 'Demote' : 'Make admin'}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.banned_at ? 'secondary' : 'ghost'}
                          disabled={busyId === row.id || row.id === me?.id}
                          title={row.id === me?.id ? 'You cannot ban yourself' : undefined}
                          onClick={() =>
                            void act(row.id, () => setUserBanned(row.id, !row.banned_at))
                          }
                        >
                          {row.banned_at ? 'Unban' : 'Ban'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-400">
        A ban blocks publishing, rating and syncing on the next request — the account keeps
        its notebooks and can still read. Deleting an account outright needs the Auth admin
        API, so do that from the Supabase dashboard.
      </p>
    </div>
  );
}
