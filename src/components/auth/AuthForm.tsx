'use client';

/**
 * Sign in / sign up.
 *
 * One component for both, because the two differ only by a display-name field
 * and which method gets called — splitting them would duplicate the validation,
 * the error handling and the redirect.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Field, Notice, Spinner, TextInput } from '@/components/ui/controls';
import { useAuth } from '@/lib/client/auth';

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, signUp, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Only ever an in-app path: an absolute URL here would be an open redirect.
  const rawNext = params.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  if (status === 'unconfigured') {
    return (
      <Notice tone="warn">
        This deployment has no Supabase project configured, so there are no accounts. Your
        notebooks are saved in this browser and everything else still works.
      </Notice>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Use at least 8 characters for the password.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        router.push(next);
        // The sidebar and any server component need to re-read the session.
        router.refresh();
      } else {
        const result = await signUp(
          email.trim(),
          password,
          displayName.trim() || email.trim().split('@')[0]
        );
        if (result.needsEmailConfirmation) {
          setSent(true);
        } else {
          router.push(next);
          router.refresh();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3">
        <Notice tone="info">
          Account created. Check <strong>{email}</strong> for a confirmation link, then sign
          in.
        </Notice>
        <Link href="/signin">
          <Button variant="primary" className="w-full">
            Go to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}

      {mode === 'signup' && (
        <Field label="Display name" hint="Shown next to anything you publish.">
          <TextInput
            value={displayName}
            autoComplete="nickname"
            placeholder="Your name"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      )}

      <Field label="Email">
        <TextInput
          type="email"
          value={email}
          autoFocus
          required
          autoComplete="email"
          placeholder="you@example.com"
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <Field
        label="Password"
        hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
      >
        <TextInput
          type="password"
          value={password}
          required
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy && <Spinner />}
        {mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>

      <p className="text-center text-[12px] text-ink-500">
        {mode === 'signin' ? (
          <>
            No account yet?{' '}
            <Link href="/signup" className="font-semibold text-accent-600 hover:underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have one?{' '}
            <Link href="/signin" className="font-semibold text-accent-600 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
