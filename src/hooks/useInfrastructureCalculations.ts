"use client";

import { useState, useMemo } from "react";
import { computeSiteOperations, SiteOpsCalcResult } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// useInfrastructureCalculations — Step 3 Site Operations state & calculations
// ---------------------------------------------------------------------------

export interface UseInfrastructureCalculationsReturn {
  quantities: { knox: number; payrollCleaning: number; hiredCleaning: number; soilBorings: number };
  rates: { soilBorings: number };
  handleSiteOpsChange: (field: "knox" | "payroll" | "hired" | "soilQty" | "soilRate", valStr: string) => void;
  calcResult: SiteOpsCalcResult;
  siteOperationsTotal: number;
  // Serializable snapshots for persistence
  siteOpsQuantities: Record<string, number>;
  siteOpsRates: Record<string, number>;
}

export function useInfrastructureCalculations(
  durationMonths: number,
  squareFootage: number,
  initialQuantities?: Record<string, number>,
  initialRates?: Record<string, number>
): UseInfrastructureCalculationsReturn {
  const [qtyKnox, setQtyKnox] = useState<number>(initialQuantities?.qtyKnox ?? 0);
  const [qtyPayrollCleaning, setQtyPayrollCleaning] = useState<number>(initialQuantities?.qtyPayrollCleaning ?? 0);
  const [qtyHiredCleaning, setQtyHiredCleaning] = useState<number>(initialQuantities?.qtyHiredCleaning ?? 0);
  const [qtySoilBorings, setQtySoilBorings] = useState<number>(initialQuantities?.qtySoilBorings ?? 0);
  const [rateSoilBorings, setRateSoilBorings] = useState<number>(initialRates?.rateSoilBorings ?? 0);

  const quantities = { knox: qtyKnox, payrollCleaning: qtyPayrollCleaning, hiredCleaning: qtyHiredCleaning, soilBorings: qtySoilBorings };
  const rates = { soilBorings: rateSoilBorings };

  const handleSiteOpsChange = (
    field: "knox" | "payroll" | "hired" | "soilQty" | "soilRate",
    valStr: string
  ) => {
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    if (field === "knox") setQtyKnox(clamped);
    else if (field === "payroll") setQtyPayrollCleaning(clamped);
    else if (field === "hired") setQtyHiredCleaning(clamped);
    else if (field === "soilQty") setQtySoilBorings(clamped);
    else if (field === "soilRate") setRateSoilBorings(clamped);
  };

  // Compute via pure calculation layer
  const calcResult = useMemo(
    () => computeSiteOperations(durationMonths, squareFootage, quantities, rates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMonths, squareFootage, qtyKnox, qtyPayrollCleaning, qtyHiredCleaning, qtySoilBorings, rateSoilBorings]
  );

  // Serializable persistence snapshots (matching existing ProjectEstimate shape)
  const siteOpsQuantities: Record<string, number> = {
    qtyKnox, qtyPayrollCleaning, qtyHiredCleaning, qtySoilBorings,
  };
  const siteOpsRates: Record<string, number> = {
    rateSoilBorings,
  };

  return {
    quantities,
    rates,
    handleSiteOpsChange,
    calcResult,
    siteOperationsTotal: calcResult.grandTotal,
    siteOpsQuantities,
    siteOpsRates,
  };
}
