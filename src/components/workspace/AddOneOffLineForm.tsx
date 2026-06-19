"use client";

import React, { useEffect, useRef, useState } from "react";
import { FilePlus2 } from "lucide-react";
import type { EstimateSectionLine, SectionDiscriminator } from "@/types/db";
import { newOneOffLine, type OneOffEntryKind } from "@/lib/sectionLines/oneOff";

// ---------------------------------------------------------------------------
// AddOneOffLineForm — the "+ One-off line" affordance (Phase B5 / D1).
//
// Title-bar popover on GcPersonnelGridStep (Step 2) / SiteOpsGridStep (Step 3) that creates an
// estimator-authored ONE-OFF line — a generic manual entry NOT in the catalog. It collects the
// description / kind / unit / typed value (+ rate), then mints an UNCODED `source: 'manual'`
// section line (the estimator assigns a valid Procore code in the row's Code cell afterward,
// `OneOffCodeCell`). Two kinds only — Quantity × Rate (`qty`) and Lump sum (`lumpSum`) — so a
// one-off reuses the EXISTING manual-line evaluator with NO new per-line math (ID-4: bespoke
// structured lines are never mintable here). Dismiss uses a container-ref check (SKILL §8 #7).
// ---------------------------------------------------------------------------

interface AddOneOffLineFormProps {
  section: SectionDiscriminator;
  /** Append the new one-off line (drives the grid's undoable `addOneOff`). */
  onAdd: (line: EstimateSectionLine) => void;
}

export function AddOneOffLineForm({ section, onAdd }: AddOneOffLineFormProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [entry, setEntry] = useState<OneOffEntryKind>("qty");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const reset = () => {
    setLabel(""); setEntry("qty"); setUnit(""); setValue(""); setRate(""); setError(null);
  };

  const submit = () => {
    const trimmedLabel = label.trim();
    if (trimmedLabel === "") { setError("Enter a description."); return; }
    const numValue = value === "" ? 0 : parseFloat(value);
    if (!Number.isFinite(numValue) || numValue < 0) { setError("Enter a valid amount."); return; }
    const numRate = rate === "" ? 0 : parseFloat(rate);
    const line = newOneOffLine({
      section,
      label: trimmedLabel,
      unit: unit.trim() || (entry === "lumpSum" ? "ls" : "ea"),
      entry,
      value: numValue,
      rate: entry === "qty" ? (Number.isFinite(numRate) ? numRate : 0) : undefined,
    });
    onAdd(line);
    reset();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="add-one-off-trigger"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/15 dark:hover:bg-sky-950/35 text-sky-700 dark:text-sky-400 border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all text-xs cursor-pointer select-none"
        title="Add a project-specific one-off line"
      >
        <FilePlus2 size={14} /> One-off line
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-card border border-grid-border rounded-lg shadow-lg p-3 w-[320px] text-xs animate-fade-in" onMouseDown={(e) => e.stopPropagation()}>
          <div className="font-bold text-foreground uppercase tracking-wider text-[10px] mb-2">Add one-off line</div>

          <label className="block mb-2">
            <span className="text-slate-500 dark:text-slate-400 font-semibold">Description</span>
            <input
              data-testid="one-off-description"
              value={label}
              onChange={(e) => { setLabel(e.target.value); setError(null); }}
              placeholder="e.g. Site-specific permit fee"
              className="mt-0.5 w-full px-2 py-1 border border-grid-border rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <div className="flex gap-2 mb-2">
            <label className="flex-1">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">Kind</span>
              <select
                data-testid="one-off-kind"
                value={entry}
                onChange={(e) => setEntry(e.target.value as OneOffEntryKind)}
                className="mt-0.5 w-full px-2 py-1 border border-grid-border rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="qty">Quantity &times; Rate</option>
                <option value="lumpSum">Lump sum</option>
              </select>
            </label>
            <label className="w-[84px]">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">Unit</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={entry === "lumpSum" ? "ls" : "ea"}
                className="mt-0.5 w-full px-2 py-1 border border-grid-border rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
              />
            </label>
          </div>

          <div className="flex gap-2 mb-3">
            <label className="flex-1">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">{entry === "lumpSum" ? "Amount ($)" : "Quantity"}</span>
              <input
                data-testid="one-off-value"
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                inputMode="decimal"
                placeholder="0"
                className="mt-0.5 w-full px-2 py-1 border border-grid-border rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono text-right"
              />
            </label>
            {entry === "qty" && (
              <label className="flex-1">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Rate ($)</span>
                <input
                  data-testid="one-off-rate"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-0.5 w-full px-2 py-1 border border-grid-border rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono text-right"
                />
              </label>
            )}
          </div>

          {error && <div className="text-[10px] text-red-600 dark:text-red-400 mb-2">{error}</div>}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">Assign a Procore code in the row to export it.</span>
            <button
              type="button"
              data-testid="one-off-submit"
              onClick={submit}
              className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md px-3 py-1.5 font-bold uppercase transition-all text-xs cursor-pointer select-none"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
