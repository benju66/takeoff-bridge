import React from "react";
import { Activity, DollarSign, HelpCircle } from "lucide-react";
import { Project } from "@/types/db";

// ---------------------------------------------------------------------------
// ArchitecturalParametersStep — Step 1 Panel
// Pure presentation: receives project + mutation callback
// ---------------------------------------------------------------------------

interface ArchitecturalParametersStepProps {
  project: Project;
  onParamChange: (field: keyof Project, value: string | number) => void;
}

const inputClass = "bg-transparent border border-grid-border rounded-lg px-3 py-2 text-foreground outline-none font-semibold transition-all focus:bg-white dark:focus:bg-slate-900/40 focus:ring-2 focus:ring-blue-500 focus:z-10";
const labelClass = "text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider";

interface FieldConfig {
  label: string;
  field: keyof Project;
  type: "text" | "number" | "date";
  /** For numeric fields — value accessor */
  numericDefault?: number;
}

const fields: FieldConfig[] = [
  { label: "Project Name", field: "name", type: "text" },
  { label: "Location", field: "location", type: "text" },
  { label: "Bid Date", field: "bidDate", type: "text" },
  { label: "Expected Start Date", field: "expectedStart", type: "date" },
  { label: "Expected Finish Date", field: "expectedFinish", type: "date" },
  { label: "Project Size (SF)", field: "squareFootage", type: "number" },
  { label: "Unit Count", field: "unitCount", type: "number" },
  { label: "Building Perimeter (LF)", field: "buildingPerimeter", type: "number", numericDefault: 0 },
  { label: "Building Footprint (SF)", field: "buildingFootprint", type: "number", numericDefault: 0 },
  { label: "Podium Area (SF)", field: "podiumArea", type: "number", numericDefault: 0 },
  { label: "Woodframed Area (SF)", field: "woodframedArea", type: "number", numericDefault: 0 },
  { label: "Levels Above Podium", field: "levelsAbovePodium", type: "number", numericDefault: 0 },
];

export function ArchitecturalParametersStep({
  project,
  onParamChange,
}: ArchitecturalParametersStepProps) {
  return (
    <div className="flex flex-col gap-6 select-none">
      {/* Container 1: Architectural Parameters & Schedule Constraints */}
      <div className="bg-card border border-grid-border text-card-foreground p-6 rounded-xl shadow-sm animate-fade-in">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-6 flex items-center gap-2">
          <Activity size={16} className="text-blue-600 dark:text-blue-400" /> Architectural Parameters & Schedule Constraints
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-sans text-xs">
          {fields.map((f) => {
            const rawValue = project[f.field as keyof Project];
            let displayValue: string | number;

            if (f.type === "date") {
              displayValue = (rawValue as string) || "";
            } else if (f.type === "number") {
              displayValue = (rawValue as number) ?? f.numericDefault ?? 0;
            } else {
              displayValue = rawValue as string;
            }

            return (
              <div key={f.field} className="flex flex-col gap-2">
                <label className={labelClass}>{f.label}</label>
                <input
                  type={f.type}
                  className={inputClass}
                  value={displayValue}
                  onChange={(e) => {
                    if (f.type === "number") {
                      onParamChange(f.field, Math.max(0, parseInt(e.target.value) || 0));
                    } else {
                      onParamChange(f.field, e.target.value);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Container 2: Estimate Pricing & Markup Rules */}
      <div className="bg-card border border-grid-border text-card-foreground p-6 rounded-xl shadow-sm animate-fade-in">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-6 flex items-center gap-2">
          <DollarSign size={16} className="text-blue-600 dark:text-blue-400" /> Estimate Pricing & Markup Rules
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-sans text-xs">
          <div className="flex flex-col gap-2">
            <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
              Overhead Markup Rate (%) <span title="Applied directly to gross estimate subtotal"><HelpCircle size={12} className="text-slate-500" /></span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className={inputClass}
              value={project.overheadRate ?? 10}
              onChange={(e) => onParamChange("overheadRate", parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
              Contractor Fee (%) <span title="Fixed GC fee applied on top of subtotal"><HelpCircle size={12} className="text-slate-500" /></span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className={inputClass}
              value={project.feeRate ?? 5}
              onChange={(e) => onParamChange("feeRate", parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
              General Liability Modifier (%)
            </label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="10"
              className={inputClass}
              value={project.liabilityRate ?? 1}
              onChange={(e) => onParamChange("liabilityRate", parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
              Sales Tax Modifier (%)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="20"
              className={inputClass}
              value={project.taxRate ?? 8.25}
              onChange={(e) => onParamChange("taxRate", parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
              Cell Rounding Rules
            </label>
            <select
              value={project.roundingRule ?? "dollar"}
              onChange={(e) => onParamChange("roundingRule", e.target.value)}
              className="bg-transparent border border-grid-border rounded-lg px-3 py-2 text-foreground font-semibold outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">No Rounding (Display Raw Decimals)</option>
              <option value="dollar">Round to Nearest Integer Dollar ($1)</option>
              <option value="ten">Round to Nearest Ten Dollars ($10)</option>
              <option value="hundred">Round to Nearest Hundred Dollars ($100)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
