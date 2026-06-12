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
  TrendingUp,
  Plus,
  PackagePlus,
  PackageCheck,
} from "lucide-react";
import {
  getCustomStep23LineDefs,
  updateCustomStep23LineDef,
  retireCustomStep23LineDef,
  mergeCustomStep23LineDef,
  promoteCustomStep23LineDef,
  getImportedStep23History,
  getRateCard,
  getCatalogAdditions,
  createCatalogAddition,
  updateCatalogAddition,
} from "@/lib/db";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import {
  activeStep23Defs,
  resolveStep23Line,
  isStep23DeterministicCode,
  type Step23LineDef,
  type Step23HistorySource,
} from "@/lib/step23Normalization";
import { isActive } from "@/lib/catalogLifecycle";
import {
  isBuiltInCatalogCode,
  catalogAdditionDriftState,
} from "@/lib/catalog";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import {
  PROCORE_VALID_CODES,
  PROCORE_CODE_DESCRIPTIONS,
  isValidProcoreCode,
} from "@/lib/procoreValidCodes";
import { primeProcoreValidCodesFromDb } from "@/lib/procoreValidCodesPrime";
import type { CustomStep23LineDef, CatalogAddition } from "@/types/db";

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
  /**
   * Codes that already have a company rate_card row (Catalog Manager Phase 4).
   * Promotion is one-way and exactly-once, so the Promote button is hidden for a
   * code already in this set (a "Promoted" pill shows instead). Loaded FAIL-SOFT
   * from the rate card — an outage hides promoted state, never blocks the page.
   */
  const [promotedCodes, setPromotedCodes] = useState<Set<string>>(new Set());

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

  // Which custom codes are already promoted (have a rate_card row). FAIL-SOFT and
  // independent: an outage degrades to "none promoted", never blocks the page.
  useEffect(() => {
    let cancelled = false;
    getRateCard(MASTER_TEMPLATE_NAME)
      .then((card) => {
        if (!cancelled) setPromotedCodes(new Set(card.map((r) => r.lineCode)));
      })
      .catch((err) => {
        console.error("Failed to load rate card (promoted state hidden):", err);
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

  const handlePromote = async (code: string) => {
    if (
      !window.confirm(
        `Promote ${code} to the Company Rate Card?\n\n` +
          `This adds the code to the Rate Card so you can review its past-bid history and adopt a company default rate for it. ` +
          `It applies to FUTURE projects only — no existing estimate moves, and no dollar changes until you set a rate on the Rate Card page. ` +
          `Promotion is one-way (it cannot be undone here). The code is not yet shown in the GC / Site Ops calculators.`
      )
    ) {
      return;
    }
    setBusyCode(code);
    try {
      await promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, code);
      setPromotedCodes((prev) => new Set(prev).add(code));
      flashSaved(code);
    } catch (err) {
      console.error(`Failed to promote ${code}:`, err);
      alert(err instanceof Error ? err.message : `Failed to promote ${code}. No change was saved.`);
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
                      const isPromoted = promotedCodes.has(entry.code);

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
                                  {isPromoted ? (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                                      title="This code is on the Company Rate Card — review and adopt a rate there"
                                    >
                                      <CheckCircle2 size={11} /> Promoted
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handlePromote(entry.code)}
                                      disabled={isBusy}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-grid-border text-foreground hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-40 transition-colors"
                                      title="Promote this code to the Company Rate Card so you can review its history and adopt a default rate (future projects only)"
                                    >
                                      <TrendingUp size={11} /> Promote
                                    </button>
                                  )}
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

      {/* ───────────────────────────────────────────────────────────────────
          STEP 4 catalog codes (Catalog Manager Phase 7). A self-contained,
          independently-loaded section: add a brand-new STEP 4 code that works
          everywhere immediately (pickers, import, row birth, mapping, rates)
          with no redeploy, manage existing additions, and reconcile template
          drift. Mounted unconditionally — it has its own loading + error UI. */}
      <Step4CatalogSection />
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

// ---------------------------------------------------------------------------
// STEP 4 catalog section (Catalog Manager Phase 7). Add / manage in-app catalog
// additions (the catalog_additions table). An addition is SELF-CONTAINED — it
// carries its own Procore BLI + default unit price — so it resolves at every
// chokepoint the moment it is created (the overlays are re-primed here on
// create / edit) with NO cost_code_map / rate_card widening and no redeploy.
// Adds never move a saved dollar: a price freezes on a row at birth.
//
// Drift honesty: an addition lives only in-app until its STEP 4 row is hand-
// added to the master template and `npm run sync-codes` re-harvests it into
// estimate-catalog.json. The banner makes that owed work loud; once a harvest
// ships the code as a built-in, one-click "mark landed" retires the now-
// superseded overlay (the built-in wins by construction).
// ---------------------------------------------------------------------------

const COST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "L", label: "Labor" },
  { value: "M", label: "Materials" },
  { value: "S", label: "Subcontract" },
  { value: "E", label: "Equipment" },
];

const COST_TYPE_LABELS: Record<string, string> = {
  L: "Labor",
  M: "Materials",
  S: "Subcontract",
  E: "Equipment",
};

const additionCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function Step4CatalogSection() {
  const [additions, setAdditions] = useState<CatalogAddition[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Load the live additions on mount and prime the in-session overlay so a
  // workspace opened later in this tab — and this page's own drift math — reflect
  // them. FAIL-SOFT: an outage degrades to "no additions", never blocks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getCatalogAdditions();
        if (!cancelled) {
          setAdditions(loaded);
          primeCatalogAdditionOverlays(loaded);
        }
      } catch (err) {
        console.error("Failed to load catalog additions:", err);
        if (!cancelled) {
          setAdditions([]);
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 4: prime the Procore validation oracle from the live master list so
  // the addition writer's persist gate (isValidProcoreCode) validates against
  // DB-active codes. Fail-soft — an outage keeps the JSON baseline.
  useEffect(() => {
    primeProcoreValidCodesFromDb();
  }, []);

  const flashSaved = (itemId: string) => {
    setSaveSuccess(itemId);
    setTimeout(() => setSaveSuccess((c) => (c === itemId ? null : c)), 3000);
  };

  // Re-prime the overlays after any mutation so the new/edited addition is live
  // in-session at every chokepoint (no remount needed).
  const commit = (next: CatalogAddition[]) => {
    setAdditions(next);
    primeCatalogAdditionOverlays(next);
  };

  // Create: validate client-side for instant clean messages (mirroring the db
  // gate), then write through db.ts — the authoritative gate + 23505 race guard.
  // Returns an error string for the form to show, or null on success.
  const handleCreate = async (draft: {
    itemId: string;
    description: string;
    targetUom: string;
    unitPrice: string;
    costType: string;
    procoreCode: string;
  }): Promise<string | null> => {
    const itemId = draft.itemId.trim();
    const description = draft.description.trim();
    if (!isStep23DeterministicCode(itemId)) {
      return `"${draft.itemId || "(empty)"}" is not a valid catalog code — it must be NN-NNNN.NNN (e.g. 11-5000.010).`;
    }
    if (isBuiltInCatalogCode(itemId)) {
      return `${itemId} is already a built-in STEP 4 code — a built-in always wins, so an addition can't shadow it.`;
    }
    if ((additions ?? []).some((a) => a.itemId === itemId)) {
      return `${itemId} already exists as a catalog addition.`;
    }
    if (description === "") {
      return "A description is required — it is the import-match and display label.";
    }
    if (draft.procoreCode === "" || !isValidProcoreCode(draft.procoreCode)) {
      return "Pick a Procore Budget Line Item — it names where this code's dollars land.";
    }
    const price = draft.unitPrice.trim() === "" ? 0 : Number(draft.unitPrice);
    if (!Number.isFinite(price)) {
      return `"${draft.unitPrice}" is not a valid unit price — enter a finite number (a negative deduction is allowed).`;
    }
    if (!["L", "M", "S", "E"].includes(draft.costType)) {
      return "Choose a cost type: Labor, Materials, Subcontract, or Equipment.";
    }

    setBusyItemId(itemId);
    try {
      const created = await createCatalogAddition({
        itemId,
        description,
        targetUom: draft.targetUom,
        defaultUnitPrice: price,
        costType: draft.costType,
        procoreCode: draft.procoreCode,
      });
      commit([...(additions ?? []), created].sort((a, b) => a.itemId.localeCompare(b.itemId)));
      flashSaved(itemId);
      setShowAddForm(false);
      return null;
    } catch (err) {
      console.error(`Failed to create catalog code ${itemId}:`, err);
      return err instanceof Error ? err.message : `Failed to create ${itemId}.`;
    } finally {
      setBusyItemId(null);
    }
  };

  const handleFieldEdit = async (
    itemId: string,
    patch: {
      description?: string;
      targetUom?: string;
      defaultUnitPrice?: number;
      costType?: string;
      procoreCode?: string;
    }
  ) => {
    setBusyItemId(itemId);
    try {
      const updated = await updateCatalogAddition({ itemId, ...patch });
      commit((additions ?? []).map((a) => (a.itemId === itemId ? updated : a)));
      flashSaved(itemId);
    } catch (err) {
      console.error(`Failed to update catalog code ${itemId}:`, err);
      alert(err instanceof Error ? err.message : `Failed to update ${itemId}. No change was saved.`);
    } finally {
      setBusyItemId(null);
    }
  };

  const handleMarkLanded = async (itemId: string) => {
    if (
      !window.confirm(
        `Mark ${itemId} as landed?\n\nThis code now ships as a built-in STEP 4 code from the harvested template, so the built-in already wins everywhere. Marking it landed retires the in-app overlay; the addition row stays as the audit record. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyItemId(itemId);
    try {
      const updated = await updateCatalogAddition({ itemId, status: "landed" });
      commit((additions ?? []).map((a) => (a.itemId === itemId ? updated : a)));
      flashSaved(itemId);
    } catch (err) {
      console.error(`Failed to mark ${itemId} landed:`, err);
      alert(err instanceof Error ? err.message : `Failed to mark ${itemId} landed. No change was saved.`);
    } finally {
      setBusyItemId(null);
    }
  };

  // Drift partition (the honest-banner oracle): active additions not yet in the
  // template (drifted) vs. those a fresh harvest now ships as built-ins (ready).
  const { drifted, landedReady } = useMemo(() => {
    const d: CatalogAddition[] = [];
    const r: CatalogAddition[] = [];
    for (const a of additions ?? []) {
      const state = catalogAdditionDriftState(a);
      if (state === "drifted") d.push(a);
      else if (state === "landed-ready") r.push(a);
    }
    return { drifted: d, landedReady: r };
  }, [additions]);

  const filtered = useMemo(() => {
    const list = additions ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.itemId.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.targetUom.toLowerCase().includes(q) ||
        a.costType.toLowerCase().includes(q) ||
        (COST_TYPE_LABELS[a.costType] ?? "").toLowerCase().includes(q) ||
        a.procoreCode.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q)
    );
  }, [additions, searchQuery]);

  return (
    <section className="flex flex-col gap-4 border-t border-grid-border pt-8 mt-4">
      {/* Section header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
            <PackagePlus className="text-blue-600 dark:text-blue-400" size={24} /> STEP 4 CATALOG CODES
          </h2>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1.5">
            Add a brand-new STEP 4 catalog code that works everywhere immediately — pickers, import matching, row birth,
            cost-code mapping, and rates — with no redeploy. An addition carries its own Procore destination and default
            unit price; it never moves a saved dollar.
          </p>
        </div>
        {additions !== null && !loadError && (
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold uppercase bg-blue-600 hover:bg-blue-700 text-white transition-colors shrink-0 self-start"
            title="Add a new STEP 4 catalog code"
          >
            {showAddForm ? <X size={14} /> : <Plus size={14} />} {showAddForm ? "Close" : "Add code"}
          </button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && additions !== null && !loadError && (
        <AddStep4CodeForm disabled={busyItemId !== null} onSubmit={handleCreate} onCancel={() => setShowAddForm(false)} />
      )}

      {/* Drift banner — additions not yet in the harvested template file */}
      {drifted.length > 0 && (
        <div className="bg-rose-50/50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-rose-500 mt-0.5 flex-shrink-0 animate-pulse" size={18} />
          <div>
            <h4 className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
              {drifted.length} catalog addition{drifted.length === 1 ? "" : "s"} not yet in the template file
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
              These codes work in the app now, but they live ONLY here until their STEP 4 row is added to{" "}
              <span className="font-mono">templates/Company_Estimate_Template.xlsx</span> and{" "}
              <span className="font-mono font-bold">npm run sync-codes</span> is re-run — otherwise the next harvest will
              not know about them:&nbsp;
              <span className="font-mono font-bold">
                {drifted.slice(0, 12).map((a) => a.itemId).join(", ")}
                {drifted.length > 12 ? ", …" : ""}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Reconciliation banner — additions a fresh harvest now ships as built-ins */}
      {landedReady.length > 0 && (
        <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl flex items-start gap-3">
          <PackageCheck className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
          <div className="flex-1">
            <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
              {landedReady.length} addition{landedReady.length === 1 ? "" : "s"} now shipped in the template — mark landed
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
              A fresh harvest added {landedReady.length === 1 ? "this code" : "these codes"} as built-in STEP 4{" "}
              {landedReady.length === 1 ? "code" : "codes"}, so the built-in already wins everywhere. Mark{" "}
              {landedReady.length === 1 ? "it" : "each"} landed to retire the now-superseded in-app overlay:
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {landedReady.map((a) => (
                <button
                  key={a.itemId}
                  onClick={() => handleMarkLanded(a.itemId)}
                  disabled={busyItemId !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/40 disabled:opacity-40 transition-colors"
                  title={`Mark ${a.itemId} landed (the built-in now wins)`}
                >
                  <PackageCheck size={11} /> {a.itemId}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Body — additions is null only while loading (set to [] on error) */}
      {additions === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 p-6">
          <Terminal className="text-blue-600 dark:text-blue-400 animate-pulse" size={18} /> Loading catalog additions…
        </div>
      ) : loadError ? (
        <div className="flex items-center gap-2 bg-rose-50/50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/50 rounded-lg p-4 text-[11px] text-rose-700 dark:text-rose-400">
          <AlertTriangle size={16} className="shrink-0" /> The catalog additions table could not be loaded. Adds and edits
          are unavailable until the live table is reachable — reload to retry.
        </div>
      ) : additions.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-12 text-center bg-card dark:bg-card/10">
          <PackagePlus size={40} className="text-blue-500 mb-4" />
          <h3 className="text-sm font-bold text-foreground mb-1">No catalog additions yet</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-[11px] leading-relaxed">
            Use <span className="font-bold">Add code</span> to create a STEP 4 catalog code in-app. It becomes available
            everywhere immediately and is reconciled into the template at the next harvest.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-3 text-slate-600 dark:text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search additions by code, description, unit, cost type, Procore code, or status…"
              className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 rounded-lg pl-11 pr-4 py-2.5 text-xs text-foreground outline-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Table */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-grid-border">
                <thead>
                  <tr className="bg-background/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-3 text-center border-r border-b border-grid-border font-semibold">Code</th>
                    <th className="p-3 text-center border-r border-b border-grid-border font-semibold">Description</th>
                    <th className="p-3 text-center w-20 border-r border-b border-grid-border font-semibold">UOM</th>
                    <th className="p-3 text-center w-28 border-r border-b border-grid-border font-semibold">Unit Price</th>
                    <th className="p-3 text-center w-28 border-r border-b border-grid-border font-semibold">Cost Type</th>
                    <th className="p-3 text-center border-r border-b border-grid-border font-semibold">Procore BLI</th>
                    <th className="p-3 text-center border-r border-b border-grid-border font-semibold">Status</th>
                    <th className="p-3 text-center border-r border-b border-grid-border font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No additions match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filtered.map((a) => (
                      <Step4AdditionRow
                        key={a.itemId}
                        addition={a}
                        busy={busyItemId === a.itemId}
                        anyBusy={busyItemId !== null}
                        justSaved={saveSuccess === a.itemId}
                        onEdit={handleFieldEdit}
                        onMarkLanded={handleMarkLanded}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              Editing an addition changes only FUTURE row births — a catalog unit price freezes on each line item the
              moment a row is saved, so existing estimates never move.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add-code form — its own field state; full client-side validation runs in the
// parent's onSubmit (which mirrors the db gate) and returns a clean message.
// ---------------------------------------------------------------------------

function AddStep4CodeForm({
  disabled,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  onSubmit: (draft: {
    itemId: string;
    description: string;
    targetUom: string;
    unitPrice: string;
    costType: string;
    procoreCode: string;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [targetUom, setTargetUom] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [costType, setCostType] = useState("M");
  const [procoreCode, setProcoreCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const busy = disabled || submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const err = await onSubmit({ itemId, description, targetUom, unitPrice, costType, procoreCode });
    setSubmitting(false);
    if (err) setError(err);
    // On success the parent hides the form, so no reset is needed here.
  };

  const fieldClasses =
    "bg-card border border-grid-border rounded px-2 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="bg-blue-50/30 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 rounded-xl p-5 space-y-4 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Catalog code *
          <input
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            disabled={busy}
            placeholder="11-5000.010"
            className={`font-mono ${fieldClasses}`}
            title="A deterministic STEP 4 code, NN-NNNN.NNN"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:col-span-2">
          Description *
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            placeholder="e.g. Window Washing Hoist"
            className={fieldClasses}
            title="The import-match and display label"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Unit of measure
          <input
            value={targetUom}
            onChange={(e) => setTargetUom(e.target.value)}
            disabled={busy}
            placeholder="EA"
            className={`font-mono uppercase ${fieldClasses}`}
            title="The as-bid unit of measure (optional)"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Default unit price
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            disabled={busy}
            placeholder="0.00"
            className={`font-mono text-right ${fieldClasses}`}
            title="Frozen onto a row at birth — a negative deduction is allowed"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Cost type *
          <select value={costType} onChange={(e) => setCostType(e.target.value)} disabled={busy} className={`cursor-pointer ${fieldClasses}`}>
            {COST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} — {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:col-span-3">
          Procore Budget Line Item *
          <select value={procoreCode} onChange={(e) => setProcoreCode(e.target.value)} disabled={busy} className={`font-mono cursor-pointer ${fieldClasses}`}>
            <option value="">— select a Procore destination —</option>
            {PROCORE_VALID_CODES.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} — {o.description}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold uppercase bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Create the catalog code"
        >
          {submitting ? "Adding…" : (<><Plus size={12} /> Add code</>)}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-bold uppercase border border-grid-border text-foreground hover:border-slate-400 disabled:opacity-40 transition-colors"
        >
          Cancel
        </button>
        <span className="text-[10px] text-slate-500 ml-1">
          Works everywhere immediately — pickers, import, row birth, mapping, rates.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One addition row. Active rows are inline-editable (description, UOM, price,
// cost type, Procore BLI); a landed row is frozen (the built-in supersedes it).
// ---------------------------------------------------------------------------

function Step4AdditionRow({
  addition,
  busy,
  anyBusy,
  justSaved,
  onEdit,
  onMarkLanded,
}: {
  addition: CatalogAddition;
  busy: boolean;
  anyBusy: boolean;
  justSaved: boolean;
  onEdit: (
    itemId: string,
    patch: { description?: string; targetUom?: string; defaultUnitPrice?: number; costType?: string; procoreCode?: string }
  ) => void;
  onMarkLanded: (itemId: string) => void;
}) {
  const a = addition;
  const active = a.status === "active";
  const drift = catalogAdditionDriftState(a);
  const [editingCostType, setEditingCostType] = useState(false);
  const [editingProcore, setEditingProcore] = useState(false);
  const isLegacyProcore = !isValidProcoreCode(a.procoreCode);

  const cellHover = "transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60";

  return (
    <tr className="group transition-colors">
      {/* Code */}
      <td className={`p-3 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-wide uppercase border-r border-b border-grid-border whitespace-nowrap ${cellHover}`}>
        <div className="flex items-center gap-2">
          {a.itemId}
          {justSaved && <CheckCircle2 size={14} className="text-emerald-500 animate-pulse shrink-0" />}
        </div>
      </td>

      {/* Description */}
      <td className={`p-2 border-r border-b border-grid-border ${cellHover}`}>
        {active ? (
          <InlineTextCell
            value={a.description}
            placeholder="Description"
            disabled={busy}
            title="the import-match and display label"
            onCommit={(next) => {
              if (next.trim() === "") {
                alert("A description is required.");
                return;
              }
              onEdit(a.itemId, { description: next });
            }}
          />
        ) : (
          <span className="px-2 text-foreground">{a.description}</span>
        )}
      </td>

      {/* UOM */}
      <td className={`p-2 border-r border-b border-grid-border ${cellHover}`}>
        {active ? (
          <InlineTextCell
            value={a.targetUom}
            placeholder="—"
            mono
            disabled={busy}
            title="the as-bid unit of measure"
            onCommit={(next) => onEdit(a.itemId, { targetUom: next })}
          />
        ) : (
          <span className="px-2 font-mono text-foreground">{a.targetUom || "—"}</span>
        )}
      </td>

      {/* Unit price */}
      <td className={`p-2 text-right border-r border-b border-grid-border ${cellHover}`}>
        {active ? (
          <InlineTextCell
            value={String(a.defaultUnitPrice)}
            placeholder="0"
            mono
            disabled={busy}
            title="frozen onto a row at birth (negatives allowed)"
            onCommit={(next) => {
              const v = next.trim() === "" ? 0 : Number(next);
              if (!Number.isFinite(v)) {
                alert(`"${next}" is not a valid unit price.`);
                return;
              }
              onEdit(a.itemId, { defaultUnitPrice: v });
            }}
          />
        ) : (
          <span className="px-2 font-mono text-foreground">{additionCurrency.format(a.defaultUnitPrice)}</span>
        )}
      </td>

      {/* Cost type */}
      <td className={`p-2 text-center border-r border-b border-grid-border ${cellHover}`}>
        {!active ? (
          <span className="font-mono text-foreground" title={COST_TYPE_LABELS[a.costType]}>{a.costType}</span>
        ) : editingCostType ? (
          <select
            autoFocus
            value={a.costType}
            disabled={busy}
            onChange={(e) => {
              onEdit(a.itemId, { costType: e.target.value });
              setEditingCostType(false);
            }}
            onBlur={() => { if (!busy) setEditingCostType(false); }}
            className="text-xs font-mono rounded-md border border-blue-500 px-2 py-1.5 bg-card cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 text-foreground disabled:opacity-50"
            title={`Cost type for ${a.itemId}`}
          >
            {COST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} — {o.label}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditingCostType(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold rounded-md border border-grid-border hover:border-blue-500 px-2.5 py-1.5 bg-card text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
            title={`${COST_TYPE_LABELS[a.costType] ?? a.costType} — click to change`}
          >
            {a.costType}
            <PenLine size={11} className="text-slate-400 shrink-0" />
          </button>
        )}
      </td>

      {/* Procore BLI */}
      <td className={`p-3 text-center border-r border-b border-grid-border ${cellHover}`}>
        {!active ? (
          <span className="font-mono text-slate-500">{a.procoreCode}</span>
        ) : editingProcore ? (
          <select
            autoFocus
            value={a.procoreCode}
            disabled={busy}
            onChange={(e) => {
              onEdit(a.itemId, { procoreCode: e.target.value });
              setEditingProcore(false);
            }}
            onBlur={() => { if (!busy) setEditingProcore(false); }}
            className="text-xs font-mono rounded-md border border-blue-500 px-2 py-2 bg-card cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 text-foreground disabled:opacity-50 disabled:cursor-wait w-44"
            title={`Procore Budget Line Item for ${a.itemId}`}
          >
            {/* Legacy out-of-list value: shown so the select never blanks; not re-selectable */}
            {isLegacyProcore && (
              <option value={a.procoreCode} disabled>
                {a.procoreCode} (not on Importer list)
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
            onClick={() => setEditingProcore(true)}
            disabled={busy}
            className="flex items-center gap-2 text-xs font-mono font-bold rounded-md border border-grid-border hover:border-blue-500 px-3 py-2 bg-card text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait w-44 justify-between mx-auto"
            title={PROCORE_CODE_DESCRIPTIONS.get(a.procoreCode) || `Procore destination for ${a.itemId}`}
          >
            <span className={isLegacyProcore ? "text-rose-500" : ""}>{busy ? "Saving…" : a.procoreCode}</span>
            <PenLine size={12} className="text-slate-400 shrink-0" />
          </button>
        )}
      </td>

      {/* Status */}
      <td className={`p-3 text-center border-r border-b border-grid-border ${cellHover}`}>
        {active ? (
          <div className="flex flex-col items-center gap-1">
            <span className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50">
              ACTIVE
            </span>
            {drift === "drifted" ? (
              <span className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-wider bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50" title="Not yet in the harvested template — add the STEP 4 row and re-run sync-codes">
                NOT IN TEMPLATE
              </span>
            ) : (
              <span className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-wider bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50" title="Now shipped as a built-in — ready to mark landed">
                IN TEMPLATE
              </span>
            )}
          </div>
        ) : (
          <span className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700">
            LANDED
          </span>
        )}
      </td>

      {/* Actions */}
      <td className={`p-3 text-center border-r border-b border-grid-border ${cellHover}`}>
        {active && drift === "landed-ready" ? (
          <button
            onClick={() => onMarkLanded(a.itemId)}
            disabled={anyBusy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/40 disabled:opacity-40 transition-colors"
            title="The built-in now wins — mark this addition landed"
          >
            <PackageCheck size={11} /> Mark landed
          </button>
        ) : active ? (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">In-app only</span>
        ) : (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">Landed (superseded)</span>
        )}
      </td>
    </tr>
  );
}
