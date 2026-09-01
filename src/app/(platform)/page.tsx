import { Dashboard } from '@/components/Dashboard';

export default function DashboardPage() {
  // Notebooks live in browser storage, so the listing is built on the client.
  return <Dashboard />;
}
