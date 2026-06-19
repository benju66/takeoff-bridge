"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { EstimateSectionLine } from "@/types/db";
import { validateOneOffCode } from "@/lib/sectionLines/oneOff";

// ---------------------------------------------------------------------------
// OneOffAssignPopover — the validated Procore-code assign UI for a one-off line (B5 / D1).
//
// Rendered by the STEP HOST (GcPersonnelGridStep / SiteOpsGridStep), NOT inside the
// virtualized grid body — so its open + text state survives the virtualizer's mount/unmount
// churn of the boundary row (the assign-and-place equivalent of the host-owned context menu).
// A free-entry code is validated against the Procore authority (`validateOneOffCode`); on a
// valid code it calls `onAssign(line, procoreCode, costType)` (the grid's undoable assign).
// Dismiss = an outside mousedown (container-ref check, SKILL §8 #7) or Escape.
// ---------------------------------------------------------------------------

export interface OneOffAssignTarget {
  line: EstimateSectionLine;
  x: number;
  y: number;
}

interface OneOffAssignPopoverProps {
  target: OneOffAssignTarget | null;
  /** Assign the resolved code + cost type (drives the grid's undoable assignOneOffCode). */
  onAssign: (line: EstimateSectionLine, procoreCode: string, costType: string) => void;
  onClose: () => void;
}

export function OneOffAssignPopover({ target, onAssign, onClose }: OneOffAssignPopoverProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the input whenever a new target opens (prefill the existing code on re-assign).
  const lineId = target?.line.id ?? null;
  useEffect(() => {
    if (!target) return;
    setText(target.line.procoreCode || "");
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  useEffect(() => {
    if (!target) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [target, onClose]);

  if (!target) return null;

  const commit = () => {
    const result = validateOneOffCode(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAssign(target.line, result.procoreCode, result.costType);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-card border border-grid-border rounded-lg shadow-lg p-2.5 text-xs animate-fade-in min-w-[220px]"
      style={{ top: target.y, left: target.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1.5">
        Assign Procore code
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          data-testid="one-off-code-input"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
          placeholder="e.g. 2-29010.000"
          className="w-[130px] px-1.5 py-1 text-[11px] font-mono border border-blue-400 dark:border-blue-600 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="button" data-testid="one-off-code-confirm" onClick={commit} title="Assign code" className="text-emerald-600 hover:text-emerald-700 cursor-pointer">
          <Check size={15} />
        </button>
        <button type="button" onClick={onClose} title="Cancel" className="text-slate-400 hover:text-slate-600 cursor-pointer">
          <X size={15} />
        </button>
      </div>
      {error && <div className="text-[10px] text-red-600 dark:text-red-400 mt-1 leading-tight max-w-[200px]">{error}</div>}
    </div>
  );
}
