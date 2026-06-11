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
  History,
  PackagePlus,
} from "lucide-react";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import {
  getRateCard,
  updateRateCardEntry,
  getBidPriceHistory,
  getImportedStep23History,
  getCustomStep23LineDefs,
  getCatalogAdditions,
} from "@/lib/db";
import { step23Observations } from "@/lib/step23Normalization";
import { primeRateCard } from "@/lib/rateResolver";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import {
  groupRateCardRows,
  parseRateInput,
  RATE_LINE_DEFS,
} from "@/lib/rateCardEditor";
import {
  aggregateTrustedHistory,
  canonicalUom,
  type TrustedHistoryStat,
} from "@/lib/historyTrust";
import { RateCardEntry, CustomStep23LineDef, CatalogAddition } from "@/types/db";

// ---------------------------------------------------------------------------
// /rates module-load decision (Catalog Manager Phase 7, plan §Risks):
// rateCardEditor's RATE_SECTION_ORDER / RATE_LINE_DEFS read getCatalogItems()
// ONCE at import time, so they CANNOT see a later additions prime — and even a
// rebuild wouldn't surface additions as editable rate rows (additions have no
// rate_card entry). Rather than mutate those workspace-independent module-load
// globals, additions are shown in a dedicated READ-ONLY section sourced directly
// from the fetched list (the established fail-soft async-refresh idiom). Edits
// to an addition's price live on /catalog, its home table.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Company Rate Card editor (Rate-card slice 1 Phase C + slice 2 Phase C) — twin
// of /cost-codes. Global view/edit of the rate_card table: the company-DEFAULT
// for each rate-bearing GC/Site Ops line (keyed by the constants.ts `code`) AND
// each STEP 4 catalog unit price (keyed by itemId), grouped by CSI division.
//
// - Editing a value affects FUTURE projects only. Existing estimates never move:
//   GC/Site Ops rates are frozen by each project's rate_card_snapshot, and a
//   catalog unit price freezes on the saved line item at row birth (slice 2).
// - All writes route through db.ts/updateRateCardEntry (single gateway), which
//   stamps source='manual' and validates per kind (GC/Site Ops finite >= 0;
//   catalog finite, negatives allowed). The UI mirrors that gate (parseRateInput
//   with the row's allowNegative) so no invalid value is ever sent. The seed
//   script is insert-only; this editor is the SOLE update path for an existing rate.
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

/**
 * One trusted-history line under a rate (shared by the catalog price report,
 * Slice 2, and the STEP 2/3 staff-rate report, Slice 3; trust rules from
 * historyTrust since fidelity Phase 3 — one stat per code/unit/sector group).
 * REPORT-only; the ADOPT button renders only when the bids' canonical UOM
 * matches this line's unit and writes through the caller's audited path.
 */
function HistoryStatLine({
  stat,
  lineCode,
  unit,
  sourceNote,
  disabled,
  onAdopt,
}: {
  stat: TrustedHistoryStat;
  /** The card row's code — names the ADOPT target in the button tooltip. */
  lineCode: string;
  /** The line def's unit — gates ADOPT (prices are only adoptable within a UOM). */
  unit: string;
  /** Tooltip lead-in naming the observation source. */
  sourceNote: string;
  disabled: boolean;
  onAdopt: (stat: TrustedHistoryStat) => void;
}) {
  const uomMatches = stat.uom !== "" && stat.count > 0 && stat.uom === canonicalUom(unit);
  const groupLabel = `${stat.uom || "no UOM"}${stat.marketSector ? ` · ${stat.marketSector}` : ""}`;
  const detail = stat.observations
    .map((o) => `${o.projectName || "Unnamed"} (${o.bidDate || "no date"}${o.marketSector ? `, ${o.marketSector}` : ""}): ${currency.format(o.unitPrice)}`)
    .join("\n");
  // Flag-only outliers: visibly set aside in the tooltip, never deleted.
  const outlierDetail = stat.flaggedOutliers
    .map((o) => `OUTLIER — set aside: ${o.projectName || "Unnamed"} (${o.bidDate || "no date"}): ${currency.format(o.unitPrice)}`)
    .join("\n");
  return (
    <div
      className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-violet-700 dark:text-violet-300"
      title={`${sourceNote} (${groupLabel}) — ${stat.confidenceLabel}:\n${detail}${outlierDetail ? `\n${outlierDetail}` : ""}`}
    >
      <History size={10} className="shrink-0" />
      <span className="font-mono">
        {stat.count} bid{stat.count === 1 ? "" : "s"} ({groupLabel})
        {stat.count > 0 && ` · med ${currency.format(stat.median)}`}
        {stat.count > 1 && ` · ${currency.format(stat.min)}–${currency.format(stat.max)}`}
        {stat.confidence === "low" && " · low confidence"}
        {stat.flaggedOutliers.length > 0 &&
          ` · ${stat.flaggedOutliers.length} outlier${stat.flaggedOutliers.length === 1 ? "" : "s"} set aside`}
      </span>
      {uomMatches && (
        <button
          onClick={() => onAdopt(stat)}
          disabled={disabled}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border border-violet-300 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-950/40 disabled:opacity-40 transition-colors cursor-pointer"
          title={`Adopt ${currency.format(stat.median)} as the company default for ${lineCode}`}
        >
          Adopt
        </button>
      )}
    </div>
  );
}

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
  /**
   * As-bid price history per catalog itemId (Phase 3 Slice 2) — REPORT-only,
   * aggregated per (itemId, unit, sector) through the historyTrust rules
   * (fidelity Phase 3). Fail-soft: a fetch error leaves the map empty and the
   * page fully functional without the report.
   */
  const [priceHistory, setPriceHistory] = useState<Map<string, TrustedHistoryStat[]>>(new Map());
  /**
   * As-bid STEP 2/3 rate history per resolved GC/Site-Ops code (Phase 3
   * Slice 3) — REPORT-only, mined from imported_step23_lines. Kept SEPARATE
   * from the catalog map so STEP 4 unit-price observations and STEP 2/3 rate
   * observations never mix (a code like 02-4100.002 exists in both worlds).
   * Fail-soft, same as the catalog report.
   */
  const [step23History, setStep23History] = useState<Map<string, TrustedHistoryStat[]>>(new Map());
  /**
   * Custom (user-minted) GC/Site-Ops defs (Catalog Manager Phase 4). A PROMOTED
   * custom code has a rate_card row but NO built-in line def, so the card join
   * needs these to lift it out of "Unmatched" into the promoted-custom section
   * with its label/unit/status. Fail-soft: an outage leaves it empty and a
   * promoted row simply falls back to the Unmatched display (never blocks).
   */
  const [customDefs, setCustomDefs] = useState<CustomStep23LineDef[]>([]);
  /**
   * In-app catalog additions (Catalog Manager Phase 7) — shown READ-ONLY in
   * their own section (their default unit price lives on /catalog). They are NOT
   * rate_card rows, so they are not editable here and not part of the grouped
   * card table. Fail-soft: an outage degrades to "no additions", never blocks.
   */
  const [additions, setAdditions] = useState<CatalogAddition[]>([]);

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
    // Bid price history (report-only, advisory) — loaded independently so a
    // history outage can never block the rate card itself. Observations come
    // from imported bids AND submitted estimate versions (a project's
    // submitted version supersedes its imported record — no double-counting).
    (async () => {
      try {
        // Versioning + fidelity compose: getBidPriceHistory is the SOURCE
        // (imported bids + submitted versions, supersede rule applied) and
        // aggregateTrustedHistory is the JUDGE (historyTrust validity screen,
        // alias merge, outlier flags) — neither replaces the other.
        const observations = await getBidPriceHistory();
        if (!cancelled) setPriceHistory(aggregateTrustedHistory(observations));
      } catch (err) {
        console.error("Failed to load bid price history (report skipped):", err);
      }
    })();
    // As-bid STEP 2/3 rate history (Slice 3) — same fail-soft independence.
    (async () => {
      try {
        // Custom (user-minted) defs overlay the built-ins so assigned/auto-
        // matching lines file under their minted code (gate Phase 2). History
        // under a custom code is REPORT-only by construction: no rate_card row
        // → no card row here → no ADOPT. A defs outage degrades to built-ins
        // only — the report still renders.
        const [sources, loadedDefs] = await Promise.all([
          getImportedStep23History(),
          getCustomStep23LineDefs().catch((err) => {
            console.error("Failed to load custom GC/Site-Ops codes (mining with built-ins only):", err);
            return [] as CustomStep23LineDef[];
          }),
        ]);
        if (!cancelled) {
          setCustomDefs(loadedDefs);
          setStep23History(aggregateTrustedHistory(step23Observations(sources, loadedDefs)));
        }
      } catch (err) {
        console.error("Failed to load imported STEP 2/3 rate history (report skipped):", err);
      }
    })();
    return () => { cancelled = true; };
  }, [loadCard]);

  // Load + prime the catalog-additions overlay independently (fail-soft). The
  // prime keeps the in-session resolvers consistent; the list drives the
  // read-only additions section.
  useEffect(() => {
    let cancelled = false;
    getCatalogAdditions()
      .then((loaded) => {
        if (cancelled) return;
        setAdditions(loaded);
        primeCatalogAdditionOverlays(loaded);
      })
      .catch((err) => {
        console.error("Failed to load catalog additions (read-only display skipped):", err);
      });
    return () => { cancelled = true; };
  }, []);

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
    // Catalog unit prices may be negative (e.g. the -$2 deduction line); GC/Site
    // Ops rates stay >= 0. The row's line kind drives the gate on BOTH sides.
    const allowNegative = RATE_LINE_DEFS.get(entry.lineCode)?.kind === "catalog";
    // Mirror the db.ts gate in the UI: reject anything outside the kind's range
    // BEFORE attempting a write (no unvalidated financial value leaves the page).
    const parsed = parseRateInput(draftValue, { allowNegative });
    if (parsed === null) {
      alert(
        `"${draftValue}" is not a valid rate. Enter a finite number${
          allowNegative ? "" : " greater than or equal to 0"
        }.`,
      );
      return;
    }
    if (parsed === entry.rate) {
      cancelEdit();
      return;
    }

    skipBlurRef.current = true; // commit in progress — swallow the unmount blur
    setSavingCode(entry.lineCode);
    try {
      await updateRateCardEntry(MASTER_TEMPLATE_NAME, entry.lineCode, parsed, { allowNegative });
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

  /**
   * One-click ADOPT (Phase 3 Slice 2): writes the as-bid MEDIAN through the
   * SAME audited admin path as a manual edit (updateRateCardEntry → stamped
   * MANUAL). Explicit human action with a confirm — never auto-applied.
   */
  const handleAdopt = async (entry: RateCardEntry, stat: TrustedHistoryStat) => {
    // The ADOPT button only renders for count > 0 groups, but a financial
    // write deserves its own gate: an all-outliers group's median is 0 and
    // must never become the company default through a future render change.
    if (stat.count === 0) return;
    const allowNegative = RATE_LINE_DEFS.get(entry.lineCode)?.kind === "catalog";
    const ok = window.confirm(
      `Set the company default for ${entry.lineCode} to the as-bid median ${currency.format(stat.median)}?\n\n` +
        `Backed by ${stat.count} imported bid${stat.count === 1 ? "" : "s"} (${stat.uom}${stat.marketSector ? `, ${stat.marketSector}` : ""}). ` +
        `Current default: ${currency.format(entry.rate)}. Applies to future projects only.`
    );
    if (!ok) return;
    setSavingCode(entry.lineCode);
    try {
      await updateRateCardEntry(MASTER_TEMPLATE_NAME, entry.lineCode, stat.median, { allowNegative });
      await loadCard();
      setSaveSuccess(entry.lineCode);
      setTimeout(() => setSaveSuccess((c) => (c === entry.lineCode ? null : c)), 3000);
    } catch (err) {
      console.error(`Failed to adopt the median rate for ${entry.lineCode}:`, err);
      alert(`Failed to save the rate for ${entry.lineCode}. The previous rate is unchanged. Please try again.`);
    } finally {
      setSavingCode(null);
    }
  };

  // Promoted custom codes have no built-in line def — key their label/unit here
  // so search matches them (the card join uses the same defs via groupRateCardRows).
  const customByCode = useMemo(() => {
    const m = new Map<string, CustomStep23LineDef>();
    for (const d of customDefs) m.set(d.code, d);
    return m;
  }, [customDefs]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((e) => {
      const def = RATE_LINE_DEFS.get(e.lineCode);
      const custom = customByCode.get(e.lineCode);
      return (
        e.lineCode.toLowerCase().includes(query) ||
        (def?.label.toLowerCase().includes(query) ?? false) ||
        (def?.unit.toLowerCase().includes(query) ?? false) ||
        (custom?.label.toLowerCase().includes(query) ?? false) ||
        (custom?.unit.toLowerCase().includes(query) ?? false) ||
        e.source.toLowerCase().includes(query)
      );
    });
  }, [entries, searchQuery, customByCode]);

  const groups = useMemo(
    () => groupRateCardRows(filteredEntries, customDefs),
    [filteredEntries, customDefs],
  );

  // Read-only additions, search-filtered with the same query as the card.
  const filteredAdditions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return additions;
    return additions.filter(
      (a) =>
        a.itemId.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.targetUom.toLowerCase().includes(q) ||
        a.procoreCode.toLowerCase().includes(q),
    );
  }, [additions, searchQuery]);

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
              Default GC / Site Ops Rates + STEP 4 Catalog Unit Prices // {MASTER_TEMPLATE_NAME}
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
            This table holds the company DEFAULT for each rate-bearing General Conditions / Site Operations line and each
            STEP 4 catalog unit price (grouped by CSI division). Editing a value changes it for projects created AFTER the
            edit — existing estimates never move: GC / Site Ops rates are frozen by each project&apos;s rate snapshot, and a
            catalog unit price freezes on the line item the moment a row is saved. A per-project staff rate override still
            wins on top of the card. Catalog deduction lines may be negative. Edits are stamped MANUAL and are never
            overwritten by a re-seed.
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
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">GC / Site Ops rates + catalog unit prices</div>
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
                                <div className="flex items-center gap-2 flex-wrap">
                                  {def ? def.label : <span className="italic text-rose-500">No current line definition</span>}
                                  {def?.status === "retired" && (
                                    <span
                                      className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest bg-slate-100 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700"
                                      title="This promoted custom code was retired. Its company rate-card row stays; it no longer appears in pickers."
                                    >
                                      RETIRED
                                    </span>
                                  )}
                                  {def?.status === "merged" && (
                                    <span
                                      className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/50"
                                      title="This promoted custom code was merged into another. Its company rate-card row stays."
                                    >
                                      MERGED
                                    </span>
                                  )}
                                </div>
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
                                      min={def?.kind === "catalog" ? undefined : 0}
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
                                {/* As-bid price history (Phase 3 Slice 2) — report-only;
                                    ADOPT only where the bids' UOM matches this line's unit. */}
                                {(priceHistory.get(entry.lineCode) ?? []).map((stat) => (
                                  <HistoryStatLine
                                    key={`catalog-${stat.uom || "(none)"}-${stat.marketSector || "(none)"}`}
                                    stat={stat}
                                    lineCode={entry.lineCode}
                                    unit={def?.unit ?? ""}
                                    sourceNote="As-bid prices"
                                    disabled={isSaving}
                                    onAdopt={(s) => handleAdopt(entry, s)}
                                  />
                                ))}
                                {/* As-bid STEP 2/3 rate history (Phase 3 Slice 3) — the
                                    same report + UOM-gated ADOPT over the bids' own
                                    GC/Site-Ops line detail (resolved codes). */}
                                {(step23History.get(entry.lineCode) ?? []).map((stat) => (
                                  <HistoryStatLine
                                    key={`step23-${stat.uom || "(none)"}-${stat.marketSector || "(none)"}`}
                                    stat={stat}
                                    lineCode={entry.lineCode}
                                    unit={def?.unit ?? ""}
                                    sourceNote="As-bid GC/Site-Ops rates"
                                    disabled={isSaving}
                                    onAdopt={(s) => handleAdopt(entry, s)}
                                  />
                                ))}
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

          {/* In-app catalog additions — READ-ONLY (price managed on /catalog) */}
          {additions.length > 0 && (
            <div className="bg-card border border-blue-200 dark:border-blue-900/50 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-grid-border bg-blue-50/40 dark:bg-blue-950/10 flex items-center gap-2">
                <PackagePlus size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  In-app catalog additions
                </h3>
                <span className="text-[10px] text-slate-500 ml-auto">
                  Default unit price managed on{" "}
                  <a href="/catalog" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">
                    /catalog
                  </a>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-separate border-spacing-0 border-l border-grid-border">
                  <thead>
                    <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-40">Code</th>
                      <th className="p-4 border-r border-b border-grid-border font-semibold">Line Description</th>
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-20">Unit</th>
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold w-40">Default Unit Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdditions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                          No additions match the query: &quot;{searchQuery}&quot;
                        </td>
                      </tr>
                    ) : (
                      filteredAdditions.map((a) => (
                        <tr key={a.itemId} className="group transition-colors">
                          <td className="p-4 text-center font-bold text-blue-600 dark:text-blue-400 font-mono tracking-wide border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {a.itemId}
                          </td>
                          <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {a.description}
                          </td>
                          <td className="p-4 text-center text-slate-600 dark:text-slate-400 font-mono uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {a.targetUom || "—"}
                          </td>
                          <td className="p-4 text-center font-mono font-bold text-foreground border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {currency.format(a.defaultUnitPrice)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <Info className="text-amber-500/80 shrink-0" size={14} />
            <span>
              Rate changes apply to projects created after the edit. Existing estimates keep their values frozen — GC /
              Site Ops rates in each project&apos;s snapshot, catalog unit prices on the saved line items — until an
              estimator chooses to refresh them.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
