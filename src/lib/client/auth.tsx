'use client';

/**
 * Who is signed in, for the client tree.
 *
 * `status` distinguishes three things the UI has to render differently:
 * `unconfigured` (no Supabase project — the app is local-only and should not
 * advertise accounts at all), `loading`, and a resolved signed-in/out state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../supabase/client';

export interface Profile {
  id: string;
  display_name: string;
  bio: string;
  role: 'user' | 'admin';
  banned_at: string | null;
  created_at: string;
}

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'signed-in';

interface AuthStore {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'display_name' | 'bio'>>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Context = createContext<AuthStore | null>(null);

export function useAuth(): AuthStore {
  const store = useContext(Context);
  if (!store) throw new Error('useAuth must be used inside <AuthProvider>');
  return store;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(
    async (id: string) => {
      if (!supabase) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, bio, role, banned_at, created_at')
        .eq('id', id)
        .single();
      setProfile((data as Profile) ?? null);
    },
    [supabase]
  );

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    // getUser validates the token with the auth server rather than trusting
    // whatever is in the cookie.
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setStatus(data.user ? 'signed-in' : 'signed-out');
      if (data.user) void loadProfile(data.user.id);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const next = session?.user ?? null;
      setUser(next);
      setStatus(next ? 'signed-in' : 'signed-out');
      if (next) void loadProfile(next.id);
      else setProfile(null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error('Accounts are not configured on this deployment.');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(friendly(error.message));
    },
    [supabase]
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (!supabase) throw new Error('Accounts are not configured on this deployment.');
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Read by the on_auth_user_created trigger to fill in the profile row.
        options: { data: { display_name: displayName } },
      });
      if (error) throw new Error(friendly(error.message));

      // With email confirmation switched on, sign-up returns a user but no
      // session; the caller needs to say "check your inbox" rather than
      // redirecting to a dashboard that will bounce them straight back.
      return { needsEmailConfirmation: !data.session };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setStatus('signed-out');
  }, [supabase]);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, 'display_name' | 'bio'>>) => {
      if (!supabase || !user) throw new Error('Not signed in.');
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error) throw new Error(error.message);
      await loadProfile(user.id);
    },
    [supabase, user, loadProfile]
  );

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const value = useMemo<AuthStore>(
    () => ({
      status,
      user,
      profile,
      isAdmin: profile?.role === 'admin' && !profile.banned_at,
      signIn,
      signUp,
      signOut,
      updateProfile,
      refreshProfile,
    }),
    [status, user, profile, signIn, signUp, signOut, updateProfile, refreshProfile]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Supabase error strings are accurate but terse; these are the common ones. */
function friendly(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'That email and password do not match an account.',
    'Email not confirmed': 'Check your inbox and confirm your email address first.',
    'User already registered': 'There is already an account with that email — sign in instead.',
  };
  return map[message] ?? message;
}
