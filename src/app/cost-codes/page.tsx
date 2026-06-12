"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  PackagePlus,
  GitCompareArrows,
  Tags,
} from "lucide-react";
import { getCatalogItems, isBuiltInCatalogCode, primeCatalogCostTypeOverrides } from "@/lib/catalog";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";
import { getCostCodeMap, updateCostCodeMapping, getCatalogAdditions, getCatalogCostTypeOverrides, getProcoreCostCodes } from "@/lib/db";
import { primeCostCodeResolver } from "@/lib/costCodeResolver";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import {
  PROCORE_VALID_CODES,
  PROCORE_CODE_DESCRIPTIONS,
  isValidProcoreCode,
} from "@/lib/procoreValidCodes";
import { primeProcoreValidCodesFromList } from "@/lib/procoreValidCodesPrime";
import { computeTypeReconciliation } from "@/lib/procoreTypeReconciliation";
import { CostCodeMapEntry, CatalogAddition, ProcoreCostCode, ProcoreCostCodeType } from "@/types/db";
import { InternalEstimateItem } from "@/types";

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
// - Only the row being edited mounts its <select>; all other rows render a
//   lightweight button — keeps the 221-row table snappy.
//
// Phase 3 (type-aware, additive): the page now also READS the typed Procore
// master list (procore_cost_codes via getProcoreCostCodes) to source the target
// dropdown + descriptions + a Procore Type column, and to surface a read-only
// type-mismatch / missing-base advisory. The EXPORT/persist validation gate is
// unchanged — it stays the JSON oracle (isValidProcoreCode) until Phase 4.
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

// Procore type → badge classes (Phase 3 type-aware view). Mirrors /procore-codes.
const PROCORE_TYPE_BADGES: Record<ProcoreCostCodeType, string> = {
  Labor: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50",
  Material: "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50",
  Subcontract: "bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900/50",
  Equipment: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50",
};

function ProcoreTypeBadge({ type }: { type: ProcoreCostCodeType | undefined }) {
  if (!type) return <span className="text-slate-400 italic text-[10px]">—</span>;
  return (
    <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${PROCORE_TYPE_BADGES[type]}`}>
      {type.toUpperCase()}
    </span>
  );
}

export default function CostCodeMappingDashboard() {
  const [entries, setEntries] = useState<CostCodeMapEntry[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  /** internalCode of the row whose <select> is currently mounted */
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  /**
   * In-app catalog additions (Catalog Manager Phase 7). Self-contained codes
   * that carry their OWN procore_code via the resolver overlay — they are NOT in
   * cost_code_map, so they are shown here READ-ONLY (mapping edits live on
   * /catalog) and excluded from the missing-from-map divergence (their overlay
   * IS their mapping, so flagging them would be a false alarm). Fail-soft: an
   * outage degrades to "no additions", never blocks the editor.
   */
  const [additions, setAdditions] = useState<CatalogAddition[]>([]);
  /**
   * The typed Procore master list (procore_cost_codes). Phase 3 wires this in
   * READ-ONLY: it sources the mapping target dropdown + Procore descriptions +
   * the type column, and powers the type-aware reconciliation advisory. It does
   * NOT replace the export/persist validation gate — that stays the JSON oracle
   * (isValidProcoreCode) until Phase 4. Fail-soft: an outage degrades to the JSON
   * code list so the editor keeps working, just without the type-aware extras.
   */
  const [procoreCodes, setProcoreCodes] = useState<ProcoreCostCode[]>([]);
  /**
   * Render-time snapshot of the merged STEP 4 catalog (getCatalogItems()). The
   * overlay primes are effects that mutate MODULE state only — no re-render —
   * so anything computed from the catalog in a memo would go stale the moment
   * an overlay lands (Phase 3: the seeded cost-type corrections must drop the
   * mismatch advisory 67 → 2 on this page). Each prime effect re-snapshots
   * after priming; the advisory memo keys on this state.
   */
  const [catalogItems, setCatalogItems] = useState<Record<string, InternalEstimateItem>>(() => getCatalogItems());

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

  // Load + prime the catalog-additions overlay independently (fail-soft). Prime
  // keeps the in-session resolvers consistent; the list drives the read-only
  // additions display + the divergence exclusion.
  useEffect(() => {
    let cancelled = false;
    getCatalogAdditions()
      .then((loaded) => {
        if (cancelled) return;
        setAdditions(loaded);
        primeCatalogAdditionOverlays(loaded);
        setCatalogItems(getCatalogItems());
      })
      .catch((err) => {
        console.error("Failed to load catalog additions (read-only display skipped):", err);
      });
    return () => { cancelled = true; };
  }, []);

  // Prime the built-in cost-type override overlay independently (Reconciliation
  // Phase 2 — fail-soft). Phase 3's seeded corrections reach the type-mismatch
  // advisory through this prime (the advisory reads getCatalogItems()). LABEL
  // ONLY — moves no dollars; empty = identity.
  useEffect(() => {
    getCatalogCostTypeOverrides()
      .then((loaded) => {
        primeCatalogCostTypeOverrides(loaded);
        setCatalogItems(getCatalogItems());
      })
      .catch((err) => {
        console.error("Failed to load catalog cost-type overrides (harvested types kept):", err);
      });
  }, []);

  // Load the typed Procore master list independently (fail-soft). An outage just
  // means the type column / advisory are skipped and the dropdown falls back to
  // the JSON code list — editing never blocks on this.
  useEffect(() => {
    let cancelled = false;
    getProcoreCostCodes()
      .then((loaded) => {
        if (cancelled) return;
        setProcoreCodes(loaded);
        // Phase 4: this list IS the validation oracle now — prime it so the
        // persist gate (isValidProcoreCode) validates against DB-active codes.
        primeProcoreValidCodesFromList(loaded);
      })
      .catch((err) => {
        console.error("Failed to load Procore master list (type-aware view skipped):", err);
      });
    return () => { cancelled = true; };
  }, []);

  // --- Typed Procore master list derivations (Phase 3, read-only) ---
  const procoreActive = useMemo(
    () => procoreCodes.filter((c) => c.status === "active"),
    [procoreCodes],
  );
  const procoreTypeByCode = useMemo(
    () => new Map(procoreActive.map((c) => [c.code, c.type] as const)),
    [procoreActive],
  );
  const procoreDescByCode = useMemo(
    () => new Map(procoreActive.map((c) => [c.code, c.description] as const)),
    [procoreActive],
  );
  // Procore description preferring the DB master list, falling back to the JSON
  // oracle so a still-valid legacy code (in JSON, not yet in the master list)
  // still resolves a label.
  const procoreDescription = useCallback(
    (code: string) => procoreDescByCode.get(code) ?? PROCORE_CODE_DESCRIPTIONS.get(code),
    [procoreDescByCode],
  );
  // Mapping target dropdown: the DB active list (type-aware) when reachable; the
  // JSON oracle when not. The persist gate stays the JSON oracle (isValidProcoreCode)
  // regardless, so a DB pick (⊂ JSON) always validates — no flip this phase.
  const targetOptions = useMemo<{ code: string; type?: ProcoreCostCodeType }[]>(() => {
    if (procoreActive.length > 0) {
      return [...procoreActive]
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((c) => ({ code: c.code, type: c.type }));
    }
    return PROCORE_VALID_CODES.map((c) => ({ code: c.code }));
  }, [procoreActive]);
  // Type-aware reconciliation advisory (read-only; no auto-fix). Only meaningful
  // once the master list has loaded — otherwise nothing can be classified.
  const reconciliation = useMemo(() => {
    if (!entries || procoreActive.length === 0)
      return { mismatches: [], missingBase: [] };
    return computeTypeReconciliation(
      entries.map((e) => ({ internalCode: e.internalCode, procoreCode: e.procoreCode })),
      // The catalogItems STATE snapshot (not a live getCatalogItems() call):
      // keying on it is what recomputes the advisory once the cost-type
      // override prime lands (the prime itself triggers no re-render).
      catalogItems,
      procoreTypeByCode,
      // Phase 4: linked-division summaries map to the retired 2-20000.000 base
      // but never export — exempt them so the advisory's missing-base drops 8 → 0.
      { exemptLinkedDivision: true },
    );
  }, [entries, procoreActive, procoreTypeByCode, catalogItems]);

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
    const catalog = getCatalogItems();
    return entries.filter((e) => {
      const internalDescription = catalog[e.internalCode]?.description || "";
      const procoreDesc = procoreDescription(e.procoreCode) || "";
      const procoreType = procoreTypeByCode.get(e.procoreCode) || "";
      return (
        e.internalCode.toLowerCase().includes(query) ||
        internalDescription.toLowerCase().includes(query) ||
        e.procoreCode.toLowerCase().includes(query) ||
        procoreDesc.toLowerCase().includes(query) ||
        procoreType.toLowerCase().includes(query) ||
        e.source.toLowerCase().includes(query)
      );
    });
  }, [entries, searchQuery, procoreDescription, procoreTypeByCode]);

  // Divergence diagnostic: BUILT-IN catalog itemIds with NO cost_code_map row
  // resolve to "" at row creation (export blocker) and are editable nowhere —
  // surface them here so the gap is visible before it bites at export time.
  // Scoped to built-ins via isBuiltInCatalogCode (NOT the primed overlay): an
  // in-app addition resolves through its own overlay, so its absence from
  // cost_code_map is by design — never a gap, regardless of prime timing. A
  // LANDED addition that is now a genuine built-in DOES surface if its map row
  // is still missing (a real gap to seed).
  const catalogCodesMissingFromMap = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const mapped = new Set(entries.map((e) => e.internalCode));
    return Object.keys(getCatalogItems())
      .filter((id) => isBuiltInCatalogCode(id) && !mapped.has(id))
      .sort();
  }, [entries]);

  // Read-only additions for display, joined to their Procore description and
  // search-filtered with the same query as the editable map table.
  const filteredAdditions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return additions;
    return additions.filter((a) => {
      const procoreDesc = procoreDescription(a.procoreCode) || "";
      return (
        a.itemId.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.procoreCode.toLowerCase().includes(query) ||
        procoreDesc.toLowerCase().includes(query)
      );
    });
  }, [additions, searchQuery, procoreDescription]);

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

      {/* Type-aware reconciliation advisory (Phase 3) — READ-ONLY, no auto-fix.
          Surfaces where an estimate code's cost type disagrees with Procore's
          type for its mapped base, and where a mapped base is absent from the
          Procore master list. Fixing these (the estimate catalog's costType
          values) is the follow-on reconciliation workstream — not done here. */}
      {procoreActive.length > 0 && (reconciliation.mismatches.length > 0 || reconciliation.missingBase.length > 0) && (
        <div className="bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-xl mb-2 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200/70 dark:border-amber-900/50 flex items-center gap-2">
            <GitCompareArrows size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Type-aware reconciliation — {reconciliation.mismatches.length} type mismatch{reconciliation.mismatches.length === 1 ? "" : "es"}, {reconciliation.missingBase.length} missing base{reconciliation.missingBase.length === 1 ? "" : "s"}
            </h4>
            <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Advisory · read-only</span>
          </div>
          <p className="px-4 pt-3 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            Compared against the Procore master list (<a href="/procore-codes" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">/procore-codes</a>).
            Nothing here changes export behavior — these are flagged for correction in a later reconciliation pass, not auto-fixed.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
            {/* Type mismatches */}
            <div className="bg-card border border-grid-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-grid-border bg-background/60 flex items-center gap-2">
                <Tags size={13} className="text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  Type mismatches ({reconciliation.mismatches.length})
                </span>
              </div>
              {reconciliation.mismatches.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-slate-500 italic">None — every mapped type agrees with Procore.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-grid-border/50">
                  {reconciliation.mismatches.map((m) => (
                    <div key={m.internalCode} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400 w-32 shrink-0">{m.internalCode}</span>
                      <span className="text-slate-600 dark:text-slate-400">
                        estimate says <span className="font-bold text-foreground">{m.estimateType ?? m.estimateCostType}</span>
                        {" · "}Procore says <span className="font-bold text-foreground">{m.procoreType}</span>
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-slate-400 shrink-0">{m.procoreCode}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Missing base */}
            <div className="bg-card border border-grid-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-grid-border bg-background/60 flex items-center gap-2">
                <AlertTriangle size={13} className="text-rose-500 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  Mapped base not in Procore list ({reconciliation.missingBase.length})
                </span>
              </div>
              {reconciliation.missingBase.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-slate-500 italic">None — every mapped base exists.</p>
              ) : (
                <>
                  <p className="px-3 pt-2 text-[10px] text-slate-500 dark:text-slate-400 italic">
                    These map to a Procore base absent from the master list (a retire-candidate code). Export-safe today
                    where the rows are linked-division display totals; resolved in Phase 4.
                  </p>
                  <div className="max-h-60 overflow-y-auto divide-y divide-grid-border/50">
                    {reconciliation.missingBase.map((m) => (
                      <div key={m.internalCode} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400 w-32 shrink-0">{m.internalCode}</span>
                        <span className="text-slate-600 dark:text-slate-400">→ base</span>
                        <span className="ml-auto font-mono text-[10px] text-rose-500 shrink-0">{m.procoreCode}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
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
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Procore Type</th>
                    <th className="p-4 text-center w-72 border-r border-b border-grid-border font-semibold">Procore Description</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No mappings match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry) => {
                      const internalDescription = getCatalogItems()[entry.internalCode]?.description || "—";
                      const procoreDesc = procoreDescription(entry.procoreCode);
                      const procoreType = procoreTypeByCode.get(entry.procoreCode);
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
                                // Only the active row mounts the (type-aware) options select
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
                                  {targetOptions.map((opt) => (
                                    <option key={opt.code} value={opt.code}>
                                      {opt.code}{opt.type ? ` · ${opt.type}` : ""}
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
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <ProcoreTypeBadge type={procoreType} />
                          </td>
                          <td className="p-4 text-slate-600 dark:text-slate-400 font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {procoreDesc || <span className="italic text-rose-500">Not on Importer list</span>}
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

          {/* In-app catalog additions — READ-ONLY here (managed on /catalog) */}
          {additions.length > 0 && (
            <div className="bg-card border border-blue-200 dark:border-blue-900/50 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-grid-border bg-blue-50/40 dark:bg-blue-950/10 flex items-center gap-2">
                <PackagePlus size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  In-app catalog additions ({additions.length})
                </h3>
                <span className="text-[10px] text-slate-500 ml-auto">
                  Self-contained — managed on{" "}
                  <a href="/catalog" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">
                    /catalog
                  </a>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-separate border-spacing-0 border-l border-grid-border">
                  <thead>
                    <tr className="bg-background/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Internal Code</th>
                      <th className="p-4 text-center w-80 border-r border-b border-grid-border font-semibold">Item Description</th>
                      <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Procore Code</th>
                      <th className="p-4 text-center w-72 border-r border-b border-grid-border font-semibold">Procore Description</th>
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
                      filteredAdditions.map((a) => {
                        const procoreDesc = procoreDescription(a.procoreCode);
                        return (
                          <tr key={a.itemId} className="group transition-colors">
                            <td className="p-4 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-widest uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {a.itemId}
                            </td>
                            <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {a.description}
                            </td>
                            <td className="p-4 text-center font-mono font-bold text-foreground border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {a.procoreCode}
                            </td>
                            <td className="p-4 text-slate-600 dark:text-slate-400 font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                              {procoreDesc || <span className="italic text-rose-500">Not on Importer list</span>}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
