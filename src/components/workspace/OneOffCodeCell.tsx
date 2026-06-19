"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import type { EstimateSectionLine } from "@/types/db";

// ---------------------------------------------------------------------------
// OneOffCodeCell — the Code-cell affordance for a one-off line (Phase B5 / D1).
//
// DISPLAY + DISPATCH ONLY. An estimator-authored one-off (a `source: 'manual'` section
// line) does NOT count in the Procore export until it resolves to a valid `procore_cost_codes`
// entry. This cell renders:
//   - UNCODED → a "⚠ Assign code" button; CODED → the assigned code (click to re-assign).
// In BOTH cases the click dispatches `onRequestAssign(line, x, y)` to the STEP HOST, which
// owns the validated assign popover (OneOffAssignPopover).
//
// Why the input is NOT here: this cell lives inside the virtualized grid body, and the
// last/boundary row mounts+unmounts as the virtualizer re-measures — any state held INSIDE the
// cell (an open flag, a text buffer) is wiped by that churn (proven via mount/unmount probes).
// The codebase's rule (SKILL §2/§3): interactive cell state lives in the host/grid, never in a
// transient per-cell component. The host popover survives, exactly like the context menu.
// ---------------------------------------------------------------------------

interface OneOffCodeCellProps {
  line: EstimateSectionLine;
  /** Open the host-owned assign popover for this line, anchored near the click. */
  onRequestAssign: (line: EstimateSectionLine, x: number, y: number) => void;
}

export function OneOffCodeCell({ line, onRequestAssign }: OneOffCodeCellProps) {
  if (line.procoreCode) {
    return (
      <button
        type="button"
        data-testid="one-off-coded"
        onClick={(e) => { e.stopPropagation(); onRequestAssign(line, e.clientX, e.clientY); }}
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
      onClick={(e) => { e.stopPropagation(); onRequestAssign(line, e.clientX, e.clientY); }}
      title="This one-off line needs a valid Procore code before it can export"
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
    >
      <AlertTriangle size={12} /> Assign code
    </button>
  );
}
