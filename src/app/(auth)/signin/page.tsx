import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { Panel, Spinner } from '@/components/ui/controls';

export const metadata = { title: 'Sign in — nb-make' };

export default function SignInPage() {
  return (
    <Panel
      title="Welcome back"
      description="Sign in to sync your notebooks and publish them to the community."
    >
      {/*
        AuthForm reads `?next=` with useSearchParams, which opts the route into
        client rendering; the boundary is what keeps the shell prerenderable.
      */}
      <Suspense fallback={<Spinner />}>
        <AuthForm mode="signin" />
      </Suspense>
    </Panel>
  );
}
