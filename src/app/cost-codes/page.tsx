"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  Info,
  Terminal,
  CheckCircle2,
  Menu,
  Sigma,
  PenLine,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import { getCostCodeMap, updateCostCodeMapping } from "@/lib/db";
import { primeCostCodeResolver } from "@/lib/costCodeResolver";
import {
  PROCORE_VALID_CODES,
  PROCORE_CODE_DESCRIPTIONS,
  isValidProcoreCode,
} from "@/lib/procoreValidCodes";
import { CostCodeMapEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// Cost Code Mapping editor (Phase 3c) — global view/edit of cost_code_map,
// the app-owned internal → granular Procore code mapping that the
// resolveProcoreCode chokepoint serves at row-creation time.
//
// - Every edit is validated against the Procore Importer Data Fields valid-code
//   list (src/lib/procoreValidCodes.ts — same oracle as the export override
//   modal). Nothing outside that list can ever be persisted (AGENTS.md).
// - All writes route through db.ts/updateCostCodeMapping (single gateway) and
//   are stamped source='manual'. The seed script is insert-only; this editor
//   is the SOLE update path for existing mappings.
// - Edits apply to rows created/re-derived AFTER the change (itemId edits, CSV
//   imports, new workspaces). Existing saved line items keep their persisted
//   code until touched.
// - Only the row being edited mounts its <select> (224 options); all other
//   rows render a lightweight button — keeps the 221-row table snappy.
// ---------------------------------------------------------------------------

const SOURCE_BADGES: Record<CostCodeMapEntry["source"], { label: string; classes: string }> = {
  template: {
    label: "TEMPLATE",
    classes: "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  },
  sibling: {
    label: "SIBLING",
    classes: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50",
  },
  manual: {
    label: "MANUAL",
    classes: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  },
};

export default function CostCodeMappingDashboard() {
  const [entries, setEntries] = useState<CostCodeMapEntry[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  /** internalCode of the row whose <select> is currently mounted */
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Load the live mapping on mount (single gateway: db.ts)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getCostCodeMap(MASTER_TEMPLATE_NAME);
        if (!cancelled) {
          setEntries(loaded);
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load cost code map:", err);
        if (!cancelled) {
          setEntries([]);
          setLoadError(true);
          setIsLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleMappingChange = async (internalCode: string, newProcoreCode: string) => {
    if (!entries) return;
    const entry = entries.find((e) => e.internalCode === internalCode);
    if (!entry || entry.procoreCode === newProcoreCode) {
      setEditingCode(null);
      return;
    }

    // Hard validation gate: only codes on the Procore Importer list persist.
    if (!isValidProcoreCode(newProcoreCode)) {
      alert(`"${newProcoreCode}" is not a valid Procore code (Importer Data Fields list). Edit rejected.`);
      return;
    }

    setSavingCode(internalCode);
    try {
      const updated = await updateCostCodeMapping(MASTER_TEMPLATE_NAME, internalCode, newProcoreCode);
      // Update local state only after the DB write succeeds (registry pattern),
      // and re-prime the resolveProcoreCode chokepoint so a workspace mounted
      // in THIS session picks the edit up without relying on remount/refocus.
      const next = entries.map((e) => (e.internalCode === internalCode ? updated : e));
      setEntries(next);
      primeCostCodeResolver(next);
      setSaveSuccess(internalCode);
      setTimeout(() => setSaveSuccess((current) => (current === internalCode ? null : current)), 3000);
    } catch (err) {
      console.error(`Failed to update mapping for ${internalCode}:`, err);
      alert(`Failed to save the mapping for ${internalCode}. The previous mapping is unchanged. Please try again.`);
    } finally {
      setSavingCode(null);
      setEditingCode(null);
    }
  };

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((e) => {
      const internalDescription = ESTIMATE_ITEMS_MASTER[e.internalCode]?.description || "";
      const procoreDescription = PROCORE_CODE_DESCRIPTIONS.get(e.procoreCode) || "";
      return (
        e.internalCode.toLowerCase().includes(query) ||
        internalDescription.toLowerCase().includes(query) ||
        e.procoreCode.toLowerCase().includes(query) ||
        procoreDescription.toLowerCase().includes(query) ||
        e.source.toLowerCase().includes(query)
      );
    });
  }, [entries, searchQuery]);

  // Divergence diagnostic: catalog itemIds with NO cost_code_map row resolve
  // to "" at row creation (export blocker) and are editable nowhere — surface
  // them here so the gap is visible before it bites at export time.
  const catalogCodesMissingFromMap = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const mapped = new Set(entries.map((e) => e.internalCode));
    return Object.keys(ESTIMATE_ITEMS_MASTER).filter((id) => !mapped.has(id)).sort();
  }, [entries]);

  if (!isLoaded || entries === null) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Cost Code Mapping...</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Fetching live mapping table from secure storage</p>
      </div>
    );
  }

  const manualCount = entries.filter((e) => e.source === "manual").length;

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
              <Sigma className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> COST CODE MAPPING
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Internal Catalog → Procore Budget Line Items // {MASTER_TEMPLATE_NAME}
            </p>
          </div>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Live Mapping Authority</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            This table controls which Procore Budget Line Items code receives the dollars for each internal cost code.
            Every edit is validated against Procore&apos;s official Importer list ({PROCORE_VALID_CODES.length} codes) and takes effect
            for rows created or re-mapped after the change — existing saved estimate rows keep their current code until
            they are touched. Edits are stamped MANUAL and are never overwritten by template re-harvests.
          </p>
        </div>
      </div>

      {/* Catalog ↔ map divergence warning */}
      {catalogCodesMissingFromMap.length > 0 && (
        <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
          <AlertTriangle className="text-rose-500 mt-0.5 flex-shrink-0 animate-pulse" size={18} />
          <div>
            <h4 className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
              {catalogCodesMissingFromMap.length} catalog code{catalogCodesMissingFromMap.length === 1 ? "" : "s"} missing from the mapping table
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
              These internal codes exist in the item catalog but have no Procore destination here, so new rows using them
              will block at export until resolved. Re-run the seed (npm run generate-seed → apply SQL) to add them:&nbsp;
              <span className="font-mono font-bold">{catalogCodesMissingFromMap.slice(0, 12).join(", ")}{catalogCodesMissingFromMap.length > 12 ? ", …" : ""}</span>
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sigma size={40} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Active Mappings</p>
          <h2 className="text-2xl font-extrabold text-foreground mt-2">{entries.length}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Internal codes with a Procore destination</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <PenLine size={40} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Manual Overrides</p>
          <h2 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">{manualCount}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Mappings edited by an estimator</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ShieldCheck size={40} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Valid Procore Codes</p>
          <h2 className="text-2xl font-extrabold text-cyan-600 dark:text-cyan-400 mt-2">{PROCORE_VALID_CODES.length}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Importer Data Fields validation oracle</div>
        </div>
      </div>

      {/* Main Content Area */}
      {loadError ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Terminal size={48} className="text-rose-500 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Mapping Table Unavailable</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            The live cost_code_map table could not be loaded. Check your connection and reload — no edits are possible
            until the live table is reachable.
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-600 dark:text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by internal code, description, Procore code, or source (template / sibling / manual)..."
              className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-lg pl-12 pr-4 py-3 text-xs text-foreground outline-none font-sans transition-all focus:bg-white dark:focus:bg-slate-900/40"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Data Table */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-grid-border">
                <thead>
                  <tr className="bg-background/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Internal Code</th>
                    <th className="p-4 text-center w-80 border-r border-b border-grid-border font-semibold">Item Description</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Procore Code (Click to Edit)</th>
                    <th className="p-4 text-center w-72 border-r border-b border-grid-border font-semibold">Procore Description</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No mappings match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry) => {
                      const internalDescription = ESTIMATE_ITEMS_MASTER[entry.internalCode]?.description || "—";
                      const procoreDescription = PROCORE_CODE_DESCRIPTIONS.get(entry.procoreCode);
                      const badge = SOURCE_BADGES[entry.source] || SOURCE_BADGES.template;
                      const isLegacyCode = !isValidProcoreCode(entry.procoreCode);
                      const isSaving = savingCode === entry.internalCode;
                      const isEditing = editingCode === entry.internalCode;
                      const justSaved = saveSuccess === entry.internalCode;

                      return (
                        <tr key={entry.internalCode} className="group transition-colors">
                          <td className="p-4 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-widest uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {entry.internalCode}
                          </td>
                          <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {internalDescription}
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <div className="flex items-center justify-center gap-2">
                              {isEditing ? (
                                // Only the active row mounts the 224-option select
                                <select
                                  autoFocus
                                  value={entry.procoreCode}
                                  disabled={isSaving}
                                  onChange={(e) => handleMappingChange(entry.internalCode, e.target.value)}
                                  onBlur={() => { if (!isSaving) setEditingCode(null); }}
                                  className="text-xs font-mono rounded-md border border-blue-500 px-2 py-2 bg-card cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 text-foreground disabled:opacity-50 disabled:cursor-wait w-44"
                                  title={`Procore destination for ${entry.internalCode}`}
                                >
                                  {/* Legacy out-of-list value: shown so the select never blanks; not re-selectable */}
                                  {isLegacyCode && (
                                    <option value={entry.procoreCode} disabled>
                                      {entry.procoreCode} (not on Importer list)
                                    </option>
                                  )}
                                  {PROCORE_VALID_CODES.map((opt) => (
                                    <option key={opt.code} value={opt.code}>
                                      {opt.code}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  onClick={() => setEditingCode(entry.internalCode)}
                                  disabled={isSaving}
                                  className="flex items-center gap-2 text-xs font-mono font-bold rounded-md border border-grid-border hover:border-blue-500 px-3 py-2 bg-card text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait w-44 justify-between"
                                  title={`Click to change the Procore destination for ${entry.internalCode}`}
                                >
                                  <span>{isSaving ? "Saving…" : entry.procoreCode}</span>
                                  <PenLine size={12} className="text-slate-400 shrink-0" />
                                </button>
                              )}
                              {justSaved && (
                                <CheckCircle2 size={16} className="text-emerald-500 animate-pulse shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-slate-600 dark:text-slate-400 font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {procoreDescription || <span className="italic text-rose-500">Not on Importer list</span>}
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${badge.classes}`}>
                              {badge.label}
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

          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              Mapping changes apply to rows created or re-mapped after the edit. Already-saved estimate rows keep their
              persisted Procore code until an estimator touches them (item code edit or CSV re-import).
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
