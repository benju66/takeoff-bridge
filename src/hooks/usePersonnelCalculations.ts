"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computePersonnelCosts, PersonnelCalcResult } from "@/lib/calculations";
import { GC_MANUAL_DEFAULTS, STAFF_ROLE_DEFAULTS } from "@/lib/constants";

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
  calcResult: PersonnelCalcResult;
  totalGCs: number;
  // Serializable snapshots for persistence
  gcUtilization: Record<string, number>;
  gcEquipmentOverrides: Record<string, number>;
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
  initialEquipment?: Record<string, number>
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

  const manualEntriesString = JSON.stringify(manualEntries);
  const rateOverridesString = JSON.stringify(rateOverrides);

  // Compute via pure calculation layer
  const calcResult = useMemo(
    () => computePersonnelCosts(durationMonths, squareFootage, utilizations, equipment, manualEntries, rateOverrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa, eqDumpsters, eqToilets, eqElectric, manualEntriesString, rateOverridesString]
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
    calcResult,
    totalGCs: calcResult.grandTotal,
    gcUtilization,
    gcEquipmentOverrides,
  };
}
