"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Info,
  Terminal,
  CheckCircle2,
  Menu,
  Boxes,
  PenLine,
  Archive,
  GitMerge,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  getCustomStep23LineDefs,
  updateCustomStep23LineDef,
  retireCustomStep23LineDef,
  mergeCustomStep23LineDef,
  getImportedStep23History,
} from "@/lib/db";
import {
  activeStep23Defs,
  resolveStep23Line,
  type Step23LineDef,
  type Step23HistorySource,
} from "@/lib/step23Normalization";
import { isActive } from "@/lib/catalogLifecycle";
import {
  PROCORE_VALID_CODES,
  PROCORE_CODE_DESCRIPTIONS,
  isValidProcoreCode,
} from "@/lib/procoreValidCodes";
import type { CustomStep23LineDef } from "@/types/db";

// ---------------------------------------------------------------------------
// Catalog Manager (roadmap item 4, Phase 3) — the admin surface for the custom
// GC/Site-Ops codes minted at the import review gate. Twins the /cost-codes
// idiom: a searchable table with inline editing, all writes routed through the
// db.ts lifecycle surface (single gateway) that mirrors the DB guard trigger.
//
// - Edit name/unit/Procore BLI on an ACTIVE code (the scope-2 BLI backfill is
//   the Procore picker → updateCustomStep23LineDef). The Procore picker is
//   validated against the same Importer Data Fields oracle as /cost-codes.
// - Retire an active code: it leaves every dropdown (activeStep23Defs drops it)
//   but keeps labeling its old lines through the resolver — a tombstone, never
//   a delete. The suffix is never reused.
// - Merge an active code into a winner (built-in or active custom): every
//   stored bid that referenced the loser renders the winner at render time —
//   no imported payload is rewritten. The advisory "N imported bids currently
//   resolve here" count is mined FAIL-SOFT from the STEP 2/3 history; an outage
//   degrades to no count, never an error and never a block.
//
// Codes are labels, resolver targets, and mining keys — NOTHING on this page
// ever moves a dollar (architect-locked 2026-06-11).
// ---------------------------------------------------------------------------

const SOURCE_BADGES: Record<CustomStep23LineDef["source"], { label: string; classes: string }> = {
  import_gate: {
    label: "IMPORT GATE",
    classes: "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  },
  manual: {
    label: "MANUAL",
    classes: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
  },
};

const STATUS_BADGES: Record<"active" | "retired" | "merged", { label: string; classes: string }> = {
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

/**
 * Inline text editor for the name / unit cells. Click to edit, commit on Enter
 * or blur, Esc cancels. Only the active row mounts an <input>; all others
 * render a lightweight button (the /cost-codes "edit on demand" pattern).
 */
function InlineTextCell({
  value,
  placeholder,
  mono,
  disabled,
  title,
  onCommit,
}: {
  value: string;
  placeholder: string;
  mono?: boolean;
  disabled: boolean;
  title: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Commit happens on blur only; Enter blurs to commit, Escape blurs to cancel.
  // This keeps the write single-fire (Enter no longer races the blur handler).
  const cancelledRef = useRef(false);

  const begin = () => {
    setDraft(value);
    cancelledRef.current = false;
    setEditing(true);
  };
  const finish = () => {
    setEditing(false);
    if (!cancelledRef.current && draft.trim() !== value.trim()) onCommit(draft);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelledRef.current = true;
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        className={`w-full bg-card border border-blue-500 rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${mono ? "font-mono" : ""}`}
        title={title}
      />
    );
  }

  return (
    <button
      onClick={begin}
      disabled={disabled}
      className={`w-full text-left flex items-center justify-between gap-2 rounded-md border border-transparent hover:border-blue-500 px-2 py-1.5 text-xs text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait ${mono ? "font-mono" : ""}`}
      title={`Click to edit — ${title}`}
    >
      <span className={value ? "" : "italic text-slate-400"}>{value || placeholder}</span>
      <PenLine size={11} className="text-slate-400 shrink-0" />
    </button>
  );
}

export default function CatalogManagerDashboard() {
  const [entries, setEntries] = useState<CustomStep23LineDef[] | null>(null);
  const [history, setHistory] = useState<Step23HistorySource[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  /** code of the row whose Procore <select> is currently mounted */
  const [editingProcore, setEditingProcore] = useState<string | null>(null);
  /** code of the row whose merge panel is open */
  const [mergingCode, setMergingCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Load the live custom defs on mount (single gateway: db.ts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getCustomStep23LineDefs();
        if (!cancelled) {
          setEntries(loaded);
          setIsLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load custom GC/Site-Ops codes:", err);
        if (!cancelled) {
          setEntries([]);
          setLoadError(true);
          setIsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // As-bid STEP 2/3 history backs the advisory "N bids resolve here" merge
  // count. FAIL-SOFT and independent: an outage degrades to no count, never an
  // error — the management surface must never block on this read.
  useEffect(() => {
    let cancelled = false;
    getImportedStep23History()
      .then((sources) => {
        if (!cancelled) setHistory(sources);
      })
      .catch((err) => {
        console.error("Failed to load imported STEP 2/3 history (merge counts hidden):", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flashSaved = (code: string) => {
    setSaveSuccess(code);
    setTimeout(() => setSaveSuccess((c) => (c === code ? null : c)), 3000);
  };

  // Re-read the whole table after a mutation. A merge re-points followers
  // (chain-collapse) beyond the single returned row, so a full reload is the
  // simplest way to keep every merged row's target correct.
  const reload = async (): Promise<CustomStep23LineDef[]> => {
    const loaded = await getCustomStep23LineDefs();
    setEntries(loaded);
    return loaded;
  };

  const handleFieldEdit = async (
    code: string,
    patch: { label?: string; unit?: string; procoreCode?: string | null }
  ) => {
    setBusyCode(code);
    try {
      const updated = await updateCustomStep23LineDef({ code, ...patch });
      setEntries((prev) => (prev ? prev.map((e) => (e.code === code ? updated : e)) : prev));
      flashSaved(code);
    } catch (err) {
      console.error(`Failed to update ${code}:`, err);
      alert(err instanceof Error ? err.message : `Failed to update ${code}. No change was saved.`);
    } finally {
      setBusyCode(null);
      setEditingProcore(null);
    }
  };

  const handleRetire = async (code: string) => {
    if (
      !window.confirm(
        `Retire ${code}?\n\nIt will leave every assign dropdown but keep labeling the lines in bids that already use it (history stays intact). Its suffix is never reused. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyCode(code);
    try {
      const updated = await retireCustomStep23LineDef(code);
      setEntries((prev) => (prev ? prev.map((e) => (e.code === code ? updated : e)) : prev));
      flashSaved(code);
    } catch (err) {
      console.error(`Failed to retire ${code}:`, err);
      alert(err instanceof Error ? err.message : `Failed to retire ${code}. No change was saved.`);
    } finally {
      setBusyCode(null);
    }
  };

  const handleMerge = async (code: string, winner: string) => {
    setBusyCode(code);
    try {
      await mergeCustomStep23LineDef(code, winner);
      await reload();
      flashSaved(code);
      setMergingCode(null);
    } catch (err) {
      console.error(`Failed to merge ${code} into ${winner}:`, err);
      alert(err instanceof Error ? err.message : `Failed to merge ${code}. No change was saved.`);
    } finally {
      setBusyCode(null);
    }
  };

  // Map of code → number of imported bids that currently resolve at least one
  // STEP 2/3 line to it (advisory only). Built over the FULL def list so the
  // count reflects reality, including merge redirects already in effect.
  const resolveCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!entries) return counts;
    for (const src of history) {
      const lines = [...(src.payload?.step2Lines ?? []), ...(src.payload?.step3Lines ?? [])];
      const codesInBid = new Set<string>();
      for (const line of lines) {
        const resolved = resolveStep23Line(line.code, line.description, line.assignedCode, entries);
        if (resolved) codesInBid.add(resolved.code);
      }
      for (const c of codesInBid) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }, [history, entries]);

  // Active defs (built-in + active custom) offered as merge winners.
  const winnerOptions = useMemo(() => activeStep23Defs(entries ?? []), [entries]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((e) => {
      const procoreDescription = e.procoreCode ? PROCORE_CODE_DESCRIPTIONS.get(e.procoreCode) || "" : "";
      return (
        e.code.toLowerCase().includes(query) ||
        e.label.toLowerCase().includes(query) ||
        e.unit.toLowerCase().includes(query) ||
        (e.procoreCode || "").toLowerCase().includes(query) ||
        procoreDescription.toLowerCase().includes(query) ||
        (e.status ?? "active").toLowerCase().includes(query) ||
        e.source.toLowerCase().includes(query)
      );
    });
  }, [entries, searchQuery]);

  if (!isLoaded || entries === null) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Loading Catalog…</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Fetching custom GC/Site-Ops codes from secure storage</p>
      </div>
    );
  }

  const activeCount = entries.filter((e) => isActive(e)).length;
  const retiredMergedCount = entries.length - activeCount;

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
              <Boxes className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> CATALOG MANAGER
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Custom GC/Site-Ops Codes // Lifecycle &amp; Procore Backfill
            </p>
          </div>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-2 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Manage the codes you mint</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            These are the custom General Conditions / Site Operations codes created at the import review gate. Edit a
            code&apos;s name, unit, or Procore Budget Line Item; <strong>retire</strong> one to stop offering it (it still
            labels the bids that already use it); or <strong>merge</strong> a near-duplicate into the right code so every
            past and future bid shows the winner with no re-import. These changes only relabel and re-route — they never
            move a dollar.
          </p>
        </div>
      </div>

      {/* KPI Cards Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Boxes size={40} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Custom Codes</p>
          <h2 className="text-2xl font-extrabold text-foreground mt-2">{entries.length}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Minted GC/Site-Ops line definitions</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Active</p>
          <h2 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">{activeCount}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Offered in every assign dropdown</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Archive size={40} className="text-violet-600 dark:text-violet-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Retired or Merged</p>
          <h2 className="text-2xl font-extrabold text-violet-600 dark:text-violet-400 mt-2">{retiredMergedCount}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Tombstones — still labeling old bids</div>
        </div>
      </div>

      {/* Main Content Area */}
      {loadError ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Terminal size={48} className="text-rose-500 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">Catalog Unavailable</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            The custom GC/Site-Ops code table could not be loaded. Check your connection and reload — no edits are
            possible until the live table is reachable.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Boxes size={48} className="text-blue-500" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">No custom codes yet</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            Custom GC/Site-Ops codes are minted at the import review gate when no built-in line fits a bid&apos;s line.
            Once you create one, it appears here to edit, retire, or merge.
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-600 dark:text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by code, name, unit, Procore code, status (active / retired / merged), or source…"
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
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Code</th>
                    <th className="p-4 text-center w-72 border-r border-b border-grid-border font-semibold">Name</th>
                    <th className="p-4 text-center w-28 border-r border-b border-grid-border font-semibold">Unit</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Procore BLI</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Status</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Source</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No codes match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry) => {
                      const active = isActive(entry);
                      const status = entry.status ?? "active";
                      const statusBadge = STATUS_BADGES[status];
                      const sourceBadge = SOURCE_BADGES[entry.source] || SOURCE_BADGES.manual;
                      const isBusy = busyCode === entry.code;
                      const justSaved = saveSuccess === entry.code;
                      const isEditingProcore = editingProcore === entry.code;
                      const isLegacyProcore = entry.procoreCode !== null && !isValidProcoreCode(entry.procoreCode);
                      const isMerging = mergingCode === entry.code;
                      const bidCount = resolveCounts.get(entry.code) ?? 0;

                      return (
                        <React.Fragment key={entry.code}>
                          <tr className="group transition-colors">
                            {/* Code */}
                            <td className="p-4 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-widest uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {entry.code}
                                {justSaved && <CheckCircle2 size={14} className="text-emerald-500 animate-pulse shrink-0" />}
                              </div>
                            </td>
                            {/* Name */}
                            <td className="p-2 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {active ? (
                                <InlineTextCell
                                  value={entry.label}
                                  placeholder="Name"
                                  disabled={isBusy}
                                  title="the name auto-resolves matching lines in every bid"
                                  onCommit={(next) => handleFieldEdit(entry.code, { label: next })}
                                />
                              ) : (
                                <span className="px-2 text-foreground">{entry.label}</span>
                              )}
                            </td>
                            {/* Unit */}
                            <td className="p-2 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {active ? (
                                <InlineTextCell
                                  value={entry.unit}
                                  placeholder="—"
                                  mono
                                  disabled={isBusy}
                                  title="the as-bid unit of measure"
                                  onCommit={(next) => handleFieldEdit(entry.code, { unit: next })}
                                />
                              ) : (
                                <span className="px-2 font-mono text-foreground">{entry.unit || "—"}</span>
                              )}
                            </td>
                            {/* Procore BLI */}
                            <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {!active ? (
                                <span className="font-mono text-slate-500">{entry.procoreCode || "—"}</span>
                              ) : isEditingProcore ? (
                                <select
                                  autoFocus
                                  value={entry.procoreCode ?? ""}
                                  disabled={isBusy}
                                  onChange={(e) => handleFieldEdit(entry.code, { procoreCode: e.target.value })}
                                  onBlur={() => { if (!isBusy) setEditingProcore(null); }}
                                  className="text-xs font-mono rounded-md border border-blue-500 px-2 py-2 bg-card cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 text-foreground disabled:opacity-50 disabled:cursor-wait w-44"
                                  title={`Procore Budget Line Item for ${entry.code}`}
                                >
                                  <option value="">— none —</option>
                                  {/* Legacy out-of-list value: shown so the select never blanks; not re-selectable */}
                                  {isLegacyProcore && entry.procoreCode && (
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
                                  onClick={() => setEditingProcore(entry.code)}
                                  disabled={isBusy}
                                  className="flex items-center gap-2 text-xs font-mono font-bold rounded-md border border-grid-border hover:border-blue-500 px-3 py-2 bg-card text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait w-44 justify-between mx-auto"
                                  title={`Click to set the Procore destination for ${entry.code}`}
                                >
                                  <span className={entry.procoreCode ? "" : "italic text-slate-400 font-sans"}>
                                    {isBusy ? "Saving…" : entry.procoreCode || "Set BLI"}
                                  </span>
                                  <PenLine size={12} className="text-slate-400 shrink-0" />
                                </button>
                              )}
                            </td>
                            {/* Status */}
                            <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${statusBadge.classes}`}>
                                {statusBadge.label}
                              </span>
                              {status === "merged" && entry.mergedInto && (
                                <div className="text-[10px] font-mono text-violet-600 dark:text-violet-400 mt-1" title={`Resolves to ${entry.mergedInto}`}>
                                  → {entry.mergedInto}
                                </div>
                              )}
                            </td>
                            {/* Source */}
                            <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${sourceBadge.classes}`}>
                                {sourceBadge.label}
                              </span>
                            </td>
                            {/* Actions */}
                            <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {active ? (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => setMergingCode(isMerging ? null : entry.code)}
                                    disabled={isBusy}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-grid-border text-foreground hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-40 transition-colors"
                                    title="Merge this code into another — every bid shows the winner"
                                  >
                                    <GitMerge size={11} /> Merge
                                  </button>
                                  <button
                                    onClick={() => handleRetire(entry.code)}
                                    disabled={isBusy}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-grid-border text-foreground hover:border-rose-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-40 transition-colors"
                                    title="Retire this code — it leaves every dropdown but keeps labeling old bids"
                                  >
                                    <Archive size={11} /> Retire
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">Frozen (tombstone)</span>
                              )}
                            </td>
                          </tr>

                          {/* Merge flow — inline expansion under the row */}
                          {isMerging && active && (
                            <tr className="border-t border-grid-border">
                              <td colSpan={7} className="px-4 py-4 bg-violet-50/40 dark:bg-violet-950/10 border-r border-b border-grid-border">
                                <MergePanel
                                  loser={entry}
                                  bidCount={bidCount}
                                  winnerOptions={winnerOptions.filter((d) => d.code !== entry.code)}
                                  disabled={isBusy}
                                  onCancel={() => setMergingCode(null)}
                                  onConfirm={(winner) => handleMerge(entry.code, winner)}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
              Retired and merged codes are tombstones — they stay in the database and keep labeling the bids that already
              use them. Editing, retiring, and merging only relabel and re-route; no estimate dollar ever moves.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge panel — pick the winning code from active defs (built-in + custom).
// ---------------------------------------------------------------------------

function MergePanel({
  loser,
  bidCount,
  winnerOptions,
  disabled,
  onCancel,
  onConfirm,
}: {
  loser: CustomStep23LineDef;
  /** Imported bids currently resolving a line to the loser (advisory). */
  bidCount: number;
  winnerOptions: Step23LineDef[];
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (winner: string) => void;
}) {
  const [winner, setWinner] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
          <GitMerge size={12} /> Merge {loser.code} — “{loser.label}”
        </div>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="p-1 rounded text-slate-500 hover:text-foreground hover:bg-background disabled:opacity-40 transition-colors"
          title="Cancel merge"
        >
          <X size={14} />
        </button>
      </div>

      <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        {bidCount > 0 ? (
          <span>
            <strong>{bidCount}</strong> imported bid{bidCount === 1 ? "" : "s"} currently resolve a line to{" "}
            <span className="font-mono">{loser.code}</span> — after merging, those lines render the winning code instead.
            No stored bid is rewritten; the change is at render time only.
          </span>
        ) : (
          <span>
            No imported bid currently resolves a line to <span className="font-mono">{loser.code}</span>. Merging still
            redirects it everywhere it is offered. No stored bid is rewritten.
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Merge into (winner)
          <select
            value={winner}
            onChange={(e) => setWinner(e.target.value)}
            disabled={disabled}
            className="min-w-72 bg-card border border-grid-border rounded px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
          >
            <option value="">Select a winning code…</option>
            {winnerOptions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => onConfirm(winner)}
          disabled={disabled || !winner}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold uppercase bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Confirm the merge"
        >
          {disabled ? "Merging…" : (<><GitMerge size={12} /> Confirm merge</>)}
        </button>
      </div>
      {winnerOptions.length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertTriangle size={12} /> No other active code is available to merge into.
        </p>
      )}
    </div>
  );
}
