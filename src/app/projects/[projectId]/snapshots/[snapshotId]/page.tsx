"use client";

import React, { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Lock, Layers, ScrollText,
  ChevronRight, ChevronDown, Sparkles, XCircle, RotateCcw, Info,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  getProject, getBudgetSnapshotDetail, getEstimateLineItems,
  getEstimateVersions, getEstimateVersionDetail, getCostCodeMap, getCatalogAdditions,
  getBudgetSnapshotAllocations, saveBudgetSnapshotAllocation, deleteBudgetSnapshotAllocation,
} from "@/lib/db";
import {
  primeCostCodeResolver, primeCostCodeResolverFromCatalog, resolveProcoreCode,
} from "@/lib/costCodeResolver";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import {
  buildReconciliationModel, buildVerifyAllocation, buildLineAllocation, buildDeclineAllocation,
  ALLOCATION_KIND,
  type CodeReconciliation, type EstimateLineLike, type ReconciliationStatus,
  type AllocationWriteInput,
} from "@/lib/actuals";
import type { Project, BudgetSnapshotDetail } from "@/types/db";
import type { ProcessedTakeoffRow } from "@/types";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseMoney = (s: string): number => {
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? 0 : n;
};

/** Prefer the project's submitted estimate version; fall back to current saved lines. */
async function loadEstimateLines(
  projectId: string,
): Promise<{ lines: ProcessedTakeoffRow[]; source: "submitted" | "live" }> {
  try {
    const versions = await getEstimateVersions(projectId);
    const submitted = versions.find((v) => v.isSubmitted);
    if (submitted) {
      const detail = await getEstimateVersionDetail(submitted.id);
      if (detail && detail.lineItems.length > 0) {
        return { lines: detail.lineItems, source: "submitted" };
      }
    }
  } catch {
    // fall through to the live line items
  }
  return { lines: await getEstimateLineItems(projectId), source: "live" };
}

function ReconcileInner({ projectId, snapshotId }: { projectId: string; snapshotId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [detail, setDetail] = useState<BudgetSnapshotDetail | null>(null);
  const [estimateLines, setEstimateLines] = useState<EstimateLineLike[]>([]);
  const [estimateSource, setEstimateSource] = useState<"submitted" | "live">("live");

  // The mutable overlay (refetched after every write) — the only thing that
  // changes the reconciled view between renders. The frozen snapshot is never touched.
  const [allocations, setAllocations] = useState<BudgetSnapshotDetail["allocations"]>([]);

  const [showAllRollups, setShowAllRollups] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [splitInputs, setSplitInputs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const isFinal = detail?.isFinal ?? false;
  const locked = isFinal || busy !== null;

  // ----- load --------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [proj, det] = await Promise.all([
          getProject(projectId),
          getBudgetSnapshotDetail(snapshotId),
        ]);
        if (cancelled) return;
        if (!det) {
          setError("Snapshot not found.");
          setLoading(false);
          return;
        }
        setProject(proj);
        setDetail(det);
        setAllocations(det.allocations);

        // Prime the cost-code resolver exactly as the workbook does, so each
        // estimate line resolves to its granular Procore code from the live map.
        try {
          const [map, additions] = await Promise.all([
            getCostCodeMap(MASTER_TEMPLATE_NAME),
            getCatalogAdditions().catch(() => []),
          ]);
          primeCatalogAdditionOverlays(additions);
          if (map.length > 0) primeCostCodeResolver(map);
          else primeCostCodeResolverFromCatalog();
        } catch {
          primeCostCodeResolverFromCatalog();
        }

        const { lines, source } = await loadEstimateLines(projectId);
        if (cancelled) return;
        setEstimateSource(source);
        setEstimateLines(
          lines.map((r) => ({
            id: r.id,
            // resolveProcoreCode (fresh) wins; the persisted code is the fallback.
            procoreCode: resolveProcoreCode(r.itemId) || r.procoreCode || "",
            description: r.description,
            costType: r.costType,
            total: r.total,
          })),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the snapshot.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, snapshotId]);

  // ----- model (recompute from frozen actuals + overlay) -------------------
  const model = useMemo(() => {
    if (!detail) return null;
    return buildReconciliationModel({
      actuals: detail.actuals,
      estimateLines,
      allocations,
    });
  }, [detail, estimateLines, allocations]);

  // ----- overlay writes (replace-the-code's-overlay semantics) -------------
  const refreshAllocations = useCallback(async () => {
    const fresh = await getBudgetSnapshotAllocations(snapshotId);
    setAllocations(fresh);
  }, [snapshotId]);

  const replaceCodeOverlay = useCallback(
    async (costCode: string, writes: AllocationWriteInput[]) => {
      setBusy(costCode);
      setWriteError(null);
      try {
        const existing = allocations.filter((a) => a.budgetCode === costCode);
        for (const e of existing) await deleteBudgetSnapshotAllocation(e.id);
        for (const w of writes) await saveBudgetSnapshotAllocation(w);
        await refreshAllocations();
      } catch (err) {
        setWriteError(err instanceof Error ? err.message : "Failed to save your change.");
      } finally {
        setBusy(null);
      }
    },
    [allocations, refreshAllocations],
  );

  const verifyCode = useCallback(
    (code: CodeReconciliation) => replaceCodeOverlay(code.costCode, [buildVerifyAllocation(snapshotId, code)]),
    [replaceCodeOverlay, snapshotId],
  );

  const declineCode = useCallback(
    (code: CodeReconciliation) => replaceCodeOverlay(code.costCode, [buildDeclineAllocation(snapshotId, code)]),
    [replaceCodeOverlay, snapshotId],
  );

  const clearCode = useCallback(
    (code: CodeReconciliation) => replaceCodeOverlay(code.costCode, []),
    [replaceCodeOverlay],
  );

  const verifyAllOneToOne = useCallback(async () => {
    if (!model) return;
    setBusy("verify-all");
    setWriteError(null);
    try {
      const targets = model.codes.filter((c) => c.bucket === "oneToOne" && c.status === "pending");
      for (const c of targets) {
        const existing = allocations.filter((a) => a.budgetCode === c.costCode);
        for (const e of existing) await deleteBudgetSnapshotAllocation(e.id);
        await saveBudgetSnapshotAllocation(buildVerifyAllocation(snapshotId, c));
      }
      await refreshAllocations();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : "Failed to verify the 1:1 matches.");
    } finally {
      setBusy(null);
    }
  }, [model, allocations, snapshotId, refreshAllocations]);

  const saveSplit = useCallback(
    (code: CodeReconciliation) => {
      const inputs = splitInputs[code.costCode] ?? {};
      const writes: AllocationWriteInput[] = code.estimateLines
        .map((l) => ({ lineId: l.id, amount: parseMoney(inputs[l.id] ?? "") }))
        .filter((x) => x.amount !== 0)
        .map((x) => buildLineAllocation(snapshotId, code, x.lineId, x.amount));
      return replaceCodeOverlay(code.costCode, writes);
    },
    [splitInputs, replaceCodeOverlay, snapshotId],
  );

  // ----- expand / input plumbing -------------------------------------------
  const toggleExpand = useCallback((code: CodeReconciliation) => {
    const willExpand = !expanded.has(code.costCode);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code.costCode)) next.delete(code.costCode);
      else next.add(code.costCode);
      return next;
    });
    // On first open, seed the split inputs from any existing per-line allocations.
    if (willExpand) {
      setSplitInputs((si) => {
        if (si[code.costCode]) return si;
        const seed: Record<string, string> = {};
        for (const a of code.allocations) {
          if (a.kind === ALLOCATION_KIND.ALLOCATION && a.estimateLineItemId) {
            seed[a.estimateLineItemId] = String(a.allocatedNormalized);
          }
        }
        return { ...si, [code.costCode]: seed };
      });
    }
  }, [expanded]);

  const setSplitInput = useCallback((costCode: string, lineId: string, value: string) => {
    setSplitInputs((si) => ({ ...si, [costCode]: { ...(si[costCode] ?? {}), [lineId]: value } }));
  }, []);

  // ----- guards ------------------------------------------------------------
  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center gap-2 text-xs text-slate-500 p-8">
          <Loader2 className="animate-spin" size={16} /> Loading reconciliation…
        </div>
      </ProtectedRoute>
    );
  }
  if (error || !detail || !model) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col gap-4 max-w-2xl p-2">
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-4 flex items-start gap-2.5 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{error ?? "Could not build the reconciliation."}</p>
          </div>
          <Link href={`/projects/${projectId}/snapshots`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to snapshots
          </Link>
        </div>
      </ProtectedRoute>
    );
  }

  const c = model.counts;
  const oneToOne = model.codes.filter((x) => x.bucket === "oneToOne");
  const pendingOneToOne = oneToOne.filter((x) => x.status === "pending").length;
  const rollups = model.codes.filter((x) => x.bucket === "rollup");
  const visibleRollups = showAllRollups
    ? rollups
    : rollups.filter((x) => x.isTargeted || x.status !== "pending");
  const unbacked = model.codes.filter((x) => x.bucket === "unbacked" && x.hasActual);
  const estimateOnly = model.codes.filter((x) => x.bucket === "estimateOnly");

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-5xl">
        {/* Header */}
        <header className="border-b border-grid-border pb-6">
          <Link href={`/projects/${projectId}/snapshots`} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 mb-3 transition-colors">
            <ArrowLeft size={14} /> Back to snapshots
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <ScrollText className="text-blue-600 dark:text-blue-400" size={24} />
              Reconcile Snapshot #{detail.snapshotNumber}
            </h1>
            {isFinal && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-900/50 rounded-md px-2 py-0.5">
                <Lock size={10} /> Final — frozen
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            {project?.name}{detail.label ? ` · ${detail.label}` : ""}. Match each Procore code to the
            estimate: confirm the 1:1 codes, split or decline the rolled-up ones. Your work is saved to a
            separate overlay — the captured snapshot is never altered.{" "}
            <span className="text-slate-500">Estimate side: {estimateSource === "submitted" ? "submitted bid version" : "current saved estimate"}.</span>
          </p>
        </header>

        {isFinal && (
          <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-300 dark:border-emerald-900/50 rounded-lg p-3 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <Lock size={14} className="mt-0.5 flex-shrink-0" />
            This snapshot is FINAL — the reconciliation overlay is frozen and read-only.
          </div>
        )}

        {writeError && (
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-3 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {writeError}
          </div>
        )}

        {/* Summary */}
        <div className="bg-card border border-grid-border rounded-xl p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-2">
            <Layers size={13} className="text-indigo-500" /> Reconciliation summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <Stat label="1:1 codes" value={`${c.oneToOne}`} />
            <Stat label="Rollups" value={`${c.rollup}`} sub={`${c.targetedRollup} targeted`} />
            <Stat label="Code-only (no estimate)" value={`${c.unbacked}`} />
            <Stat label="Estimate-only (no actual)" value={`${c.estimateOnly}`} />
            <Stat label="Verified" value={`${c.verified}`} tone="emerald" />
            <Stat label="Allocated" value={`${c.allocated}`} tone="blue" />
            <Stat label="Declined" value={`${c.declined}`} tone="slate" />
            <Stat label="Pending" value={`${c.pending}`} tone={c.pending > 0 ? "amber" : "slate"} />
          </div>
          {model.unmappedEstimateLineCount > 0 && (
            <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5">
              <Info size={12} className="text-blue-500" />
              {model.unmappedEstimateLineCount} estimate line(s) resolve to no Procore code — excluded from reconciliation.
            </p>
          )}
        </div>

        {/* 1:1 codes */}
        {oneToOne.length > 0 && (
          <section className="bg-card border border-grid-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <CheckCircle2 size={13} className="text-emerald-500" /> 1:1 matches
                <span className="font-normal normal-case text-slate-500">{oneToOne.length} codes · auto-matched, you verify</span>
              </h3>
              {pendingOneToOne > 0 && (
                <button
                  onClick={verifyAllOneToOne}
                  disabled={locked}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {busy === "verify-all" ? <Loader2 className="animate-spin" size={12} /> : <CheckCircle2 size={12} />}
                  Verify all ({pendingOneToOne})
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto border border-grid-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-bold">Code</th>
                    <th className="px-3 py-2 font-bold">Estimate line</th>
                    <th className="px-3 py-2 font-bold text-right">Estimate</th>
                    <th className="px-3 py-2 font-bold text-right">Actual (norm.)</th>
                    <th className="px-3 py-2 font-bold text-right">Variance</th>
                    <th className="px-3 py-2 font-bold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {oneToOne.map((code) => (
                    <tr key={code.costCode} className="border-t border-grid-border">
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap text-foreground">
                        {code.costCode}
                        {code.isBurden && <span className="ml-1.5 text-[9px] uppercase text-amber-600 dark:text-amber-400 font-bold">burden</span>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400 max-w-[16rem] truncate" title={code.estimateLines[0]?.description}>
                        {code.estimateLines[0]?.description ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{money(code.estimateTotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-foreground">{money(code.normalizedActual)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${varianceTone(code.variance)}`}>{money(code.variance)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {code.status === "verified" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                            <CheckCircle2 size={12} /> Verified
                            {!isFinal && (
                              <button onClick={() => clearCode(code)} disabled={locked} title="Undo verify" className="ml-1 text-slate-400 hover:text-rose-500 disabled:opacity-40">
                                <RotateCcw size={11} />
                              </button>
                            )}
                          </span>
                        ) : (
                          <button
                            onClick={() => verifyCode(code)}
                            disabled={locked}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase rounded border border-emerald-300 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-40 transition-colors"
                          >
                            {busy === code.costCode ? <Loader2 className="animate-spin" size={11} /> : <CheckCircle2 size={11} />} Verify
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Rollups */}
        {rollups.length > 0 && (
          <section className="bg-card border border-grid-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <Sparkles size={13} className="text-violet-500" /> Rolled-up codes
                <span className="font-normal normal-case text-slate-500">many estimate lines → one code</span>
              </h3>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                <input type="checkbox" checked={showAllRollups} onChange={(e) => setShowAllRollups(e.target.checked)} className="accent-violet-600" />
                Enter all ({rollups.length})
              </label>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              {showAllRollups
                ? "Showing every rollup. Split each code's normalized actual across its estimate lines, or decline to exclude it."
                : `Showing the ${visibleRollups.length} worth attention (high-value / high-variance) plus any you've touched. Toggle "Enter all" for the rest.`}
            </p>
            <div className="flex flex-col gap-2">
              {visibleRollups.map((code) => (
                <RollupCard
                  key={code.costCode}
                  code={code}
                  expanded={expanded.has(code.costCode)}
                  onToggle={() => toggleExpand(code)}
                  inputs={splitInputs[code.costCode] ?? {}}
                  onInput={(lineId, v) => setSplitInput(code.costCode, lineId, v)}
                  onSave={() => saveSplit(code)}
                  onDecline={() => declineCode(code)}
                  onClear={() => clearCode(code)}
                  busy={busy === code.costCode}
                  locked={locked}
                  isFinal={isFinal}
                />
              ))}
              {visibleRollups.length === 0 && (
                <p className="text-xs text-slate-500 italic">No targeted rollups — toggle &quot;Enter all&quot; to review the rest.</p>
              )}
            </div>
          </section>
        )}

        {/* Informational: code-only & estimate-only */}
        {(unbacked.length > 0 || estimateOnly.length > 0) && (
          <InfoSection unbacked={unbacked} estimateOnly={estimateOnly} />
        )}
      </div>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// Rollup card (expandable per-line split editor)
// ---------------------------------------------------------------------------

function RollupCard({
  code, expanded, onToggle, inputs, onInput, onSave, onDecline, onClear, busy, locked, isFinal,
}: {
  code: CodeReconciliation;
  expanded: boolean;
  onToggle: () => void;
  inputs: Record<string, string>;
  onInput: (lineId: string, value: string) => void;
  onSave: () => void;
  onDecline: () => void;
  onClear: () => void;
  busy: boolean;
  locked: boolean;
  isFinal: boolean;
}) {
  const entered = code.estimateLines.reduce((s, l) => s + parseMoney(inputs[l.id] ?? ""), 0);
  const remaining = code.normalizedActual - entered;
  const tied = Math.abs(remaining) <= 0.01;

  return (
    <div className="border border-grid-border rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-background/50 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
          <span className="font-mono text-xs text-foreground whitespace-nowrap">{code.costCode}</span>
          <span className="text-xs text-slate-500 truncate">{code.description}</span>
          {code.isTargeted && <span className="text-[9px] uppercase tracking-wider font-bold text-violet-600 dark:text-violet-400 flex-shrink-0">targeted</span>}
          {code.isHighValue && <span className="text-[9px] uppercase tracking-wider font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">high $</span>}
          {code.isHighVariance && <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400 flex-shrink-0">variance</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-xs">
          <span className="font-mono text-slate-500 hidden sm:inline">{code.estimateLines.length} lines</span>
          <span className="font-mono text-foreground">{money(code.normalizedActual)}</span>
          <StatusBadge status={code.status} tied={code.tiesOut} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-grid-border p-3 bg-background/30">
          {code.status === "declined" ? (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 inline-flex items-center gap-1.5"><XCircle size={13} className="text-slate-400" /> Excluded from finer-grain history.</span>
              {!isFinal && (
                <button onClick={onClear} disabled={locked} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase rounded border border-grid-border text-foreground hover:bg-card disabled:opacity-40">
                  <RotateCcw size={11} /> Undo
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs mb-3">
                <span className="text-slate-500">Code normalized actual (the pool to split)</span>
                <span className="font-mono text-foreground text-right">{money(code.normalizedActual)}</span>
                <span className="text-slate-500">Total estimate across these lines</span>
                <span className="font-mono text-slate-500 text-right">{money(code.estimateTotal)}</span>
              </div>
              <table className="w-full text-xs mb-2">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-1 font-bold">Estimate line</th>
                    <th className="py-1 font-bold text-right">Estimate</th>
                    <th className="py-1 font-bold text-right">Actual to attribute</th>
                  </tr>
                </thead>
                <tbody>
                  {code.estimateLines.map((line) => (
                    <tr key={line.id} className="border-t border-grid-border">
                      <td className="py-1.5 text-slate-600 dark:text-slate-400 max-w-[18rem] truncate" title={line.description}>{line.description}</td>
                      <td className="py-1.5 text-right font-mono text-slate-500">{money(line.total)}</td>
                      <td className="py-1.5 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={locked}
                          value={inputs[line.id] ?? ""}
                          onChange={(e) => onInput(line.id, e.target.value)}
                          placeholder="0.00"
                          className="w-28 bg-transparent border border-grid-border rounded px-2 py-1 text-right font-mono text-xs outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className={`text-xs font-mono ${tied ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {tied ? "Ties out ✓" : `Remaining ${money(remaining)}`}
                </span>
                {!isFinal && (
                  <div className="flex items-center gap-2">
                    <button onClick={onDecline} disabled={locked} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase rounded border border-grid-border text-slate-600 dark:text-slate-400 hover:bg-card disabled:opacity-40">
                      <XCircle size={11} /> Decline
                    </button>
                    {code.status !== "pending" && (
                      <button onClick={onClear} disabled={locked} title="Clear this code's overlay" className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase rounded border border-grid-border text-slate-600 dark:text-slate-400 hover:bg-card disabled:opacity-40">
                        <RotateCcw size={11} /> Clear
                      </button>
                    )}
                    <button onClick={onSave} disabled={locked} className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold uppercase rounded text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
                      {busy ? <Loader2 className="animate-spin" size={11} /> : <CheckCircle2 size={11} />} Save split
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Informational section (code-only / estimate-only) — collapsed by default
// ---------------------------------------------------------------------------

function InfoSection({
  unbacked, estimateOnly,
}: { unbacked: CodeReconciliation[]; estimateOnly: CodeReconciliation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-card border border-grid-border rounded-xl p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Info size={13} className="text-blue-500" /> Not reconcilable
        <span className="font-normal normal-case text-slate-500">
          {unbacked.length} code-only · {estimateOnly.length} estimate-only
        </span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoList
            title="Code-only (actual, no estimate line)"
            note="Nothing finer to recover — code-level only."
            rows={unbacked.map((x) => ({ code: x.costCode, desc: x.description, amount: x.normalizedActual }))}
          />
          <InfoList
            title="Estimate-only (line, no actual)"
            note="The estimate had a line but Procore shows no cost here."
            rows={estimateOnly.map((x) => ({ code: x.costCode, desc: x.estimateLines[0]?.description ?? "", amount: x.estimateTotal }))}
          />
        </div>
      )}
    </section>
  );
}

function InfoList({ title, note, rows }: { title: string; note: string; rows: { code: string; desc: string; amount: number }[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{title}</div>
      <div className="text-[11px] text-slate-400 mb-2">{note}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">None.</p>
      ) : (
        <div className="max-h-48 overflow-y-auto border border-grid-border rounded-lg divide-y divide-grid-border">
          {rows.map((r) => (
            <div key={r.code} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
              <span className="font-mono text-foreground whitespace-nowrap">{r.code}</span>
              <span className="text-slate-500 truncate flex-1" title={r.desc}>{r.desc}</span>
              <span className="font-mono text-slate-500">{money(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function varianceTone(v: number): string {
  if (Math.abs(v) < 0.01) return "text-slate-500";
  return v > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
}

function StatusBadge({ status, tied }: { status: ReconciliationStatus; tied: boolean }) {
  const map: Record<ReconciliationStatus, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "text-amber-600 dark:text-amber-400" },
    verified: { label: "Verified", cls: "text-emerald-600 dark:text-emerald-400" },
    allocated: { label: tied ? "Allocated ✓" : "Partial", cls: tied ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400" },
    declined: { label: "Excluded", cls: "text-slate-400" },
  };
  const s = map[status];
  return <span className={`text-[10px] uppercase tracking-wider font-bold ${s.cls}`}>{s.label}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "emerald" | "blue" | "amber" | "slate" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
      : tone === "blue" ? "text-blue-600 dark:text-blue-400"
        : tone === "amber" ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">{label}</div>
      <div className={`font-semibold ${toneCls}`}>{value}{sub && <span className="text-slate-500 font-normal text-[11px] ml-1.5">{sub}</span>}</div>
    </div>
  );
}

export default function ReconcileSnapshotPage({ params }: { params: Promise<{ projectId: string; snapshotId: string }> }) {
  const { projectId, snapshotId } = use(params);
  return <ReconcileInner projectId={projectId} snapshotId={snapshotId} />;
}
