import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { Panel, Spinner } from '@/components/ui/controls';

export const metadata = { title: 'Sign up — nb-make' };

export default function SignUpPage() {
  return (
    <Panel
      title="Create an account"
      description="Your existing notebooks stay where they are — signing up backs them up rather than replacing them."
    >
      <Suspense fallback={<Spinner />}>
        <AuthForm mode="signup" />
      </Suspense>
    </Panel>
  );
}
