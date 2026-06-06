import React from "react";
import { Activity } from "lucide-react";
import { SiteOpsCalcResult } from "@/lib/calculations";
import {
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// InfrastructureStep — Step 3 Panel
// Division 02 Site Operations Calculation Module
// Phase 4: full template STEP 3 line coverage, grouped by the template's
// subtotal sections (SITE_OPS_SECTIONS).
// ---------------------------------------------------------------------------

interface InfrastructureStepProps {
  durationMonths: number;
  squareFootage: number;
  quantities: Record<string, number>;
  rates: Record<string, number>;
  onLineQuantityChange: (key: string, valStr: string) => void;
  onLineRateChange: (key: string, valStr: string) => void;
  calcResult: SiteOpsCalcResult;
  siteOperationsTotal: number;
}

const codeCellClass = "p-3 text-center text-blue-600 dark:text-blue-400 font-semibold border-r border-b border-grid-border font-mono";
const descCellClass = "p-3 text-left font-semibold text-foreground border-r border-b border-grid-border";
const unitCellClass = "p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono";
const totalCellClass = "p-3 text-center border-b border-grid-border text-emerald-600 dark:text-emerald-400 font-bold font-mono";
const dashCellClass = "p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 font-semibold font-mono";
const inputClass = "w-full h-full min-h-[36px] bg-transparent border-none rounded-none text-center px-3 py-2 outline-none text-foreground focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10 transition-all font-mono";

const fmt = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InfrastructureStep({
  durationMonths,
  squareFootage,
  quantities,
  rates,
  onLineQuantityChange,
  onLineRateChange,
  calcResult,
  siteOperationsTotal,
}: InfrastructureStepProps) {
  // Line totals computed by the calculation layer, keyed by criterion code
  const totalByCode = new Map<string, number>();
  for (const l of [...calcResult.dynamicLines, ...calcResult.manualLines]) {
    totalByCode.set(l.code, l.total);
  }

  return (
    <div className="bg-card border border-grid-border text-card-foreground rounded-xl overflow-hidden shadow-sm animate-fade-in">
      <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} className="text-blue-600 dark:text-blue-400" /> Division 02 Site Operations Calculation Module
        </h3>
        <span className="text-[10px] bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full border border-grid-border font-sans font-semibold">
          Active SF: {squareFootage.toLocaleString()} SF | Duration: {durationMonths} Mos
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-separate border-spacing-0 font-sans">
          <thead>
            <tr className="bg-[#3057A6] text-white uppercase tracking-wider font-bold text-[13px]">
              <th className="p-4 text-center w-28 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Code</th>
              <th className="p-4 text-center border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Description</th>
              <th className="p-4 text-center w-20 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Unit</th>
              <th className="p-4 text-center w-32 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Rate</th>
              <th className="p-4 text-center w-44 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Estimator Entry</th>
              <th className="p-4 text-center w-40 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Calculated Qty</th>
              <th className="p-4 text-center w-36 border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-border">
            {SITE_OPS_SECTIONS.map((section) => {
              const dynamicRows = SITE_OPS_DYNAMIC_DEFAULTS.filter((c) => c.section === section.id);
              const manualRows = SITE_OPS_MANUAL_DEFAULTS.filter((c) => c.section === section.id);
              const sectionTotal =
                dynamicRows.reduce((s, c) => s + (totalByCode.get(c.code) ?? 0), 0) +
                manualRows.reduce((s, c) => s + (totalByCode.get(c.code) ?? 0), 0);

              return (
                <React.Fragment key={section.id}>
                  <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
                    <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">{section.label}</td>
                  </tr>

                  {/* Auto lines (duration / sqft driven — mirror template formulas) */}
                  {dynamicRows.map((cfg) => {
                    const qty = cfg.quantityDriver === "duration" ? durationMonths : squareFootage;
                    return (
                      <tr key={cfg.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                        <td className={codeCellClass}>{cfg.code}</td>
                        <td className={descCellClass}>{cfg.label} (Rate ${cfg.rate.toLocaleString()}/{cfg.unit}, quantity follows {cfg.quantityDriver === "duration" ? "schedule duration" : "project square footage"})</td>
                        <td className={unitCellClass}>{cfg.unit}</td>
                        <td className="p-3 text-center border-r border-b border-grid-border text-foreground font-mono">${cfg.rate.toFixed(2)}</td>
                        <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono">auto</td>
                        <td className={dashCellClass}>{qty.toLocaleString()} {cfg.unit}</td>
                        <td className={totalCellClass}>{fmt(totalByCode.get(cfg.code) ?? 0)}</td>
                      </tr>
                    );
                  })}

                  {/* Manual lines (typed qty / typed qty+rate / typed lump-sum $) */}
                  {manualRows.map((cfg) => {
                    const val = quantities[cfg.key] ?? 0;
                    const isLump = cfg.entry === "lumpSum";
                    const isQtyRate = cfg.entry === "qtyRate";
                    const rateVal = isQtyRate ? (rates[cfg.key] ?? 0) : cfg.rate ?? 0;
                    return (
                      <tr key={cfg.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                        <td className={codeCellClass}>{cfg.code}</td>
                        <td className={descCellClass}>
                          {isLump
                            ? `${cfg.label} (Lump Sum — enter total $)`
                            : isQtyRate
                              ? `${cfg.label} (Lump Sum custom overrides)`
                              : `${cfg.label} (Rate $${(cfg.rate ?? 0).toLocaleString()}/${cfg.unit})`}
                        </td>
                        <td className={unitCellClass}>{cfg.unit}</td>
                        {/* Rate cell */}
                        <td className={isQtyRate ? "p-0 border-r border-b border-grid-border" : "p-3 text-center border-r border-b border-grid-border font-mono"}>
                          {isQtyRate ? (
                            <div className="flex items-center justify-center w-full h-full relative">
                              <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                              <input
                                type="number"
                                className={inputClass}
                                value={rateVal === 0 ? "" : rateVal}
                                placeholder="0.00"
                                onChange={(e) => onLineRateChange(cfg.key, e.target.value)}
                              />
                            </div>
                          ) : isLump ? (
                            <span className="text-slate-600 dark:text-slate-400 font-semibold">—</span>
                          ) : (
                            <span className="text-foreground">${(cfg.rate ?? 0).toFixed(2)}</span>
                          )}
                        </td>
                        {/* Entry cell: quantity or lump-sum dollars */}
                        <td className="p-0 border-r border-b border-grid-border">
                          <div className="flex items-center justify-center w-full h-full relative">
                            {isLump && (
                              <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                            )}
                            <input
                              type="number"
                              min={0}
                              className={inputClass}
                              value={val === 0 ? "" : val}
                              placeholder={isLump ? "0.00" : "0"}
                              onChange={(e) => onLineQuantityChange(cfg.key, e.target.value)}
                            />
                          </div>
                        </td>
                        <td className={dashCellClass}>—</td>
                        <td className={totalCellClass}>{fmt(totalByCode.get(cfg.code) ?? 0)}</td>
                      </tr>
                    );
                  })}

                  {/* Section subtotal (mirrors the template's subtotal rows) */}
                  <tr className="bg-background/60 dark:bg-slate-900/60 text-[11px] font-bold text-foreground">
                    <td className="p-2 text-center border-r border-b border-grid-border" />
                    <td colSpan={5} className="p-2 text-right uppercase tracking-wider text-[10px] text-slate-600 dark:text-slate-400 border-r border-b border-grid-border font-bold">Subtotal — {section.label.replace(/^02\.[A-H] — /, "")}</td>
                    <td className="p-2 text-right text-foreground font-mono border-b border-grid-border">{fmt(sectionTotal)}</td>
                  </tr>
                </React.Fragment>
              );
            })}

            {/* Grand total row */}
            <tr className="bg-background/80 dark:bg-slate-900/80 border-t border-grid-border text-xs font-bold text-foreground">
              <td className="p-4 text-center border-r border-b border-grid-border font-bold">TOTAL</td>
              <td colSpan={5} className="p-4 text-left uppercase tracking-wider text-[10px] text-slate-600 dark:text-slate-400 border-r border-b border-grid-border font-bold">Cumulative Division 02 Site Operations Cost</td>
              <td className="p-4 text-right text-emerald-600 dark:text-emerald-400 text-sm font-black border-b border-grid-border font-mono">
                {fmt(siteOperationsTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
