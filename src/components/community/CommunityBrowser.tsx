'use client';

/**
 * Browse what other people have published.
 *
 * Readable signed out — the listing is public, so there is no wall in front of
 * the thing that makes the platform worth joining. Liking, saving and rating
 * prompt for an account at the point they are used.
 */
import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stars } from '@/components/community/Stars';
import {
  Button,
  EmptyState,
  Notice,
  Panel,
  Select,
  Spinner,
  TextInput,
} from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';
import { listCommunity } from '@/lib/client/community';
import { COMMUNITY_SORTS, type CommunityNotebook, type CommunitySort } from '@/lib/sync/types';

const PAGE_SIZE = 24;

export function CommunityBrowser() {
  const { status } = useAuth();
  const [notebooks, setNotebooks] = useState<CommunityNotebook[] | null>(null);
  const [sort, setSort] = useState<CommunitySort>('trending');
  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  // Guards against an older request landing after a newer one and overwriting
  // the results the user is actually looking at.
  const requestId = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const ticket = ++requestId.current;
      if (offset === 0) setNotebooks(null);
      else setLoadingMore(true);

      try {
        const rows = await listCommunity({
          sort,
          search,
          minRating: minRating || undefined,
          featuredOnly,
          limit: PAGE_SIZE,
          offset,
        });
        if (ticket !== requestId.current) return;

        setError(null);
        setExhausted(rows.length < PAGE_SIZE);
        setNotebooks((current) => (offset === 0 ? rows : [...(current ?? []), ...rows]));
      } catch (err) {
        if (ticket !== requestId.current) return;
        setError(err instanceof Error ? err.message : 'Could not load the community.');
        setNotebooks([]);
      } finally {
        if (ticket === requestId.current) setLoadingMore(false);
      }
    },
    [sort, search, minRating, featuredOnly]
  );

  // Debounced so typing in the search box does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(0), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  if (status === 'unconfigured') {
    return (
      <div className="px-5 py-8">
        <Notice tone="info">
          The community needs a Supabase project. Without one nb-make runs entirely locally —
          design, impose and export all still work.
        </Notice>
      </div>
    );
  }

  return (
    <div className="w-full px-5 py-6">
      <div className="mb-5">
        <h1 className="font-display text-[32px] leading-none text-ink-900">Community</h1>
        <p className="mt-2 text-[13px] text-ink-500">
          Notebooks other people have published. Save one for later, or copy it into your own
          library and change anything you like.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <TextInput
            value={search}
            placeholder="Search names and descriptions…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as CommunitySort)}
          className="w-auto"
          aria-label="Sort by"
        >
          {Object.entries(COMMUNITY_SORTS).map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          value={String(minRating)}
          onChange={(event) => setMinRating(Number(event.target.value))}
          className="w-auto"
          aria-label="Minimum rating"
        >
          <option value="0">Any rating</option>
          <option value="3">3★ and up</option>
          <option value="4">4★ and up</option>
          <option value="4.5">4.5★ and up</option>
        </Select>

        <Button
          variant={featuredOnly ? 'primary' : 'secondary'}
          onClick={() => setFeaturedOnly((value) => !value)}
        >
          Featured
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {notebooks === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
          <Spinner /> Loading community notebooks…
        </div>
      ) : notebooks.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          description={
            search || minRating || featuredOnly
              ? 'Try a broader search, or clear the filters.'
              : 'Nobody has published a notebook yet. Yours could be the first — open one from your library and press Publish.'
          }
          action={
            (search || minRating || featuredOnly) && (
              <Button
                onClick={() => {
                  setSearch('');
                  setMinRating(0);
                  setFeaturedOnly(false);
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {notebooks.map((notebook, index) => (
              <li key={notebook.id}>
                <CommunityCard notebook={notebook} tilt={index % 3} />
              </li>
            ))}
          </ul>

          {!exhausted && (
            <div className="mt-6 flex justify-center">
              <Button
                disabled={loadingMore}
                onClick={() => void load(notebooks.length)}
              >
                {loadingMore && <Spinner />} Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TILTS = ['-rotate-[0.4deg]', 'rotate-[0.3deg]', '-rotate-[0.15deg]'];

function CommunityCard({ notebook, tilt }: { notebook: CommunityNotebook; tilt: number }) {
  return (
    <div className={clsx('relative pt-2', TILTS[tilt])}>
      <span className="tape" aria-hidden />
      <Panel className="sketch-card-hover h-full">
        <div className="flex h-full flex-col">
          <Link href={`/community/${notebook.id}`} className="group">
            <h3 className="truncate font-display text-[21px] leading-tight text-ink-900 group-hover:text-accent-600">
              {notebook.name}
            </h3>
          </Link>

          <p className="mt-0.5 text-[11px] text-ink-400">
            by {notebook.author?.display_name || 'someone'}
            {notebook.is_featured && (
              <span className="ml-1.5 rounded bg-accent-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent-700">
                Featured
              </span>
            )}
          </p>

          {notebook.description && (
            <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-ink-500">
              {notebook.description}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <Stars value={Number(notebook.rating_avg)} size={13} />
            <span className="text-[11px] text-ink-400">
              {notebook.rating_count > 0
                ? `${Number(notebook.rating_avg).toFixed(1)} (${notebook.rating_count})`
                : 'unrated'}
            </span>
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-ink-500">
            <Stat label="Pages" value={String(notebook.page_count || '—')} />
            <Stat label="Size" value={notebook.page_size_label} />
            <Stat label="Likes" value={String(notebook.like_count)} />
            <Stat label="Saves" value={String(notebook.save_count)} />
          </dl>

          <div className="mt-auto pt-3">
            <Link href={`/community/${notebook.id}`}>
              <Button size="sm" className="w-full">
                View
              </Button>
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-semibold text-ink-700">{value}</dd>
    </div>
  );
}
