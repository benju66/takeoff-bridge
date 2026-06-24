"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Target,
  Info,
  Terminal,
  Menu,
  Layers,
  ChevronRight,
  ChevronDown,
  PackageOpen,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  CircleDollarSign,
} from "lucide-react";
import { getBuyoutAccuracyInputs } from "@/lib/db";
import {
  aggregateBuyoutAccuracy,
  type BuyoutAccuracyPortfolio,
  type BuyoutAccuracyStatus,
  type ProjectBuyoutAccuracy,
} from "@/lib/actuals";

// ---------------------------------------------------------------------------
// /buyout-accuracy — planned-buyout-vs-miss accuracy lens (Actuals Cost-History
// Phase 9). The THIRD reader of the FINAL budget snapshots (after /rates +
// /concept-pricing pricing pool and the per-project variance dashboard) and the
// only one that couples to the estimate side. For every closed job it sums the
// in-scope FP Contingency/Buyout draws and grades them against that job's
// bid-time contingency budget: draws within budget = planned, the excess = a
// miss. REPORT-only — nothing here writes; every number is engine-derived.
// ---------------------------------------------------------------------------

const dollarsFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Status-badge styling per accuracy posture. */
const STATUS_CLASSES: Record<BuyoutAccuracyStatus, string> = {
  within:
    "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  savings:
    "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  miss: "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50",
  unbudgeted:
    "bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700",
};

const STATUS_LABEL: Record<BuyoutAccuracyStatus, string> = {
  within: "Within budget",
  savings: "Came in under",
  miss: "Over budget",
  unbudgeted: "No bid budget",
};

function sectorLabel(sector: string): string {
  return sector === "" ? "Unspecified sector" : sector;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: BuyoutAccuracyStatus }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${STATUS_CLASSES[status]}`}
      title={STATUS_LABEL[status]}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function BuyoutAccuracyDashboard() {
  const [portfolio, setPortfolio] = useState<BuyoutAccuracyPortfolio | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load the FINAL-snapshot buyout draws + each project's bid-time contingency
  // budget, then score. Fail-soft: an outage (or no FINAL snapshot yet) leaves an
  // honest empty state, never a crash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inputs = await getBuyoutAccuracyInputs();
        if (!cancelled) setPortfolio(aggregateBuyoutAccuracy(inputs));
      } catch (err) {
        console.error("Failed to load buyout-accuracy pool:", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = portfolio?.totals;

  // The aggregate posture tints the hit-rate card.
  const hitRateClass = useMemo(() => {
    if (!totals || totals.portfolioStatus === "unbudgeted") return "text-slate-500";
    if (totals.portfolioStatus === "miss") return "text-rose-600 dark:text-rose-400";
    return "text-emerald-600 dark:text-emerald-400";
  }, [totals]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Buyout Accuracy…</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Grading closed-job contingency draws against their bid budgets
        </p>
      </div>
    );
  }

  const noData = !portfolio || !portfolio.hasData;

  return (
    <div className="flex flex-col gap-6 selection:bg-blue-100 dark:selection:bg-blue-900/50">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-grid-border pb-6 mb-2 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-sidebar"))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/65 rounded-lg text-slate-650 dark:text-slate-350 transition-colors cursor-pointer"
            title="Toggle Sidebar"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <Target className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> BUYOUT ACCURACY
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping inline-block"></span>
              Planned-buyout-vs-miss · contingency draws vs the bid budget
            </p>
          </div>
        </div>
      </header>

      {/* Info banner */}
      <div className="bg-teal-50/50 dark:bg-teal-950/10 border border-teal-200 dark:border-teal-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wider">
            Did we budget contingency accurately?
          </h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            For each closed job (a FINAL budget snapshot), this sums the in-scope <em>FP Contingency/Buyout</em> draws —
            the contingency our crew actually spent during construction — and compares them to the contingency we budgeted
            at bid time (<span className="font-semibold">Construction + Design Contingency</span> on the{" "}
            <a href="/rates" className="font-bold text-teal-700 dark:text-teal-300 hover:underline">submitted estimate</a>).
            Draws within budget were <span className="font-semibold">planned</span>; any excess over budget is a{" "}
            <span className="font-semibold">miss</span>. Jobs that never had a submitted estimate carry no budget to grade
            against and are listed as <em>no bid budget</em>. Nothing here is written back to any estimate.
          </p>
        </div>
      </div>

      {noData ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            {loadError ? (
              <Terminal size={48} className="text-rose-500 animate-pulse" />
            ) : (
              <PackageOpen size={48} className="text-slate-400" />
            )}
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">
            {loadError ? "Buyout Accuracy Unavailable" : "No closed jobs to grade yet"}
          </h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            {loadError
              ? "The buyout-accuracy pool could not be loaded. Check your connection and reload."
              : "Accuracy appears once a project's budget snapshot is marked FINAL. Promote a closeout snapshot, then return here — jobs with a submitted bid get graded against their contingency budget."}
          </p>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Hit rate */}
            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Target size={40} className="text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Accuracy hit rate
              </p>
              <h2 className={`text-2xl font-extrabold mt-2 ${hitRateClass}`}>
                {totals!.hitRate === null ? "—" : pctFmt.format(totals!.hitRate)}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                {totals!.withinCount + totals!.savingsCount} of {totals!.budgetedProjects} budgeted job
                {totals!.budgetedProjects === 1 ? "" : "s"} within budget
              </div>
            </div>

            {/* Total contingency budget */}
            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <CircleDollarSign size={40} className="text-slate-500" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Budgeted contingency
              </p>
              <h2 className="text-2xl font-extrabold text-foreground mt-2">
                {dollarsFmt.format(totals!.totalContingencyBudget)}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                Σ bid-time contingency across budgeted jobs
              </div>
            </div>

            {/* Total drawn */}
            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                {totals!.totalDrawn >= 0 ? (
                  <TrendingUp size={40} className="text-amber-500" />
                ) : (
                  <PiggyBank size={40} className="text-blue-500" />
                )}
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Contingency drawn
              </p>
              <h2 className="text-2xl font-extrabold text-foreground mt-2">
                {dollarsFmt.format(totals!.totalDrawn)}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                Σ in-scope FP buyout draws (negative = returned)
              </div>
            </div>

            {/* Total miss */}
            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <TrendingDown size={40} className="text-rose-500" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Total miss
              </p>
              <h2 className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-2">
                {dollarsFmt.format(totals!.totalMiss)}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                {totals!.missCount} job{totals!.missCount === 1 ? "" : "s"} over budget
                {totals!.unbudgetedProjects > 0
                  ? ` · ${totals!.unbudgetedProjects} unbudgeted`
                  : ""}
              </div>
            </div>
          </div>

          {/* Per-project table */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-separate border-spacing-0 border-l border-grid-border">
                <thead>
                  <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-4 border-r border-b border-grid-border font-semibold">Project</th>
                    <th className="p-4 border-r border-b border-grid-border font-semibold w-28">Finalized</th>
                    <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-32">Budget</th>
                    <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-32">Drawn</th>
                    <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-32">Planned</th>
                    <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-32">Miss</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-32">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio!.projects.map((p) => (
                    <ProjectRow
                      key={p.snapshotId}
                      project={p}
                      isOpen={expanded.has(p.snapshotId)}
                      onToggle={() => toggle(p.snapshotId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Caveat footer */}
          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              The draw is the in-scope FP Contingency/Buyout direct cost (the change orders&apos; own Fee/GL markup is
              excluded). A negative draw means contingency was returned. Jobs with no submitted bid carry no budget and are
              listed but not scored.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** One project row, expandable to its per-division direct draws. */
function ProjectRow({
  project,
  isOpen,
  onToggle,
}: {
  project: ProjectBuyoutAccuracy;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { stat, draws } = project;
  const hasDivisions = draws.byDivision.length > 0;

  return (
    <React.Fragment>
      <tr
        className={`group transition-colors ${hasDivisions ? "cursor-pointer" : ""}`}
        onClick={hasDivisions ? onToggle : undefined}
      >
        <td className="p-4 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          <div className="flex items-center gap-2 font-bold text-foreground">
            {hasDivisions ? (
              isOpen ? (
                <ChevronDown size={14} className="text-slate-400 shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-slate-400 shrink-0" />
              )
            ) : (
              <span className="w-[14px] shrink-0" />
            )}
            <span className="truncate">{project.projectName || "Untitled project"}</span>
          </div>
          <div className="text-[10px] font-mono font-normal text-slate-500 pl-[22px] mt-0.5">
            {sectorLabel(project.marketSector)} · {draws.drawCount} buyout event
            {draws.drawCount === 1 ? "" : "s"}
            {draws.overriddenCount > 0 ? ` · ${draws.overriddenCount} reclassified` : ""}
          </div>
        </td>
        <td className="p-4 border-r border-b border-grid-border font-mono text-slate-600 dark:text-slate-400 group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          {fmtDate(project.finalizedAt)}
        </td>
        <td className="p-4 text-right font-mono text-slate-600 dark:text-slate-400 border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          {stat.hasBudget ? dollarsFmt.format(stat.contingencyBudget!) : "—"}
        </td>
        <td className="p-4 text-right font-mono font-bold text-foreground border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          {dollarsFmt.format(stat.drawn)}
        </td>
        <td className="p-4 text-right font-mono text-emerald-700 dark:text-emerald-300 border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          {stat.hasBudget ? dollarsFmt.format(stat.plannedDraw) : "—"}
        </td>
        <td className="p-4 text-right font-mono font-bold border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          <span className={stat.missAmount > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}>
            {stat.hasBudget ? dollarsFmt.format(stat.missAmount) : "—"}
          </span>
        </td>
        <td className="p-4 text-center border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status={stat.status} />
            {stat.utilizationPct !== null && (
              <span className="text-[9px] font-mono text-slate-500" title="Draw ÷ budget">
                {pctFmt.format(stat.utilizationPct)} used
              </span>
            )}
          </div>
        </td>
      </tr>

      {/* Division breakdown (expanded) */}
      {isOpen &&
        draws.byDivision.map((d) => (
          <tr key={`${project.snapshotId}-${d.division}`} className="group transition-colors">
            <td
              colSpan={3}
              className="p-3 pl-12 border-r border-b border-grid-border text-slate-600 dark:text-slate-400 group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50"
            >
              <div className="flex items-center gap-2">
                <Layers size={13} className="text-blue-500 shrink-0" />
                <span className="font-semibold text-foreground">{d.divisionLabel}</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {d.codes.length} code{d.codes.length === 1 ? "" : "s"}
                </span>
              </div>
            </td>
            <td className="p-3 text-right font-mono font-semibold text-foreground border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
              {dollarsFmt.format(d.directDraw)}
            </td>
            <td colSpan={3} className="border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50" />
          </tr>
        ))}
    </React.Fragment>
  );
}
