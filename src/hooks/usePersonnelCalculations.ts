"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computePersonnelCosts, buildPersonnelLineSet, PersonnelCalcResult, RateLookup } from "@/lib/calculations";
import { resolveCompanyRate } from "@/lib/rateResolver";
import { GC_MANUAL_DEFAULTS, STAFF_ROLE_DEFAULTS } from "@/lib/constants";
import { synthesizePersonnelSectionLines } from "@/lib/sectionLines/synthesize";
import { oneOffToGcManualConfig, oneOffValueInjection } from "@/lib/sectionLines/oneOff";
import type { EstimateSectionLine } from "@/types/db";
import type { EstimateOverrideMap } from "@/types";

// ---------------------------------------------------------------------------
// usePersonnelCalculations — Step 2 GC Personnel state & calculations
// ---------------------------------------------------------------------------

export interface UsePersonnelCalculationsReturn {
  utilizations: Record<string, number>;
  setUtilization: (key: string, value: number) => void;
  equipment: { dumpsters: number; toilets: number; electric: number };
  handleEquipmentChange: (field: "dumpsters" | "toilets" | "electric", valStr: string) => void;
  /** Phase 4: estimator-typed GC values keyed by GcManualConfig.key */
  manualEntries: Record<string, number>;
  handleManualEntryChange: (key: string, valStr: string) => void;
  /** Phase 6: per-project hourly rate overrides keyed by StaffRoleConfig.key (absent = corporate default) */
  rateOverrides: Record<string, number>;
  handleRateChange: (key: string, valStr: string) => void;
  resetRate: (key: string) => void;
  /**
   * GC/Site-Ops Addressability Phase B4 (D2): the catalog codes the estimator has
   * REMOVED from this project (the active line set is the catalog minus these). A
   * removed code drops from `calcResult` (so the grand total / linked-division bridge
   * / export all exclude it) and from `sectionLines` (so its grid row + the persisted
   * dual-write both omit it). Empty by default → byte-identical → goldens tie $0.00.
   */
  removedCodes: string[];
  /** Remove a catalog line by `code` (B4 / D2) — the active set becomes a subset. */
  removeLine: (code: string) => void;
  /** Re-add a previously-removed catalog line by `code` (B4 / D2) — inverse of removeLine. */
  restoreLine: (code: string) => void;
  /**
   * GC/Site-Ops Addressability Phase B5 (D1): the estimator-authored ONE-OFF GC lines
   * (`source: 'manual'`, NOT catalog). Each runs through the EXISTING manual-line evaluator
   * via `buildPersonnelLineSet({ addManual })`; it counts in the export ONLY once it carries a
   * valid Procore code (validateExportReadiness). Empty by default → byte-identical → goldens
   * tie $0.00. The synthesized one-offs ride `sectionLines` (dual-write + reload).
   */
  oneOffLines: EstimateSectionLine[];
  /** Append a new one-off GC line (B5 / D1) — undoable via the grid's ADD_ONE_OFF_LINE command. */
  addOneOff: (line: EstimateSectionLine) => void;
  /** Remove a one-off GC line by id (B5 / D1) — inverse of addOneOff. */
  removeOneOff: (id: string) => void;
  /** Set a one-off's typed value (qty or lump-sum dollars) by id (B5 / D1). */
  setOneOffValue: (id: string, value: number) => void;
  /** Set a one-off's typed rate ($/unit) by id (B5 / D1). */
  setOneOffRate: (id: string, value: number) => void;
  /** Assign / re-assign a one-off's resolved Procore code + cost type by id (B5 / D1). */
  assignOneOffCode: (id: string, procoreCode: string, costType: string) => void;
  calcResult: PersonnelCalcResult;
  totalGCs: number;
  // Serializable snapshots for persistence
  gcUtilization: Record<string, number>;
  gcEquipmentOverrides: Record<string, number>;
  /**
   * GC/Site-Ops Addressability: the GC inputs as addressable section lines.
   * Phase B6 made these the AUTHORITATIVE persisted Step 2/3 store (the legacy
   * blob columns were retired); the page persists them via the section-lines save.
   */
  sectionLines: EstimateSectionLine[];
}

/** Valid persistence keys for Phase 4 manual GC entries (stale JSONB keys are dropped on load). */
const MANUAL_GC_KEYS = new Set(GC_MANUAL_DEFAULTS.map((c) => c.key));

/** Set of valid StaffRoleConfig keys ("ex", "srPm", …) for rate-override input guarding. */
const STAFF_ROLE_KEYS = new Set(STAFF_ROLE_DEFAULTS.map((r) => r.key));

/**
 * Persistence key for a staff rate override inside the gc_utilization JSONB
 * snapshot: role key "srSu" ↔ "rateSrSu" (sits alongside the util* keys —
 * same free-form-JSONB pattern Phase 4 used for gc_equipment_overrides;
 * no schema change).
 */
const rateKeyFor = (roleKey: string) =>
  "rate" + roleKey.charAt(0).toUpperCase() + roleKey.slice(1);

export function usePersonnelCalculations(
  durationMonths: number,
  squareFootage: number,
  isLoaded: boolean,
  initialUtilizations?: Record<string, number>,
  initialEquipment?: Record<string, number>,
  /** Frozen per-project rate snapshot (Phase B). Layered on top of the company
   *  card: rate = rateOverrides ?? projectSnapshot ?? companyCard ?? constants. */
  rateCardSnapshot?: Record<string, number>,
  /**
   * Audited per-line type-overs (gc-siteops Phase A+1 / D3), the active
   * `estimate_overrides` map keyed by `field`. Forwarded straight to
   * `computePersonnelCosts` as `lineOverrides`; only the `line:<id>:total` keys
   * for the GC lines this engine produces are consumed (recognized-keys guard),
   * every other key ignored. Defaults to `{}` → fully INERT (byte-identical
   * result, goldens tie $0.00). The Step-2 grid (B2) records these via the
   * type-over gesture; the page passes the resolved active map in.
   */
  lineOverrides: EstimateOverrideMap = {},
  /**
   * GC/Site-Ops Addressability Phase B4 (D2): the persisted REMOVED catalog codes,
   * derived from the project's `estimate_section_lines` on load (catalog − present) by
   * `deriveRemovedCodesFromLines`. Applied once when `isLoaded`, mirroring the blob
   * one-time sync. APP-BORN ONLY — the page passes `undefined` for imported projects
   * (D4). Defaults to none → full catalog → byte-identical.
   */
  initialRemovedCodes?: string[],
  /**
   * GC/Site-Ops Addressability Phase B5 (D1): the persisted ONE-OFF GC lines, reconstructed
   * from the project's `estimate_section_lines` on load (the `source: 'manual'` GC lines) by
   * `deriveOneOffsFromLines`. Applied once when `isLoaded`, mirroring the removed-codes sync.
   * APP-BORN ONLY — the page passes `undefined` for imported projects (D4). Defaults to none.
   */
  initialOneOffLines?: EstimateSectionLine[]
): UsePersonnelCalculationsReturn {
  // Individual utilization percentages (0-100)
  const [utilEx, setUtilEx] = useState<number>(initialUtilizations?.utilEx ?? 0);
  const [utilSrPm, setUtilSrPm] = useState<number>(initialUtilizations?.utilSrPm ?? 0);
  const [utilPm, setUtilPm] = useState<number>(initialUtilizations?.utilPm ?? 0);
  const [utilPe, setUtilPe] = useState<number>(initialUtilizations?.utilPe ?? 0);
  const [utilSrSu, setUtilSrSu] = useState<number>(initialUtilizations?.utilSrSu ?? 0);
  const [utilSu, setUtilSu] = useState<number>(initialUtilizations?.utilSu ?? 0);
  const [utilAsstSu, setUtilAsstSu] = useState<number>(initialUtilizations?.utilAsstSu ?? 0);
  const [utilPa, setUtilPa] = useState<number>(initialUtilizations?.utilPa ?? 0);

  // Equipment cost overrides
  const [eqDumpsters, setEqDumpsters] = useState<number>(initialEquipment?.eqDumpsters ?? 0);
  const [eqToilets, setEqToilets] = useState<number>(initialEquipment?.eqToilets ?? 0);
  const [eqElectric, setEqElectric] = useState<number>(initialEquipment?.eqElectric ?? 0);

  // Phase 4: typed GC entries (lump sums / quantities), persisted alongside
  // the eq* keys in the same gc_equipment_overrides JSONB snapshot.
  const [manualEntries, setManualEntries] = useState<Record<string, number>>({});

  // Phase 6: per-project staff rate overrides keyed by role key. Sparse —
  // a role absent from the map uses its corporate default rate
  // (STAFF_ROLE_DEFAULTS, the sole rate authority via computePersonnelCosts).
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});

  // Phase B4 (D2): removed catalog codes. Initialized from the persisted section
  // lines (catalog − present) and re-applied once on load (the effect below).
  const [removedCodes, setRemovedCodes] = useState<string[]>(initialRemovedCodes ?? []);

  // Phase B5 (D1): estimator-authored one-off GC lines. Initialized from the persisted
  // `source: 'manual'` GC lines and re-applied once on load (the effect below).
  const [oneOffLines, setOneOffLines] = useState<EstimateSectionLine[]>(initialOneOffLines ?? []);

  // ---------------------------------------------------------------------------
  // One-time DB sync: update state once estimate data arrives from the database.
  // useState only captures the initial value on the first render (before the
  // async DB query completes), so this effect applies the loaded values once.
  // ---------------------------------------------------------------------------
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (isLoaded && !hasInitializedRef.current && (initialUtilizations || initialEquipment)) {
      Promise.resolve().then(() => {
        if (initialUtilizations) {
          setUtilEx(initialUtilizations.utilEx ?? 0);
          setUtilSrPm(initialUtilizations.utilSrPm ?? 0);
          setUtilPm(initialUtilizations.utilPm ?? 0);
          setUtilPe(initialUtilizations.utilPe ?? 0);
          setUtilSrSu(initialUtilizations.utilSrSu ?? 0);
          setUtilSu(initialUtilizations.utilSu ?? 0);
          setUtilAsstSu(initialUtilizations.utilAsstSu ?? 0);
          setUtilPa(initialUtilizations.utilPa ?? 0);
          // Phase 6: rate* keys share the gc_utilization JSONB snapshot
          const loadedRates: Record<string, number> = {};
          for (const role of STAFF_ROLE_DEFAULTS) {
            const v = initialUtilizations[rateKeyFor(role.key)];
            if (typeof v === "number" && v >= 0) loadedRates[role.key] = v;
          }
          setRateOverrides(loadedRates);
        }
        if (initialEquipment) {
          setEqDumpsters(initialEquipment.eqDumpsters ?? 0);
          setEqToilets(initialEquipment.eqToilets ?? 0);
          setEqElectric(initialEquipment.eqElectric ?? 0);
          // Phase 4 manual entries share the JSONB snapshot with the eq* keys
          const extras: Record<string, number> = {};
          for (const [k, v] of Object.entries(initialEquipment)) {
            if (MANUAL_GC_KEYS.has(k) && typeof v === "number") extras[k] = v;
          }
          setManualEntries(extras);
        }
        hasInitializedRef.current = true;
      });
    }
  }, [isLoaded, initialUtilizations, initialEquipment]);

  // Reset guard when project changes (isLoaded goes false during navigation)
  useEffect(() => {
    if (!isLoaded) {
      hasInitializedRef.current = false;
    }
  }, [isLoaded]);

  // Phase B4 (D2): one-time sync of the persisted removed-codes once the project loads
  // (separate from the blob sync above — a removal lives in the section-lines table, not
  // the blobs). `initialRemovedCodes` is referentially stable (the workspace hook stores
  // it in state), so this applies exactly once per project load.
  const hasInitRemovedRef = useRef(false);
  useEffect(() => {
    if (isLoaded && !hasInitRemovedRef.current) {
      Promise.resolve().then(() => {
        setRemovedCodes(initialRemovedCodes ?? []);
        hasInitRemovedRef.current = true;
      });
    } else if (!isLoaded) {
      hasInitRemovedRef.current = false;
    }
  }, [isLoaded, initialRemovedCodes]);

  // Phase B5 (D1): one-time sync of the persisted one-off lines once the project loads
  // (separate from the blob/removed-codes syncs — one-offs live in the section-lines table).
  // `initialOneOffLines` is referentially stable (the workspace hook stores it in state).
  const hasInitOneOffRef = useRef(false);
  useEffect(() => {
    if (isLoaded && !hasInitOneOffRef.current) {
      Promise.resolve().then(() => {
        setOneOffLines(initialOneOffLines ?? []);
        hasInitOneOffRef.current = true;
      });
    } else if (!isLoaded) {
      hasInitOneOffRef.current = false;
    }
  }, [isLoaded, initialOneOffLines]);

  const utilizations: Record<string, number> = {
    ex: utilEx, srPm: utilSrPm, pm: utilPm, pe: utilPe,
    srSu: utilSrSu, su: utilSu, asstSu: utilAsstSu, pa: utilPa,
  };

  const equipment = { dumpsters: eqDumpsters, toilets: eqToilets, electric: eqElectric };

  const setUtilization = (key: string, value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    const setters: Record<string, (v: number) => void> = {
      ex: setUtilEx, srPm: setUtilSrPm, pm: setUtilPm, pe: setUtilPe,
      srSu: setUtilSrSu, su: setUtilSu, asstSu: setUtilAsstSu, pa: setUtilPa,
    };
    setters[key]?.(clamped);
  };

  const handleEquipmentChange = (field: "dumpsters" | "toilets" | "electric", valStr: string) => {
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    if (field === "dumpsters") setEqDumpsters(clamped);
    else if (field === "toilets") setEqToilets(clamped);
    else if (field === "electric") setEqElectric(clamped);
  };

  const handleManualEntryChange = (key: string, valStr: string) => {
    if (!MANUAL_GC_KEYS.has(key)) return;
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    setManualEntries((prev) => ({ ...prev, [key]: clamped }));
  };

  // Phase 6: editable staff rates. Clearing the input removes the override
  // (the corporate default returns); resetRate is the explicit affordance.
  const handleRateChange = (key: string, valStr: string) => {
    if (!STAFF_ROLE_KEYS.has(key)) return;
    if (valStr === "") {
      resetRate(key);
      return;
    }
    const clamped = Math.max(0, parseFloat(valStr) || 0);
    setRateOverrides((prev) => ({ ...prev, [key]: clamped }));
  };

  const resetRate = (key: string) => {
    setRateOverrides((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Phase B4 (D2): remove / re-add a catalog line by code. Removal does NOT clear the
  // line's blob inputs (utilization / equipment / manual value) — they stay, so a re-add
  // restores the line with its prior inputs automatically (synthesis re-reads the blobs).
  const removeLine = (code: string) => {
    setRemovedCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
  };
  const restoreLine = (code: string) => {
    setRemovedCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : prev));
  };

  // Phase B5 (D1): one-off line mutations. All keyed by the line `id` (= code = engine key).
  const addOneOff = (line: EstimateSectionLine) => {
    setOneOffLines((prev) => (prev.some((l) => l.id === line.id) ? prev : [...prev, line]));
  };
  const removeOneOff = (id: string) => {
    setOneOffLines((prev) => prev.filter((l) => l.id !== id));
  };
  const setOneOffValue = (id: string, value: number) => {
    const clamped = Math.max(0, value);
    setOneOffLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, inputs: { ...l.inputs, value: clamped } } : l))
    );
  };
  const setOneOffRate = (id: string, value: number) => {
    const clamped = Math.max(0, value);
    setOneOffLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, inputs: { ...l.inputs, rate: clamped } } : l))
    );
  };
  const assignOneOffCode = (id: string, procoreCode: string, costType: string) => {
    setOneOffLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, procoreCode, costType } : l))
    );
  };

  const manualEntriesString = JSON.stringify(manualEntries);
  const rateOverridesString = JSON.stringify(rateOverrides);
  const rateCardSnapshotString = JSON.stringify(rateCardSnapshot ?? {});
  // B4 (D2): a stable key over the removed-codes set so the calc memo + the synthesized
  // section lines + the dual-read tripwire all recompute when a line is removed/re-added.
  const removedCodesString = JSON.stringify(removedCodes);
  // B5 (D1): a stable key over the one-off lines so the calc memo + section lines + the
  // dual-read tripwire recompute when a one-off is added/removed/edited/assigned a code.
  const oneOffLinesString = JSON.stringify(oneOffLines);
  // A+1 (D3): a stable key over the active line type-overs so the calc memo +
  // dual-read tripwire recompute when an override is set/reverted. `{}` → inert.
  const lineOverridesString = JSON.stringify(lineOverrides);

  // Layered company-default lookup (Phase B): the frozen project snapshot wins
  // over the live company card; both fall through to the constants fallback the
  // calc passes in. `??` (not `||`) so a legitimate 0 rate is honored.
  const rateLookup: RateLookup = (code, fallback) =>
    rateCardSnapshot?.[code] ?? resolveCompanyRate(code, fallback);

  // Compute via pure calculation layer. The active line set is the catalog minus the
  // removed codes (B4 / D2); with none removed `buildPersonnelLineSet` returns the same
  // catalog array refs as `DEFAULT_PERSONNEL_LINES`, so the result is byte-identical (the
  // A+1 `lineOverrides` layer is a pure passthrough on `{}`). Goldens tie $0.00.
  const calcResult = useMemo(
    () => {
      // B5 (D1): append the one-off lines via the EXISTING manual-line evaluator (no new
      // per-line math). Each one-off's typed value rides `manualEntries` keyed by its id
      // (= the manual-config key); its rate rides config.rate. The dual-read bridge builds
      // these IDENTICALLY, so the tripwire below stays green.
      const oneOffConfigs = oneOffLines.map(oneOffToGcManualConfig);
      const engineManualEntries: Record<string, number> = { ...manualEntries };
      for (const l of oneOffLines) {
        const inj = oneOffValueInjection(l);
        engineManualEntries[inj.key] = inj.value;
      }
      return computePersonnelCosts(
        durationMonths, squareFootage, utilizations, equipment, engineManualEntries, rateOverrides, rateLookup,
        buildPersonnelLineSet({ removeCodes: removedCodes, addManual: oneOffConfigs }), lineOverrides
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa, eqDumpsters, eqToilets, eqElectric, manualEntriesString, rateOverridesString, rateCardSnapshotString, lineOverridesString, removedCodesString, oneOffLinesString]
  );

  // Serializable persistence snapshots (matching existing ProjectEstimate shape).
  // Rate overrides ride the gc_utilization JSONB as rate* keys — only
  // overridden roles are present, so deleting an override also clears it
  // from the saved snapshot.
  const gcUtilization: Record<string, number> = {
    utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa,
    ...Object.fromEntries(
      Object.entries(rateOverrides).map(([key, rate]) => [rateKeyFor(key), rate])
    ),
  };
  const gcEquipmentOverrides: Record<string, number> = {
    eqDumpsters, eqToilets, eqElectric, ...manualEntries,
  };

  // ---------------------------------------------------------------------------
  // Synthesize the GC section lines from the working blob state. Phase B6: these
  // are now the AUTHORITATIVE persisted Step 2/3 inputs (the legacy blob columns
  // were retired). On load the workspace reconstructs the blob state FROM these
  // same lines (sectionLinesToBlobs), so this is a stable closed loop; the page
  // persists them via the section-lines save (single write, no more dual-write).
  // ---------------------------------------------------------------------------
  const gcUtilizationString = JSON.stringify(gcUtilization);
  const gcEquipmentOverridesString = JSON.stringify(gcEquipmentOverrides);
  // B4 (D2): synthesize the full catalog seed, then drop the removed codes. The grid
  // rows + the dual-write persist this filtered set (removal = absent from the table).
  const sectionLines = useMemo(
    () => {
      const all = synthesizePersonnelSectionLines(gcUtilization, gcEquipmentOverrides);
      const removed = new Set(removedCodes);
      const catalog = removed.size === 0 ? all : all.filter((l) => !removed.has(l.code));
      // B5 (D1): the one-off lines ride after the catalog seed (so the dual-write persists
      // them and reload reconstructs them). Order matches the calc's `addManual` order.
      return oneOffLines.length === 0 ? catalog : [...catalog, ...oneOffLines];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gcUtilizationString, gcEquipmentOverridesString, removedCodesString, oneOffLinesString]
  );

  return {
    utilizations,
    setUtilization,
    equipment,
    handleEquipmentChange,
    manualEntries,
    handleManualEntryChange,
    rateOverrides,
    handleRateChange,
    resetRate,
    removedCodes,
    removeLine,
    restoreLine,
    oneOffLines,
    addOneOff,
    removeOneOff,
    setOneOffValue,
    setOneOffRate,
    assignOneOffCode,
    calcResult,
    totalGCs: calcResult.grandTotal,
    gcUtilization,
    gcEquipmentOverrides,
    sectionLines,
  };
}
