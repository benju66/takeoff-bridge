"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computeSiteOperations, DEFAULT_SITE_OPS_LINES, SiteOpsCalcResult, RateLookup } from "@/lib/calculations";
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
  lineOverrides: EstimateOverrideMap = {}
): UseInfrastructureCalculationsReturn {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => quantitiesFromSnapshot(initialQuantities));
  const [rates, setRates] = useState<Record<string, number>>(() => ratesFromSnapshot(initialRates));

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
  // A+1 (D3): a stable key over the active line type-overs so the calc memo +
  // dual-read tripwire recompute when an override is set/reverted. `{}` → inert.
  const lineOverridesString = JSON.stringify(lineOverrides);

  // Layered company-default lookup (Phase B): frozen project snapshot wins over
  // the live company card; both fall through to the calc's constants fallback.
  const rateLookup: RateLookup = (code, fallback) =>
    rateCardSnapshot?.[code] ?? resolveCompanyRate(code, fallback);

  // Compute via pure calculation layer. `DEFAULT_SITE_OPS_LINES` is the explicit
  // default 6th arg so `lineOverrides` (7th) can be threaded; with no overrides the
  // result is byte-identical (the A+1 layer is a pure passthrough on `{}`).
  const calcResult = useMemo(
    () => computeSiteOperations(durationMonths, squareFootage, quantities, rates, rateLookup, DEFAULT_SITE_OPS_LINES, lineOverrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, quantitiesString, ratesString, rateCardSnapshotString, lineOverridesString]
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
  const sectionLines = useMemo(
    () => synthesizeSiteOpsSectionLines(siteOpsQuantities, siteOpsRates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteOpsQuantitiesString, siteOpsRatesString]
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
    calcResult,
    siteOperationsTotal: calcResult.grandTotal,
    siteOpsQuantities,
    siteOpsRates,
    sectionLines,
  };
}
