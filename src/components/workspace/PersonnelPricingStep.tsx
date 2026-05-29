import React from "react";
import { Activity } from "lucide-react";
import { PersonnelCalcResult } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// PersonnelPricingStep — Step 2 Panel
// Division 01 General Conditions Pricing Matrix
// ---------------------------------------------------------------------------

interface PersonnelPricingStepProps {
  durationMonths: number;
  utilizations: Record<string, number>;
  onUtilizationChange: (key: string, value: number) => void;
  equipment: { dumpsters: number; toilets: number; electric: number };
  onEquipmentChange: (field: "dumpsters" | "toilets" | "electric", valStr: string) => void;
  calcResult: PersonnelCalcResult;
  totalGCs: number;
}

// Shared cell classes
const codeCellClass = "p-3 text-center text-blue-600 dark:text-blue-400 font-semibold border-r border-b border-grid-border font-mono";
const descCellClass = "p-3 text-left font-semibold text-foreground border-r border-b border-grid-border";
const unitCellClass = "p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono";
const rateCellClass = "p-3 text-center border-r border-b border-grid-border text-foreground font-mono";
const qtyCellClass = "p-3 text-center border-r border-b border-grid-border font-semibold text-slate-600 dark:text-slate-400 font-mono";
const totalCellClass = "p-3 text-center border-b border-grid-border text-emerald-600 dark:text-emerald-400 font-bold font-mono";
const inputCellClass = "p-0 border-r border-b border-grid-border";
const inputClass = "w-full h-full min-h-[36px] bg-transparent border-none rounded-none text-center px-3 py-2 outline-none text-foreground focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10 transition-all font-mono";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const staffRoleKeys = ["ex", "srPm", "pm", "pe", "srSu", "su", "asstSu", "pa"] as const;

// Static role display config
const STAFF_DISPLAY: Array<{ key: typeof staffRoleKeys[number]; code: string; role: string; rate: number }> = [
  { key: "ex", code: "01-0310", role: "Project Executive", rate: 175 },
  { key: "srPm", code: "01-0320", role: "Sr Project Manager", rate: 135 },
  { key: "pm", code: "01-0330", role: "Project Manager", rate: 120 },
  { key: "pe", code: "01-0340", role: "Project Engineer", rate: 85 },
  { key: "srSu", code: "01-0410", role: "Sr Superintendent", rate: 125 },
  { key: "su", code: "01-0420", role: "Superintendent", rate: 110 },
  { key: "asstSu", code: "01-0430", role: "Asst. Superintendent", rate: 85 },
  { key: "pa", code: "01-0510", role: "Project Assistant", rate: 55 },
];

const OPS_DISPLAY: Array<{ code: string; desc: string; unit: string; rate: number }> = [
  { code: "01-1000", desc: "Small Tools (Bound to Superintendent)", unit: "mo", rate: 500 },
  { code: "01-1200", desc: "Fuel and Vehicle Charges (Bound to Superintendent)", unit: "mo", rate: 1200 },
  { code: "01-5111", desc: "Cell Phone (Fixed Baseline)", unit: "mo", rate: 135 },
];

const EQ_DISPLAY: Array<{ code: string; desc: string; field: "dumpsters" | "toilets" | "electric" }> = [
  { code: "01-5130", desc: "Dumpsters (Lump Sum)", field: "dumpsters" },
  { code: "01-5140", desc: "Temp Toilets (Lump Sum)", field: "toilets" },
  { code: "01-5170", desc: "Temp Electric (Lump Sum)", field: "electric" },
];

const fmt = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PersonnelPricingStep({
  durationMonths,
  utilizations,
  onUtilizationChange,
  equipment,
  onEquipmentChange,
  calcResult,
  totalGCs,
}: PersonnelPricingStepProps) {
  return (
    <div className="bg-card border border-grid-border text-card-foreground rounded-xl overflow-hidden shadow-sm animate-fade-in">
      <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} className="text-blue-600 dark:text-blue-400" /> Division 01 General Conditions Pricing Matrix
        </h3>
        <span className="text-[10px] bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full border border-grid-border font-sans font-semibold">
          Active Schedule Duration: {durationMonths} Months
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-separate border-spacing-0 font-sans">
          <thead>
            <tr className="bg-[#3057A6] text-white uppercase tracking-wider font-bold text-[13px]">
              <th className="p-4 text-center w-28 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Code</th>
              <th className="p-4 text-center border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Staff Role / Operational Scope</th>
              <th className="p-4 text-center w-20 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Unit</th>
              <th className="p-4 text-center w-32 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Rate</th>
              <th className="p-4 text-center w-44 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Utilization</th>
              <th className="p-4 text-center w-40 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Calculated Qty</th>
              <th className="p-4 text-center w-36 border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-border">
            {/* Staff Labor Directs */}
            <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
              <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">01.A - Staff Labour Directs</td>
            </tr>
            {STAFF_DISPLAY.map((row, i) => {
              const line = calcResult.staffLines[i];
              return (
                <tr key={row.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className={codeCellClass}>{row.code}</td>
                  <td className={descCellClass}>{row.role}</td>
                  <td className={unitCellClass}>hr</td>
                  <td className={rateCellClass}>${row.rate.toFixed(2)}</td>
                  <td className={inputCellClass}>
                    <div className="flex items-center justify-center w-full h-full relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={inputClass}
                        value={utilizations[row.key] ?? 0}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                          onUtilizationChange(row.key, v);
                        }}
                      />
                      <span className="absolute right-2 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">%</span>
                    </div>
                  </td>
                  <td className={qtyCellClass}>{line.qty.toFixed(1)} hrs</td>
                  <td className={totalCellClass}>{fmt(line.total)}</td>
                </tr>
              );
            })}

            {/* Operational Expenses */}
            <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
              <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">01.B - Operational Expenses</td>
            </tr>
            {OPS_DISPLAY.map((row, i) => {
              const line = calcResult.operationalLines[i];
              return (
                <tr key={row.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className={codeCellClass}>{row.code}</td>
                  <td className={descCellClass}>{row.desc}</td>
                  <td className={unitCellClass}>{row.unit}</td>
                  <td className={rateCellClass}>${row.rate.toFixed(2)}</td>
                  <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono">auto</td>
                  <td className={qtyCellClass}>{line.qty.toFixed(2)} mos</td>
                  <td className={totalCellClass}>{fmt(line.total)}</td>
                </tr>
              );
            })}

            {/* Site Equipment & Overrides */}
            <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
              <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">01.C - Site Equipment & Mobilization Overrides</td>
            </tr>
            {EQ_DISPLAY.map((row) => {
              const val = equipment[row.field];
              return (
                <tr key={row.code + "-" + row.field} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className={codeCellClass}>{row.code}</td>
                  <td className={descCellClass}>{row.desc}</td>
                  <td className={unitCellClass}>ls</td>
                  <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 font-semibold font-mono">—</td>
                  <td className={inputCellClass}>
                    <div className="flex items-center justify-center w-full h-full relative">
                      <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={val === 0 ? "" : val}
                        placeholder="0.00"
                        onChange={(e) => onEquipmentChange(row.field, e.target.value)}
                      />
                    </div>
                  </td>
                  <td className="p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 font-semibold font-mono">—</td>
                  <td className={totalCellClass}>{fmt(val)}</td>
                </tr>
              );
            })}

            {/* Subtotal Row */}
            <tr className="bg-background/80 dark:bg-slate-900/80 border-t border-grid-border text-xs font-bold text-foreground">
              <td className="p-4 text-center border-r border-b border-grid-border font-bold">TOTAL</td>
              <td colSpan={5} className="p-4 text-left uppercase tracking-wider text-[10px] text-slate-600 dark:text-slate-400 border-r border-b border-grid-border font-bold">Cumulative Division 01 General Conditions Cost</td>
              <td className="p-4 text-right text-emerald-600 dark:text-emerald-400 text-sm font-black border-b border-grid-border font-mono">
                {fmt(totalGCs)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
