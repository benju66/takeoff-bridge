"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computeSiteOperations, buildSiteOpsLineSet, SiteOpsCalcResult, RateLookup } from "@/lib/calculations";
import { resolveCompanyRate } from "@/lib/rateResolver";
import { SITE_OPS_MANUAL_DEFAULTS } from "@/lib/constants";
import { synthesizeSiteOpsSectionLines } from "@/lib/sectionLines/synthesize";
import { oneOffToSiteOpsManualConfig, oneOffValueInjection } from "@/lib/sectionLines/oneOff";
import type { EstimateSectionLine } from "@/types/db";
import type { EstimateOverrideMap } from "@/types";

// ---------------------------------------------------------------------------
// useInfrastructureCalculations — Step 3 Site Operations state & calculations
// ---------------------------------------------------------------------------

export interface UseInfrastructureCalculationsReturn {
  /** Typed values keyed by SiteOpsManualConfig.key ("qty"/"qtyRate" lines hold a quantity; "lumpSum" lines hold a dollar amount) */
  quantities: Record<string, number>;
  /** Typed rates keyed by SiteOpsManualConfig.key (only "qtyRate" lines — soil borings) */
  rates: Record<string, number>;
  /** Phase 4 generic handlers (cover legacy + new lines) */
  handleLineQuantityChange: (key: string, valStr: string) => void;
  handleLineRateChange: (key: string, valStr: string) => void;
  /**
   * GC/Site-Ops Addressability Phase B4 (D2): the catalog codes the estimator has
   * REMOVED from this project (the active line set is the catalog minus these). A removed
   * code drops from `calcResult` (grand total / linked-division bridge / export all
   * exclude it) and from `sectionLines` (grid row + dual-write both omit it). Empty by
   * default → byte-identical → goldens tie $0.00.
   */
  removedCodes: string[];
  /** Remove a catalog line by `code` (B4 / D2) — the active set becomes a subset. */
  removeLine: (code: string) => void;
  /** Re-add a previously-removed catalog line by `code` (B4 / D2) — inverse of removeLine. */
  restoreLine: (code: string) => void;
  /**
   * GC/Site-Ops Addressability Phase B5 (D1): the estimator-authored ONE-OFF Site-Ops lines
   * (`source: 'manual'`, NOT catalog). Each runs through the EXISTING manual-line evaluator
   * via `buildSiteOpsLineSet({ addManual })`; it counts in the export ONLY once it carries a
   * valid Procore code (validateExportReadiness). Empty by default → byte-identical → goldens
   * tie $0.00. The synthesized one-offs ride `sectionLines` (dual-write + reload).
   */
  oneOffLines: EstimateSectionLine[];
  /** Append a new one-off Site-Ops line (B5 / D1) — undoable via ADD_ONE_OFF_LINE. */
  addOneOff: (line: EstimateSectionLine) => void;
  /** Remove a one-off Site-Ops line by id (B5 / D1) — inverse of addOneOff. */
  removeOneOff: (id: string) => void;
  /** Set a one-off's typed value (qty or lump-sum dollars) by id (B5 / D1). */
  setOneOffValue: (id: string, value: number) => void;
  /** Set a one-off's typed rate ($/unit) by id (B5 / D1). */
  setOneOffRate: (id: string, value: number) => void;
  /** Assign / re-assign a one-off's resolved Procore code + cost type by id (B5 / D1). */
  assignOneOffCode: (id: string, procoreCode: string, costType: string) => void;
  calcResult: SiteOpsCalcResult;
  siteOperationsTotal: number;
  // Serializable snapshots for persistence
  siteOpsQuantities: Record<string, number>;
  siteOpsRates: Record<string, number>;
  /**
   * GC/Site-Ops Addressability: the Site Ops inputs as addressable section lines.
   * Phase B6 made these the AUTHORITATIVE persisted Step 2/3 store (the legacy blob
   * columns were retired); the page persists them via the section-lines save.
   */
  sectionLines: EstimateSectionLine[];
}

/**
 * Legacy persistence keys: the original 4 manual lines saved under qty…-prefixed
 * JSONB keys. Preserved so existing saved projects load unchanged; Phase 4
 * lines persist under their raw config key.
 */
const LEGACY_QTY_KEYS: Record<string, string> = {
  knox: "qtyKnox",
  payrollCleaning: "qtyPayrollCleaning",
  hiredCleaning: "qtyHiredCleaning",
  soilBorings: "qtySoilBorings",
};
const LEGACY_RATE_KEYS: Record<string, string> = {
  soilBorings: "rateSoilBorings",
};

const ALL_LINE_KEYS = new Set(SITE_OPS_MANUAL_DEFAULTS.map((c) => c.key));
const RATE_LINE_KEYS = new Set(SITE_OPS_MANUAL_DEFAULTS.filter((c) => c.entry === "qtyRate").map((c) => c.key));

/** Builds the line-keyed quantities record from a persisted JSONB snapshot. */
function quantitiesFromSnapshot(snapshot?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!snapshot) return out;
  for (const key of ALL_LINE_KEYS) {
    const legacy = LEGACY_QTY_KEYS[key];
    const v = legacy !== undefined ? snapshot[legacy] : snapshot[key];
    if (typeof v === "number" && v !== 0) out[key] = v;
  }
  return out;
}

function ratesFromSnapshot(snapshot?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!snapshot) return out;
  for (const key of RATE_LINE_KEYS) {
    const legacy = LEGACY_RATE_KEYS[key];
    const v = legacy !== undefined ? snapshot[legacy] : snapshot[key];
    if (typeof v === "number" && v !== 0) out[key] = v;
  }
  return out;
}

export function useInfrastructureCalculations(
  durationMonths: number,
  squareFootage: number,
  isLoaded: boolean,
  initialQuantities?: Record<string, number>,
  initialRates?: Record<string, number>,
  /** Frozen per-project rate snapshot (Phase B). Layered over the company card:
   *  rate = projectSnapshot ?? companyCard ?? constants (qty/dynamic lines). */
  rateCardSnapshot?: Record<string, number>,
  /**
   * Audited per-line type-overs (gc-siteops Phase A+1 / D3), the active
   * `estimate_overrides` map keyed by `field`. Forwarded straight to
   * `computeSiteOperations` as `lineOverrides`; only the `line:<id>:total` keys for
   * the Site-Ops lines this engine produces are consumed (recognized-keys guard),
   * every other key ignored. Defaults to `{}` → fully INERT (byte-identical result,
   * goldens tie $0.00). The Step-3 grid (B3) records these via the type-over gesture;
   * the page passes the resolved active map in.
   */
  lineOverrides: EstimateOverrideMap = {},
  /**
   * GC/Site-Ops Addressability Phase B4 (D2): the persisted REMOVED catalog codes,
   * derived from the project's `estimate_section_lines` on load (catalog − present) by
   * `deriveRemovedCodesFromLines`. Applied once when `isLoaded`. APP-BORN ONLY — the page
   * passes `undefined` for imported projects (D4). Defaults to none → full catalog.
   */
  initialRemovedCodes?: string[],
  /**
   * GC/Site-Ops Addressability Phase B5 (D1): the persisted ONE-OFF Site-Ops lines,
   * reconstructed from the project's `estimate_section_lines` on load (the `source: 'manual'`
   * site_ops lines) by `deriveOneOffsFromLines`. Applied once when `isLoaded`. APP-BORN ONLY
   * — the page passes `undefined` for imported projects (D4). Defaults to none.
   */
  initialOneOffLines?: EstimateSectionLine[]
): UseInfrastructureCalculationsReturn {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => quantitiesFromSnapshot(initialQuantities));
  const [rates, setRates] = useState<Record<string, number>>(() => ratesFromSnapshot(initialRates));
  // Phase B4 (D2): removed catalog codes (catalog − present). Re-applied once on load.
  const [removedCodes, setRemovedCodes] = useState<string[]>(initialRemovedCodes ?? []);
  // Phase B5 (D1): estimator-authored one-off Site-Ops lines. Re-applied once on load.
  const [oneOffLines, setOneOffLines] = useState<EstimateSectionLine[]>(initialOneOffLines ?? []);

  // ---------------------------------------------------------------------------
  // One-time DB sync: update state once estimate data arrives from the database.
  // useState only captures the initial value on the first render (before the
  // async DB query completes), so this effect applies the loaded values once.
  // ---------------------------------------------------------------------------
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (isLoaded && !hasInitializedRef.current && (initialQuantities || initialRates)) {
      Promise.resolve().then(() => {
        if (initialQuantities) setQuantities(quantitiesFromSnapshot(initialQuantities));
        if (initialRates) setRates(ratesFromSnapshot(initialRates));
        hasInitializedRef.current = true;
      });
    }
  }, [isLoaded, initialQuantities, initialRates]);

  // Reset guard when project changes (isLoaded goes false during navigation)
  useEffect(() => {
    if (!isLoaded) {
      hasInitializedRef.current = false;
    }
  }, [isLoaded]);

  // Phase B4 (D2): one-time sync of the persisted removed-codes once the project loads
  // (separate from the blob sync — a removal lives in the section-lines table, not the
  // blobs). `initialRemovedCodes` is referentially stable (the workspace hook stores it).
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

  // Phase B5 (D1): one-time sync of the persisted one-off lines once the project loads.
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

  // Phase B4 (D2): remove / re-add a catalog line by code. Removal does NOT clear the
  // line's blob inputs (quantity / typed rate) — they stay, so a re-add restores the line
  // with its prior inputs automatically (synthesis re-reads the blobs).
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

  const handleLineQuantityChange = (key: string, valStr: string) => {
    if (!ALL_LINE_KEYS.has(key)) return;
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    setQuantities((prev) => ({ ...prev, [key]: clamped }));
  };

  const handleLineRateChange = (key: string, valStr: string) => {
    if (!RATE_LINE_KEYS.has(key)) return;
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    setRates((prev) => ({ ...prev, [key]: clamped }));
  };

  const quantitiesString = JSON.stringify(quantities);
  const ratesString = JSON.stringify(rates);
  const rateCardSnapshotString = JSON.stringify(rateCardSnapshot ?? {});
  // B4 (D2): a stable key over the removed-codes set so the calc memo + section lines +
  // dual-read tripwire recompute when a line is removed/re-added.
  const removedCodesString = JSON.stringify(removedCodes);
  // B5 (D1): a stable key over the one-off lines so the calc memo + section lines + the
  // dual-read tripwire recompute when a one-off is added/removed/edited/assigned a code.
  const oneOffLinesString = JSON.stringify(oneOffLines);
  // A+1 (D3): a stable key over the active line type-overs so the calc memo +
  // dual-read tripwire recompute when an override is set/reverted. `{}` → inert.
  const lineOverridesString = JSON.stringify(lineOverrides);

  // Layered company-default lookup (Phase B): frozen project snapshot wins over
  // the live company card; both fall through to the calc's constants fallback.
  const rateLookup: RateLookup = (code, fallback) =>
    rateCardSnapshot?.[code] ?? resolveCompanyRate(code, fallback);

  // Compute via pure calculation layer. The active line set is the catalog minus the
  // removed codes (B4 / D2); with none removed `buildSiteOpsLineSet` returns the same
  // catalog array refs as `DEFAULT_SITE_OPS_LINES`, so the result is byte-identical (the
  // A+1 `lineOverrides` layer is a pure passthrough on `{}`). Goldens tie $0.00.
  const calcResult = useMemo(
    () => {
      // B5 (D1): append the one-off lines via the EXISTING manual-line evaluator (no new
      // per-line math). A one-off's typed value rides `quantities` keyed by its id; a qtyRate
      // one-off's typed rate rides `rates`; a qty one-off's rate is config.rate. The dual-read
      // bridge builds these IDENTICALLY → the tripwire below stays green.
      const oneOffConfigs = oneOffLines.map(oneOffToSiteOpsManualConfig);
      const engineQuantities: Record<string, number> = { ...quantities };
      const engineRates: Record<string, number> = { ...rates };
      // A one-off's typed value rides `quantities`; a `qty` one-off's rate rides config.rate
      // (so engineRates carries only the catalog `qtyRate` lines, untouched here).
      for (const l of oneOffLines) {
        const inj = oneOffValueInjection(l);
        engineQuantities[inj.key] = inj.value;
      }
      return computeSiteOperations(
        durationMonths, squareFootage, engineQuantities, engineRates, rateLookup,
        buildSiteOpsLineSet({ removeCodes: removedCodes, addManual: oneOffConfigs }), lineOverrides
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, quantitiesString, ratesString, rateCardSnapshotString, lineOverridesString, removedCodesString, oneOffLinesString]
  );

  // Serializable persistence snapshots: legacy lines keep their original
  // qty…/rate… JSONB keys (saved projects load unchanged); Phase 4 lines
  // persist under their raw config key.
  const siteOpsQuantities: Record<string, number> = {};
  for (const key of ALL_LINE_KEYS) {
    siteOpsQuantities[LEGACY_QTY_KEYS[key] ?? key] = quantities[key] ?? 0;
  }
  const siteOpsRates: Record<string, number> = {};
  for (const key of RATE_LINE_KEYS) {
    siteOpsRates[LEGACY_RATE_KEYS[key] ?? key] = rates[key] ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Synthesize the Site Ops section lines from the working blob state (incl. the
  // legacy qty…/rate… key remapping above). Phase B6: these are now the
  // AUTHORITATIVE persisted Step 2/3 inputs (the legacy blob columns were retired);
  // on load the workspace reconstructs the blob state FROM these same lines
  // (sectionLinesToBlobs) — a stable closed loop, persisted via the section-lines save.
  // ---------------------------------------------------------------------------
  const siteOpsQuantitiesString = JSON.stringify(siteOpsQuantities);
  const siteOpsRatesString = JSON.stringify(siteOpsRates);
  // B4 (D2): synthesize the full catalog seed, then drop the removed codes. The grid rows
  // + the dual-write persist this filtered set (removal = absent from the table).
  const sectionLines = useMemo(
    () => {
      const all = synthesizeSiteOpsSectionLines(siteOpsQuantities, siteOpsRates);
      const removed = new Set(removedCodes);
      const catalog = removed.size === 0 ? all : all.filter((l) => !removed.has(l.code));
      // B5 (D1): the one-off lines ride after the catalog seed (dual-write + reload). Order
      // matches the calc's `addManual` order.
      return oneOffLines.length === 0 ? catalog : [...catalog, ...oneOffLines];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteOpsQuantitiesString, siteOpsRatesString, removedCodesString, oneOffLinesString]
  );

  return {
    quantities,
    rates,
    handleLineQuantityChange,
    handleLineRateChange,
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
    siteOperationsTotal: calcResult.grandTotal,
    siteOpsQuantities,
    siteOpsRates,
    sectionLines,
  };
}
