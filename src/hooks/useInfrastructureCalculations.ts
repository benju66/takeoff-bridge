"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computeSiteOperations, buildSiteOpsLineSet, SiteOpsCalcResult, RateLookup } from "@/lib/calculations";
import { resolveCompanyRate } from "@/lib/rateResolver";
import { SITE_OPS_MANUAL_DEFAULTS } from "@/lib/constants";
import { synthesizeSiteOpsSectionLines } from "@/lib/sectionLines/synthesize";
import { computeSiteOpsFromSectionLines } from "@/lib/sectionLines/project";
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
  calcResult: SiteOpsCalcResult;
  siteOperationsTotal: number;
  // Serializable snapshots for persistence
  siteOpsQuantities: Record<string, number>;
  siteOpsRates: Record<string, number>;
  /**
   * GC/Site-Ops Addressability Phase A3 (dual-read/dual-write): the Site Ops
   * inputs synthesized as addressable section lines. Persisted alongside the
   * legacy blobs (dual-write, app-born only); the legacy blob path above stays
   * authoritative for display + export until a later phase.
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
  initialRemovedCodes?: string[]
): UseInfrastructureCalculationsReturn {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => quantitiesFromSnapshot(initialQuantities));
  const [rates, setRates] = useState<Record<string, number>>(() => ratesFromSnapshot(initialRates));
  // Phase B4 (D2): removed catalog codes (catalog − present). Re-applied once on load.
  const [removedCodes, setRemovedCodes] = useState<string[]>(initialRemovedCodes ?? []);

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

  // Phase B4 (D2): remove / re-add a catalog line by code. Removal does NOT clear the
  // line's blob inputs (quantity / typed rate) — they stay, so a re-add restores the line
  // with its prior inputs automatically (synthesis re-reads the blobs).
  const removeLine = (code: string) => {
    setRemovedCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
  };
  const restoreLine = (code: string) => {
    setRemovedCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : prev));
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
    () => computeSiteOperations(durationMonths, squareFootage, quantities, rates, rateLookup, buildSiteOpsLineSet({ removeCodes: removedCodes }), lineOverrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, quantitiesString, ratesString, rateCardSnapshotString, lineOverridesString, removedCodesString]
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
  // Phase A3 (dual-read/dual-write): synthesize the Site Ops section lines from
  // the legacy blob snapshots (incl. the legacy qty…/rate… key remapping above).
  // Persisted on the next save by the dual-write path; the blob-driven
  // `calcResult` stays authoritative for display + export.
  // ---------------------------------------------------------------------------
  const siteOpsQuantitiesString = JSON.stringify(siteOpsQuantities);
  const siteOpsRatesString = JSON.stringify(siteOpsRates);
  // B4 (D2): synthesize the full catalog seed, then drop the removed codes. The grid rows
  // + the dual-write persist this filtered set (removal = absent from the table).
  const sectionLines = useMemo(
    () => {
      const all = synthesizeSiteOpsSectionLines(siteOpsQuantities, siteOpsRates);
      if (removedCodes.length === 0) return all;
      const removed = new Set(removedCodes);
      return all.filter((l) => !removed.has(l.code));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteOpsQuantitiesString, siteOpsRatesString, removedCodesString]
  );

  // Dual-read tripwire (DEV ONLY): driving the A1 engine off the synthesized
  // section lines must reproduce the blob-driven `calcResult` to the byte.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const viaLines = computeSiteOpsFromSectionLines(sectionLines, {
      durationMonths,
      squareFootage,
      rateLookup,
      lineOverrides,
    });
    if (JSON.stringify(viaLines) !== JSON.stringify(calcResult)) {
      console.error(
        "[sectionLines dual-read] Site Ops calc drift: section-line path != blob path",
        { sectionLineGrandTotal: viaLines.grandTotal, blobGrandTotal: calcResult.grandTotal }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionLines, calcResult, durationMonths, squareFootage, rateCardSnapshotString, lineOverridesString]);

  return {
    quantities,
    rates,
    handleLineQuantityChange,
    handleLineRateChange,
    removedCodes,
    removeLine,
    restoreLine,
    calcResult,
    siteOperationsTotal: calcResult.grandTotal,
    siteOpsQuantities,
    siteOpsRates,
    sectionLines,
  };
}
