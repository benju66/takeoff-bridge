"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Calculator,
  Info,
  Terminal,
  Menu,
  Ruler,
  Home,
  Coins,
  Layers,
  ChevronRight,
  ChevronDown,
  PackageOpen,
} from "lucide-react";
import { getActualCostHistory } from "@/lib/db";
import {
  aggregateConceptPricing,
  CONCEPT_METRICS,
  type ConceptMetric,
  type ConceptPricingModel,
  type ConceptPricingStat,
} from "@/lib/actuals";

// ---------------------------------------------------------------------------
// /concept-pricing — parametric ($/SF, $/unit) concept pricing (Actuals
// Cost-History Phase 7). The SECOND reader of the actuals pricing pool (after
// /rates): it turns closed-job normalized dollars into per-square-foot and
// per-unit benchmarks for napkin-stage budgeting. REPORT-only — nothing here
// writes; a benchmark becomes a number only when multiplied by a human-typed
// concept quantity for an advisory rough order of magnitude.
//
// Sector-specific by design (never blends $/SF across building types — that
// would be misleading); the dollars themselves are the EFFECTIVE normalized
// actuals (Phase-5 classification overrides honored on the db.ts side).
// ---------------------------------------------------------------------------

const perMetricFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dollarsFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Strength-tier badge styling (strong / moderate / thin) — mirrors /rates. */
const STRENGTH_TIER_CLASSES: Record<ConceptPricingStat["strength"]["tier"], string> = {
  strong:
    "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  moderate:
    "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50",
  thin: "bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700",
};

/** A market sector key for display ("" = legacy unset). */
function sectorLabel(sector: string): string {
  return sector === "" ? "Unspecified sector" : sector;
}

function StrengthBadge({ stat }: { stat: ConceptPricingStat }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${STRENGTH_TIER_CLASSES[stat.strength.tier]}`}
      title={`Confidence: ${stat.strength.label}`}
    >
      {stat.strength.tier}
    </span>
  );
}

export default function ConceptPricingDashboard() {
  const [model, setModel] = useState<ConceptPricingModel | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [metric, setMetric] = useState<ConceptMetric>("sf");
  const [sector, setSector] = useState<string>("");
  const [qtyInput, setQtyInput] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load the actuals pool and build the parametric model. Fail-soft: an outage
  // (or an empty pool — no FINAL snapshot yet) leaves the page in an honest
  // empty state, never a crash.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const observations = await getActualCostHistory();
        if (!cancelled) setModel(aggregateConceptPricing(observations));
      } catch (err) {
        console.error("Failed to load concept-pricing pool:", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer $/SF once the model lands (fall back to $/unit when SF is absent).
  useEffect(() => {
    if (!model) return;
    setMetric(model.hasSf ? "sf" : model.hasUnit ? "unit" : "sf");
  }, [model]);

  // Keep the sector valid for the active metric: preserve the user's pick while
  // it still has benchmarks for this basis, else fall back to the sector with the
  // most backing jobs. Without this, toggling SF↔unit could strand a sector that
  // has no data for the new basis — the <select> value would match no option and
  // the table would read empty even though another sector has benchmarks.
  useEffect(() => {
    if (!model) return;
    const counts = new Map<string, number>();
    for (const s of model.divisions) {
      if (s.metric !== metric) continue;
      counts.set(s.marketSector, (counts.get(s.marketSector) ?? 0) + s.count);
    }
    if (counts.size === 0 || counts.has(sector)) return; // none yet, or still valid
    let best = "";
    let bestCount = -1;
    for (const [sec, c] of counts) {
      if (c > bestCount) {
        best = sec;
        bestCount = c;
      }
    }
    setSector(best);
  }, [model, metric, sector]);

  const conceptQty = useMemo(() => {
    const n = Number(qtyInput.replace(/[, ]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [qtyInput]);

  // Sectors that actually carry a benchmark for the active metric (the picker).
  const sectorsForMetric = useMemo(() => {
    if (!model) return [];
    const set = new Set<string>();
    for (const s of model.divisions) if (s.metric === metric) set.add(s.marketSector);
    return [...set].sort();
  }, [model, metric]);

  // The division benchmarks for the active metric + sector, each with its codes.
  const rows = useMemo(() => {
    if (!model) return [];
    const divisions = model.divisions
      .filter((s) => s.metric === metric && s.marketSector === sector)
      .sort((a, b) => a.division.localeCompare(b.division, undefined, { numeric: true }));
    return divisions.map((division) => ({
      division,
      codes: model.codes
        .filter(
          (c) => c.metric === metric && c.marketSector === sector && c.division === division.division,
        )
        .sort((a, b) => b.medianCostPerMetric - a.medianCostPerMetric),
    }));
  }, [model, metric, sector]);

  // Napkin total: Σ division median $/metric, and its implied dollars at the qty.
  const totalMedianPerMetric = useMemo(
    () => rows.reduce((sum, r) => sum + r.division.medianCostPerMetric, 0),
    [rows],
  );
  const impliedTotal = totalMedianPerMetric * conceptQty;

  const meta = CONCEPT_METRICS[metric];

  const toggleDivision = (key: string) => {
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
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Concept Pricing…</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Deriving $/SF and $/unit benchmarks from closed-job actuals
        </p>
      </div>
    );
  }

  const noData = !model || (!model.hasSf && !model.hasUnit);

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
              <Calculator className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> CONCEPT PRICING
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping inline-block"></span>
              Parametric $/SF · $/unit benchmarks from closed-job actuals
            </p>
          </div>
        </div>
      </header>

      {/* Info banner */}
      <div className="bg-teal-50/50 dark:bg-teal-950/10 border border-teal-200 dark:border-teal-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-teal-700 dark:text-teal-300 uppercase tracking-wider">
            Napkin-stage budgeting
          </h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            Each benchmark is the <em>normalized</em> closed-job cost (owner extras, allowances, and net-zero reclasses
            removed) for a Procore division or code, divided by the project&apos;s square footage or unit count — pooled
            across past FINAL budget snapshots and shown as a median with the same strength badge you see on{" "}
            <a href="/rates" className="font-bold text-teal-700 dark:text-teal-300 hover:underline">/rates</a>. Type a
            concept quantity to turn the benchmarks into a rough order-of-magnitude budget. Benchmarks are kept
            sector-specific (never blended across building types) and never written back to any estimate.
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
            {loadError ? "Concept Pricing Unavailable" : "No parametric benchmarks yet"}
          </h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            {loadError
              ? "The actuals pool could not be loaded. Check your connection and reload."
              : "Benchmarks appear once a project's budget snapshot is marked FINAL and that project has a captured square footage or unit count. Promote a closeout snapshot, then return here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Controls */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm p-4 flex flex-col md:flex-row md:items-end gap-4 flex-wrap">
            {/* Metric toggle */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Basis</span>
              <div className="flex rounded-lg border border-grid-border overflow-hidden w-fit">
                <button
                  onClick={() => model!.hasSf && setMetric("sf")}
                  disabled={!model!.hasSf}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    metric === "sf"
                      ? "bg-blue-600 text-white"
                      : "bg-card text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  }`}
                  title="Cost per square foot"
                >
                  <Ruler size={13} /> $/SF
                </button>
                <button
                  onClick={() => model!.hasUnit && setMetric("unit")}
                  disabled={!model!.hasUnit}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer border-l border-grid-border disabled:opacity-30 disabled:cursor-not-allowed ${
                    metric === "unit"
                      ? "bg-blue-600 text-white"
                      : "bg-card text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  }`}
                  title="Cost per unit / key"
                >
                  <Home size={13} /> $/unit
                </button>
              </div>
            </div>

            {/* Sector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Market sector</span>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="text-xs font-semibold rounded-lg border border-grid-border bg-card text-foreground px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer min-w-[180px]"
              >
                {sectorsForMetric.length === 0 ? (
                  <option value="">No benchmarks for this basis</option>
                ) : (
                  sectorsForMetric.map((s) => (
                    <option key={s || "(none)"} value={s}>
                      {sectorLabel(s)}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Concept quantity */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Concept {meta.unitLabel === "SF" ? "square footage" : "unit count"}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={meta.unitLabel === "SF" ? 1000 : 1}
                  inputMode="numeric"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  placeholder={meta.unitLabel === "SF" ? "e.g. 120000" : "e.g. 90"}
                  className="text-xs font-mono rounded-lg border border-grid-border bg-card text-right text-foreground px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 w-40"
                  title={`Your concept ${meta.unitLabel} for a rough budget`}
                />
                <span className="text-xs font-mono text-slate-500">{meta.unitLabel}</span>
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Layers size={40} className="text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Divisions</p>
              <h2 className="text-2xl font-extrabold text-foreground mt-2">{rows.length}</h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                Procore divisions with a {meta.perLabel} benchmark
              </div>
            </div>

            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Coins size={40} className="text-teal-600 dark:text-teal-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Blended {meta.perLabel}
              </p>
              <h2 className="text-2xl font-extrabold text-teal-600 dark:text-teal-400 mt-2">
                {perMetricFmt.format(totalMedianPerMetric)}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                Σ of division median {meta.perLabel} ({sectorLabel(sector)})
              </div>
            </div>

            <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Calculator size={40} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                Rough budget
              </p>
              <h2 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">
                {conceptQty > 0 ? dollarsFmt.format(impliedTotal) : "—"}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                {conceptQty > 0
                  ? `${qtyFmt.format(conceptQty)} ${meta.unitLabel} × blended ${meta.perLabel}`
                  : `Enter a concept ${meta.unitLabel} above`}
              </div>
            </div>
          </div>

          {/* Benchmark table */}
          {rows.length === 0 ? (
            <div className="bg-card border border-grid-border rounded-xl shadow-sm p-8 text-center text-slate-600 dark:text-slate-400 italic">
              No {meta.perLabel} benchmarks for {sectorLabel(sector)}.
            </div>
          ) : (
            <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-separate border-spacing-0 border-l border-grid-border">
                  <thead>
                    <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="p-4 border-r border-b border-grid-border font-semibold">Division / Code</th>
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-20">Jobs</th>
                      <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-32">
                        Median {meta.perLabel}
                      </th>
                      <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-40">Range</th>
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-28">Strength</th>
                      <th className="p-4 text-right border-r border-b border-grid-border font-semibold w-36">
                        Implied {conceptQty > 0 ? `@ ${qtyFmt.format(conceptQty)} ${meta.unitLabel}` : ""}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ division, codes }) => {
                      const key = division.division;
                      const isOpen = expanded.has(key);
                      return (
                        <React.Fragment key={key}>
                          {/* Division rollup row */}
                          <tr
                            className="group transition-colors cursor-pointer bg-background/40 dark:bg-slate-900/40"
                            onClick={() => toggleDivision(key)}
                          >
                            <td className="p-4 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              <div className="flex items-center gap-2 font-bold text-foreground">
                                {codes.length > 0 ? (
                                  isOpen ? (
                                    <ChevronDown size={14} className="text-slate-400 shrink-0" />
                                  ) : (
                                    <ChevronRight size={14} className="text-slate-400 shrink-0" />
                                  )
                                ) : (
                                  <span className="w-[14px] shrink-0" />
                                )}
                                <Layers size={13} className="text-blue-500 shrink-0" />
                                {division.divisionLabel}
                                <span className="text-[10px] font-mono font-normal text-slate-500">
                                  {codes.length} code{codes.length === 1 ? "" : "s"}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-center font-mono text-slate-600 dark:text-slate-400 border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {division.count}
                            </td>
                            <td className="p-4 text-right font-mono font-bold text-teal-700 dark:text-teal-300 border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {perMetricFmt.format(division.medianCostPerMetric)}
                            </td>
                            <td className="p-4 text-right font-mono text-slate-500 border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {division.count > 1
                                ? `${perMetricFmt.format(division.minCostPerMetric)}–${perMetricFmt.format(division.maxCostPerMetric)}`
                                : "—"}
                            </td>
                            <td className="p-4 text-center border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              <StrengthBadge stat={division} />
                            </td>
                            <td className="p-4 text-right font-mono font-bold text-foreground border-r border-b border-grid-border group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {conceptQty > 0 ? dollarsFmt.format(division.medianCostPerMetric * conceptQty) : "—"}
                            </td>
                          </tr>

                          {/* Code rows (expanded) */}
                          {isOpen &&
                            codes.map((code) => (
                              <tr key={`${key}-${code.costCode}`} className="group transition-colors">
                                <td className="p-3 pl-12 border-r border-b border-grid-border text-slate-600 dark:text-slate-400 group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                                      {code.costCode}
                                    </span>
                                    <span className="truncate">{code.description}</span>
                                  </div>
                                </td>
                                <td className="p-3 text-center font-mono text-slate-600 dark:text-slate-400 border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  {code.count}
                                </td>
                                <td className="p-3 text-right font-mono font-semibold text-teal-700 dark:text-teal-300 border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  {perMetricFmt.format(code.medianCostPerMetric)}
                                </td>
                                <td className="p-3 text-right font-mono text-slate-500 border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  {code.count > 1
                                    ? `${perMetricFmt.format(code.minCostPerMetric)}–${perMetricFmt.format(code.maxCostPerMetric)}`
                                    : "—"}
                                </td>
                                <td className="p-3 text-center border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  <StrengthBadge stat={code} />
                                </td>
                                <td className="p-3 text-right font-mono text-foreground border-r border-b border-grid-border group-hover:bg-blue-100/40 dark:group-hover:bg-slate-800/50">
                                  {conceptQty > 0 ? dollarsFmt.format(code.medianCostPerMetric * conceptQty) : "—"}
                                </td>
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Caveat footer */}
          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              Concept benchmarks are a rough order of magnitude only. The blended {meta.perLabel} sums each division&apos;s
              median, so it is an estimate of estimates — confirm against a real takeoff before committing a number. A thin
              strength badge means few backing jobs.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
