'use client';

/**
 * Platform metrics.
 *
 * Everything comes from one `admin_overview()` RPC rather than a dozen counts,
 * which keeps the page to a single round trip and means the numbers are all
 * from the same instant.
 */
import { useEffect, useState } from 'react';
import { Notice, Panel, Spinner } from '@/components/ui/controls';
import { getOverview, type AdminOverview as Overview } from '@/lib/client/admin';

export function AdminOverview() {
  const [stats, setStats] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then(setStats)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the metrics.')
      );
  }, []);

  if (error) {
    return (
      <div className="px-5 py-6">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-500">
        <Spinner /> Loading metrics…
      </div>
    );
  }

  return (
    <div className="w-full px-5 py-6">
      <h1 className="mb-1 font-display text-[32px] leading-none text-ink-900">Overview</h1>
      <p className="mb-5 text-[13px] text-ink-500">Everything on the platform, right now.</p>

      <div className="space-y-4">
        <Panel title="People">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Users" value={stats.users} />
            <Metric label="Admins" value={stats.admins} />
            <Metric label="New this week" value={stats.newUsers7d} />
            <Metric label="Banned" value={stats.banned} tone={stats.banned > 0 ? 'warn' : undefined} />
          </div>
        </Panel>

        <Panel title="Notebooks">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Total" value={stats.notebooks} />
            <Metric label="Published" value={stats.published} />
            <Metric label="Pages" value={stats.totalPages} />
            <Metric label="Avg rating" value={Number(stats.avgRating).toFixed(2)} />
          </div>
        </Panel>

        <Panel title="Engagement">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Likes" value={stats.likes} />
            <Metric label="Saves" value={stats.saves} />
            <Metric label="Ratings" value={stats.ratings} />
            <Metric
              label="Open reports"
              value={stats.openReports}
              tone={stats.openReports > 0 ? 'warn' : undefined}
            />
          </div>
        </Panel>

        <Panel title="Sign-ups" description="Last 30 days.">
          <SignupChart data={stats.signupsByDay} />
        </Panel>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'warn';
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={
          tone === 'warn'
            ? 'font-display text-[26px] leading-tight text-danger-600'
            : 'font-display text-[26px] leading-tight text-ink-900'
        }
      >
        {value}
      </div>
    </div>
  );
}

/**
 * A plain bar chart in divs.
 *
 * Thirty bars of one number each does not justify a charting dependency, and
 * the table underneath keeps it readable for anyone not looking at the bars.
 */
function SignupChart({ data }: { data: Array<{ day: string; count: number }> }) {
  if (data.length === 0) {
    return <p className="text-[12.5px] text-ink-400">No sign-ups in the last 30 days.</p>;
  }

  const max = Math.max(...data.map((point) => point.count), 1);
  const total = data.reduce((sum, point) => sum + point.count, 0);

  return (
    <figure>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={`${total} sign-ups over the last 30 days`}>
        {data.map((point) => (
          <div
            key={point.day}
            className="group relative flex-1 rounded-t bg-accent-500/80 transition-colors hover:bg-accent-600"
            style={{ height: `${Math.max(4, (point.count / max) * 100)}%` }}
            title={`${point.day}: ${point.count}`}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-[10.5px] text-ink-400">
        <span>{data[0]?.day}</span>
        <span>{total} total</span>
        <span>{data[data.length - 1]?.day}</span>
      </figcaption>
    </figure>
  );
}
