"use client";

import React, { useState } from "react";
import { X, AlertTriangle, FileDown } from "lucide-react";
import { ExportBlocker } from "@/lib/exporter";
import { PROCORE_VALID_CODES } from "@/lib/procoreValidCodes";

// ---------------------------------------------------------------------------
// ExportOverrideModal — Interactive user-override interface for unmapped
// Procore dollars (AGENTS.md: No AI Autonomy Over Financials).
//
// Lists every row whose dollars cannot be placed on a granular Procore
// Budget Line Items code. The user assigns each one from the catalog's
// validated code set; nothing is ever auto-assigned. Export resumes only
// after every blocker is resolved.
// ---------------------------------------------------------------------------

interface ExportOverrideModalProps {
  blockers: ExportBlocker[];
  /** Map of rowId → assigned granular Procore code. Called only when complete. */
  onApply: (assignments: Record<string, string>) => void;
  onCancel: () => void;
}

export function ExportOverrideModal({ blockers, onApply, onCancel }: ExportOverrideModalProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // Full Procore valid-code list — same validation source as the /cost-codes
  // mapping editor; estimators may place dollars on ANY code Procore accepts.
  const codeOptions = PROCORE_VALID_CODES;

  const unresolvedCount = blockers.filter((b) => !(assignments[b.rowId] || "").trim()).length;
  const blockedTotal = blockers.reduce((sum, b) => sum + b.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-card border border-grid-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-grid-border">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-500" size={20} />
            <div>
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
                Unmapped Procore Dollars
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {blockers.length} line item{blockers.length === 1 ? "" : "s"} totaling{" "}
                <span className="font-mono font-bold">
                  ${blockedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>{" "}
                cannot be placed on a Procore Budget Line Items code. Assign a code to each before exporting.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cancel export"
          >
            <X size={18} />
          </button>
        </div>

        {/* Blocker rows */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {blockers.map((blocker) => (
            <div
              key={blocker.rowId}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-grid-border bg-background/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {blocker.itemId || "(no code)"}
                  </span>
                  <span className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400 ml-auto sm:ml-0">
                    ${blocker.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
                  {blocker.description || "(no description)"}
                </p>
              </div>
              <select
                value={assignments[blocker.rowId] || ""}
                onChange={(e) =>
                  setAssignments((prev) => ({ ...prev, [blocker.rowId]: e.target.value }))
                }
                className={`text-xs font-mono rounded-md border px-2 py-2 bg-card cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 sm:w-72 ${
                  (assignments[blocker.rowId] || "").trim()
                    ? "border-emerald-400 dark:border-emerald-700 text-slate-900 dark:text-white"
                    : "border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                }`}
              >
                <option value="">Select Procore code…</option>
                {codeOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.code} — {opt.description}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-grid-border">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {unresolvedCount > 0
              ? `${unresolvedCount} assignment${unresolvedCount === 1 ? "" : "s"} remaining`
              : "All rows assigned — one Ctrl+Z reverts the whole batch"}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="text-xs px-4 py-2.5 rounded-lg font-bold uppercase border border-grid-border text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(assignments)}
              disabled={unresolvedCount > 0}
              className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-lg font-bold uppercase bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <FileDown size={14} />
              Apply &amp; Retry Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
