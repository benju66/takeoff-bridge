"use client";

import React, { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Find already active theme in document root
    const currentTheme = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    let initialTheme: "light" | "dark" = "light";
    if (currentTheme) {
      initialTheme = currentTheme;
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      initialTheme = prefersDark ? "dark" : "light";
    }

    const t = setTimeout(() => {
      setTheme(initialTheme);
      setMounted(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-12 h-12 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-grid-border text-slate-700 dark:text-slate-350 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:scale-105 active:scale-95 select-none"
      title={`Switch to ${theme === "light" ? "Dark" : "Light"} Mode`}
      id="theme-toggle-button"
    >
      {theme === "light" ? (
        <Moon size={20} className="text-slate-700 dark:text-slate-300" />
      ) : (
        <Sun size={20} className="text-amber-500" />
      )}
    </button>
  );
}
