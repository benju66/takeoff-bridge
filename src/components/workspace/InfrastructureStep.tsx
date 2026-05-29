import React from "react";
import { Activity } from "lucide-react";
import { SiteOpsCalcResult } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// InfrastructureStep — Step 3 Panel
// Division 02 Site Operations Calculation Module
// ---------------------------------------------------------------------------

interface InfrastructureStepProps {
  durationMonths: number;
  squareFootage: number;
  quantities: { knox: number; payrollCleaning: number; hiredCleaning: number; soilBorings: number };
  rates: { soilBorings: number };
  onSiteOpsChange: (field: "knox" | "payroll" | "hired" | "soilQty" | "soilRate", valStr: string) => void;
  calcResult: SiteOpsCalcResult;
  siteOperationsTotal: number;
}

const codeCellClass = "p-3 text-center text-blue-600 dark:text-blue-400 font-semibold border-r border-b border-grid-border font-mono";
const descCellClass = "p-3 text-left font-semibold text-foreground border-r border-b border-grid-border";
const unitCellClass = "p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono";
const totalCellClass = "p-3 text-center border-b border-grid-border text-emerald-600 dark:text-emerald-400 font-bold font-mono";
const inputClass = "w-full h-full min-h-[36px] bg-transparent border-none rounded-none text-center px-3 py-2 outline-none text-foreground focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10 transition-all font-mono";

const fmt = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InfrastructureStep({
  durationMonths,
  squareFootage,
  quantities,
  rates,
  onSiteOpsChange,
  calcResult,
  siteOperationsTotal,
}: InfrastructureStepProps) {
  const dynamicRows = [
    { code: "02-9015", desc: "Safety (Rate $500/mo, Quantity defaults to schedule duration)", unit: "mo", rate: 500, qty: durationMonths },
    { code: "02-9020", desc: "Temp Protection (Rate $0.25/sf, Quantity defaults to project square footage)", unit: "sf", rate: 0.25, qty: squareFootage },
    { code: "02-9405", desc: "Material Hoist / Trash Chute (Rate $6,500/mo, Quantity defaults to duration)", unit: "mo", rate: 6500, qty: durationMonths },
  ];

  const manualRows = [
    { code: "02-9307", desc: "Knox Box (Rate $650/ea)", unit: "ea", rate: 650, val: quantities.knox, field: "knox" as const, isRateEditable: false },
    { code: "02-9010", desc: "Progress Cleaning - Payroll (Rate $74/hr)", unit: "hr", rate: 74, val: quantities.payrollCleaning, field: "payroll" as const, isRateEditable: false },
    { code: "02-9010", desc: "Progress Cleaning - Hired (Rate $54/hr)", unit: "hr", rate: 54, val: quantities.hiredCleaning, field: "hired" as const, isRateEditable: false },
    { code: "02-3200", desc: "Soil Borings (Lump Sum custom overrides)", unit: "ls", rate: rates.soilBorings, val: quantities.soilBorings, field: "soilQty" as const, isRateEditable: true },
  ];

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
              <th className="p-4 text-center w-44 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Override Value</th>
              <th className="p-4 text-center w-40 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Calculated Qty</th>
              <th className="p-4 text-center w-36 border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-border">
            {/* Injected Dynamic Operations */}
            <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
              <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">02.A - Injected Dynamic Operations</td>
            </tr>
            {dynamicRows.map((row, i) => (
              <tr key={row.code + "-" + i} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                <td className={codeCellClass}>{row.code}</td>
                <td className={descCellClass}>{row.desc}</td>
                <td className={unitCellClass}>{row.unit}</td>
                <td className="p-3 text-center border-r border-b border-grid-border text-foreground font-mono">${row.rate.toFixed(2)}</td>
                <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono">auto</td>
                <td className="p-3 text-center border-r border-b border-grid-border font-semibold text-slate-600 dark:text-slate-400 font-mono">{row.qty.toLocaleString()} {row.unit}</td>
                <td className={totalCellClass}>{fmt(calcResult.dynamicLines[i].total)}</td>
              </tr>
            ))}

            {/* Manual Estimation Entries */}
            <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
              <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">02.B - Manual Estimation Entries</td>
            </tr>
            {manualRows.map((row) => (
              <tr key={`${row.code}-${row.field}`} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                <td className={codeCellClass}>{row.code}</td>
                <td className={descCellClass}>{row.desc}</td>
                <td className={unitCellClass}>{row.unit}</td>
                <td className={row.isRateEditable ? "p-0 border-r border-b border-grid-border" : "p-3 text-center border-r border-b border-grid-border font-mono"}>
                  {row.isRateEditable ? (
                    <div className="flex items-center justify-center w-full h-full relative">
                      <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={rates.soilBorings === 0 ? "" : rates.soilBorings}
                        placeholder="0.00"
                        onChange={(e) => onSiteOpsChange("soilRate", e.target.value)}
                      />
                    </div>
                  ) : (
                    <span className="text-foreground">${row.rate.toFixed(2)}</span>
                  )}
                </td>
                <td className="p-0 border-r border-b border-grid-border">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    value={row.val === 0 ? "" : row.val}
                    placeholder="0"
                    onChange={(e) => onSiteOpsChange(row.field as "knox" | "payroll" | "hired" | "soilQty" | "soilRate", e.target.value)}
                  />
                </td>
                <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 font-semibold font-mono">—</td>
                <td className={totalCellClass}>
                  {fmt(row.val * row.rate)}
                </td>
              </tr>
            ))}

            {/* Subtotal Row */}
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
