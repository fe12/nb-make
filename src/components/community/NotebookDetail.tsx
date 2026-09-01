'use client';

/**
 * One published notebook: a real preview of its pages, the rating and review
 * thread, and the actions — like, save, copy into your own library.
 *
 * The preview is compiled with the same pipeline the editor and exporter use,
 * so what is shown here is exactly what the PDF would contain rather than a
 * stored screenshot that could drift.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PagePreview } from '@/components/PagePreview';
import { Stars } from '@/components/community/Stars';
import {
  Button,
  Field,
  Modal,
  Notice,
  Panel,
  Spinner,
  TextArea,
} from '@/components/ui/controls';
import { registerRemoteAssets } from '@/lib/assets';
import { useAuth } from '@/lib/client/auth';
import {
  clearRating,
  cloneToLocal,
  getCommunityNotebook,
  rateNotebook,
  recordView,
  reportNotebook,
  setLiked,
  setSaved,
  type CommunityDetail,
} from '@/lib/client/community';
import { compileNotebook } from '@/lib/compile/notebook';

const PREVIEW_PAGES = 8;

export function NotebookDetail({ id }: { id: string }) {
  const router = useRouter();
  const { status, user } = useAuth();

  const [detail, setDetail] = useState<CommunityDetail | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [myRating, setMyRating] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('');

  useEffect(() => {
    let active = true;
    getCommunityNotebook(id)
      .then((found) => {
        if (!active) return;
        if (!found) {
          setDetail('missing');
          return;
        }
        // Lets the SVG preview resolve images that live in the author's
        // browser, via the copies uploaded when they published.
        registerRemoteAssets(found.asset_urls ?? {});
        setDetail(found);
        setMyRating(found.my_rating ?? 0);
        setReviewText(
          found.reviews.find((review) => review.user_id === user?.id)?.review ?? ''
        );
        recordView(id);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load it.');
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);

  const compiled = useMemo(() => {
    if (!detail || detail === 'missing') return null;
    try {
      return compileNotebook(detail.doc, { assets: {}, math: {}, limit: PREVIEW_PAGES });
    } catch {
      // A document from a newer version of the app might not compile here;
      // better to show the metadata than an error page.
      return null;
    }
  }, [detail]);

  if (error) {
    return (
      <div className="px-5 py-8">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-500">
        <Spinner /> Loading notebook…
      </div>
    );
  }

  if (detail === 'missing') {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-2xl text-ink-900">Not found</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          This notebook is not published, or has been taken down.
        </p>
        <Link href="/community" className="mt-5 inline-block">
          <Button variant="primary">Back to the community</Button>
        </Link>
      </div>
    );
  }

  const signedIn = status === 'signed-in';
  const isMine = detail.owner_id === user?.id;

  const guard = async (key: string, run: () => Promise<void>) => {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(`/community/${id}`)}`);
      return;
    }
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    const fresh = await getCommunityNotebook(id);
    if (fresh) setDetail(fresh);
  };

  const toggleLike = () =>
    guard('like', async () => {
      await setLiked(id, !detail.liked_by_me);
      await refresh();
    });

  const toggleSave = () =>
    guard('save', async () => {
      await setSaved(id, !detail.saved_by_me);
      await refresh();
      setNote(detail.saved_by_me ? 'Removed from Saved.' : 'Saved. Find it under Saved.');
    });

  const submitRating = () =>
    guard('rate', async () => {
      if (myRating < 1) {
        setError('Pick a star rating first.');
        return;
      }
      await rateNotebook(id, myRating, reviewText);
      await refresh();
      setNote('Thanks — your rating is in.');
    });

  const removeRating = () =>
    guard('rate', async () => {
      await clearRating(id);
      setMyRating(0);
      setReviewText('');
      await refresh();
    });

  const copyToLibrary = () =>
    guard('clone', async () => {
      const clone = await cloneToLocal(detail);
      router.push(`/notebooks/${clone.id}/design`);
    });

  const submitReport = () =>
    guard('report', async () => {
      await reportNotebook(id, reportReason);
      setReporting(false);
      setReportReason('');
      setNote('Reported. An admin will take a look.');
    });

  return (
    <div className="w-full px-5 py-6">
      <Link href="/community" className="text-[12px] text-ink-500 hover:text-accent-600">
        ← Community
      </Link>

      <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div>
            <h1 className="font-display text-[32px] leading-tight text-ink-900">
              {detail.name}
            </h1>
            <p className="mt-1 text-[12.5px] text-ink-500">
              by {detail.author?.display_name || 'someone'}
              {detail.published_at && ` · published ${formatDate(detail.published_at)}`}
            </p>
            {detail.description && (
              <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-600">
                {detail.description}
              </p>
            )}
          </div>

          {note && <Notice tone="info">{note}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}

          <Panel
            title="Preview"
            description={
              compiled
                ? `First ${Math.min(PREVIEW_PAGES, compiled.pages.length)} of ${detail.page_count} pages, drawn from the real document.`
                : undefined
            }
          >
            {compiled && compiled.pages.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {compiled.pages.map((page) => (
                  <li key={page.index}>
                    <PagePreview ops={page.ops} size={page.size} title={page.label} />
                    <p className="mt-1 truncate text-center text-[10.5px] text-ink-400">
                      {page.label}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="warn">
                This notebook could not be rendered here. You can still copy it to your
                library and open it in the editor.
              </Notice>
            )}
          </Panel>

          <Panel
            title="Ratings"
            description={
              detail.rating_count > 0
                ? `${Number(detail.rating_avg).toFixed(2)} average from ${detail.rating_count} rating${detail.rating_count === 1 ? '' : 's'}.`
                : 'No ratings yet.'
            }
          >
            {!isMine && (
              <div className="mb-4 space-y-2 border-b-2 border-dashed border-ink-200 pb-4">
                <Field label="Your rating">
                  <div className="flex items-center gap-3">
                    <Stars value={myRating} size={22} onChange={setMyRating} />
                    {detail.my_rating != null && (
                      <Button size="sm" variant="ghost" onClick={removeRating}>
                        Remove
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="Review" hint="Optional — what worked, what you would change.">
                  <TextArea
                    rows={3}
                    value={reviewText}
                    placeholder="Printed this at A6 and the margins held up nicely…"
                    onChange={(event) => setReviewText(event.target.value)}
                  />
                </Field>
                <Button variant="primary" disabled={busy === 'rate'} onClick={submitRating}>
                  {busy === 'rate' && <Spinner />}
                  {detail.my_rating != null ? 'Update rating' : 'Submit rating'}
                </Button>
              </div>
            )}

            {detail.reviews.length === 0 ? (
              <p className="text-[12.5px] text-ink-400">
                Nobody has reviewed this yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {detail.reviews.map((review) => (
                  <li key={review.user_id} className="sketch-box border-[1.5px] border-ink-200 p-3">
                    <div className="flex items-center gap-2">
                      <Stars value={review.rating} size={13} />
                      <span className="text-[12px] font-semibold text-ink-700">
                        {review.author?.display_name || 'Someone'}
                      </span>
                      <span className="ml-auto text-[10.5px] text-ink-400">
                        {formatDate(review.updated_at)}
                      </span>
                    </div>
                    {review.review && (
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-600">
                        {review.review}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-3">
          <Panel title="Get it">
            <Button
              variant="primary"
              className="w-full"
              disabled={busy === 'clone'}
              onClick={copyToLibrary}
            >
              {busy === 'clone' && <Spinner />} Copy to my notebooks
            </Button>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">
              Makes an independent copy in this browser, images included. Editing it does not
              affect the original, and it keeps working if the original is ever taken down.
            </p>

            <div className="mt-3 flex gap-2">
              <Button
                className="flex-1"
                variant={detail.liked_by_me ? 'primary' : 'secondary'}
                disabled={busy === 'like'}
                onClick={toggleLike}
              >
                {busy === 'like' ? <Spinner /> : detail.liked_by_me ? '♥' : '♡'}{' '}
                {detail.like_count}
              </Button>
              <Button
                className="flex-1"
                variant={detail.saved_by_me ? 'primary' : 'secondary'}
                disabled={busy === 'save'}
                onClick={toggleSave}
              >
                {busy === 'save' ? <Spinner /> : detail.saved_by_me ? '★' : '☆'}{' '}
                {detail.saved_by_me ? 'Saved' : 'Save'}
              </Button>
            </div>
          </Panel>

          <Panel title="Details">
            <dl className="space-y-2 text-[12px]">
              <Row label="Pages" value={String(detail.page_count)} />
              <Row label="Page size" value={detail.page_size_label} />
              <Row label="Designs" value={String(detail.template_count)} />
              <Row label="Views" value={String(detail.view_count)} />
              <Row label="Saves" value={String(detail.save_count)} />
              <Row label="Updated" value={formatDate(detail.updated_at)} />
            </dl>
          </Panel>

          {!isMine && signedIn && (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="w-full text-[11px] text-ink-400 hover:text-danger-600"
            >
              Report this notebook
            </button>
          )}
        </aside>
      </div>

      <Modal
        open={reporting}
        onClose={() => setReporting(false)}
        title="Report this notebook"
        description="An admin will review it. Tell them what the problem is."
        footer={
          <>
            <Button onClick={() => setReporting(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!reportReason.trim() || busy === 'report'}
              onClick={submitReport}
            >
              {busy === 'report' && <Spinner />} Send report
            </Button>
          </>
        }
      >
        <TextArea
          rows={4}
          value={reportReason}
          autoFocus
          placeholder="What is wrong with it?"
          onChange={(event) => setReportReason(event.target.value)}
        />
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-400">{label}</dt>
      <dd className="text-right font-semibold text-ink-700">{value}</dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}
