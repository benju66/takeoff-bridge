"use client";

import React, { useState, useMemo } from "react";
import { X, Upload, CheckCircle, AlertTriangle, XCircle, ChevronRight, FileSpreadsheet } from "lucide-react";
import { ProcessedTakeoffRow } from "@/types";
import { ArchParamSuggestion } from "@/lib/archParamDetector";
import { PendingImport } from "@/hooks/useFileIngestion";
import { UOM_OPTIONS } from "@/lib/uom-options";

// ---------------------------------------------------------------------------
// ImportPreviewModal — 3-stage enterprise import flow
//
// Stage 1: Upload & Detect (auto-skipped — file already parsed by hook)
// Stage 2: Preview & Validate
// Stage 3: Confirm & Import
// ---------------------------------------------------------------------------

interface ImportPreviewModalProps {
  pendingImport: PendingImport;
  appendData: boolean;
  onImport: (archParams: ArchParamSuggestion[], overriddenRows?: ProcessedTakeoffRow[]) => void;
  onClose: () => void;
  onSheetChange?: (sheetName: string) => void;
}

type ImportStage = "preview" | "confirm";

export function ImportPreviewModal({
  pendingImport,
  appendData,
  onImport,
  onClose,
  onSheetChange,
}: ImportPreviewModalProps) {
  const [stage, setStage] = useState<ImportStage>("preview");
  const [archParams, setArchParams] = useState<ArchParamSuggestion[]>(
    pendingImport.archParamSuggestions,
  );
  const [uomOverrides, setUomOverrides] = useState<Record<number, string>>({});

  // Effective rows with UOM overrides applied (re-matches quantity on override)
  const effectiveRows = useMemo(() => {
    return pendingImport.parsed.map((row, i) => {
      const override = uomOverrides[i];
      if (!override || override === row.uom) return row;
      const matched = row.rawQuantities.find(
        (m) => m.uom?.trim().toUpperCase() === override.toUpperCase(),
      );
      return {
        ...row,
        uom: override,
        matchedQty: matched?.qty ?? 0,
        total: (matched?.qty ?? 0) * row.unitPrice,
      };
    });
  }, [pendingImport.parsed, uomOverrides]);

  // Computed stats — uses effectiveRows to reflect UOM overrides
  const stats = useMemo(() => {
    const total = effectiveRows.length;
    const matched = effectiveRows.filter((r) => r.isMapped).length;
    const unmapped = total - matched;
    // Rows whose imported number was ambiguous and was NOT trusted (Phase 3 / INV-8 #5).
    const review = effectiveRows.filter((r) => r.needsReview).length;
    // A flagged-for-review row already shows qty 0; don't also count it as a UOM mismatch.
    const uomMismatches = effectiveRows.filter(
      (r) => r.isMapped && r.matchedQty === 0 && !r.needsReview,
    ).length;
    return { total, matched, unmapped, uomMismatches, review };
  }, [effectiveRows]);

  const handleToggleArchParam = (index: number) => {
    setArchParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, accepted: !p.accepted } : p)),
    );
  };

  const handleImport = () => {
    const hasOverrides = Object.keys(uomOverrides).length > 0;
    onImport(archParams.filter((p) => p.accepted), hasOverrides ? effectiveRows : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Import Takeoff Data
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {pendingImport.fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Stage Indicator */}
        <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-sm">
          <span
            className={`px-3 py-1 rounded-full font-medium transition-colors ${
              stage === "preview"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            }`}
          >
            1. Preview
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
          <span
            className={`px-3 py-1 rounded-full font-medium transition-colors ${
              stage === "confirm"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            }`}
          >
            2. Confirm
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {stage === "preview" ? (
            <PreviewStage
              pendingImport={pendingImport}
              effectiveRows={effectiveRows}
              uomOverrides={uomOverrides}
              setUomOverrides={setUomOverrides}
              stats={stats}
              archParams={archParams}
              onToggleArchParam={handleToggleArchParam}
              onSheetChange={onSheetChange}
            />
          ) : (
            <ConfirmStage
              stats={stats}
              appendData={appendData}
              archParams={archParams}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-3">
            {stage === "preview" ? (
              <button
                onClick={() => setStage("confirm")}
                className="px-6 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button
                  onClick={() => setStage("preview")}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Import {stats.matched} Rows
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 2: Preview & Validate
// ---------------------------------------------------------------------------

function PreviewStage({
  pendingImport,
  effectiveRows,
  uomOverrides,
  setUomOverrides,
  stats,
  archParams,
  onToggleArchParam,
  onSheetChange,
}: {
  pendingImport: PendingImport;
  effectiveRows: ProcessedTakeoffRow[];
  uomOverrides: Record<number, string>;
  setUomOverrides: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  stats: { total: number; matched: number; unmapped: number; uomMismatches: number; review: number };
  archParams: ArchParamSuggestion[];
  onToggleArchParam: (index: number) => void;
  onSheetChange?: (sheetName: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Sheet selector for multi-sheet XLSX */}
      {pendingImport.sheetNames.length > 1 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Multiple sheets detected:
            </span>
            <select
              value={pendingImport.selectedSheet}
              onChange={(e) => onSheetChange?.(e.target.value)}
              className="text-sm px-3 py-1 rounded-md border border-amber-300 dark:border-amber-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              {pendingImport.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3">
        <StatBadge
          icon={<FileSpreadsheet className="w-4 h-4" />}
          label="Total Rows"
          value={stats.total}
          color="blue"
        />
        <StatBadge
          icon={<CheckCircle className="w-4 h-4" />}
          label="Matched"
          value={stats.matched}
          color="green"
        />
        <StatBadge
          icon={<XCircle className="w-4 h-4" />}
          label="Unmapped"
          value={stats.unmapped}
          color="red"
        />
        <StatBadge
          icon={<AlertTriangle className="w-4 h-4" />}
          label="UOM Mismatch"
          value={stats.uomMismatches}
          color="amber"
        />
        {stats.review > 0 && (
          <StatBadge
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Review #"
            value={stats.review}
            color="amber"
          />
        )}
      </div>

      {/* Architectural Parameters */}
      {archParams.length > 0 && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700">
          <h3 className="text-sm font-bold text-indigo-800 dark:text-indigo-200 mb-3">
            Detected Project Parameters
          </h3>
          <div className="space-y-2">
            {archParams.map((param, i) => (
              <label
                key={i}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={param.accepted}
                  onChange={() => onToggleArchParam(i)}
                  className="w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  {param.label}
                </span>
                <span className="text-sm text-indigo-600 dark:text-indigo-300 font-mono">
                  {param.value.toLocaleString()} {param.uom}
                </span>
                <span className="text-xs text-indigo-400 dark:text-indigo-500">
                  from &quot;{param.classification}&quot;
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Preview table */}
      <div className="border rounded-xl overflow-hidden border-slate-200 dark:border-slate-700">
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Classification
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Detected Code
                </th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Qty
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Source UOM
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Target UOM
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {effectiveRows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-slate-800 dark:text-slate-200 font-medium">
                    {row.classification}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-400">
                    {row.itemId || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200">
                    {row.matchedQty.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-500 dark:text-slate-500">
                    {pendingImport.parsed[i]?.rawQuantities?.[0]?.uom || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {row.isMapped ? (
                      <select
                        value={uomOverrides[i] ?? row.uom}
                        onChange={(e) => setUomOverrides((prev) => ({ ...prev, [i]: e.target.value }))}
                        className="text-xs font-mono font-bold bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-slate-700 dark:text-slate-300 cursor-pointer focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        {UOM_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-mono text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {row.needsReview ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                        title="The imported quantity was ambiguous and was not trusted. Enter the correct value before importing."
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Review #
                      </span>
                    ) : row.isMapped ? (
                      row.matchedQty === 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          UOM Mismatch
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          <CheckCircle className="w-3 h-3" />
                          Matched
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        <XCircle className="w-3 h-3" />
                        Unmapped
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 3: Confirm & Import
// ---------------------------------------------------------------------------

function ConfirmStage({
  stats,
  appendData,
  archParams,
}: {
  stats: { total: number; matched: number; unmapped: number; uomMismatches: number; review: number };
  appendData: boolean;
  archParams: ArchParamSuggestion[];
}) {
  const acceptedParams = archParams.filter((p) => p.accepted);

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          Ready to Import
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Review the summary below before confirming.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SummaryCard label="Rows to merge" value={stats.matched} />
        <SummaryCard label="Unmapped (skipped)" value={stats.unmapped} />
        <SummaryCard label="UOM mismatches" value={stats.uomMismatches} />
        <SummaryCard
          label="Import mode"
          value={appendData ? "Append" : "Replace"}
          isText
        />
      </div>

      {acceptedParams.length > 0 && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700">
          <h4 className="text-sm font-bold text-indigo-800 dark:text-indigo-200 mb-2">
            Project Parameters to Update
          </h4>
          <ul className="space-y-1">
            {acceptedParams.map((p, i) => (
              <li
                key={i}
                className="text-sm text-indigo-700 dark:text-indigo-300 flex items-center gap-2"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {p.label}: {p.value.toLocaleString()} {p.uom}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.unmapped > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            {stats.unmapped} unmapped classification{stats.unmapped !== 1 ? "s" : ""} will be skipped.
            You can map them after import using the Cost Code column.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility components
// ---------------------------------------------------------------------------

function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "blue" | "green" | "red" | "amber";
}) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700",
    green:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700",
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700",
    amber:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700",
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colorMap[color]}`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
      <span className="text-sm font-bold ml-auto">{value}</span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  isText,
}: {
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-bold text-slate-900 dark:text-white ${
          isText ? "text-base" : ""
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
