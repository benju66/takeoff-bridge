"use client";

/**
 * VersionsPanel — the Estimate Versioning workspace tab (?step=versions).
 *
 * The team always edits ONE live working copy; this panel freezes it into
 * named versions, designates exactly one version per project as the OFFICIAL
 * BID (Submit — the one and only doorway into cost history; the DB's
 * partial-unique index + atomic RPC make a second submitted version
 * impossible), withdraws a submission, and compares any two versions (or a
 * version against the live working copy) line by line.
 *
 * Financial guardrails: every dollar shown is a stored value or a B−A
 * subtraction (versionDiff.ts, pure). Saving a version copies the engine's
 * TakeoffSummary verbatim — nothing here computes an estimate number.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  Info,
  AlertTriangle,
  Send,
  Undo2,
  Save,
  ArrowRight,
} from "lucide-react";
import type { ProcessedTakeoffRow } from "@/types";
import type { EstimateVersionMeta } from "@/types/db";
import type { TakeoffSummary } from "@/lib/calculations";
import { useEstimateVersions } from "@/hooks/useEstimateVersions";
import { getEstimateVersionDetail } from "@/lib/db";
import { diffVersionLines, type VersionDiff, type VersionDiffEntry } from "@/lib/versionDiff";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedMoney = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Sentinel compare-picker value for the live working copy. */
const WORKING_COPY = "__working_copy__";

/** The engine summary's numeric fields, copied VERBATIM for the frozen
 *  version record (drops the non-numeric appliedOverrides audit map). */
function summaryNumbers(summary: TakeoffSummary): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

function versionLabel(v: EstimateVersionMeta): string {
  return `V${v.versionNumber}${v.title ? ` — ${v.title}` : ""}`;
}

const DELTA_COLOR = (n: number) =>
  n > 0 ? "text-red-600 dark:text-red-400" : n < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500";

const KIND_STYLES: Record<VersionDiffEntry["kind"], { row: string; badge: string; label: string }> = {
  added: {
    row: "bg-emerald-50/60 dark:bg-emerald-950/20",
    badge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    label: "Added",
  },
  removed: {
    row: "bg-red-50/60 dark:bg-red-950/20",
    badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    label: "Removed",
  },
  changed: {
    row: "bg-amber-50/50 dark:bg-amber-950/15",
    badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    label: "Changed",
  },
  unchanged: {
    row: "",
    badge: "bg-slate-100 dark:bg-slate-800 text-slate-500",
    label: "Same",
  },
};

export function VersionsPanel({
  projectId,
  rows,
  summary,
}: {
  projectId: string;
  /** The live working copy (FULL unfiltered row set). */
  rows: ProcessedTakeoffRow[];
  /** The engine's FULL unfiltered summary for the working copy. */
  summary: TakeoffSummary;
}) {
  const { versions, createVersion, submitVersion, withdrawVersion, saveAndSubmit, busy } =
    useEstimateVersions(projectId, true);

  const [title, setTitle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Compare pickers ("" = unselected; WORKING_COPY = the live rows).
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>(WORKING_COPY);
  const [compareRowsA, setCompareRowsA] = useState<ProcessedTakeoffRow[] | null>(null);
  const [compareRowsB, setCompareRowsB] = useState<ProcessedTakeoffRow[] | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const submitted = versions.find((v) => v.isSubmitted) ?? null;
  const workingTotal = summary.totalEstimatedCost;

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      setTitle("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const handleSaveVersion = () => {
    if (!title.trim()) {
      setActionError("Give the version a title (e.g. \"50% DD\", \"Addendum 2\").");
      return;
    }
    runAction(() => createVersion(title, rows, summaryNumbers(summary)));
  };

  const handleSaveAndSubmit = () => {
    if (!title.trim()) {
      setActionError("Give the version a title (e.g. \"50% DD\", \"Addendum 2\").");
      return;
    }
    const replaceNote = submitted
      ? `\n\nThis REPLACES ${versionLabel(submitted)} as the official bid — its prices leave cost history and this version's take their place.`
      : "";
    if (
      !window.confirm(
        `Save the current working copy as a new version AND submit it as this project's OFFICIAL BID?\n\nIts prices become historical cost observations.${replaceNote}`
      )
    ) {
      return;
    }
    runAction(() => saveAndSubmit(title, rows, summaryNumbers(summary)));
  };

  const handleSubmit = (v: EstimateVersionMeta) => {
    const replaceNote =
      submitted && submitted.id !== v.id
        ? `\n\nThis REPLACES ${versionLabel(submitted)} as the official bid — its prices leave cost history and ${versionLabel(v)}'s take their place.`
        : "";
    if (
      !window.confirm(
        `Submit ${versionLabel(v)} as this project's OFFICIAL BID?\n\nIts prices become historical cost observations.${replaceNote}`
      )
    ) {
      return;
    }
    runAction(() => submitVersion(v.id));
  };

  const handleWithdraw = () => {
    if (!submitted) return;
    if (
      !window.confirm(
        `Withdraw ${versionLabel(submitted)}?\n\nThe project will have NO official bid and its prices leave cost history until another version is submitted.`
      )
    ) {
      return;
    }
    runAction(() => withdrawVersion());
  };

  // Resolve one compare side: live rows for the working copy, a frozen
  // payload fetch for a saved version.
  useEffect(() => {
    let cancelled = false;

    const load = async (
      selection: string,
      set: (rows: ProcessedTakeoffRow[] | null) => void
    ) => {
      if (!selection) {
        set(null);
        return;
      }
      if (selection === WORKING_COPY) {
        set(rows);
        return;
      }
      const detail = await getEstimateVersionDetail(selection);
      if (cancelled) return;
      set(detail ? detail.lineItems : null);
    };

    Promise.all([
      load(compareA, (r) => { if (!cancelled) setCompareRowsA(r); }),
      load(compareB, (r) => { if (!cancelled) setCompareRowsB(r); }),
    ]).catch((err) => {
      if (cancelled) return;
      console.error("Failed to load versions for comparison:", err);
      setCompareError(err instanceof Error ? err.message : "Failed to load versions for comparison");
    });

    return () => { cancelled = true; };
  }, [compareA, compareB, rows]);

  const diff: VersionDiff | null = useMemo(
    () => (compareRowsA && compareRowsB ? diffVersionLines(compareRowsA, compareRowsB) : null),
    [compareRowsA, compareRowsB]
  );

  const visibleEntries = useMemo(
    () => (diff ? diff.entries.filter((e) => showUnchanged || e.kind !== "unchanged") : []),
    [diff, showUnchanged]
  );

  const pickerOptions = (
    <>
      <option value="">Select…</option>
      <option value={WORKING_COPY}>Current working copy</option>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {versionLabel(v)}{v.isSubmitted ? " (submitted)" : ""}
        </option>
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="bg-card border border-grid-border rounded-xl p-5">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2.5 mb-1.5">
          <GitBranch size={16} className="text-blue-600 dark:text-blue-400" /> Estimate Versions
        </h2>
        <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          The team works on one live copy. Save Version freezes it with a title and date; drafts and
          revisions stay invisible to pricing data. Submit is the one doorway into cost history — it marks
          a version as the official bid, and only one version per project can hold that record. Submitting
          a newer version automatically replaces the old observations; nothing ever double-counts.
        </p>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="bg-red-50 dark:bg-red-950/25 border border-red-200 dark:border-red-900/50 rounded-xl p-4 flex items-center gap-3 text-red-700 dark:text-red-400 text-xs font-mono">
          <AlertTriangle className="text-red-500" size={16} />
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="ml-auto bg-transparent hover:text-slate-900 dark:hover:text-white font-bold uppercase text-[10px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Working copy card */}
      <div className="bg-card border border-grid-border rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Current Working Copy
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              {rows.length.toLocaleString()} lines · Total estimated cost{" "}
              <span className="font-mono font-bold text-foreground">{money(workingTotal)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Version title (e.g. "50% DD")'
              className="bg-background border border-grid-border rounded-lg px-3 py-2 text-xs text-foreground w-56 focus:outline-none focus:border-blue-500"
              disabled={busy}
            />
            <button
              onClick={handleSaveVersion}
              disabled={busy}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-800 dark:text-slate-200 border border-grid-border text-[10px] px-3.5 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <Save size={12} /> Save Version
            </button>
            <button
              onClick={handleSaveAndSubmit}
              disabled={busy}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] px-3.5 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <Send size={12} /> Save &amp; Submit
            </button>
          </div>
        </div>
        {submitted ? (
          <p className="text-[11px] text-slate-500 border-t border-grid-border pt-3">
            Official bid: <span className="font-bold text-emerald-600 dark:text-emerald-400">{versionLabel(submitted)}</span>
            {" "}· submitted {formatDate(submitted.submittedAt)} · its prices are the project&apos;s cost-history observations.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500 border-t border-grid-border pt-3">
            No official bid yet — this project contributes nothing to cost history until a version is submitted.
          </p>
        )}
      </div>

      {/* Version list */}
      <div className="bg-card border border-grid-border rounded-xl overflow-hidden">
        {versions.length === 0 ? (
          <p className="text-xs text-slate-500 p-5">
            No saved versions yet. Save one before a milestone (an owner submission, an addendum, a rebid)
            so you can always come back and compare.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-background">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-bold">Version</th>
                <th className="px-4 py-2.5 font-bold">Title</th>
                <th className="px-4 py-2.5 font-bold">Saved</th>
                <th className="px-4 py-2.5 font-bold text-right">Total</th>
                <th className="px-4 py-2.5 font-bold text-center">Status</th>
                <th className="px-4 py-2.5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-grid-border">
                  <td className="px-4 py-2.5 font-mono font-bold text-foreground">V{v.versionNumber}</td>
                  <td className="px-4 py-2.5 text-foreground">{v.title || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(v.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-foreground">
                    {typeof v.summary.totalEstimatedCost === "number" ? money(v.summary.totalEstimatedCost) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {v.isSubmitted ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md">
                        Submitted
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">Draft</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {v.isSubmitted ? (
                      <button
                        onClick={handleWithdraw}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 disabled:opacity-50 cursor-pointer"
                      >
                        <Undo2 size={11} /> Withdraw
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSubmit(v)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50 cursor-pointer"
                      >
                        <Send size={11} /> Submit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Compare */}
      <div className="bg-card border border-grid-border rounded-xl p-5">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">Compare Versions</h3>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            value={compareA}
            onChange={(e) => { setCompareError(null); setCompareA(e.target.value); }}
            className="bg-background border border-grid-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500"
          >
            {pickerOptions}
          </select>
          <ArrowRight size={14} className="text-slate-400" />
          <select
            value={compareB}
            onChange={(e) => { setCompareError(null); setCompareB(e.target.value); }}
            className="bg-background border border-grid-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500"
          >
            {pickerOptions}
          </select>
          {diff && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={(e) => setShowUnchanged(e.target.checked)}
              />
              Show unchanged ({diff.counts.unchanged})
            </label>
          )}
        </div>

        {compareError && (
          <p className="text-xs text-red-600 dark:text-red-400 font-mono mb-3 flex items-center gap-2">
            <AlertTriangle size={13} /> {compareError}
          </p>
        )}

        {!diff ? (
          <p className="text-[11px] text-slate-500">
            Pick two versions (the working copy counts) to see exactly what changed — lines added or
            removed, quantity and price moves, and the total shifting line by line.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4 text-[11px] mb-3 font-mono">
              <span className="text-slate-500">A: <span className="text-foreground font-bold">{money(diff.totalA)}</span></span>
              <span className="text-slate-500">B: <span className="text-foreground font-bold">{money(diff.totalB)}</span></span>
              <span className={`font-bold ${DELTA_COLOR(diff.totalDelta)}`}>Δ {signedMoney(diff.totalDelta)}</span>
              <span className="text-slate-400 font-sans">
                {diff.counts.added} added · {diff.counts.removed} removed · {diff.counts.changed} changed
              </span>
            </div>

            {visibleEntries.length === 0 ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                No differences{showUnchanged ? "" : " (all matched lines are identical)"}.
              </p>
            ) : (
              <div className="border border-grid-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-background">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 font-bold">Change</th>
                      <th className="px-3 py-2 font-bold">Code</th>
                      <th className="px-3 py-2 font-bold">Description</th>
                      <th className="px-3 py-2 font-bold text-right">Qty A → B</th>
                      <th className="px-3 py-2 font-bold text-right">Price A → B</th>
                      <th className="px-3 py-2 font-bold text-right">Total A → B</th>
                      <th className="px-3 py-2 font-bold text-right">Δ Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => {
                      const row = entry.rowB ?? entry.rowA!;
                      const style = KIND_STYLES[entry.kind];
                      const num = (n: number | undefined) =>
                        n === undefined ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                      return (
                        <tr key={`${entry.kind}-${row.id}`} className={`border-t border-grid-border ${style.row}`}>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>
                              {style.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">{row.itemId || "—"}</td>
                          <td className="px-3 py-2 text-foreground">{row.description}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {num(entry.rowA?.matchedQty)} → {num(entry.rowB?.matchedQty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {entry.rowA ? money(entry.rowA.unitPrice) : "—"} → {entry.rowB ? money(entry.rowB.unitPrice) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {entry.rowA ? money(entry.rowA.total) : "—"} → {entry.rowB ? money(entry.rowB.total) : "—"}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${DELTA_COLOR(entry.totalDelta)}`}>
                            {signedMoney(entry.totalDelta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-grid-border bg-background">
                      <td colSpan={5} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Line totals
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground whitespace-nowrap">
                        {money(diff.totalA)} → {money(diff.totalB)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${DELTA_COLOR(diff.totalDelta)}`}>
                        {signedMoney(diff.totalDelta)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
