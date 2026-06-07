import React from "react";
import { Activity } from "lucide-react";
import { PersonnelCalcResult } from "@/lib/calculations";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// PersonnelPricingStep — Step 2 Panel
// Division 01 General Conditions Pricing Matrix
// Phase 4: full template STEP 2 line coverage — adds Design & Preconstruction
// (01.D), monthly auto lines (01.E), and manual GC entries incl. the two
// %-of-estimate lines with a live suggested amount (01.F).
// ---------------------------------------------------------------------------

interface PersonnelPricingStepProps {
  durationMonths: number;
  squareFootage: number;
  utilizations: Record<string, number>;
  onUtilizationChange: (key: string, value: number) => void;
  equipment: { dumpsters: number; toilets: number; electric: number };
  onEquipmentChange: (field: "dumpsters" | "toilets" | "electric", valStr: string) => void;
  manualEntries: Record<string, number>;
  onManualEntryChange: (key: string, valStr: string) => void;
  /** Phase 6: per-project staff hourly rate overrides keyed by StaffRoleConfig.key */
  rateOverrides: Record<string, number>;
  onRateChange: (key: string, valStr: string) => void;
  onRateReset: (key: string) => void;
  /** Current STEP 4 total estimated cost — drives the % suggestion hints (display only) */
  estimateTotal: number;
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
const autoCellClass = "p-3 text-center border-r border-b border-grid-border text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono";
const inputClass = "w-full h-full min-h-[36px] bg-transparent border-none rounded-none text-center px-3 py-2 outline-none text-foreground focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10 transition-all font-mono";

// Derived from canonical constants — single source of truth
const STAFF_DISPLAY = STAFF_ROLE_DEFAULTS.map((role) => ({
  key: role.key,
  code: role.code,
  role: role.label,
  rate: role.defaultRate,
}));

const fmt = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-bold select-none">
      <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-blue-50/30 dark:bg-blue-950/10 border-r border-b border-grid-border font-semibold">{label}</td>
    </tr>
  );
}

export function PersonnelPricingStep({
  durationMonths,
  squareFootage,
  utilizations,
  onUtilizationChange,
  equipment,
  onEquipmentChange,
  manualEntries,
  onManualEntryChange,
  rateOverrides,
  onRateChange,
  onRateReset,
  estimateTotal,
  calcResult,
  totalGCs,
}: PersonnelPricingStepProps) {
  // Calc-layer line lookup by criterion code (avoids index coupling)
  const opLineByCode = new Map(calcResult.operationalLines.map((l) => [l.code, l]));
  const manualLineByCode = new Map(calcResult.manualLines.map((l) => [l.code, l]));

  const renderManualRows = (section: "design" | "gcManual") =>
    GC_MANUAL_DEFAULTS.filter((cfg) => cfg.section === section).map((cfg) => {
      const line = manualLineByCode.get(cfg.code);
      const val = manualEntries[cfg.key] ?? 0;
      const isQty = cfg.entry === "qty";
      const suggested = cfg.pctHint !== undefined ? cfg.pctHint * estimateTotal : null;
      return (
        <tr key={cfg.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
          <td className={codeCellClass}>{cfg.code}</td>
          <td className={descCellClass}>
            {cfg.label}
            {isQty && ` (Rate $${(cfg.rate ?? 0).toLocaleString()}/${cfg.unit})`}
            {!isQty && cfg.pctHint === undefined && " (Lump Sum — enter total $)"}
            {suggested !== null && (
              <span className="block text-[10px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                Template guidance: {(cfg.pctHint! * 100).toFixed(2)}% of estimate ≈ {fmt(suggested)} — enter the final amount
              </span>
            )}
          </td>
          <td className={unitCellClass}>{cfg.unit}</td>
          <td className={rateCellClass}>{isQty ? `$${(cfg.rate ?? 0).toFixed(2)}` : "—"}</td>
          <td className={inputCellClass}>
            <div className="flex items-center justify-center w-full h-full relative">
              {!isQty && (
                <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
              )}
              <input
                type="number"
                min={0}
                className={inputClass}
                value={val === 0 ? "" : val}
                placeholder={isQty ? "0" : "0.00"}
                onChange={(e) => onManualEntryChange(cfg.key, e.target.value)}
              />
            </div>
          </td>
          <td className={qtyCellClass}>—</td>
          <td className={totalCellClass}>{fmt(line?.total ?? 0)}</td>
        </tr>
      );
    });

  const renderOpRows = (section: "operational" | "gcMonthly") =>
    OPERATIONAL_EXPENSE_DEFAULTS.filter((cfg) => cfg.section === section).map((cfg) => {
      const line = opLineByCode.get(cfg.code);
      return (
        <tr key={cfg.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
          <td className={codeCellClass}>{cfg.code}</td>
          <td className={descCellClass}>{cfg.description}</td>
          <td className={unitCellClass}>{cfg.unit}</td>
          <td className={rateCellClass}>${cfg.rate.toFixed(2)}</td>
          <td className={autoCellClass}>auto</td>
          <td className={qtyCellClass}>{(line?.qty ?? 0).toFixed(2)} {cfg.unit}</td>
          <td className={totalCellClass}>{fmt(line?.total ?? 0)}</td>
        </tr>
      );
    });

  return (
    <div className="bg-card border border-grid-border text-card-foreground rounded-xl overflow-hidden shadow-sm animate-fade-in">
      <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} className="text-blue-600 dark:text-blue-400" /> Division 01 General Conditions Pricing Matrix
        </h3>
        <span className="text-[10px] bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full border border-grid-border font-sans font-semibold">
          Active Schedule Duration: {durationMonths} Months | {squareFootage.toLocaleString()} SF
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
              <th className="p-4 text-center w-44 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Utilization / Entry</th>
              <th className="p-4 text-center w-40 border-r border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Calculated Qty</th>
              <th className="p-4 text-center w-36 border-b border-grid-border font-bold sticky top-0 z-10 bg-[#3057A6]">Total Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-border">
            {/* Staff Labor Directs */}
            <SectionHeader label="01.A - Staff Labour Directs" />
            {STAFF_DISPLAY.map((row, i) => {
              const line = calcResult.staffLines[i];
              const isOverridden = row.key in rateOverrides;
              return (
                <tr key={row.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className={codeCellClass}>{row.code}</td>
                  <td className={descCellClass}>
                    {row.role}
                    {isOverridden && (
                      <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400 mt-0.5">
                        Project rate override — corporate default ${row.rate.toFixed(2)}/hr{" "}
                        <button
                          type="button"
                          className="underline font-semibold hover:text-amber-700 dark:hover:text-amber-300"
                          onClick={() => onRateReset(row.key)}
                        >
                          Reset
                        </button>
                      </span>
                    )}
                  </td>
                  <td className={unitCellClass}>hr</td>
                  <td className={inputCellClass}>
                    <div className="flex items-center justify-center w-full h-full relative">
                      <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                      <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={isOverridden ? rateOverrides[row.key] : ""}
                        placeholder={row.rate.toFixed(2)}
                        onChange={(e) => onRateChange(row.key, e.target.value)}
                      />
                    </div>
                  </td>
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

            {/* Operational Expenses (original auto lines) */}
            <SectionHeader label="01.B - Operational Expenses" />
            {renderOpRows("operational")}

            {/* Site Equipment & Overrides */}
            <SectionHeader label="01.C - Site Equipment & Mobilization Overrides" />
            {EQUIPMENT_DEFAULTS.map((eq) => {
              const val = equipment[eq.key];
              return (
                <tr key={eq.code} className="hover:bg-blue-100/50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className={codeCellClass}>{eq.code}</td>
                  <td className={descCellClass}>{eq.label}</td>
                  <td className={unitCellClass}>ls</td>
                  <td className={qtyCellClass}>—</td>
                  <td className={inputCellClass}>
                    <div className="flex items-center justify-center w-full h-full relative">
                      <span className="absolute left-2.5 text-slate-600 dark:text-slate-400 text-[10px] font-bold pointer-events-none select-none font-mono">$</span>
                      <input
                        type="number"
                        className={inputClass}
                        value={val === 0 ? "" : val}
                        placeholder="0.00"
                        onChange={(e) => onEquipmentChange(eq.key, e.target.value)}
                      />
                    </div>
                  </td>
                  <td className={qtyCellClass}>—</td>
                  <td className={totalCellClass}>{fmt(val)}</td>
                </tr>
              );
            })}

            {/* Phase 4: Design & Preconstruction (template STEP 2 Design section) */}
            <SectionHeader label="01.D - Design & Preconstruction" />
            {renderManualRows("design")}

            {/* Phase 4: monthly auto lines (template duration/sqft formulas) */}
            <SectionHeader label="01.E - General Conditions — Monthly (Auto)" />
            {renderOpRows("gcMonthly")}

            {/* Phase 4: manual GC entries incl. the two %-of-estimate lines */}
            <SectionHeader label="01.F - General Conditions — Manual Entries" />
            {renderManualRows("gcManual")}

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
