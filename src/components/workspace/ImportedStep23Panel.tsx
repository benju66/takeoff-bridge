"use client";

/**
 * ImportedStep23Panel — the STEP 2 (GC) / STEP 3 (Site-Ops) view for IMPORTED
 * projects (architect-approved 2026-06-10).
 *
 * A finished bid's STEP 2/3 sheets are hand-authored, so the app's parametric
 * calculators cannot reproduce them — and rendering those calculators here
 * fabricates default-derived numbers (e.g. Safety = default rate × duration)
 * that were never in the bid. This panel replaces them with the truth: the
 * bid's own line detail, captured at import (`imported_step23_lines`), shown
 * READ-ONLY. The dollars themselves ride the linked STEP 4 rows ("re-driving"
 * imported GC/Site-Ops through the calculators is a deferred feature).
 *
 * Phase 3 Slice 3: each line's bare legacy code is resolved AT RENDER TIME to
 * the app's deterministic GC/Site-Ops code (step23Normalization, pure) and
 * shown alongside the as-bid code; a line with no certain match is marked
 * "unmapped" and stays exactly as bid. Labeling only — nothing is persisted
 * and no dollar moves.
 */

import React, { useState, useEffect } from "react";
import { FileSpreadsheet, Info, AlertTriangle } from "lucide-react";
import type { ImportedStep23Lines, ImportedSheetLine, CustomStep23LineDef } from "@/types/db";
import type { LinkedDivisionTotal } from "@/lib/calculations";
import { getDivisionCode } from "@/lib/division";
import { getCustomStep23LineDefs } from "@/lib/db";
import { resolveStep23Line } from "@/lib/step23Normalization";
import { RECONCILIATION_TOLERANCE } from "@/lib/exporter";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEP_META = {
  step2: { title: "General Conditions — Imported As-Bid", division: "01", linesKey: "step2Lines" as const },
  step3: { title: "Site Operations — Imported As-Bid", division: "02", linesKey: "step3Lines" as const },
};

export function ImportedStep23Panel({
  step,
  payload,
  linkedTotals,
}: {
  step: "step2" | "step3";
  /** `imported_step23_lines` from the estimate; undefined for imports saved before capture existed. */
  payload?: ImportedStep23Lines;
  /** The workspace's row-derived linked totals (the dollars that actually count). */
  linkedTotals: LinkedDivisionTotal[];
}) {
  const meta = STEP_META[step];
  // User-minted custom defs (gate Phase 2) overlay the built-ins at render
  // time — a code minted at any import review labels matching lines here
  // retroactively. FAIL-SOFT: an outage degrades to built-ins only.
  const [customDefs, setCustomDefs] = useState<CustomStep23LineDef[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCustomStep23LineDefs()
      .then((defs) => {
        if (!cancelled) setCustomDefs(defs);
      })
      .catch((err) => {
        console.error("Failed to load custom GC/Site-Ops codes (resolving with built-ins only):", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const lines: ImportedSheetLine[] = payload?.[meta.linesKey] ?? [];
  const lineSum = lines.reduce((s, l) => s + l.total, 0);
  const sectionLinkedTotal = linkedTotals
    .filter((l) => getDivisionCode(l.itemId) === meta.division)
    .reduce((s, l) => s + l.total, 0);
  // Hand-authored sheets do not always sum cleanly to their own section
  // subtotals — show the disagreement, never hide it.
  const delta = lineSum - sectionLinkedTotal;
  const sumsTie = Math.abs(delta) <= RECONCILIATION_TOLERANCE;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-grid-border rounded-xl p-5">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2.5 mb-1.5">
          <FileSpreadsheet size={16} className="text-blue-600 dark:text-blue-400" /> {meta.title}
        </h2>
        <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          This project was imported from a finished bid. Its {step === "step2" ? "General Conditions" : "Site Operations"} detail
          is shown exactly as bid and is read-only — these dollars are carried by the linked rows on the STEP 4 estimate,
          not recalculated. The app&apos;s {step === "step2" ? "staffing" : "site-ops"} calculator is intentionally not shown:
          it would display default-derived numbers that were never in this bid.
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/50 rounded-xl p-5">
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            Line detail wasn&apos;t captured when this bid was imported (it predates detail capture).
            The section total below is correct — re-import the bid to capture its full line detail.
          </p>
          <div className="mt-3 text-xs font-mono flex items-center justify-between border-t border-amber-200 dark:border-amber-900/50 pt-3">
            <span className="text-slate-600 dark:text-slate-400 font-sans font-bold uppercase text-[10px] tracking-wider">
              Imported section total
            </span>
            <span className="font-bold text-foreground">{money(sectionLinkedTotal)}</span>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-grid-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-background">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-bold">Code</th>
                <th className="px-4 py-2.5 font-bold">Description</th>
                <th className="px-4 py-2.5 font-bold text-right">Qty</th>
                <th className="px-4 py-2.5 font-bold text-center">UOM</th>
                <th className="px-4 py-2.5 font-bold text-right">Rate</th>
                <th className="px-4 py-2.5 font-bold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const resolved = resolveStep23Line(l.code, l.description, l.assignedCode, customDefs);
                const isAssigned = resolved !== null && resolved.code === l.assignedCode?.trim();
                return (
                <tr key={`${l.rowNumber}`} className="border-t border-grid-border">
                  <td className="px-4 py-2 font-mono text-slate-500">
                    {l.code}
                    {resolved ? (
                      <div
                        className="text-[10px] text-violet-700 dark:text-violet-300"
                        title={
                          isAssigned
                            ? `Assigned at import review to the app's GC/Site-Ops line "${resolved.label}"`
                            : `Maps to the app's GC/Site-Ops line "${resolved.label}"`
                        }
                      >
                        → {resolved.code}
                      </div>
                    ) : (
                      <div
                        className="text-[10px] italic text-amber-600 dark:text-amber-400"
                        title="No matching app GC/Site-Ops line — shown exactly as bid"
                      >
                        unmapped
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-foreground">{l.description}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{l.qty !== 0 ? l.qty.toLocaleString() : "—"}</td>
                  {/* uom is absent on payloads saved before Slice 0 — show "—" */}
                  <td className="px-4 py-2 text-center font-mono text-foreground">{l.uom || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{l.rate !== 0 ? money(l.rate) : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{money(l.total)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-grid-border bg-background">
                <td colSpan={5} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  As-bid line total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground">{money(lineSum)}</td>
              </tr>
              <tr className="border-t border-grid-border">
                <td colSpan={5} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Counted in the estimate (linked rows)
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground">{money(sectionLinkedTotal)}</td>
              </tr>
            </tfoot>
          </table>
          {!sumsTie && (
            <div className="px-4 py-3 border-t border-amber-300 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              The bid&apos;s own line detail differs from its section totals by {money(delta)} — preserved exactly as
              the original workbook had it. The estimate counts the section totals (the linked rows).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
