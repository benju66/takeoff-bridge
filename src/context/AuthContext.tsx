"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { getSession, subscribeToAuthChanges, getUserProfile, signIn } from "@/lib/db";
import type { User } from "@supabase/supabase-js";

interface UserProfile {
  id: string;
  email: string;
  tenantId: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  tenantId: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  tenantId: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks the currently-authenticated user id so the auth-change handler can tell a
  // background token refresh (same user) from a genuine sign-in / user change. A refresh
  // must NOT re-gate the app — see the subscription handler below.
  const userIdRef = useRef<string | null>(null);
  // Live mirror of `profile` for the auth-change handler (created once, so it can't read
  // `profile` from state directly). Lets a same-user refresh RECOVER a profile that never
  // loaded (a transient failure at initial load) without re-gating.
  const profileRef = useRef<UserProfile | null>(null);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  useEffect(() => {
    let cancelled = false;

    // Load initial session
    const initAuth = async () => {
      try {
        let session = await getSession();
        if (cancelled) return;

        // Auto-login for local development
        const devEmail = process.env.NEXT_PUBLIC_DEV_EMAIL;
        const devPassword = process.env.NEXT_PUBLIC_DEV_PASSWORD;
        if (!session && devEmail && devPassword) {
          try {
            console.log("Developer Auto-Login triggered...");
            await signIn(devEmail, devPassword);
            session = await getSession();
          } catch (autoLoginErr) {
            console.error("Auto-login failed:", autoLoginErr);
          }
        }

        if (session?.user) {
          userIdRef.current = session.user.id;
          setUser(session.user);
          const prof = await getUserProfile(session.user.id);
          if (!cancelled && prof) {
            setProfile(prof);
          }
        }
      } catch (err) {
        console.error("Auth initialization failed:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen to changes
    const subscription = subscribeToAuthChanges(async (_event, session) => {
      if (cancelled) return;

      if (session?.user) {
        const isSameUser = userIdRef.current === session.user.id;
        userIdRef.current = session.user.id;
        // Always refresh the session-bearing user object (carries the new token).
        setUser(session.user);

        // BACKGROUND TOKEN REFRESH (same user, e.g. Supabase TOKEN_REFRESHED, which fires
        // ~hourly and on tab refocus): the profile/tenant can't have changed, so do NOT
        // re-gate. Re-gating here would flip `loading` true → ProtectedRoute unmounts the
        // whole app subtree and remounts after the profile re-fetch, flashing the
        // "Authenticating…" screen and dropping in-session unsaved state on every refresh.
        if (isSameUser) {
          // …but if the profile never loaded (a transient failure at initial load), recover
          // it quietly now — WITHOUT gating — so the session can self-heal off a later refresh
          // (preserving the pre-fix recovery behavior the unconditional re-fetch used to give).
          if (!profileRef.current) {
            try {
              const prof = await getUserProfile(session.user.id);
              if (!cancelled && prof) setProfile(prof);
            } catch (err) {
              console.error("Error recovering user profile on token refresh:", err);
            }
          }
          return;
        }

        // Genuine sign-in / user change: gate while the profile (tenantId) loads, preserving
        // the original behavior so consumers never render against a null tenant.
        setLoading(true);
        try {
          const prof = await getUserProfile(session.user.id);
          if (!cancelled) {
            setProfile(prof);
          }
        } catch (err) {
          console.error("Error loading user profile on auth change:", err);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      } else {
        userIdRef.current = null;
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    };
  }, []);

  const value = {
    user,
    profile,
    loading,
    tenantId: profile?.tenantId || null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
