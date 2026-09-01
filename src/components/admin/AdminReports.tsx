'use client';

/**
 * Flagged notebooks awaiting a decision.
 *
 * "Take down" both unpublishes the notebook and closes the report, because
 * doing one without the other is the failure mode that leaves a queue looking
 * handled while the content is still up.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Notice, Panel, Segmented, Spinner } from '@/components/ui/controls';
import { listReports, resolveReport, unpublish, type AdminReport } from '@/lib/client/admin';

export function AdminReports() {
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReports(await listReports(scope));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reports.');
      setReports([]);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    <div className="w-full max-w-3xl px-5 py-6">
      <h1 className="mb-1 font-display text-[32px] leading-none text-ink-900">Reports</h1>
      <p className="mb-4 text-[13px] text-ink-500">Notebooks other users have flagged.</p>

      <div className="mb-4">
        <Segmented
          value={scope}
          onChange={(value) => setScope(value as 'open' | 'all')}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {reports === null ? (
        <div className="flex items-center gap-2 py-12 text-sm text-ink-500">
          <Spinner /> Loading…
        </div>
      ) : reports.length === 0 ? (
        <Panel>
          <p className="text-[13px] text-ink-500">
            {scope === 'open' ? 'Nothing to review — the queue is empty.' : 'No reports yet.'}
          </p>
        </Panel>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.id}>
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/community/${report.notebook_id}`}
                      className="font-display text-[19px] text-ink-900 hover:text-accent-600"
                    >
                      {report.notebook?.name ?? 'Deleted notebook'}
                    </Link>
                    <p className="text-[11px] text-ink-400">
                      reported by {report.reporter?.display_name || 'someone'} ·{' '}
                      {new Date(report.created_at).toLocaleString()}
                      {report.notebook && !report.notebook.is_published && ' · already unpublished'}
                    </p>
                  </div>
                  <span
                    className={
                      report.status === 'open'
                        ? 'rounded bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger-600'
                        : 'rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-500'
                    }
                  >
                    {report.status}
                  </span>
                </div>

                <blockquote className="sketch-box mt-2.5 border-l-4 border-ink-200 bg-ink-50 p-2.5 text-[12.5px] leading-relaxed text-ink-700">
                  {report.reason}
                </blockquote>

                {report.status === 'open' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyId === report.id}
                      onClick={() =>
                        void act(report.id, async () => {
                          await unpublish(report.notebook_id);
                          await resolveReport(report.id, 'actioned');
                        })
                      }
                    >
                      {busyId === report.id && <Spinner />} Take down
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === report.id}
                      onClick={() => void act(report.id, () => resolveReport(report.id, 'dismissed'))}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
