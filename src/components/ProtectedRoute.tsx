"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Layers } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  // Loading state (sleek and premium loading animation)
  if (loading || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground font-sans p-8">
        <div className="flex flex-col items-center gap-4">
          <Layers className="text-blue-600 dark:text-blue-400 animate-pulse" size={48} />
          <div className="w-48 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full w-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full animate-pulse"></div>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-2 animate-pulse">
            Authenticating Session Node...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
