"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { EstimateSectionLine } from "@/types/db";
import { validateOneOffCode } from "@/lib/sectionLines/oneOff";

// ---------------------------------------------------------------------------
// OneOffCodeCell — the Code-cell assign-and-place affordance for a one-off line
// (Phase B5 / D1, the validated escape hatch).
//
// An estimator-authored one-off (a `source: 'manual'` section line) does NOT count in the
// Procore export until it resolves to a valid `procore_cost_codes` entry. This cell renders:
//   - UNCODED → a "⚠ Assign code" button → an inline validated free-entry input (Enter / ✓ to
//     commit, Esc / ✕ to cancel). On a valid code (`validateOneOffCode`, the Procore authority)
//     it calls `onAssign(procoreCode, costType)`; an invalid code shows the error and never
//     commits — mirrors the Step-4 assign-and-place gate (AGENTS.md: no AI autonomy over codes).
//   - CODED → the assigned Procore code (click to re-assign).
//
// Dismiss-on-outside-click uses a container-ref check, NOT stopPropagation (SKILL §8 #7). The
// input lives in this component's local state — it does NOT route through the grid's
// NumberCellInput edit path (that path is numeric only).
// ---------------------------------------------------------------------------

interface OneOffCodeCellProps {
  line: EstimateSectionLine;
  /** Assign the resolved Procore code + cost type (drives the grid's undoable assign command). */
  onAssign: (procoreCode: string, costType: string) => void;
}

export function OneOffCodeCell({ line, onAssign }: OneOffCodeCellProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(line.procoreCode || "");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dismiss on an OUTSIDE mousedown (ref check, §8 #7) or Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setText(line.procoreCode || "");
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, line.procoreCode]);

  const commit = () => {
    const result = validateOneOffCode(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAssign(result.procoreCode, result.costType);
    setOpen(false);
  };

  if (open) {
    return (
      <div ref={ref} className="flex flex-col gap-1 w-full" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            data-testid="one-off-code-input"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
            }}
            placeholder="Procore code"
            className="w-[110px] px-1.5 py-1 text-[11px] font-mono border border-blue-400 dark:border-blue-600 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="button" data-testid="one-off-code-confirm" onClick={commit} title="Assign code" className="text-emerald-600 hover:text-emerald-700 cursor-pointer">
            <Check size={14} />
          </button>
          <button type="button" onClick={() => setOpen(false)} title="Cancel" className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X size={14} />
          </button>
        </div>
        {error && <span className="text-[10px] text-red-600 dark:text-red-400 leading-tight">{error}</span>}
      </div>
    );
  }

  if (line.procoreCode) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="One-off line — click to re-assign its Procore code"
        className="inline-flex items-center gap-1 font-mono text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
      >
        {line.procoreCode}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="one-off-assign"
      onClick={() => setOpen(true)}
      title="This one-off line needs a valid Procore code before it can export"
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
    >
      <AlertTriangle size={12} /> Assign code
    </button>
  );
}
