'use client';

/**
 * Moderation for published work.
 *
 * The actions here are deliberately limited to *visibility* — feature and
 * unpublish. An admin can already read any document through RLS, but taking a
 * notebook out of the community is a very different thing from editing or
 * deleting somebody's work, and only the former belongs in a moderation tool.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Stars } from '@/components/community/Stars';
import {
  Button,
  Notice,
  Panel,
  Segmented,
  Spinner,
  TextInput,
} from '@/components/ui/controls';
import { listAllNotebooks, setFeatured, unpublish } from '@/lib/client/admin';
import type { CommunityNotebook } from '@/lib/sync/types';

type Filter = 'all' | 'published' | 'unpublished';

export function AdminNotebooks() {
  const [notebooks, setNotebooks] = useState<CommunityNotebook[] | null>(null);
  const [filter, setFilter] = useState<Filter>('published');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotebooks(await listAllNotebooks(filter, search));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notebooks.');
      setNotebooks([]);
    }
  }, [filter, search]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="w-full px-5 py-6">
      <h1 className="mb-1 font-display text-[32px] leading-none text-ink-900">Notebooks</h1>
      <p className="mb-4 text-[13px] text-ink-500">
        Every notebook on the platform, including unpublished ones.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
          options={[
            { value: 'published', label: 'Published' },
            { value: 'unpublished', label: 'Private' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="max-w-xs flex-1">
          <TextInput
            value={search}
            placeholder="Search names…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {notebooks === null ? (
        <div className="flex items-center gap-2 py-12 text-sm text-ink-500">
          <Spinner /> Loading…
        </div>
      ) : notebooks.length === 0 ? (
        <Panel>
          <p className="text-[13px] text-ink-500">Nothing matches.</p>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b-2 border-dashed border-ink-200 text-left text-[10.5px] uppercase tracking-wide text-ink-400">
                  <th className="px-3 py-2 font-semibold">Notebook</th>
                  <th className="px-3 py-2 font-semibold">Author</th>
                  <th className="px-3 py-2 font-semibold">Rating</th>
                  <th className="px-3 py-2 font-semibold">Engagement</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {notebooks.map((row) => (
                  <tr key={row.id} className="border-b border-dashed border-ink-100 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {row.is_published ? (
                          <Link
                            href={`/community/${row.id}`}
                            className="font-semibold text-ink-800 hover:text-accent-600"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink-800">{row.name}</span>
                        )}
                        {row.is_featured && (
                          <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-accent-700">
                            Featured
                          </span>
                        )}
                        {!row.is_published && (
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-ink-500">
                            Private
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400">
                        {row.page_count} pages · {row.page_size_label}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-600">
                      {row.author?.display_name || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Stars value={Number(row.rating_avg)} size={12} />
                        <span className="text-[11px] text-ink-400">({row.rating_count})</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-500">
                      {row.like_count} likes · {row.save_count} saves · {row.view_count} views
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {row.is_published && (
                          <>
                            <Button
                              size="sm"
                              variant={row.is_featured ? 'primary' : 'ghost'}
                              disabled={busyId === row.id}
                              onClick={() =>
                                void act(row.id, () => setFeatured(row.id, !row.is_featured))
                              }
                            >
                              {busyId === row.id ? <Spinner /> : row.is_featured ? 'Unfeature' : 'Feature'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === row.id}
                              onClick={() => void act(row.id, () => unpublish(row.id))}
                            >
                              Unpublish
                            </Button>
                          </>
                        )}
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
        Unpublishing removes a notebook from the community and from other people&rsquo;s Saved
        lists. The author keeps their copy and can publish it again.
      </p>
    </div>
  );
}
