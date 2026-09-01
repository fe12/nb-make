import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/supabase/server';

/**
 * Server-side admin gate.
 *
 * `proxy.ts` already redirects non-admins, but this checks again on render.
 * The proxy is a convenience layer that can be bypassed in some deployment
 * topologies, whereas this runs in the same request as the page itself. The
 * data behind it is protected a third time by row-level security, so all three
 * would have to fail for anything to leak.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin) redirect('/');
  return <>{children}</>;
}
