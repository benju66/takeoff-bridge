"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { SectionCatalogEntry } from "@/lib/sectionLines/gcGridModel";

// ---------------------------------------------------------------------------
// AddLinePicker — the "+ Add line" affordance (Phase B4 / D2)
//
// Shared by GcPersonnelGridStep (Step 2) and SiteOpsGridStep (Step 3). Lists the
// catalog lines NOT currently present (the grid's `removedLines`), grouped by the same
// section dividers (01.A–01.F / 02.A–02.H), and re-adds one on click. Only catalog lines
// are re-addable — bespoke structured lines are removable but NOT user-mintable (ID-4),
// so the picker never offers a way to invent a new structured line. The dropdown dismisses
// on an outside mousedown via a container-ref check (NOT stopPropagation — SKILL §8 #7).
// ---------------------------------------------------------------------------

interface AddLinePickerProps {
  /** The catalog lines currently removed (catalog − present), display-ordered. */
  removedLines: readonly SectionCatalogEntry[];
  /** Re-add a removed line by code (drives the grid's `restoreLine`). */
  onAdd: (code: string) => void;
}

export function AddLinePicker({ removedLines, onAdd }: AddLinePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Group by section label, preserving the incoming display order.
  const groups: { label: string; items: SectionCatalogEntry[] }[] = [];
  for (const entry of removedLines) {
    let group = groups.find((g) => g.label === entry.groupLabel);
    if (!group) { group = { label: entry.groupLabel, items: [] }; groups.push(group); }
    group.items.push(entry);
  }

  const disabled = removedLines.length === 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/15 dark:hover:bg-emerald-950/35 text-emerald-700 dark:text-emerald-400 disabled:text-slate-400 disabled:cursor-not-allowed border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all text-xs cursor-pointer select-none"
        title={disabled ? "All catalog lines are present" : "Re-add a standard catalog line"}
      >
        <Plus size={14} /> Add line{removedLines.length > 0 ? ` (${removedLines.length})` : ""}
      </button>

      {open && !disabled && (
        <div className="absolute right-0 mt-1 z-50 bg-card border border-grid-border rounded-lg shadow-lg overflow-hidden animate-fade-in min-w-[320px] max-h-[420px] overflow-y-auto text-xs">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 px-3 py-1.5 bg-background/95 dark:bg-slate-900/95 text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 border-b border-grid-border">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => { onAdd(item.code); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer border-b border-grid-border/60"
                >
                  <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold shrink-0">{item.code}</span>
                  <span className="text-foreground truncate">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
