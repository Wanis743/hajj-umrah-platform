/* eslint-disable react-refresh/only-export-components -- provider module intentionally
   exports its context hook alongside the provider component. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  staffProfile: { role: string; branch_id: string | null; is_active: boolean } | null;
  isStaff: boolean;
  mfaRequired: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [staffProfile, setStaffProfile] = useState<AuthContextValue['staffProfile']>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  const loadProfile = async (currentSession: Session | null, mounted: boolean) => {
    if (!currentSession?.user) {
      if (mounted) {
        setStaffProfile(null);
        setMfaRequired(false);
      }
      return;
    }

    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('role, branch_id, is_active')
      .eq('user_id', currentSession.user.id)
      .maybeSingle();

    if (!mounted) return;
    setStaffProfile(
      profile
        ? {
            role: String(profile.role ?? ''),
            branch_id: (profile.branch_id as string | null) ?? null,
            is_active: Boolean(profile.is_active),
          }
        : null,
    );

    // V12 §14: ADMIN accounts must reach AAL2. mfaRequired drives the enrollment gate.
    if (profile?.role === 'ADMIN' && profile.is_active) {
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setMfaRequired(!aalError && aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2');
    } else {
      setMfaRequired(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session, mounted);
      if (mounted) setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      (async () => {
        setSession(nextSession);
        await loadProfile(nextSession, mounted);
        if (mounted) setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        staffProfile,
        isStaff: Boolean(staffProfile?.is_active),
        mfaRequired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
