"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Info,
  Terminal,
  Menu,
  FileSpreadsheet,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  PlusCircle,
  RefreshCw,
  Archive,
} from "lucide-react";
import { getProcoreCostCodes, applyProcoreCostCodesImport } from "@/lib/db";
import { parseProcoreCostCodesXLSX } from "@/lib/xlsx-reader";
import {
  validateProcoreImportRows,
  diffProcoreCostCodes,
  buildProcoreCostCodesWorkbookBuffer,
  PROCORE_COST_CODE_TYPES,
  type ProcoreCostCodeDiff,
} from "@/lib/procoreCostCodes";
import type { ProcoreCostCode, ProcoreCostCodeType, ProcoreCostCodeStatus } from "@/types/db";

// ---------------------------------------------------------------------------
// Procore Cost Codes — master-list management page (Phase 2). Sibling of
// /cost-codes and /catalog: a searchable/filterable table of the authoritative
// procore_cost_codes list, with spreadsheet IMPORT (upload → validate → diff
// preview → confirm-apply) and EXPORT (download the live list as the same
// 3-column .xlsx Procore emits).
//
// - All reads/writes route through db.ts (single gateway). The import-apply
//   write is the only mutation; it shows the full diff first and never
//   auto-retires a code missing from the file (architect-locked).
// - UNWIRED to export validation: src/lib/procore-valid-codes.json is still the
//   live oracle until Phase 4. This page only manages the master list.
// ---------------------------------------------------------------------------

const TYPE_BADGES: Record<ProcoreCostCodeType, string> = {
  Labor: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50",
  Material: "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  Subcontract: "bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/50",
  Equipment: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
};

const STATUS_BADGES: Record<ProcoreCostCodeStatus, { label: string; classes: string }> = {
  active: {
    label: "ACTIVE",
    classes: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  },
  retired: {
    label: "RETIRED",
    classes: "bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700",
  },
  merged: {
    label: "MERGED",
    classes: "bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/50",
  },
};

type TypeFilter = "all" | ProcoreCostCodeType;
type ImportPhase = "idle" | "parsing" | "error" | "preview" | "applying" | "done";

export default function ProcoreCostCodesDashboard() {
  const [codes, setCodes] = useState<ProcoreCostCode[] | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showRetired, setShowRetired] = useState(false);

  // Import flow state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPhase, setImportPhase] = useState<ImportPhase>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [diff, setDiff] = useState<ProcoreCostCodeDiff | null>(null);
  const [retireSelections, setRetireSelections] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);

  const loadCodes = async () => {
    const loaded = await getProcoreCostCodes();
    setCodes(loaded);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getProcoreCostCodes();
        if (!cancelled) {
          setCodes(loaded);
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load Procore cost codes:", err);
        if (!cancelled) {
          setCodes([]);
          setLoadError(true);
          setIsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const active = (codes ?? []).filter((c) => c.status === "active");
    const byType: Record<ProcoreCostCodeType, number> = {
      Labor: 0,
      Material: 0,
      Subcontract: 0,
      Equipment: 0,
    };
    for (const c of active) byType[c.type] += 1;
    return {
      byType,
      activeTotal: active.length,
      retiredTotal: (codes ?? []).filter((c) => c.status !== "active").length,
    };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    if (!codes) return [];
    const query = searchQuery.trim().toLowerCase();
    return codes.filter((c) => {
      if (!showRetired && c.status !== "active") return false;
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (!query) return true;
      return (
        c.code.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.type.toLowerCase().includes(query)
      );
    });
  }, [codes, searchQuery, typeFilter, showRetired]);

  // -------------------------------------------------------------------------
  // Import: upload → parse → validate → diff → preview
  // -------------------------------------------------------------------------
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setValidationErrors([]);
    setApplyResult(null);
    setImportPhase("parsing");
    try {
      const raw = await parseProcoreCostCodesXLSX(file);
      const validation = validateProcoreImportRows(raw);
      if (!validation.ok) {
        setValidationErrors(validation.errors);
        setImportPhase("error");
        return;
      }
      const d = diffProcoreCostCodes(codes ?? [], validation.rows);
      setDiff(d);
      setRetireSelections(new Set());
      setImportPhase("preview");
    } catch (err) {
      console.error("Failed to parse Procore cost-code file:", err);
      setImportError(err instanceof Error ? err.message : "Could not read the file.");
      setImportPhase("error");
    }
  };

  const toggleRetire = (code: string) => {
    setRetireSelections((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleAllRetire = () => {
    if (!diff) return;
    setRetireSelections((prev) =>
      prev.size === diff.proposedRetirements.length
        ? new Set()
        : new Set(diff.proposedRetirements.map((c) => c.code)),
    );
  };

  const handleApply = async () => {
    if (!diff) return;
    setImportPhase("applying");
    setImportError(null);
    try {
      // Upsert only the rows that actually change (added + changed/re-activated)
      // — unchanged codes already match, so writing them would needlessly churn
      // updated_at on the whole list every import.
      const upserts = [
        ...diff.added,
        ...diff.changed.map((c) => ({ code: c.code, type: c.to.type, description: c.to.description })),
      ];
      await applyProcoreCostCodesImport({
        upserts,
        retireCodes: [...retireSelections],
      });
      await loadCodes();
      const retired = retireSelections.size;
      setApplyResult(
        `Applied: ${diff.added.length} added, ${diff.changed.length} changed, ${retired} retired.`,
      );
      setImportPhase("done");
      setDiff(null);
      setRetireSelections(new Set());
    } catch (err) {
      console.error("Failed to apply Procore cost-code import:", err);
      setImportError(err instanceof Error ? err.message : "Failed to apply the import.");
      setImportPhase("error");
    }
  };

  const cancelImport = () => {
    setImportPhase("idle");
    setDiff(null);
    setRetireSelections(new Set());
    setValidationErrors([]);
    setImportError(null);
  };

  // -------------------------------------------------------------------------
  // Export: live list (active only) → 3-column .xlsx download
  // -------------------------------------------------------------------------
  const handleExport = async () => {
    if (!codes) return;
    setIsExporting(true);
    try {
      const active = codes
        .filter((c) => c.status === "active")
        .sort((a, b) => a.code.localeCompare(b.code));
      const buffer = await buildProcoreCostCodesWorkbookBuffer(active);
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", "Procore Cost Codes.xlsx");
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export Procore cost codes:", err);
      alert("Failed to build the export file. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  if (!isLoaded || codes === null) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Procore Cost Codes...</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Fetching the master list from secure storage</p>
      </div>
    );
  }

  const allRetireSelected = !!diff && diff.proposedRetirements.length > 0 && retireSelections.size === diff.proposedRetirements.length;

  return (
    <div className="flex flex-col gap-6 selection:bg-blue-100 dark:selection:bg-blue-900/50">
      {/* Header Panel */}
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
              <FileSpreadsheet className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> PROCORE COST CODES
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Master list // Cost Code · Type · Description
            </p>
          </div>
        </div>

        {/* Import / Export controls */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loadError}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-blue-500 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Import a Procore Cost Codes spreadsheet"
          >
            <Upload size={14} /> Import
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || counts.activeTotal === 0}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-grid-border hover:border-blue-500 bg-card text-foreground px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download the live list as a 3-column .xlsx"
          >
            <Download size={14} /> {isExporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Procore Master List</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            The authoritative, type-aware list of every Procore Budget Line Items cost code. Import the Procore export
            spreadsheet to sync it (you&apos;ll preview every add / change / proposed retirement before anything is written),
            or export the live list back out. Codes missing from an imported file are shown as <span className="font-semibold">proposed</span>{" "}
            retirements only — never removed automatically.
          </p>
        </div>
      </div>

      {applyResult && (
        <div className="bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900/50 p-3 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="text-emerald-500 flex-shrink-0" size={18} />
          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">{applyResult}</span>
        </div>
      )}

      {/* KPI Cards: per-type active counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-2">
        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm">
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Active Codes</p>
          <h2 className="text-2xl font-extrabold text-foreground mt-2">{counts.activeTotal}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Live Procore destinations</div>
        </div>
        {PROCORE_COST_CODE_TYPES.map((t) => (
          <div key={t} className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm">
            <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">{t}</p>
            <h2 className="text-2xl font-extrabold text-foreground mt-2">{counts.byType[t]}</h2>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Active {t.toLowerCase()} codes</div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      {loadError ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Terminal size={48} className="text-rose-500 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Master List Unavailable</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            The procore_cost_codes table could not be loaded. Check your connection and reload — import is disabled until
            the live table is reachable.
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-3.5 text-slate-600 dark:text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search by code, description, or type..."
                className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-lg pl-12 pr-4 py-3 text-xs text-foreground outline-none font-sans transition-all focus:bg-white dark:focus:bg-slate-900/40"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="bg-card border border-grid-border focus:border-blue-500 rounded-lg px-4 py-3 text-xs text-foreground outline-none cursor-pointer font-semibold uppercase tracking-wider"
              title="Filter by type"
            >
              <option value="all">All types</option>
              {PROCORE_COST_CODE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 px-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
                className="accent-blue-600 cursor-pointer"
              />
              Show retired ({counts.retiredTotal})
            </label>
          </div>

          {/* Data Table */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-grid-border">
                <thead>
                  <tr className="bg-background/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Cost Code</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Type</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Description</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No codes match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCodes.map((c) => {
                      const statusBadge = STATUS_BADGES[c.status];
                      return (
                        <tr key={c.code} className="group transition-colors">
                          <td className="p-4 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-widest uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {c.code}
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${TYPE_BADGES[c.type]}`}>
                              {c.type.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {c.description}
                            {c.status === "merged" && c.mergedInto && (
                              <span className="ml-2 text-[10px] italic text-violet-600 dark:text-violet-300">→ {c.mergedInto}</span>
                            )}
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${statusBadge.classes}`}>
                              {statusBadge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold px-1">
            Showing {filteredCodes.length} of {codes.length} codes
          </div>
        </div>
      )}

      {/* ─────────────────────────── Import modal ─────────────────────────── */}
      {(importPhase === "parsing" || importPhase === "error" || importPhase === "preview" || importPhase === "applying") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="bg-card border border-grid-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-grid-border">
              <h2 className="text-lg font-extrabold text-foreground flex items-center gap-2">
                <Upload className="text-blue-600 dark:text-blue-400" size={20} /> Import Procore Cost Codes
              </h2>
              <button
                onClick={cancelImport}
                disabled={importPhase === "applying"}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 transition-colors cursor-pointer disabled:opacity-40"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto">
              {importPhase === "parsing" && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <RefreshCw className="text-blue-500 animate-spin" size={32} />
                  <p className="text-sm font-semibold text-foreground">Reading and validating the file…</p>
                </div>
              )}

              {importPhase === "error" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3 bg-rose-50/60 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 rounded-xl p-4">
                    <AlertTriangle className="text-rose-500 mt-0.5 flex-shrink-0" size={18} />
                    <div>
                      <h4 className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                        Import rejected — nothing was written
                      </h4>
                      {importError && <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{importError}</p>}
                      {validationErrors.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc list-inside max-h-60 overflow-y-auto">
                          {validationErrors.slice(0, 50).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                          {validationErrors.length > 50 && <li>…and {validationErrors.length - 50} more.</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(importPhase === "preview" || importPhase === "applying") && diff && (
                <div className="flex flex-col gap-5">
                  {/* Summary chips */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <DiffChip icon={<PlusCircle size={14} />} label="Added" value={diff.added.length} tone="emerald" />
                    <DiffChip icon={<RefreshCw size={14} />} label="Changed" value={diff.changed.length} tone="blue" />
                    <DiffChip icon={<Archive size={14} />} label="Proposed retirements" value={diff.proposedRetirements.length} tone="rose" />
                    <DiffChip icon={<CheckCircle2 size={14} />} label="Unchanged" value={diff.unchanged} tone="slate" />
                  </div>

                  {diff.added.length === 0 && diff.changed.length === 0 && diff.proposedRetirements.length === 0 && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                      The file matches the live list exactly — applying makes no changes.
                    </p>
                  )}

                  {/* Added */}
                  {diff.added.length > 0 && (
                    <DiffSection title={`Added (${diff.added.length})`} tone="emerald">
                      {diff.added.map((r) => (
                        <div key={r.code} className="flex items-center gap-2 py-1 text-[11px]">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400 w-36 shrink-0">{r.code}</span>
                          <span className="w-24 shrink-0 text-slate-500">{r.type}</span>
                          <span className="text-foreground">{r.description}</span>
                        </div>
                      ))}
                    </DiffSection>
                  )}

                  {/* Changed */}
                  {diff.changed.length > 0 && (
                    <DiffSection title={`Changed (${diff.changed.length})`} tone="blue">
                      {diff.changed.map((c) => (
                        <div key={c.code} className="py-1 text-[11px]">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{c.code}</span>
                          <div className="ml-2 text-slate-600 dark:text-slate-400">
                            {c.from.status !== "active" && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">re-activate · </span>
                            )}
                            {c.from.type !== c.to.type && (
                              <span>type {c.from.type} → <span className="font-semibold text-foreground">{c.to.type}</span>{"; "}</span>
                            )}
                            {c.from.description !== c.to.description && (
                              <span>desc &ldquo;{c.from.description}&rdquo; → <span className="font-semibold text-foreground">&ldquo;{c.to.description}&rdquo;</span></span>
                            )}
                          </div>
                        </div>
                      ))}
                    </DiffSection>
                  )}

                  {/* Proposed retirements (opt-in checkboxes) */}
                  {diff.proposedRetirements.length > 0 && (
                    <DiffSection
                      title={`Proposed retirements (${diff.proposedRetirements.length})`}
                      tone="rose"
                      action={
                        <button
                          onClick={toggleAllRetire}
                          disabled={importPhase === "applying"}
                          className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 hover:underline cursor-pointer disabled:opacity-40"
                        >
                          {allRetireSelected ? "Deselect all" : "Select all"}
                        </button>
                      }
                    >
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 italic">
                        These active codes are absent from the file. Tick the ones to retire — unticked codes stay active.
                      </p>
                      {diff.proposedRetirements.map((c) => (
                        <label key={c.code} className="flex items-center gap-2 py-1 text-[11px] cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={retireSelections.has(c.code)}
                            onChange={() => toggleRetire(c.code)}
                            disabled={importPhase === "applying"}
                            className="accent-rose-600 cursor-pointer"
                          />
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400 w-36 shrink-0">{c.code}</span>
                          <span className="w-24 shrink-0 text-slate-500">{c.type}</span>
                          <span className="text-foreground">{c.description}</span>
                        </label>
                      ))}
                    </DiffSection>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-grid-border bg-background/40">
              <button
                onClick={cancelImport}
                disabled={importPhase === "applying"}
                className="text-xs font-bold uppercase tracking-wider rounded-lg border border-grid-border hover:border-slate-400 px-4 py-2.5 text-foreground transition-colors cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              {importPhase === "preview" && diff && (
                <button
                  onClick={handleApply}
                  disabled={diff.added.length === 0 && diff.changed.length === 0 && retireSelections.size === 0}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-blue-500 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Write the upserts and confirmed retirements"
                >
                  <CheckCircle2 size={14} /> Apply{retireSelections.size > 0 ? ` (${retireSelections.size} retire)` : ""}
                </button>
              )}
              {importPhase === "applying" && (
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 px-4 py-2.5">
                  <RefreshCw size={14} className="animate-spin" /> Applying…
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers (local to the page)
// ---------------------------------------------------------------------------

function DiffChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "emerald" | "blue" | "rose" | "slate";
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    blue: "text-blue-600 dark:text-blue-400",
    rose: "text-rose-600 dark:text-rose-400",
    slate: "text-slate-600 dark:text-slate-400",
  };
  return (
    <div className="bg-background border border-grid-border rounded-xl p-3 flex flex-col gap-1">
      <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${tones[tone]}`}>
        {icon} {label}
      </span>
      <span className="text-xl font-extrabold text-foreground">{value}</span>
    </div>
  );
}

function DiffSection({
  title,
  tone,
  action,
  children,
}: {
  title: string;
  tone: "emerald" | "blue" | "rose";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const borders: Record<string, string> = {
    emerald: "border-emerald-200 dark:border-emerald-900/50",
    blue: "border-blue-200 dark:border-blue-900/50",
    rose: "border-rose-200 dark:border-rose-900/50",
  };
  return (
    <div className={`border ${borders[tone]} rounded-xl p-3`}>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground">{title}</h4>
        {action}
      </div>
      <div className="max-h-52 overflow-y-auto divide-y divide-grid-border/50">{children}</div>
    </div>
  );
}
