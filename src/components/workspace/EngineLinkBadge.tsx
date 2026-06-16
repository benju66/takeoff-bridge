import React from "react";

// ---------------------------------------------------------------------------
// EngineLinkBadge — Linked Values Bucket B Phase 5
//
// The per-cell entry point into the Trust Inspector "Links" tab for a calculation-engine
// value. A small 🔗 affordance on a GC (STEP 2) / Site-Ops (STEP 3) value that, when
// clicked, dispatches the existing `tb:inspect-binding` window event carrying the value's
// engine node id (`gc:*` / `siteops:*` / `division:*`). The page coordinator
// (projects/[projectId]/page.tsx) routes the request to STEP 4 and opens the inspector
// focused on that node; when STEP 4 is already mounted, EstimateTable's own listener
// handles it directly. Same decoupled-event pattern as the grid's 🔗 binding badge and the
// header's "toggle-sidebar".
//
// DISPLAY-ONLY: it never reads or writes estimate data and never touches the export path
// (LD-B4). Purely a focus dispatcher.
// ---------------------------------------------------------------------------

interface EngineLinkBadgeProps {
  /** The engine node id to focus the Links tab on (e.g. `gc:grandTotal`, `siteops:demolition`). */
  nodeId: string;
  /** Optional human label for the aria-label / title (defaults to the node id). */
  label?: string;
}

export function EngineLinkBadge({ nodeId, label }: EngineLinkBadgeProps) {
  return (
    <button
      type="button"
      data-testid="engine-inspect"
      data-node-id={nodeId}
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("tb:inspect-binding", { detail: { nodeId } })
        );
      }}
      title={`Inspect this value's links (what it reads, what feeds off it) — ${label ?? nodeId}`}
      aria-label={`Open the Links tab for ${label ?? nodeId}`}
      className="ml-2 shrink-0 text-[11px] text-blue-500 dark:text-blue-400 select-none hover:opacity-70 cursor-pointer align-middle"
    >
      🔗
    </button>
  );
}
