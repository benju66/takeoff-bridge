"use client";

import React, { useState, useEffect, useCallback, memo } from "react";
import { Search, X } from "lucide-react";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";

// ---------------------------------------------------------------------------
// SearchBar — Debounced global search input for the workbook grid
// ---------------------------------------------------------------------------

interface SearchBarProps {
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
}

function SearchBarInner({ globalFilter, setGlobalFilter }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(globalFilter);
  const [prevGlobalFilter, setPrevGlobalFilter] = useState(globalFilter);

  // Sync external → local (e.g. when cleared from outside) using derived state during render
  if (globalFilter !== prevGlobalFilter) {
    setPrevGlobalFilter(globalFilter);
    setLocalValue(globalFilter);
  }

  // Debounce local → external
  useEffect(() => {
    const timer = setTimeout(() => {
      setGlobalFilter(localValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localValue, setGlobalFilter]);

  const handleClear = useCallback(() => {
    setLocalValue("");
    setGlobalFilter("");
  }, [setGlobalFilter]);

  return (
    <div className="relative flex items-center">
      <Search
        size={14}
        className="absolute left-2.5 text-slate-400 dark:text-slate-500 pointer-events-none"
      />
      <input
        id="workbook-search-input"
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder="Search all columns..."
        className="w-48 h-8 pl-8 pr-8 text-xs font-mono bg-background border border-grid-border rounded-lg outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 text-foreground focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
          title="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export const SearchBar = memo(SearchBarInner);
