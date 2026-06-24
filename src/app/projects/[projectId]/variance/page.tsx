"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertTriangle, Scale, Layers, ChevronRight, ChevronDown,
  Lock, TrendingUp, TrendingDown, Minus, Coins, Boxes, History, Gauge, Info, PackageOpen, Upload,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getProject, getProjectBudgetVariance } from "@/lib/db";
import { buildProjectVariance } from "@/lib/actuals";
import type {
  ProjectVarianceModel, DivisionVariance, CodeVariance, VarianceStat, BudgetStatus,
} from "@/lib/actuals";
import type { Project } from "@/types/db";

// ---------------------------------------------------------------------------
// /projects/[id]/variance — active-project budget variance / KPI dashboard
// (Actuals Cost-History Phase 8). The SECOND consumer of the budget-snapshot
// spine and the mirror of the pricing pool: it reads ALL of a project's
// snapshots (draft or final) and shows budget-vs-EAC + snapshot-over-snapshot
// variance plus a first executive KPI view. Computes purely from the Procore
// numbers, so it works for jobs never estimated in this app, and it NEVER reads
// or writes the pricing pool. REPORT-only.
// ---------------------------------------------------------------------------

const money2 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const money0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Signed compact dollars, e.g. "+$12,400" / "−$3,100". */
const signedMoney0 = (n: number) => `${n >= 0 ? "+" : "−"}${money0.format(Math.abs(n))}`;

const fmtPct = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(1)}%`);

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/** over = rose (bad), under = emerald (good), on = slate (neutral). */
const STATUS_TEXT: Record<BudgetStatus, string> = {
  over: "text-rose-600 dark:text-rose-400",
  under: "text-emerald-600 dark:text-emerald-400",
  on: "text-slate-600 dark:text-slate-400",
};

const STATUS_BADGE: Record<BudgetStatus, string> = {
  over: "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50",
  under:
    "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  on: "bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700",
};

const STATUS_LABEL: Record<BudgetStatus, string> = {
  over: "Over budget",
  under: "Under budget",
  on: "On budget",
};

function StatusBadge({ status }: { status: BudgetStatus }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Variance dollars + % colored by status (the budget-vs-EAC headline cell). */
function VarianceCell({ stat }: { stat: VarianceStat }) {
  return (
    <span className={`font-mono ${STATUS_TEXT[stat.status]}`}>
      {signedMoney0(stat.variance)}
      <span className="text-[10px] ml-1 opacity-80">({fmtPct(stat.variancePct)})</span>
    </span>
  );
}

function VarianceInner({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [model, setModel] = useState<ProjectVarianceModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getProject(projectId), getProjectBudgetVariance(projectId)])
      .then(([p, snapshots]) => {
        if (cancelled) return;
        setProject(p);
        setModel(buildProjectVariance(snapshots));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load variance.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Newest snapshot first for the trend table (the current state reads at top).
  const trend = useMemo(
    () => (model ? [...model.timeline].reverse() : []),
    [model],
  );

  const toggleDivision = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-5xl">
        {/* Header */}
        <header className="border-b border-grid-border pb-6">
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back to project
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <Gauge className="text-blue-600 dark:text-blue-400" size={26} /> Budget Variance
            </h1>
            <Link
              href={`/projects/${projectId}/snapshots`}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors"
            >
              <History size={14} className="text-blue-600 dark:text-blue-400" /> Snapshots
            </Link>
          </div>
          {project && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
              Budget-vs-EAC and snapshot-over-snapshot variance for{" "}
              <span className="font-semibold text-foreground">{project.name}</span>, computed straight from
              the uploaded Procore budget snapshots. Reads every snapshot — draft or final — and never touches
              the forward-pricing pool.
            </p>
          )}
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Loading variance…
          </div>
        )}

        {error && (
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-4 flex items-start gap-2.5 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {!loading && !error && model && !model.hasData && (
          <div className="bg-card border border-grid-border rounded-xl p-12 text-center">
            <PackageOpen className="mx-auto text-slate-400 mb-3" size={32} />
            <p className="text-sm font-bold text-foreground">No snapshots to analyze yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
              Upload this project&apos;s Procore Budget Detail export to capture a snapshot. Variance appears as
              soon as the first snapshot lands — no estimate or FINAL promotion required.
            </p>
            <Link
              href="/projects/import-actuals"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors"
            >
              <Upload size={14} /> Import actuals
            </Link>
          </div>
        )}

        {!loading && !error && model && model.hasData && model.kpis && model.latest && (
          <>
            {/* KPI cards — latest snapshot */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                  <Scale size={13} className="text-teal-500" /> Latest snapshot
                  <span className="font-normal normal-case text-slate-500">
                    #{model.latest.snapshotNumber}
                    {model.latest.label ? ` · ${model.latest.label}` : ""} · {fmtDate(model.latest.capturedAt)}
                  </span>
                </h3>
                {model.kpis.latestIsFinal && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                    <Lock size={10} /> Final
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="Original budget" value={money0.format(model.kpis.originalBudget)} icon={<Boxes size={36} />} iconTone="text-slate-400" />
                <KpiCard label="Estimated cost @ completion" value={money0.format(model.kpis.eac)} icon={<Coins size={36} />} iconTone="text-blue-500" />
                <KpiCard
                  label="Variance vs budget"
                  value={signedMoney0(model.kpis.variance)}
                  valueTone={STATUS_TEXT[model.kpis.status]}
                  sub={fmtPct(model.kpis.variancePct)}
                  icon={model.kpis.status === "over" ? <TrendingUp size={36} /> : model.kpis.status === "under" ? <TrendingDown size={36} /> : <Minus size={36} />}
                  iconTone={STATUS_TEXT[model.kpis.status]}
                />
                <KpiCard
                  label="Status"
                  valueNode={<StatusBadge status={model.kpis.status} />}
                  sub={`${model.kpis.divisionsOverBudget} of ${model.kpis.divisionCount} divisions over`}
                  icon={<Gauge size={36} />}
                  iconTone={STATUS_TEXT[model.kpis.status]}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MiniStat label="Direct cost (EAC)" value={money0.format(model.kpis.directEac)} />
                <MiniStat label="Burden (Fee + GL)" value={money0.format(model.kpis.burdenEac)} />
                <MiniStat label="Normalized (in-scope)" value={money0.format(model.kpis.normalized)} />
                <MiniStat
                  label="EAC trend (all snapshots)"
                  value={model.kpis.eacTrend === null ? "—" : signedMoney0(model.kpis.eacTrend)}
                  valueTone={
                    model.kpis.eacTrend === null
                      ? undefined
                      : model.kpis.eacTrend > 0
                        ? STATUS_TEXT.over
                        : model.kpis.eacTrend < 0
                          ? STATUS_TEXT.under
                          : undefined
                  }
                  sub={`${model.kpis.snapshotCount} snapshot${model.kpis.snapshotCount === 1 ? "" : "s"}`}
                />
              </div>
            </section>

            {/* Snapshot-over-snapshot trend */}
            <section className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-grid-border">
                <History size={13} className="text-indigo-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Snapshot trend
                </h3>
                <span className="text-[11px] font-normal text-slate-500">newest first · Δ EAC from the prior upload</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="p-3 border-b border-grid-border font-semibold">Snapshot</th>
                      <th className="p-3 border-b border-grid-border font-semibold">Captured</th>
                      <th className="p-3 text-right border-b border-grid-border font-semibold">EAC</th>
                      <th className="p-3 text-right border-b border-grid-border font-semibold">Δ EAC</th>
                      <th className="p-3 text-right border-b border-grid-border font-semibold">Variance vs budget</th>
                      <th className="p-3 text-center border-b border-grid-border font-semibold w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((pt) => (
                      <tr key={pt.snapshotId} className="hover:bg-background/40 dark:hover:bg-slate-900/40 transition-colors">
                        <td className="p-3 border-b border-grid-border">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">#{pt.snapshotNumber}</span>
                            {pt.label && <span className="text-slate-500 truncate max-w-[14rem]">{pt.label}</span>}
                            {pt.isFinal && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                                <Lock size={9} /> Final
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 border-b border-grid-border text-slate-500 font-mono">{fmtDate(pt.capturedAt)}</td>
                        <td className="p-3 text-right border-b border-grid-border font-mono text-foreground">{money2(pt.eac)}</td>
                        <td className="p-3 text-right border-b border-grid-border font-mono">
                          {pt.eacDeltaFromPrev === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className={pt.eacDeltaFromPrev > 0 ? STATUS_TEXT.over : pt.eacDeltaFromPrev < 0 ? STATUS_TEXT.under : "text-slate-500"}>
                              {signedMoney0(pt.eacDeltaFromPrev)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right border-b border-grid-border">
                          <VarianceCell stat={pt} />
                        </td>
                        <td className="p-3 text-center border-b border-grid-border">
                          <StatusBadge status={pt.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Division breakdown (latest snapshot) */}
            <section className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-grid-border">
                <Layers size={13} className="text-blue-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Variance by division
                </h3>
                <span className="text-[11px] font-normal text-slate-500">latest snapshot · biggest overrun first · expand for codes</span>
              </div>
              {model.divisions.length === 0 ? (
                <p className="p-8 text-center text-slate-500 italic text-xs">No coded actuals in the latest snapshot.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                        <th className="p-3 border-b border-grid-border font-semibold">Division / Code</th>
                        <th className="p-3 text-right border-b border-grid-border font-semibold">Original budget</th>
                        <th className="p-3 text-right border-b border-grid-border font-semibold">EAC</th>
                        <th className="p-3 text-right border-b border-grid-border font-semibold">Variance</th>
                        <th className="p-3 text-center border-b border-grid-border font-semibold w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.divisions.map((division) => (
                        <DivisionRows
                          key={division.division || "(unassigned)"}
                          division={division}
                          open={expanded.has(division.division)}
                          onToggle={() => toggleDivision(division.division)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Caveat footer */}
            <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
              <Info className="text-amber-500/80 shrink-0" size={14} />
              <span>
                Variance is EAC minus the original budget straight from Procore (positive = over). Burden (Fee /
                GL) is included so divisions tie to the grand EAC. This is the active-job financial read — it never
                touches the forward-pricing pool.
              </span>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// Division row + nested code rows
// ---------------------------------------------------------------------------

function DivisionRows({
  division, open, onToggle,
}: { division: DivisionVariance; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="group transition-colors cursor-pointer bg-background/40 dark:bg-slate-900/40 hover:bg-blue-100/50 dark:hover:bg-slate-800/60"
        onClick={onToggle}
      >
        <td className="p-3 border-b border-grid-border">
          <div className="flex items-center gap-2 font-bold text-foreground">
            {division.codes.length > 0 ? (
              open ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />
            ) : (
              <span className="w-[14px] shrink-0" />
            )}
            <Layers size={13} className="text-blue-500 shrink-0" />
            {division.divisionLabel}
            {division.isBurden && (
              <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400">burden</span>
            )}
            <span className="text-[10px] font-mono font-normal text-slate-500">
              {division.codeCount} code{division.codeCount === 1 ? "" : "s"}
            </span>
          </div>
        </td>
        <td className="p-3 text-right border-b border-grid-border font-mono text-slate-500">{money2(division.originalBudget)}</td>
        <td className="p-3 text-right border-b border-grid-border font-mono font-bold text-foreground">{money2(division.eac)}</td>
        <td className="p-3 text-right border-b border-grid-border"><VarianceCell stat={division} /></td>
        <td className="p-3 text-center border-b border-grid-border"><StatusBadge status={division.status} /></td>
      </tr>
      {open &&
        division.codes.map((code: CodeVariance) => (
          <tr key={`${division.division}-${code.costCode || "(none)"}`} className="hover:bg-background/30 dark:hover:bg-slate-900/30 transition-colors">
            <td className="p-2.5 pl-12 border-b border-grid-border text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{code.costCode || "—"}</span>
                <span className="truncate max-w-[18rem]">{code.description}</span>
                {code.isBurden && (
                  <span className="text-[9px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400">burden</span>
                )}
              </div>
            </td>
            <td className="p-2.5 text-right border-b border-grid-border font-mono text-slate-500">{money2(code.originalBudget)}</td>
            <td className="p-2.5 text-right border-b border-grid-border font-mono text-foreground">{money2(code.eac)}</td>
            <td className="p-2.5 text-right border-b border-grid-border"><VarianceCell stat={code} /></td>
            <td className="p-2.5 text-center border-b border-grid-border"><StatusBadge status={code.status} /></td>
          </tr>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function KpiCard({
  label, value, valueNode, valueTone, sub, icon, iconTone,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  valueTone?: string;
  sub?: string;
  icon: React.ReactNode;
  iconTone: string;
}) {
  return (
    <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
      <div className={`absolute top-0 right-0 p-4 opacity-10 ${iconTone}`}>{icon}</div>
      <p className="text-slate-600 dark:text-slate-400 text-[11px] uppercase tracking-wider font-semibold">{label}</p>
      {valueNode ? (
        <div className="mt-2">{valueNode}</div>
      ) : (
        <h2 className={`text-2xl font-extrabold mt-2 ${valueTone ?? "text-foreground"}`}>{value}</h2>
      )}
      {sub && <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, valueTone, sub }: { label: string; value: string; valueTone?: string; sub?: string }) {
  return (
    <div className="bg-card border border-grid-border rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</p>
      <p className={`text-lg font-bold mt-1 ${valueTone ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ProjectVariancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <VarianceInner projectId={projectId} />;
}
