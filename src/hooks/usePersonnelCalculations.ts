"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { computePersonnelCosts, PersonnelCalcResult } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// usePersonnelCalculations — Step 2 GC Personnel state & calculations
// ---------------------------------------------------------------------------

export interface UsePersonnelCalculationsReturn {
  utilizations: Record<string, number>;
  setUtilization: (key: string, value: number) => void;
  equipment: { dumpsters: number; toilets: number; electric: number };
  handleEquipmentChange: (field: "dumpsters" | "toilets" | "electric", valStr: string) => void;
  calcResult: PersonnelCalcResult;
  totalGCs: number;
  // Serializable snapshots for persistence
  gcUtilization: Record<string, number>;
  gcEquipmentOverrides: Record<string, number>;
}

export function usePersonnelCalculations(
  durationMonths: number,
  isLoaded: boolean,
  initialUtilizations?: Record<string, number>,
  initialEquipment?: Record<string, number>,
  rateOverrides?: Record<string, number>
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
        }
        if (initialEquipment) {
          setEqDumpsters(initialEquipment.eqDumpsters ?? 0);
          setEqToilets(initialEquipment.eqToilets ?? 0);
          setEqElectric(initialEquipment.eqElectric ?? 0);
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

  // Compute via pure calculation layer
  const calcResult = useMemo(
    () => computePersonnelCosts(durationMonths, utilizations, equipment, rateOverrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa, eqDumpsters, eqToilets, eqElectric, rateOverrides]
  );

  // Serializable persistence snapshots (matching existing ProjectEstimate shape)
  const gcUtilization: Record<string, number> = {
    utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa,
  };
  const gcEquipmentOverrides: Record<string, number> = {
    eqDumpsters, eqToilets, eqElectric,
  };

  return {
    utilizations,
    setUtilization,
    equipment,
    handleEquipmentChange,
    calcResult,
    totalGCs: calcResult.grandTotal,
    gcUtilization,
    gcEquipmentOverrides,
  };
}
