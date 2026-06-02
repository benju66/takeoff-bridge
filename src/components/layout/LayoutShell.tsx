"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

interface LayoutShellProps {
  children: React.ReactNode;
}

export default function LayoutShell({ children }: LayoutShellProps) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [mounted, setMounted] = useState(false);
  const [sidebarState, setSidebarState] = useState<"expanded" | "collapsed" | "hidden">("expanded");

  // Load from localStorage only after client-side mount to prevent Next.js SSR hydration mismatch
  useEffect(() => {
    Promise.resolve().then(() => {
      setMounted(true);
      const savedState = localStorage.getItem("takeoff-bridge-sidebar-state") as "expanded" | "collapsed" | "hidden";
      if (savedState) {
        setSidebarState(savedState);
      }
    });
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("takeoff-bridge-sidebar-state", sidebarState);
    if (sidebarState !== "hidden") {
      localStorage.setItem("takeoff-bridge-sidebar-last-visible-state", sidebarState);
    }
  }, [sidebarState, mounted]);

  // Listen to global toggle event
  useEffect(() => {
    const handleToggle = () => {
      setSidebarState((prev) => {
        if (prev === "hidden") {
          const lastVisible = (localStorage.getItem("takeoff-bridge-sidebar-last-visible-state") as "expanded" | "collapsed") || "expanded";
          return lastVisible;
        } else {
          localStorage.setItem("takeoff-bridge-sidebar-last-visible-state", prev);
          return "hidden";
        }
      });
    };
    window.addEventListener("toggle-sidebar", handleToggle);
    return () => window.removeEventListener("toggle-sidebar", handleToggle);
  }, []);

  if (isLoginPage) {
    return <>{children}</>;
  }

  // Determine skeleton width class to prevent visual layout shifts during client mount
  let skeletonClass = "w-64";
  if (mounted) {
    if (sidebarState === "collapsed") skeletonClass = "w-16";
    else if (sidebarState === "hidden") skeletonClass = "w-0 overflow-hidden";
  }

  return (
    <div className="flex h-screen bg-background text-foreground transition-colors duration-200 overflow-hidden font-sans">
      {mounted ? (
        <Sidebar sidebarState={sidebarState} setSidebarState={setSidebarState} />
      ) : (
        <div className={`h-screen bg-slate-950 border-r border-slate-900 shrink-0 transition-all duration-300 ${skeletonClass}`} />
      )}
      <main className="flex-1 min-w-0 overflow-y-auto relative h-screen bg-background flex flex-col p-8">
        {children}
      </main>
    </div>
  );
}
