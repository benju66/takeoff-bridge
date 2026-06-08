"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Search,
  Info,
  Terminal,
  CheckCircle2,
  Menu,
  DollarSign,
  PenLine,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import { getRateCard, updateRateCardEntry } from "@/lib/db";
import { primeRateCard } from "@/lib/rateResolver";
import {
  groupRateCardRows,
  parseRateInput,
  RATE_LINE_DEFS,
} from "@/lib/rateCardEditor";
import { RateCardEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// Company Rate Card editor (Rate-card slice 1, Phase C) — twin of /cost-codes.
// Global view/edit of the rate_card table: the company-DEFAULT rate for each
// rate-bearing GC/Site Ops line, keyed by the constants.ts line `code`.
//
// - Editing a rate affects FUTURE projects only. Existing estimates are frozen
//   by their per-project rate_card_snapshot (proven in Phase B) — a card edit
//   never moves a saved total.
// - All writes route through db.ts/updateRateCardEntry (single gateway), which
//   stamps source='manual' and validates finite >= 0. The UI mirrors that gate
//   (parseRateInput) so no invalid value is ever sent. The seed script is
//   insert-only; this editor is the SOLE update path for an existing rate.
// - After a successful save we re-fetch the card and re-prime the
//   resolveCompanyRate chokepoint, and we re-prime on visibilitychange so an
//   edit in another tab propagates here too (mirrors /cost-codes).
// ---------------------------------------------------------------------------

const SOURCE_BADGES: Record<RateCardEntry["source"], { label: string; classes: string }> = {
  seed: {
    label: "SEED",
    classes: "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  },
  manual: {
    label: "MANUAL",
    classes: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  },
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function RateCardDashboard() {
  const [entries, setEntries] = useState<RateCardEntry[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  /** lineCode of the row whose rate input is currently mounted */
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  // Suppresses the blur-save that the input's unmount fires after an Enter-save
  // or an Escape-cancel (the draft is already committed / discarded by then).
  const skipBlurRef = useRef(false);

  // Load + (re)prime the company card. Reused on mount and on visibilitychange
  // so a /rates edit in another tab — or the seed/backfill — is reflected here.
  const loadCard = useCallback(async (): Promise<boolean> => {
    const loaded = await getRateCard(MASTER_TEMPLATE_NAME);
    setEntries(loaded);
    primeRateCard(loaded);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadCard();
        if (!cancelled) setIsLoaded(true);
      } catch (err) {
        console.error("Failed to load rate card:", err);
        if (!cancelled) {
          setEntries([]);
          setLoadError(true);
          setIsLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadCard]);

  // Re-prime on refocus (mirror /cost-codes resolver wiring): pull the latest
  // card so the resolver and this view stay consistent with other tabs.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadCard().catch((err) => console.error("Rate card re-prime failed:", err));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadCard]);

  const beginEdit = (entry: RateCardEntry) => {
    skipBlurRef.current = false;
    setEditingCode(entry.lineCode);
    setDraftValue(String(entry.rate));
  };

  const cancelEdit = () => {
    skipBlurRef.current = true; // swallow the unmount blur
    setEditingCode(null);
    setDraftValue("");
  };

  const handleRateSave = async (entry: RateCardEntry) => {
    // Mirror the db.ts gate in the UI: reject anything that isn't finite >= 0
    // BEFORE attempting a write (no unvalidated financial value leaves the page).
    const parsed = parseRateInput(draftValue);
    if (parsed === null) {
      alert(`"${draftValue}" is not a valid rate. Enter a number greater than or equal to 0.`);
      return;
    }
    if (parsed === entry.rate) {
      cancelEdit();
      return;
    }

    skipBlurRef.current = true; // commit in progress — swallow the unmount blur
    setSavingCode(entry.lineCode);
    try {
      await updateRateCardEntry(MASTER_TEMPLATE_NAME, entry.lineCode, parsed);
      // Re-fetch + re-prime so this view and the resolveCompanyRate chokepoint
      // both reflect the persisted card (plan §5.4).
      await loadCard();
      setSaveSuccess(entry.lineCode);
      setTimeout(() => setSaveSuccess((c) => (c === entry.lineCode ? null : c)), 3000);
    } catch (err) {
      console.error(`Failed to update rate for ${entry.lineCode}:`, err);
      alert(`Failed to save the rate for ${entry.lineCode}. The previous rate is unchanged. Please try again.`);
    } finally {
      setSavingCode(null);
      cancelEdit();
    }
  };

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((e) => {
      const def = RATE_LINE_DEFS.get(e.lineCode);
      return (
        e.lineCode.toLowerCase().includes(query) ||
        (def?.label.toLowerCase().includes(query) ?? false) ||
        (def?.unit.toLowerCase().includes(query) ?? false) ||
        e.source.toLowerCase().includes(query)
      );
    });
  }, [entries, searchQuery]);

  const groups = useMemo(() => groupRateCardRows(filteredEntries), [filteredEntries]);

  if (!isLoaded || entries === null) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Company Rate Card...</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Fetching live rate table from secure storage</p>
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
              <DollarSign className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> COMPANY RATE CARD
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Default GC / Site Ops Rates // {MASTER_TEMPLATE_NAME}
            </p>
          </div>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Future Projects Only</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            This table holds the company DEFAULT rate for each rate-bearing General Conditions and Site Operations line.
            Editing a rate changes it for projects created AFTER the edit — existing estimates are frozen by their own
            point-in-time rate snapshot and never move. A per-project staff rate override (set on a project) still wins on
            top of the card. Edits are stamped MANUAL and are never overwritten by a re-seed.
          </p>
        </div>
      </div>

      {/* KPI Cards Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <DollarSign size={40} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Rate Lines</p>
          <h2 className="text-2xl font-extrabold text-foreground mt-2">{entries.length}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Rate-bearing GC / Site Ops default lines</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <PenLine size={40} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Manual Overrides</p>
          <h2 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">{manualCount}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Rates edited from the company default</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Layers size={40} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Sections</p>
          <h2 className="text-2xl font-extrabold text-cyan-600 dark:text-cyan-400 mt-2">{groups.length}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Template subtotal groups shown</div>
        </div>
      </div>

      {/* Main Content Area */}
      {loadError ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Terminal size={48} className="text-rose-500 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Rate Card Unavailable</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            The live rate_card table could not be loaded. Check your connection and reload — no edits are possible until
            the live table is reachable.
          </p>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-600 dark:text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by code, line description, unit, or source (seed / manual)..."
              className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-lg pl-12 pr-4 py-3 text-xs text-foreground outline-none font-sans transition-all focus:bg-white dark:focus:bg-slate-900/40"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {groups.length === 0 ? (
            <div className="bg-card border border-grid-border rounded-xl shadow-sm p-8 text-center text-slate-600 dark:text-slate-400 italic">
              No rate lines match the query: &quot;{searchQuery}&quot;
            </div>
          ) : (
            groups.map((group) => {
              const isUnmatched = group.id === "__unmatched__";
              return (
                <div key={group.id} className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
                  <div className={`px-4 py-3 border-b border-grid-border flex items-center gap-2 ${isUnmatched ? "bg-rose-50/50 dark:bg-rose-950/10" : "bg-background/80 dark:bg-slate-900/80"}`}>
                    {isUnmatched && <AlertTriangle size={14} className="text-rose-500 shrink-0" />}
                    <h3 className={`text-xs font-bold uppercase tracking-wider ${isUnmatched ? "text-rose-700 dark:text-rose-400" : "text-foreground"}`}>
                      {group.label}
                    </h3>
                    <span className="text-[10px] text-slate-500 font-mono ml-auto">{group.rows.length}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-separate border-spacing-0 border-l border-grid-border">
                      <thead>
                        <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                          <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-40">Code</th>
                          <th className="p-4 border-r border-b border-grid-border font-semibold">Line Description</th>
                          <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-20">Unit</th>
                          <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-56">Rate (Click to Edit)</th>
                          <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-28">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map(({ entry, def }) => {
                          const badge = SOURCE_BADGES[entry.source] || SOURCE_BADGES.seed;
                          const isSaving = savingCode === entry.lineCode;
                          const isEditing = editingCode === entry.lineCode;
                          const justSaved = saveSuccess === entry.lineCode;

                          return (
                            <tr key={entry.lineCode} className="group transition-colors">
                              <td className="p-4 text-center font-bold text-blue-600 dark:text-blue-400 font-mono tracking-wide border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                                {entry.lineCode}
                              </td>
                              <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                                {def ? def.label : <span className="italic text-rose-500">No current line definition</span>}
                              </td>
                              <td className="p-4 text-center text-slate-600 dark:text-slate-400 font-mono uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                                {def?.unit || "—"}
                              </td>
                              <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                                <div className="flex items-center justify-center gap-2">
                                  {isEditing ? (
                                    <input
                                      autoFocus
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      inputMode="decimal"
                                      value={draftValue}
                                      disabled={isSaving}
                                      onChange={(e) => setDraftValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRateSave(entry);
                                        if (e.key === "Escape") cancelEdit();
                                      }}
                                      onBlur={() => {
                                        if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                                        if (!isSaving) handleRateSave(entry);
                                      }}
                                      className="text-xs font-mono rounded-md border border-blue-500 px-2 py-2 bg-card text-right outline-none focus:ring-2 focus:ring-blue-500 text-foreground disabled:opacity-50 disabled:cursor-wait w-32"
                                      title={`New rate for ${entry.lineCode}`}
                                    />
                                  ) : (
                                    <button
                                      onClick={() => beginEdit(entry)}
                                      disabled={isSaving}
                                      className="flex items-center gap-2 text-xs font-mono font-bold rounded-md border border-grid-border hover:border-blue-500 px-3 py-2 bg-card text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait w-32 justify-between"
                                      title={`Click to change the rate for ${entry.lineCode}`}
                                    >
                                      <span>{isSaving ? "Saving…" : currency.format(entry.rate)}</span>
                                      <PenLine size={12} className="text-slate-400 shrink-0" />
                                    </button>
                                  )}
                                  {justSaved && (
                                    <CheckCircle2 size={16} className="text-emerald-500 animate-pulse shrink-0" />
                                  )}
                                </div>
                              </td>
                              <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                                <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${badge.classes}`}>
                                  {badge.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}

          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              Rate changes apply to projects created after the edit. Existing estimates keep the rates frozen in their
              snapshot until an estimator chooses to refresh them.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
