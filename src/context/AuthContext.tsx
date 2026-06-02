"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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
        setUser(session.user);
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
