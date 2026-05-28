"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import Papa from "papaparse";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper
} from "@tanstack/react-table";
import { parseTogalCSV } from "@/lib/parser";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, TogalRowPayload } from "@/types";
import { Project, ProjectEstimate } from "@/types/db";
import { getProject, getProjectEstimate, saveProjectEstimate, saveProject } from "@/lib/db";
import { 
  Upload, 
  AlertTriangle, 
  FileDown, 
  ChevronLeft, 
  MapPin, 
  Calendar, 
  Activity,
  RotateCcw,
  Grid
} from "lucide-react";
import { generateExcelPayload, generateProcoreBudget, generateExcelWorkbook } from "@/lib/exporter";
import { getFuzzySuggestions } from "@/lib/similarity";

interface DivisionAggregation {
  code: string;
  name: string;
  total: number;
  percentage: number;
}

interface CostTypeAggregation {
  key: string;
  label: string;
  total: number;
  percentage: number;
}

const DIVISION_NAMES: Record<string, string> = {
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood & Plastics",
  "07": "Thermal & Moisture",
  "08": "Openings",
  "09": "Finishes"
};

const getTerminalProgressBar = (percentage: number): string => {
  const totalBlocks = 10;
  const filledBlocks = Math.min(totalBlocks, Math.max(0, Math.round(percentage / 10)));
  const emptyBlocks = totalBlocks - filledBlocks;
  return "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
};

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectWorkspace({ params }: PageProps) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.projectId;

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<ProcessedTakeoffRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});
  const [globalRegistry, setGlobalRegistry] = useState<Record<string, string>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [appendData, setAppendData] = useState(false);
  interface WorkbookSnapshot {
    items: ProcessedTakeoffRow[];
    locks: Record<string, boolean>;
  }
  const [historyStack, setHistoryStack] = useState<WorkbookSnapshot[]>([]);

  interface ColumnDefinition {
    id: string;
    header: string;
    type: "default" | "custom";
  }

  const [columnDefs, setColumnDefs] = useState<ColumnDefinition[]>([
    { id: "costType", header: "TYPE", type: "default" },
    { id: "itemId", header: "Code", type: "default" },
    { id: "description", header: "Description", type: "default" },
    { id: "matchedQty", header: "Quantity", type: "default" },
    { id: "uom", header: "Unit", type: "default" },
    { id: "unitPrice", header: "Rate", type: "default" },
    { id: "total", header: "Total", type: "default" },
    { id: "costPerUnit", header: "Cost/Unit", type: "default" },
    { id: "costPerSf", header: "Cost/S.F.", type: "default" },
  ]);

  interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    rowIndex: number;
    columnId: string; // Tracks cell column identifier
  }
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    rowIndex: -1,
    columnId: ""
  });

  const [lockedCells, setLockedCells] = useState<Record<string, boolean>>({});

  // Step 2 & 3 Workspace Active Tab
  const [activeTab, setActiveTab] = useState<string>("step4");

  // Step 2 General Conditions Staffing Utilization (%)
  const [utilEx, setUtilEx] = useState<number>(0);
  const [utilSrPm, setUtilSrPm] = useState<number>(0);
  const [utilPm, setUtilPm] = useState<number>(0);
  const [utilPe, setUtilPe] = useState<number>(0);
  const [utilSrSu, setUtilSrSu] = useState<number>(0);
  const [utilSu, setUtilSu] = useState<number>(0);
  const [utilAsstSu, setUtilAsstSu] = useState<number>(0);
  const [utilPa, setUtilPa] = useState<number>(0);

  // Step 2 General Conditions Equipment Cost Overrides ($)
  const [eqDumpsters, setEqDumpsters] = useState<number>(0);
  const [eqToilets, setEqToilets] = useState<number>(0);
  const [eqElectric, setEqElectric] = useState<number>(0);

  // Step 3 Site Operations Quantity & Rate Overrides
  const [qtyKnox, setQtyKnox] = useState<number>(0);
  const [qtyPayrollCleaning, setQtyPayrollCleaning] = useState<number>(0);
  const [qtyHiredCleaning, setQtyHiredCleaning] = useState<number>(0);
  const [qtySoilBorings, setQtySoilBorings] = useState<number>(0);
  const [rateSoilBorings, setRateSoilBorings] = useState<number>(0);

  const pushSnapshotToStack = (currentRows: ProcessedTakeoffRow[], currentLocks: Record<string, boolean>) => {
    setHistoryStack((prev) => [
      ...prev.slice(-9),
      {
        items: JSON.parse(JSON.stringify(currentRows)),
        locks: JSON.parse(JSON.stringify(currentLocks))
      }
    ]);
  };

  // Outside click handler to dismiss context menu
  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => {
      window.removeEventListener("click", handleOutsideClick);
    };
  }, [contextMenu.visible]);

  // Splicing engine to insert a new manual row above or below target index
  const insertManualRow = (direction: "above" | "below", targetIndex: number) => {
    pushSnapshotToStack(rows, lockedCells);
    const updated = [...rows];
    
    const newRow: ProcessedTakeoffRow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      classification: "MANUAL ENTRY",
      itemId: "",
      procoreParentCode: "",
      description: "",
      matchedQty: 0,
      uom: "SF",
      unitPrice: 0,
      total: 0,
      isMapped: false,
      rawQuantities: [],
      costType: "M",
      customFields: {}
    };

    const insertIdx = direction === "above" ? targetIndex : targetIndex + 1;
    updated.splice(insertIdx, 0, newRow);
    setRows(updated);
  };

  const handleToggleCellLock = (rowId: string, columnId: string) => {
    pushSnapshotToStack(rows, lockedCells);
    const cellKey = `${rowId}::${columnId}`;
    setLockedCells((prev) => ({
      ...prev,
      [cellKey]: !prev[cellKey]
    }));
    setContextMenu({ visible: false, x: 0, y: 0, rowIndex: -1, columnId: "" });
  };

  const [unmappedTakeoffClassifications, setUnmappedTakeoffClassifications] = useState<string[]>([]);

  const initializeDefaultEstimateRows = (): ProcessedTakeoffRow[] => {
    const sortedKeys = Object.keys(ESTIMATE_ITEMS_MASTER).sort();
    return sortedKeys.map((key, idx) => {
      const item = ESTIMATE_ITEMS_MASTER[key];
      return {
        id: `row-${idx}`,
        classification: "",
        itemId: item.itemId,
        procoreParentCode: item.procoreParentCode,
        description: item.description,
        matchedQty: 0,
        uom: item.targetUom,
        unitPrice: item.defaultUnitPrice,
        total: 0,
        isMapped: true,
        rawQuantities: [],
        costType: item.costType,
        customFields: {}
      };
    });
  };

  const mergeTakeoffData = (parsed: ProcessedTakeoffRow[]) => {
    pushSnapshotToStack(rows, lockedCells);
    
    const unmappedList: string[] = [];
    parsed.forEach((parsedRow) => {
      if (!parsedRow.itemId) {
        if (!unmappedList.includes(parsedRow.classification)) {
          unmappedList.push(parsedRow.classification);
        }
      }
    });
    setUnmappedTakeoffClassifications(unmappedList);

    setRows((prevRows) => {
      const updatedRows = prevRows.map((r) => {
        if (!appendData) {
          return {
            ...r,
            matchedQty: 0,
            total: 0,
            classification: "",
            rawQuantities: []
          };
        }
        return { ...r };
      });

      parsed.forEach((parsedRow) => {
        if (!parsedRow.itemId) return;

        const targetIdx = updatedRows.findIndex((r) => r.itemId === parsedRow.itemId);
        if (targetIdx !== -1) {
          updatedRows[targetIdx].matchedQty += parsedRow.matchedQty;
          updatedRows[targetIdx].total = updatedRows[targetIdx].matchedQty * updatedRows[targetIdx].unitPrice;
          
          updatedRows[targetIdx].classification = parsedRow.classification;
          updatedRows[targetIdx].rawQuantities = parsedRow.rawQuantities;
        }
      });

      return updatedRows;
    });
  };

  const getMonthsBetween = (startStr: string, finishStr: string): number => {
    if (!startStr || !finishStr) return 0;
    const startParts = startStr.split("-").map(Number);
    const finishParts = finishStr.split("-").map(Number);
    if (startParts.length < 2 || finishParts.length < 2) return 0;
    const yearsDiff = finishParts[0] - startParts[0];
    const monthsDiff = finishParts[1] - startParts[1];
    const totalMonths = yearsDiff * 12 + monthsDiff;
    return totalMonths > 0 ? totalMonths : 0;
  };

  const handleEquipmentChange = (field: "dumpsters" | "toilets" | "electric", valStr: string) => {
    const parsed = valStr === "" ? 0 : parseFloat(valStr) || 0;
    const clamped = Math.max(0, parsed);
    if (field === "dumpsters") setEqDumpsters(clamped);
    else if (field === "toilets") setEqToilets(clamped);
    else if (field === "electric") setEqElectric(clamped);
  };

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

  const handleProjectParamChange = (field: keyof Project, value: string | number) => {
    if (!project) return;
    const updated = {
      ...project,
      [field]: value
    };
    setProject(updated);
    saveProject(updated);
  };

  // Load project details and estimate on mount
  useEffect(() => {
    if (!projectId) return;

    // Load Project Meta
    const meta = getProject(projectId);
    setProject(meta);

    // Load Project Isolated Mapping Registry
    const savedRegistry = localStorage.getItem(`takeoff_user_registry_${projectId}`);
    if (savedRegistry) {
      try {
        setUserRegistry(JSON.parse(savedRegistry));
      } catch (e) {
        console.error("Failed to parse project userRegistry", e);
      }
    }

    // Load Global Corporate Registry
    const savedGlobalRegistry = localStorage.getItem("takeoff_global_user_registry");
    if (savedGlobalRegistry) {
      try {
        setGlobalRegistry(JSON.parse(savedGlobalRegistry));
      } catch (e) {
        console.error("Failed to parse global userRegistry", e);
      }
    }

    // Load Project Isolated Estimate Items & GCs / Site Ops
    const savedEstimate = getProjectEstimate(projectId);
    if (savedEstimate) {
      if (savedEstimate.items && savedEstimate.items.length > 0) {
        setRows(savedEstimate.items);
      } else {
        setRows(initializeDefaultEstimateRows());
      }
      if (savedEstimate.gcUtilization) {
        setUtilEx(savedEstimate.gcUtilization.utilEx ?? 0);
        setUtilSrPm(savedEstimate.gcUtilization.utilSrPm ?? 0);
        setUtilPm(savedEstimate.gcUtilization.utilPm ?? 0);
        setUtilPe(savedEstimate.gcUtilization.utilPe ?? 0);
        setUtilSrSu(savedEstimate.gcUtilization.utilSrSu ?? 0);
        setUtilSu(savedEstimate.gcUtilization.utilSu ?? 0);
        setUtilAsstSu(savedEstimate.gcUtilization.utilAsstSu ?? 0);
        setUtilPa(savedEstimate.gcUtilization.utilPa ?? 0);
      } else {
        setUtilEx(0);
        setUtilSrPm(0);
        setUtilPm(0);
        setUtilPe(0);
        setUtilSrSu(0);
        setUtilSu(0);
        setUtilAsstSu(0);
        setUtilPa(0);
      }
      if (savedEstimate.gcEquipmentOverrides) {
        setEqDumpsters(savedEstimate.gcEquipmentOverrides.eqDumpsters ?? 0);
        setEqToilets(savedEstimate.gcEquipmentOverrides.eqToilets ?? 0);
        setEqElectric(savedEstimate.gcEquipmentOverrides.eqElectric ?? 0);
      } else {
        setEqDumpsters(0);
        setEqToilets(0);
        setEqElectric(0);
      }
      if (savedEstimate.siteOpsQuantities) {
        setQtyKnox(savedEstimate.siteOpsQuantities.qtyKnox ?? 0);
        setQtyPayrollCleaning(savedEstimate.siteOpsQuantities.qtyPayrollCleaning ?? 0);
        setQtyHiredCleaning(savedEstimate.siteOpsQuantities.qtyHiredCleaning ?? 0);
        setQtySoilBorings(savedEstimate.siteOpsQuantities.qtySoilBorings ?? 0);
      } else {
        setQtyKnox(0);
        setQtyPayrollCleaning(0);
        setQtyHiredCleaning(0);
        setQtySoilBorings(0);
      }
      if (savedEstimate.siteOpsRates) {
        setRateSoilBorings(savedEstimate.siteOpsRates.rateSoilBorings ?? 0);
      } else {
        setRateSoilBorings(0);
      }
    } else {
      setRows(initializeDefaultEstimateRows());
      setUtilEx(0);
      setUtilSrPm(0);
      setUtilPm(0);
      setUtilPe(0);
      setUtilSrSu(0);
      setUtilSu(0);
      setUtilAsstSu(0);
      setUtilPa(0);
      setEqDumpsters(0);
      setEqToilets(0);
      setEqElectric(0);
      setQtyKnox(0);
      setQtyPayrollCleaning(0);
      setQtyHiredCleaning(0);
      setQtySoilBorings(0);
      setRateSoilBorings(0);
    }

    // Load Project Isolated Column Definitions
    const savedColumnDefs = localStorage.getItem(`takeoff_column_defs_${projectId}`);
    if (savedColumnDefs) {
      try {
        setColumnDefs(JSON.parse(savedColumnDefs));
      } catch (e) {
        console.error("Failed to parse project columnDefs", e);
      }
    }

    // Ingest project isolated cell locks from localStorage
    const savedLockedCells = localStorage.getItem(`takeoff_locked_cells_${projectId}`);
    if (savedLockedCells) {
      try {
        setLockedCells(JSON.parse(savedLockedCells));
      } catch (e) {
        console.error("Failed to parse project lockedCells", e);
      }
    }

    setIsLoaded(true);
  }, [projectId]);

  // Auto-persist column definitions when they change
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    localStorage.setItem(`takeoff_column_defs_${projectId}`, JSON.stringify(columnDefs));
  }, [columnDefs, isLoaded, projectId]);

  // UI Metrics
  const totalRows = rows.length;
  const mappedCount = rows.filter((r) => r.isMapped).length;
  const unmappedCount = totalRows - mappedCount;
  
  // Dynamic duration calculation (Months)
  const projectDurationMonths = project ? getMonthsBetween(project.expectedStart || "", project.expectedFinish || "") : 0;

  // Step 2: Division 01 General Conditions Pricing Matrix calculations
  const qtyEx = projectDurationMonths * 173.2 * (utilEx / 100);
  const totalEx = qtyEx * 175;

  const qtySrPm = projectDurationMonths * 173.2 * (utilSrPm / 100);
  const totalSrPm = qtySrPm * 135;

  const qtyPm = projectDurationMonths * 173.2 * (utilPm / 100);
  const totalPm = qtyPm * 120;

  const qtyPe = projectDurationMonths * 173.2 * (utilPe / 100);
  const totalPe = qtyPe * 85;

  const qtySrSu = projectDurationMonths * 173.2 * (utilSrSu / 100);
  const totalSrSu = qtySrSu * 125;

  const qtySu = projectDurationMonths * 173.2 * (utilSu / 100);
  const totalSu = qtySu * 110;

  const qtyAsstSu = projectDurationMonths * 173.2 * (utilAsstSu / 100);
  const totalAsstSu = qtyAsstSu * 85;

  const qtyPa = projectDurationMonths * 173.2 * (utilPa / 100);
  const totalPa = qtyPa * 55;

  // Operational Expenses
  const qtySmallTools = projectDurationMonths * (utilSu / 100);
  const totalSmallTools = qtySmallTools * 500;

  const qtyFuelVehicle = projectDurationMonths * (utilSu / 100);
  const totalFuelVehicle = qtyFuelVehicle * 1200;

  const qtyCellPhone = projectDurationMonths;
  const totalCellPhone = qtyCellPhone * 135;

  // Aggregate General Conditions Total
  const totalGCs = totalEx + totalSrPm + totalPm + totalPe + totalSrSu + totalSu + totalAsstSu + totalPa + totalSmallTools + totalFuelVehicle + totalCellPhone + eqDumpsters + eqToilets + eqElectric;

  // Step 3: Division 02 Site Operations Module calculations
  const totalSafety = projectDurationMonths * 500;
  
  const squareFootage: number = project ? project.squareFootage : 0;
  const totalTempProtection = squareFootage * 0.25;

  const totalMaterialHoist = projectDurationMonths * 6500;
  const totalKnox = qtyKnox * 650;
  const totalPayrollCleaning = qtyPayrollCleaning * 74;
  const totalHiredCleaning = qtyHiredCleaning * 54;
  const totalSoilBorings = qtySoilBorings * rateSoilBorings;

  // Aggregate Site Operations Total
  const siteOperationsTotal = totalSafety + totalTempProtection + totalMaterialHoist + totalKnox + totalPayrollCleaning + totalHiredCleaning + totalSoilBorings;

  // Step 4 Primary Takeoff Ingestion totals
  const subtotal = rows.reduce((sum, r) => sum + r.total, 0);
  const generalLiability = subtotal * 0.01;
  const fee = subtotal * 0.05;
  const totalEstimatedCost = subtotal + generalLiability + fee;

  const unitCount: number = project ? project.unitCount : 0;

  const costPerSf: number = totalEstimatedCost / (squareFootage || 1);
  const costPerUnit: number = totalEstimatedCost / (unitCount || 1);

  // Divisional & Cost Type Budget Aggregations
  const { divisionBreakdown, costTypeBreakdown } = React.useMemo(() => {
    const divisionTotals: Record<string, number> = {};
    const costTotals: Record<string, number> = {
      M: 0,
      L: 0,
      S: 0
    };

    rows.forEach((row) => {
      const code = row.itemId && row.itemId.length >= 2 ? row.itemId.substring(0, 2) : "";
      const division = /^\d{2}$/.test(code) ? code : "Unmapped";
      
      divisionTotals[division] = (divisionTotals[division] || 0) + row.total;
      
      const type = (row.costType || "M").toUpperCase();
      if (type in costTotals) {
        costTotals[type] += row.total;
      } else {
        costTotals.M += row.total;
      }
    });

    const divisionBreakdownList: DivisionAggregation[] = Object.entries(divisionTotals)
      .filter(([, total]) => total > 0)
      .map(([code, total]) => {
        const name = code === "Unmapped" ? "Unmapped Scope" : (DIVISION_NAMES[code] || `Division ${code}`);
        const percentage = (total / (subtotal || 1)) * 100;
        return { code, name, total, percentage };
      })
      .sort((a, b) => {
        if (a.code === "Unmapped") return 1;
        if (b.code === "Unmapped") return -1;
        return a.code.localeCompare(b.code);
      });

    const costTypeBreakdownList: CostTypeAggregation[] = [
      { key: "M", label: "Materials", total: costTotals.M, percentage: (costTotals.M / (subtotal || 1)) * 100 },
      { key: "L", label: "Labor", total: costTotals.L, percentage: (costTotals.L / (subtotal || 1)) * 100 },
      { key: "S", label: "Subcontract", total: costTotals.S, percentage: (costTotals.S / (subtotal || 1)) * 100 }
    ];

    return { divisionBreakdown: divisionBreakdownList, costTypeBreakdown: costTypeBreakdownList };
  }, [rows, subtotal]);

  // Auto-persist custom cell locks state when they mutate
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    localStorage.setItem(`takeoff_locked_cells_${projectId}`, JSON.stringify(lockedCells));
  }, [lockedCells, isLoaded, projectId]);

  // Auto-persist estimate state when dynamic items or calculations change
  useEffect(() => {
    if (!isLoaded || !projectId) return;

    const estimate: ProjectEstimate = {
      projectId,
      subtotal,
      generalLiability,
      fee,
      totalCost: totalEstimatedCost,
      items: rows,
      generalConditionsTotal: totalGCs,
      gcUtilization: {
        utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa
      },
      gcEquipmentOverrides: {
        eqDumpsters, eqToilets, eqElectric
      },
      siteOperationsTotal: siteOperationsTotal,
      siteOpsQuantities: {
        qtyKnox, qtyPayrollCleaning, qtyHiredCleaning, qtySoilBorings
      },
      siteOpsRates: {
        rateSoilBorings
      }
    };
    saveProjectEstimate(estimate);
  }, [
    rows, 
    projectId, 
    subtotal, 
    generalLiability, 
    fee, 
    totalEstimatedCost, 
    isLoaded,
    utilEx, utilSrPm, utilPm, utilPe, utilSrSu, utilSu, utilAsstSu, utilPa,
    eqDumpsters, eqToilets, eqElectric,
    qtyKnox, qtyPayrollCleaning, qtyHiredCleaning, qtySoilBorings,
    rateSoilBorings, siteOperationsTotal, totalGCs
  ]);

  const downloadCSVFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportExcel = () => {
    const payload = generateExcelPayload(rows, columnDefs);
    downloadCSVFile(payload, `takeoff_excel_${projectId}.csv`);
  };

  const handleExportProcore = () => {
    const payload = generateProcoreBudget(rows);
    downloadCSVFile(payload, `procore_budget_${projectId}.csv`);
  };

  const handleExportExcelWorkbook = async () => {
    setIsExportingExcel(true);
    setExportError(null);
    try {
      const blob = await generateExcelWorkbook(rows, project, columnDefs);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `takeoff_workbook_${projectId}.xlsx`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Workbook generation failed", err);
      const message = err instanceof Error ? err.message : "Failed to generate Excel Workbook.";
      setExportError(message);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry, globalRegistry);
        mergeTakeoffData(parsed);
      },
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry, globalRegistry);
        mergeTakeoffData(parsed);
      },
    });
  };

  // Comprehensive cell modification pure helper with cascading logic
  const applyCellEditDirect = (
    updated: ProcessedTakeoffRow[],
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number,
    currentRegistry: Record<string, string>
  ): Record<string, string> | null => {
    const row = updated[index];
    if (!row) return null;
    
    const classification = row.classification;
    let newRegistry: Record<string, string> | null = null;

    if (field === "itemId") {
      const newCode = String(value).trim();
      row.itemId = newCode;
      const targetItem = ESTIMATE_ITEMS_MASTER[newCode];

      // Save project-isolated mapping pair
      if (classification !== "MANUAL ENTRY") {
        newRegistry = {
          ...currentRegistry,
          [classification]: newCode,
        };
      }

      if (targetItem) {
        row.description = targetItem.description;
        row.procoreParentCode = targetItem.procoreParentCode;
        row.unitPrice = targetItem.defaultUnitPrice;
        row.uom = targetItem.targetUom;
        row.costType = targetItem.costType;
        
        const targetUom = targetItem.targetUom;
        const matched = row.rawQuantities.find(
          (m) => m.uom?.trim().toUpperCase() === targetUom.toUpperCase()
        ) || row.rawQuantities[0];
        
        const qty = matched?.qty || 0;
        row.matchedQty = qty;
        row.total = qty * targetItem.defaultUnitPrice;
        row.isMapped = true;

        // Cascade duplicates matching classification inside the project grid scope
        if (classification !== "MANUAL ENTRY") {
          for (let i = 0; i < updated.length; i++) {
            if (i !== index && updated[i].classification === classification) {
              updated[i].itemId = newCode;
              updated[i].description = targetItem.description;
              updated[i].procoreParentCode = targetItem.procoreParentCode;
              updated[i].unitPrice = targetItem.defaultUnitPrice;
              updated[i].uom = targetItem.targetUom;
              updated[i].costType = targetItem.costType;

              const m = updated[i].rawQuantities.find(
                (mq) => mq.uom?.trim().toUpperCase() === targetUom.toUpperCase()
              ) || updated[i].rawQuantities[0];

              const q = m?.qty || 0;
              updated[i].matchedQty = q;
              updated[i].total = q * targetItem.defaultUnitPrice;
              updated[i].isMapped = true;
            }
          }
        }
      } else {
        row.description = "UNMAPPED - RECONCILE CODE";
        row.procoreParentCode = "";
        row.unitPrice = 0;
        row.total = 0;
        row.isMapped = false;
        row.costType = "M";
        
        const firstMeasure = row.rawQuantities[0];
        row.matchedQty = firstMeasure?.qty || 0;
        row.uom = firstMeasure?.uom || "SF";
      }
    } else if (field === "description") {
      row.description = String(value);
      
      // Cascade description change to other rows with same classification
      if (classification !== "MANUAL ENTRY") {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].classification === classification) {
            updated[i].description = String(value);
          }
        }
      }
    } else if (field === "matchedQty") {
      const qty = typeof value === "number" ? value : parseFloat(String(value)) || 0;
      row.matchedQty = qty;
      row.total = qty * row.unitPrice;
    } else if (field === "unitPrice") {
      const price = typeof value === "number" ? value : parseFloat(String(value)) || 0;
      row.unitPrice = price;
      row.total = row.matchedQty * price;

      // Cascade unit price change to other rows with same classification
      if (classification !== "MANUAL ENTRY") {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].classification === classification) {
            updated[i].unitPrice = price;
            updated[i].total = updated[i].matchedQty * price;
          }
        }
      }
    }

    return newRegistry;
  };

  // Keyboard navigation up & down, horizontal tab, and vertical enter shifting within inputs
  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const columnsList: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
    const colIdx = columnsList.indexOf(type);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx - 1}`)?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "Tab") {
      if (e.shiftKey) {
        // Shift + Tab: Move left
        if (colIdx > 0) {
          e.preventDefault();
          document.getElementById(`${columnsList[colIdx - 1]}-input-${rIdx}`)?.focus();
        } else if (rIdx > 0) {
          e.preventDefault();
          document.getElementById(`price-input-${rIdx - 1}`)?.focus();
        }
      } else {
        // Tab: Move right
        if (colIdx < columnsList.length - 1) {
          e.preventDefault();
          document.getElementById(`${columnsList[colIdx + 1]}-input-${rIdx}`)?.focus();
        } else if (rIdx < rows.length - 1) {
          e.preventDefault();
          document.getElementById(`code-input-${rIdx + 1}`)?.focus();
        }
      }
    }
  };

  // Batch clipboard pasting (onPaste) supporting multi-row, multi-column tab/newline delimited content
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const clipboardData = e.clipboardData;
    const pastedText = clipboardData.getData("text") || "";
    
    // Process tab or newline separated data block
    if (pastedText.includes("\t") || pastedText.includes("\n") || pastedText.includes("\r")) {
      e.preventDefault();
      
      pushSnapshotToStack(rows, lockedCells);
      const columnsList: (keyof ProcessedTakeoffRow)[] = ["itemId", "description", "matchedQty", "unitPrice"];
      const fieldTypes: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
      const startColIdx = fieldTypes.indexOf(type);
      
      const lines = pastedText.split(/\r\n|\r|\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      
      const updated = [...rows];
      let currentRegistry = { ...userRegistry };
      let registryChanged = false;
      let didModify = false;
      
      let currentGlobalRegistry = { ...globalRegistry };
      let globalRegistryChanged = false;
      
      for (let i = 0; i < lines.length; i++) {
        const targetRowIdx = startRowIdx + i;
        if (targetRowIdx >= updated.length) break;
        
        const line = lines[i];
        const cells = line.split("\t");
        
        for (let j = 0; j < cells.length; j++) {
          const targetColIdx = startColIdx + j;
          if (targetColIdx >= columnsList.length) break;
          
          const field = columnsList[targetColIdx];
          const rawValue = cells[j];
          
          didModify = true;
          
          const resultRegistry = applyCellEditDirect(updated, targetRowIdx, field, rawValue, currentRegistry);
          if (resultRegistry) {
            currentRegistry = resultRegistry;
            registryChanged = true;
            
            if (field === "itemId") {
              const row = updated[targetRowIdx];
              if (row) {
                currentGlobalRegistry = {
                  ...currentGlobalRegistry,
                  [row.classification]: String(rawValue).trim()
                };
                globalRegistryChanged = true;
              }
            }
          }
        }
      }
      
      if (didModify) {
        if (registryChanged) {
          setUserRegistry(currentRegistry);
          localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(currentRegistry));
        }
        if (globalRegistryChanged) {
          setGlobalRegistry(currentGlobalRegistry);
          localStorage.setItem("takeoff_global_user_registry", JSON.stringify(currentGlobalRegistry));
        }
        setRows(updated);
      }
    }
  };

  // Central onCellEditChange cell modification handler using applyCellEditDirect Cascader
  const handleCellEdit = (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => {
    pushSnapshotToStack(rows, lockedCells);
    const updated = [...rows];
    const newRegistry = applyCellEditDirect(updated, index, field, value, userRegistry);
    
    const classification = updated[index]?.classification;
    if (classification !== "MANUAL ENTRY") {
      if (newRegistry) {
        setUserRegistry(newRegistry);
        localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(newRegistry));
        
        // Update global company harvested registry overrides simultaneously
        if (classification && field === "itemId") {
          const newGlobalRegistry = {
            ...globalRegistry,
            [classification]: String(value).trim(),
          };
          setGlobalRegistry(newGlobalRegistry);
          localStorage.setItem("takeoff_global_user_registry", JSON.stringify(newGlobalRegistry));
        }
      }
    }
    setRows(updated);
  };

  // Dynamic custom cell edits and keys down
  const handleCustomCellEdit = (rowIndex: number, columnId: string, value: string) => {
    pushSnapshotToStack(rows, lockedCells);
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };
      row.customFields = {
        ...(row.customFields || {}),
        [columnId]: value,
      };
      updated[rowIndex] = row;
      return updated;
    });
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent, rIdx: number, colId: string) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx - 1}`)?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx + 1}`)?.focus();
    }
  };

  const handleAddCustomColumn = () => {
    pushSnapshotToStack(rows, lockedCells);
    const newColId = `custom-${Date.now()}`;
    const newColDef: ColumnDefinition = {
      id: newColId,
      header: "NEW COLUMN",
      type: "custom",
    };
    setColumnDefs((prev) => [...prev, newColDef]);
  };

  const handleDeleteColumn = (colId: string) => {
    pushSnapshotToStack(rows, lockedCells);
    setColumnDefs((prev) => prev.filter((col) => col.id !== colId));
  };

  const handleRenameColumn = (colId: string, newHeader: string) => {
    setColumnDefs((prev) =>
      prev.map((col) => (col.id === colId ? { ...col, header: newHeader } : col))
    );
  };

  // Define column builder using createColumnHelper and dynamic state mapping
  const columns = React.useMemo(() => {
    const columnHelper = createColumnHelper<ProcessedTakeoffRow>();
    return columnDefs.map((def) => {
      if (def.type === "default") {
        switch (def.id) {
          case "costType":
            return columnHelper.accessor("costType", {
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const val = row.costType || "TI";
                return (
                  <div className="text-center font-bold">
                    <span className="text-[10px] bg-neutral-900 border border-neutral-800 text-neutral-400 px-2 py-0.5 rounded-md tracking-widest uppercase">
                      {val}
                    </span>
                  </div>
                );
              },
            });
          case "itemId":
            return columnHelper.accessor("itemId", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::itemId`];
                return (
                  <div className="flex flex-col gap-2 w-full text-left">
                    <input
                      id={`code-input-${index}`}
                      type="text"
                      list="estimate-items-options"
                      disabled={isCellHardLocked}
                      className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-mono text-xs uppercase transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-neutral-900/50 ${
                        isCellHardLocked
                          ? "text-neutral-500 bg-neutral-950/30 cursor-not-allowed opacity-60"
                          : row.isMapped
                            ? "text-neutral-100"
                            : "text-amber-500 bg-amber-955/10"
                      }`}
                      value={row.itemId}
                      onChange={(e) => handleCellEdit(index, "itemId", e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, "code")}
                      onPaste={(e) => handlePaste(e, index, "code")}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          visible: true,
                          x: e.clientX,
                          y: e.clientY,
                          rowIndex: index,
                          columnId: "itemId"
                        });
                      }}
                      placeholder="Assign code..."
                    />
                    {!row.isMapped && (
                      <div className="flex flex-col gap-1 mt-1 text-left px-3 pb-2">
                        <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold">Suggestions:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {getFuzzySuggestions(row.classification, ESTIMATE_ITEMS_MASTER).map((sugg) => (
                            <button
                              key={sugg.itemId}
                              type="button"
                              disabled={isCellHardLocked}
                              onClick={() => handleCellEdit(index, "itemId", sugg.itemId)}
                              title={sugg.description}
                              className="bg-neutral-900 hover:bg-amber-955/40 text-amber-500/90 hover:text-amber-400 border border-neutral-800 hover:border-amber-800/80 rounded px-2 py-0.5 text-[10px] font-sans font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {sugg.itemId}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              },
            });
          case "description":
            return columnHelper.accessor("description", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::description`];
                return (
                  <input
                    id={`desc-input-${index}`}
                    type="text"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-neutral-900/50 ${
                      isCellHardLocked
                        ? "text-neutral-500 bg-neutral-955/30 cursor-not-allowed opacity-60"
                        : "text-neutral-100"
                    }`}
                    value={row.description}
                    onChange={(e) => handleCellEdit(index, "description", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "desc")}
                    onPaste={(e) => handlePaste(e, index, "desc")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        rowIndex: index,
                        columnId: "description"
                      });
                    }}
                  />
                );
              },
            });
          case "matchedQty":
            return columnHelper.accessor("matchedQty", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::matchedQty`];
                return (
                  <input
                    id={`qty-input-${index}`}
                    type="number"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-right font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-neutral-900/50 ${
                      isCellHardLocked
                        ? "text-neutral-500 bg-neutral-955/30 cursor-not-allowed opacity-60"
                        : "text-white"
                    }`}
                    value={row.matchedQty}
                    onChange={(e) => handleCellEdit(index, "matchedQty", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "qty")}
                    onPaste={(e) => handlePaste(e, index, "qty")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        rowIndex: index,
                        columnId: "matchedQty"
                      });
                    }}
                  />
                );
              },
            });
          case "uom":
            return columnHelper.accessor("uom", {
              header: def.header,
              cell: (info) => (
                <div className="text-center text-neutral-400 font-bold uppercase">
                  {info.getValue()}
                </div>
              ),
            });
          case "unitPrice":
            return columnHelper.accessor("unitPrice", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::unitPrice`];
                return (
                  <input
                    id={`price-input-${index}`}
                    type="number"
                    step="0.01"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-right font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-neutral-900/50 ${
                      isCellHardLocked
                        ? "text-neutral-500 bg-neutral-955/30 cursor-not-allowed opacity-60"
                        : "text-white"
                    }`}
                    value={row.unitPrice}
                    onChange={(e) => handleCellEdit(index, "unitPrice", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "price")}
                    onPaste={(e) => handlePaste(e, index, "price")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        rowIndex: index,
                        columnId: "unitPrice"
                      });
                    }}
                  />
                );
              },
            });
          case "total":
            return columnHelper.accessor("total", {
              header: def.header,
              cell: (info) => (
                <div className="text-right font-black">
                  <span className={info.getValue() > 0 ? "text-emerald-450" : "text-neutral-600"}>
                    ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ),
            });
          case "costPerUnit":
            return columnHelper.display({
              id: "costPerUnit",
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const cpu = row.total / (unitCount || 1);
                return (
                  <div className="text-right font-bold text-neutral-400">
                    ${cpu.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                );
              }
            });
          case "costPerSf":
            return columnHelper.display({
              id: "costPerSf",
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const cpsf = row.total / (squareFootage || 1);
                return (
                  <div className="text-right font-bold text-neutral-400">
                    ${cpsf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                );
              }
            });
          default:
            return columnHelper.display({ id: def.id, header: def.header });
        }
      } else {
        // Custom Column
        return columnHelper.accessor((row) => row.customFields?.[def.id] ?? "", {
          id: def.id,
          header: def.header,
          cell: (info) => {
            const index = info.row.index;
            const row = info.row.original;
            const isCellHardLocked = !!lockedCells[`${row.id}::${def.id}`];
            const val = row.customFields?.[def.id] ?? "";
            return (
              <input
                id={`custom-${def.id}-input-${index}`}
                type="text"
                disabled={isCellHardLocked}
                className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-neutral-900/50 ${
                  isCellHardLocked
                    ? "text-neutral-500 bg-neutral-955/30 cursor-not-allowed opacity-60"
                    : "text-neutral-100"
                }`}
                value={val}
                onChange={(e) => handleCustomCellEdit(index, def.id, e.target.value)}
                onKeyDown={(e) => handleCustomKeyDown(e, index, def.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    visible: true,
                    x: e.clientX,
                    y: e.clientY,
                    rowIndex: index,
                    columnId: def.id
                  });
                }}
                placeholder="..."
              />
            );
          }
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefs, lockedCells, unitCount, squareFootage, userRegistry, globalRegistry]);

  // Instantiate useReactTable Core Hook
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  if (!project) {
    return (
      <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-mono items-center justify-center p-8">
        <AlertTriangle className="text-amber-500 mb-4 animate-bounce" size={48} />
        <h3 className="text-lg font-bold text-white mb-2">Project Database Node Offline</h3>
        <p className="text-xs text-neutral-400 mb-6">Requested Project ID does not exist in local cache.</p>
        <Link href="/projects" className="bg-neutral-900 border border-neutral-800 text-xs px-5 py-2.5 rounded font-bold uppercase hover:border-neutral-700 transition-colors">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-mono p-8 selection:bg-blue-600/30 selection:text-blue-200">
      {/* Breadcrumb Back Navigation */}
      <div className="mb-4">
        <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-400 transition-colors uppercase tracking-widest font-bold font-sans">
          <ChevronLeft size={16} /> Back to Directory
        </Link>
      </div>

      {/* Header Panel */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-850 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-wider text-white">
              {project.name}
            </h1>
            <span className="text-[10px] bg-blue-955 border border-blue-900 text-blue-450 px-2 py-0.5 rounded-md font-bold tracking-widest uppercase">
              {project.id}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 mt-3 text-neutral-450 text-xs items-center uppercase font-semibold">
            <span className="flex items-center gap-1"><MapPin size={13} className="text-neutral-500" /> {project.location}</span>
            <span className="text-neutral-700">|</span>
            <span className="flex items-center gap-1"><Calendar size={13} className="text-neutral-500" /> Bid: {project.bidDate}</span>
            <span className="text-neutral-700">|</span>
            <span>Size: {project.squareFootage.toLocaleString()} SF</span>
            <span className="text-neutral-700">|</span>
            <span>Units: {project.unitCount.toLocaleString()}</span>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          {rows.length > 0 && (
            <>
              <button 
                onClick={handleExportExcelWorkbook}
                disabled={unmappedCount > 0 || isExportingExcel}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-blue-955/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} className={isExportingExcel ? "animate-spin" : ""} /> 
                {isExportingExcel ? "Compiling Workbook..." : "Download Full Estimate Workbook (.xlsx)"}
              </button>
              <button 
                onClick={handleExportExcel}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-800 hover:border-neutral-750 text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} /> Export Excel Payload
              </button>
              <button 
                onClick={handleExportProcore}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-emerald-955/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} /> Export Procore Budget
              </button>
            </>
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex border-b border-neutral-850 mb-6 gap-2 select-none overflow-x-auto">
        {[
          { id: "step1", label: "Multi-Family Layout" },
          { id: "step2", label: "GC Personnel" },
          { id: "step3", label: "Jobsite Infrastructure" },
          { id: "step4", label: "Takeoff Ingestion" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-xs uppercase tracking-wider font-bold font-sans transition-all border-b-2 whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-400 bg-neutral-900/30"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {exportError && (
        <div className="bg-red-955/40 border border-red-900/50 rounded-xl p-4 flex items-center gap-3 text-red-400 text-xs font-mono animate-shake mb-6">
          <AlertTriangle className="text-red-500 animate-pulse" size={16} />
          <span><strong>System Alert:</strong> {exportError}</span>
          <button 
            onClick={() => setExportError(null)} 
            className="ml-auto bg-transparent hover:text-white font-bold uppercase text-[10px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* STEP 1 PANEL */}
      {activeTab === "step1" && (
        <div className="bg-neutral-900/40 border border-neutral-850 rounded-xl p-6 shadow-xl animate-fade-in">
          <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-6 flex items-center gap-2">
            <Activity size={16} className="text-blue-500" /> Architectural Parameters & Schedule Constraints
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-mono text-xs">
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Project Name</label>
              <input
                type="text"
                className="bg-neutral-950 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.name}
                onChange={(e) => handleProjectParamChange("name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Location</label>
              <input
                type="text"
                className="bg-neutral-950 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.location}
                onChange={(e) => handleProjectParamChange("location", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Bid Date</label>
              <input
                type="text"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.bidDate}
                onChange={(e) => handleProjectParamChange("bidDate", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Expected Start Date</label>
              <input
                type="date"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.expectedStart || ""}
                onChange={(e) => handleProjectParamChange("expectedStart", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Expected Finish Date</label>
              <input
                type="date"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.expectedFinish || ""}
                onChange={(e) => handleProjectParamChange("expectedFinish", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Project Size (SF)</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.squareFootage}
                onChange={(e) => handleProjectParamChange("squareFootage", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Unit Count</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.unitCount}
                onChange={(e) => handleProjectParamChange("unitCount", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Building Perimeter (LF)</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.buildingPerimeter || 0}
                onChange={(e) => handleProjectParamChange("buildingPerimeter", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Building Footprint (SF)</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.buildingFootprint || 0}
                onChange={(e) => handleProjectParamChange("buildingFootprint", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Podium Area (SF)</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.podiumArea || 0}
                onChange={(e) => handleProjectParamChange("podiumArea", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Woodframed Area (SF)</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.woodframedArea || 0}
                onChange={(e) => handleProjectParamChange("woodframedArea", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-neutral-400 font-bold uppercase tracking-wider">Levels Above Podium</label>
              <input
                type="number"
                className="bg-neutral-955 border border-neutral-850 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-white outline-none font-bold transition-all"
                value={project.levelsAbovePodium || 0}
                onChange={(e) => handleProjectParamChange("levelsAbovePodium", Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 PANEL */}
      {activeTab === "step2" && (
        <div className="bg-neutral-955 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl animate-fade-in">
          <div className="p-4 bg-neutral-900/50 border-b border-neutral-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-blue-500" /> Division 01 General Conditions Pricing Matrix
            </h3>
            <span className="text-[10px] bg-neutral-800 text-neutral-400 px-3 py-1 rounded-full border border-neutral-700 font-mono">
              Active Schedule Duration: {projectDurationMonths} Months
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-800 tracking-wider font-semibold">
                  <th className="p-4 text-center w-28">Code</th>
                  <th className="p-4 text-left">Staff Role / Operational Scope</th>
                  <th className="p-4 text-center w-20">Unit</th>
                  <th className="p-4 text-right w-32">Rate</th>
                  <th className="p-4 text-right w-44">Utilization</th>
                  <th className="p-4 text-right w-40">Calculated Qty</th>
                  <th className="p-4 text-right w-36">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850 text-neutral-355">
                {/* Staff Labor Directs */}
                <tr className="bg-neutral-900/20 text-neutral-400 font-bold">
                  <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-neutral-900/40">01.A - Staff Labour Directs</td>
                </tr>
                {[
                  { code: "01-0310", role: "Project Executive", rate: 175, util: utilEx, setUtil: setUtilEx, qty: qtyEx, total: totalEx },
                  { code: "01-0320", role: "Sr Project Manager", rate: 135, util: utilSrPm, setUtil: setUtilSrPm, qty: qtySrPm, total: totalSrPm },
                  { code: "01-0330", role: "Project Manager", rate: 120, util: utilPm, setUtil: setUtilPm, qty: qtyPm, total: totalPm },
                  { code: "01-0340", role: "Project Engineer", rate: 85, util: utilPe, setUtil: setUtilPe, qty: qtyPe, total: totalPe },
                  { code: "01-0410", role: "Sr Superintendent", rate: 125, util: utilSrSu, setUtil: setUtilSrSu, qty: qtySrSu, total: totalSrSu },
                  { code: "01-0420", role: "Superintendent", rate: 110, util: utilSu, setUtil: setUtilSu, qty: qtySu, total: totalSu },
                  { code: "01-0430", role: "Asst. Superintendent", rate: 85, util: utilAsstSu, setUtil: setUtilAsstSu, qty: qtyAsstSu, total: totalAsstSu },
                  { code: "01-0510", role: "Project Assistant", rate: 55, util: utilPa, setUtil: setUtilPa, qty: qtyPa, total: totalPa }
                ].map((row) => (
                  <tr key={row.code} className="hover:bg-neutral-900/30">
                    <td className="p-3 text-center text-blue-500 font-semibold">{row.code}</td>
                    <td className="p-3 text-left font-bold text-neutral-200">{row.role}</td>
                    <td className="p-3 text-center">hr</td>
                    <td className="p-3 text-right">${row.rate.toFixed(2)}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded px-2 py-1 w-16 text-right text-white font-bold outline-none"
                          value={row.util}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
                            row.setUtil(Math.min(100, Math.max(0, v)));
                          }}
                        />
                        <span className="text-neutral-500 text-[10px]">%</span>
                      </div>
                    </td>
                    <td className="p-3 text-right font-bold text-neutral-500">{row.qty.toFixed(1)} hrs</td>
                    <td className="p-3 text-right text-emerald-450 font-bold">${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}

                {/* Operational Expenses */}
                <tr className="bg-neutral-900/20 text-neutral-400 font-bold">
                  <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-neutral-900/40">01.B - Operational Expenses</td>
                </tr>
                {[
                  { code: "01-1000", desc: "Small Tools (Bound to Superintendent)", unit: "mo", rate: 500, qty: qtySmallTools, total: totalSmallTools },
                  { code: "01-1200", desc: "Fuel and Vehicle Charges (Bound to Superintendent)", unit: "mo", rate: 1200, qty: qtyFuelVehicle, total: totalFuelVehicle },
                  { code: "01-5111", desc: "Cell Phone (Fixed Baseline)", unit: "mo", rate: 135, qty: qtyCellPhone, total: totalCellPhone }
                ].map((row) => (
                  <tr key={row.code} className="hover:bg-neutral-900/30">
                    <td className="p-3 text-center text-blue-500 font-semibold">{row.code}</td>
                    <td className="p-3 text-left font-bold text-neutral-200">{row.desc}</td>
                    <td className="p-3 text-center">{row.unit}</td>
                    <td className="p-3 text-right">${row.rate.toFixed(2)}</td>
                    <td className="p-3 text-right text-neutral-500">auto</td>
                    <td className="p-3 text-right font-bold text-neutral-505">{row.qty.toFixed(2)} mos</td>
                    <td className="p-3 text-right text-emerald-455 font-bold">${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}

                {/* Site Equipment & Overrides */}
                <tr className="bg-neutral-900/20 text-neutral-400 font-bold">
                  <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-neutral-900/40">01.C - Site Equipment & Mobilization Overrides</td>
                </tr>
                {[
                  { code: "01-5130", desc: "Dumpsters (Lump Sum)", val: eqDumpsters, field: "dumpsters" },
                  { code: "01-5140", desc: "Temp Toilets (Lump Sum)", val: eqToilets, field: "toilets" },
                  { code: "01-5170", desc: "Temp Electric (Lump Sum)", val: eqElectric, field: "electric" }
                ].map((row) => (
                  <tr key={row.code} className="hover:bg-neutral-900/30">
                    <td className="p-3 text-center text-blue-500 font-semibold">{row.code}</td>
                    <td className="p-3 text-left font-bold text-neutral-200">{row.desc}</td>
                    <td className="p-3 text-center">ls</td>
                    <td className="p-3 text-right">—</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <span className="text-neutral-500 text-[10px]">$</span>
                        <input
                          type="number"
                          className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded px-2 py-1 w-24 text-right text-white font-bold outline-none"
                          value={row.val === 0 ? "" : row.val}
                          placeholder="0.00"
                          onChange={(e) => handleEquipmentChange(row.field as "dumpsters" | "toilets" | "electric", e.target.value)}
                        />
                      </div>
                    </td>
                    <td className="p-3 text-right text-neutral-500">—</td>
                    <td className="p-3 text-right text-emerald-455 font-bold">${row.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}

                {/* Subtotal Row */}
                <tr className="bg-neutral-900 border-t border-neutral-800 text-xs font-black text-white">
                  <td className="p-4 text-center">TOTAL</td>
                  <td colSpan={5} className="p-4 text-left uppercase tracking-wider text-[10px] text-neutral-500">Cumulative Division 01 General Conditions Cost</td>
                  <td className="p-4 text-right text-emerald-455 text-sm font-black">
                    ${totalGCs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 3 PANEL */}
      {activeTab === "step3" && (
        <div className="bg-neutral-955 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl animate-fade-in">
          <div className="p-4 bg-neutral-900/50 border-b border-neutral-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-blue-500" /> Division 02 Site Operations Calculation Module
            </h3>
            <span className="text-[10px] bg-neutral-800 text-neutral-400 px-3 py-1 rounded-full border border-neutral-700 font-mono">
              Active SF: {squareFootage.toLocaleString()} SF | Duration: {projectDurationMonths} Mos
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-800 tracking-wider font-semibold">
                  <th className="p-4 text-center w-28">Code</th>
                  <th className="p-4 text-left">Description</th>
                  <th className="p-4 text-center w-20">Unit</th>
                  <th className="p-4 text-right w-32">Rate</th>
                  <th className="p-4 text-right w-44">Override Value</th>
                  <th className="p-4 text-right w-40">Calculated Qty</th>
                  <th className="p-4 text-right w-36">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850 text-neutral-355">
                {/* Injected Dynamic Operations */}
                <tr className="bg-neutral-900/20 text-neutral-400 font-bold">
                  <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-neutral-900/40">02.A - Injected Dynamic Operations</td>
                </tr>
                {[
                  { code: "02-9015", desc: "Safety (Rate $500/mo, Quantity defaults to schedule duration)", unit: "mo", rate: 500, qty: projectDurationMonths, total: totalSafety },
                  { code: "02-9020", desc: "Temp Protection (Rate $0.25/sf, Quantity defaults to project square footage)", unit: "sf", rate: 0.25, qty: squareFootage, total: totalTempProtection },
                  { code: "02-9405", desc: "Material Hoist / Trash Chute (Rate $6,500/mo, Quantity defaults to duration)", unit: "mo", rate: 6500, qty: projectDurationMonths, total: totalMaterialHoist }
                ].map((row) => (
                  <tr key={row.code} className="hover:bg-neutral-900/30">
                    <td className="p-3 text-center text-blue-500 font-semibold">{row.code}</td>
                    <td className="p-3 text-left font-bold text-neutral-200">{row.desc}</td>
                    <td className="p-3 text-center">{row.unit}</td>
                    <td className="p-3 text-right">${row.rate.toFixed(2)}</td>
                    <td className="p-3 text-right text-neutral-500">auto</td>
                    <td className="p-3 text-right font-bold text-neutral-550">{row.qty.toLocaleString()} {row.unit}</td>
                    <td className="p-3 text-right text-emerald-400 font-bold">${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}

                {/* Manual Estimation Entries */}
                <tr className="bg-neutral-900/20 text-neutral-400 font-bold">
                  <td colSpan={7} className="p-3 uppercase tracking-wider text-[10px] bg-neutral-900/40">02.B - Manual Estimation Entries</td>
                </tr>
                {[
                  { code: "02-9307", desc: "Knox Box (Rate $650/ea)", unit: "ea", rate: 650, val: qtyKnox, field: "knox", isRateEditable: false },
                  { code: "02-9010", desc: "Progress Cleaning - Payroll (Rate $74/hr)", unit: "hr", rate: 74, val: qtyPayrollCleaning, field: "payroll", isRateEditable: false },
                  { code: "02-9010", desc: "Progress Cleaning - Hired (Rate $54/hr)", unit: "hr", rate: 54, val: qtyHiredCleaning, field: "hired", isRateEditable: false },
                  { code: "02-3200", desc: "Soil Borings (Lump Sum custom overrides)", unit: "ls", rate: rateSoilBorings, val: qtySoilBorings, field: "soilQty", isRateEditable: true }
                ].map((row) => (
                  <tr key={`${row.code}-${row.field}`} className="hover:bg-neutral-900/30">
                    <td className="p-3 text-center text-blue-500 font-semibold">{row.code}</td>
                    <td className="p-3 text-left font-bold text-neutral-200">{row.desc}</td>
                    <td className="p-3 text-center">{row.unit}</td>
                    <td className="p-3 text-right">
                      {row.isRateEditable ? (
                        <div className="flex items-center gap-1 justify-end">
                          <span className="text-neutral-500 text-[10px]">$</span>
                          <input
                            type="number"
                            className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded px-2 py-1 w-20 text-right text-white font-bold outline-none"
                            value={rateSoilBorings === 0 ? "" : rateSoilBorings}
                            placeholder="0.00"
                            onChange={(e) => handleSiteOpsChange("soilRate", e.target.value)}
                          />
                        </div>
                      ) : (
                        <span>${row.rate.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        min="0"
                        className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded px-2 py-1 w-20 text-right text-white font-bold outline-none"
                        value={row.val === 0 ? "" : row.val}
                        placeholder="0"
                        onChange={(e) => handleSiteOpsChange(row.field as "knox" | "payroll" | "hired" | "soilQty" | "soilRate", e.target.value)}
                      />
                    </td>
                    <td className="p-3 text-right text-neutral-500">—</td>
                    <td className="p-3 text-right text-emerald-400 font-bold">
                      ${(row.val * row.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}

                {/* Subtotal Row */}
                <tr className="bg-neutral-900 border-t border-neutral-800 text-xs font-black text-white">
                  <td className="p-4 text-center">TOTAL</td>
                  <td colSpan={5} className="p-4 text-left uppercase tracking-wider text-[10px] text-neutral-550">Cumulative Division 02 Site Operations Cost</td>
                  <td className="p-4 text-right text-emerald-450 text-sm font-black">
                    ${siteOperationsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 4 PANEL */}
      {activeTab === "step4" && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Ingestion Module Tray */}
          <div className="bg-neutral-900/40 border border-neutral-850 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Left side: Compact Ingest / Drop Takeoff CSV box */}
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`relative flex-1 max-w-md border border-dashed rounded-lg p-4 text-center transition-all ${
                dragActive 
                  ? "border-blue-500 bg-blue-955/20 scale-[1.01]" 
                  : "border-neutral-800 bg-neutral-955/40 hover:border-neutral-750"
              }`}
            >
              <label className="flex flex-col items-center justify-center cursor-pointer select-none">
                <div className="flex items-center gap-2 text-neutral-300">
                  <Upload size={16} className={dragActive ? "text-blue-500 animate-bounce" : "text-neutral-400"} />
                  <span className="text-xs font-bold uppercase tracking-wider">Ingest / Drop Takeoff CSV</span>
                </div>
                <span className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wide">Drag here or click to browse</span>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            {/* Right side: Append Data toggler, Undo Action, and Add Custom Column buttons side-by-side */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-850 rounded-lg px-4 py-2.5 text-xs text-neutral-300 transition-colors hover:border-neutral-750 select-none">
                <input
                  id="append-checkbox-step4"
                  type="checkbox"
                  checked={appendData}
                  onChange={(e) => setAppendData(e.target.checked)}
                  className="w-4 h-4 rounded border-neutral-750 text-blue-600 focus:ring-blue-500 bg-neutral-800 cursor-pointer"
                />
                <label htmlFor="append-checkbox-step4" className="cursor-pointer font-bold uppercase tracking-wider">
                  Append Data
                </label>
              </div>

              <button
                onClick={handleAddCustomColumn}
                type="button"
                className="inline-flex items-center gap-1.5 bg-neutral-955 hover:bg-blue-955/40 text-blue-450 hover:text-blue-400 border border-neutral-800 rounded-lg px-4 py-2.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer select-none"
              >
                + Add Custom Column
              </button>

              <button
                onClick={() => {
                  const nextStack = [...historyStack];
                  const previousSnapshot = nextStack.pop();
                  if (previousSnapshot) {
                    setRows(previousSnapshot.items);
                    setLockedCells(previousSnapshot.locks);
                    setHistoryStack(nextStack);
                  }
                }}
                disabled={historyStack.length === 0}
                className="inline-flex items-center gap-1.5 bg-neutral-955 hover:bg-amber-955/40 text-amber-500 disabled:text-neutral-600 hover:text-amber-400 border border-neutral-800 disabled:border-neutral-900 disabled:hover:bg-transparent rounded-lg px-4 py-2.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer disabled:cursor-not-allowed select-none"
              >
                <RotateCcw size={14} /> Undo Action ({historyStack.length})
              </button>
            </div>
          </div>

          {unmappedTakeoffClassifications.length > 0 && (
            <div className="bg-amber-955/20 border border-amber-900/50 rounded-xl p-4 flex flex-col gap-2 font-mono text-xs text-amber-500 animate-shake">
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
                <AlertTriangle className="text-amber-500 animate-pulse" size={16} />
                <span>Notice: Unmapped Classifications Detected</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-relaxed uppercase">
                The following {unmappedTakeoffClassifications.length} classification(s) from your takeoff CSV were skipped because they are not yet mapped to any corporate code in your registry:
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {unmappedTakeoffClassifications.map((cl) => (
                  <span key={cl} className="bg-neutral-900 border border-neutral-800 text-[10px] text-amber-500/80 px-2.5 py-1 rounded font-bold">
                    {cl}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-right">
                <Link href="/registry" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-blue-400 hover:text-blue-300 transition-colors">
                  Go to Global Registry to Add Mappings &rarr;
                </Link>
              </div>
            </div>
          )}

          {/* Spreadsheet Layout Matrix: Rows 2-4 Profile Header */}
          <div className="bg-neutral-955 border border-neutral-850 rounded-xl overflow-hidden shadow-xl font-mono text-xs">
            {/* Sheet title bar */}
            <div className="bg-neutral-900/60 border-b border-neutral-850 px-4 py-2.5 text-neutral-400 font-bold uppercase tracking-wider flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Grid size={16} className="text-blue-500" />
                <span>STEP 4 - COMPANY ESTIMATE WORKBOOK</span>
              </div>
              <span className="text-[10px] bg-neutral-800 border border-neutral-750 px-2 py-0.5 rounded text-neutral-500">ROWS 2-4</span>
            </div>
            
            {/* Grid matrix mapping rows 2-4 */}
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-neutral-850">
              {/* Row 2 info */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">PROJECT NAME:</span>
                  <span className="text-white font-extrabold text-right truncate max-w-[200px]" title={project.name}>{project.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">EXPECTED START:</span>
                  <span className="text-neutral-200 font-bold font-mono">{project.expectedStart || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">EXPECTED FINISH:</span>
                  <span className="text-neutral-200 font-bold font-mono">{project.expectedFinish || "—"}</span>
                </div>
              </div>

              {/* Row 3 info */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">LOCATION:</span>
                  <span className="text-white font-bold truncate max-w-[200px]" title={project.location}>{project.location}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">PROJECT SIZE (SF):</span>
                  <span className="text-neutral-200 font-bold font-mono">{project.squareFootage.toLocaleString()} SF</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">EST. DURATION:</span>
                  <span className="text-cyan-400 font-bold font-mono">{projectDurationMonths} MONTHS</span>
                </div>
              </div>

              {/* Row 4 info */}
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">BID DATE:</span>
                  <span className="text-white font-bold">{project.bidDate}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">TOTAL UNITS:</span>
                  <span className="text-neutral-200 font-bold font-mono">{project.unitCount.toLocaleString()} UNITS</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-bold uppercase tracking-wider text-[10px]">EST. COST / S.F.:</span>
                  <span className="text-emerald-450 font-black font-mono">${costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / SF</span>
                </div>
              </div>
            </div>
          </div>

          {/* Division Summary Analytics Drawer */}
          {rows.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border border-neutral-855 bg-neutral-950 rounded-xl p-5 shadow-2xl font-mono text-xs">
              {/* Left Column: Divisional Breakdown */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2 text-[10px] text-neutral-550 uppercase tracking-widest font-bold">
                  <span>[SYS.ANALYTICS // DIVISIONAL BREAKDOWN]</span>
                  <span>Subtotal Contribution</span>
                </div>
                {divisionBreakdown.length === 0 ? (
                  <div className="text-neutral-600 italic py-4">No active divisions mapped.</div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
                    {divisionBreakdown.map((div) => (
                      <div key={div.code} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-blue-500 font-bold w-6 text-right shrink-0">{div.code}</span>
                          <span className="text-neutral-300 font-bold truncate shrink-0 max-w-[120px] sm:max-w-[180px]">{div.name}</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono shrink-0 ml-auto">
                          <span className="text-neutral-500 text-[10px] hidden sm:inline font-bold">
                            [{getTerminalProgressBar(div.percentage)}]
                          </span>
                          <span className="text-neutral-400 text-right w-12 font-bold">{div.percentage.toFixed(1)}%</span>
                          <span className="text-emerald-450 text-right w-24 font-bold">
                            ${div.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Cost Type Breakdown */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center border-b border-neutral-800 pb-2 text-[10px] text-neutral-555 uppercase tracking-widest font-bold">
                  <span>[SYS.ANALYTICS // COST TYPE SCOPES]</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {costTypeBreakdown.map((ct) => {
                    let accentColor = "border-neutral-800 text-neutral-400";
                    let badgeBg = "bg-neutral-900 text-neutral-400 border-neutral-800";
                    if (ct.key === "M") {
                      accentColor = "border-emerald-900/60 hover:border-emerald-800 bg-emerald-950/5 text-emerald-455";
                      badgeBg = "bg-emerald-950/40 text-emerald-450 border-emerald-900/50";
                    } else if (ct.key === "L") {
                      accentColor = "border-cyan-900/60 hover:border-cyan-800 bg-cyan-955/5 text-cyan-455";
                      badgeBg = "bg-cyan-950/40 text-cyan-405 border-cyan-900/50";
                    } else if (ct.key === "S") {
                      accentColor = "border-amber-900/60 hover:border-amber-800 bg-amber-955/5 text-amber-500";
                      badgeBg = "bg-amber-950/40 text-amber-500 border-amber-900/50";
                    }
                    return (
                      <div
                        key={ct.key}
                        className={`flex flex-col justify-between p-4 border rounded-xl transition-all ${accentColor}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-extrabold uppercase text-[10px] tracking-wider">{ct.label}</span>
                          <span className={`text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${badgeBg}`}>
                            {ct.key}
                          </span>
                        </div>
                        <div className="mt-2">
                          <h4 className="text-neutral-100 text-base font-black">
                            ${ct.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </h4>
                          <p className="text-[10px] text-neutral-550 mt-1 font-bold">
                            {ct.percentage.toFixed(1)}% of subtotal
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Re-Architected workbook template grid */}
          <div className="bg-neutral-955 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 bg-neutral-900/50 border-b border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
                <Activity size={16} className="text-blue-500 animate-pulse" /> Takeoff Workbook Spreadsheet Matrix
              </h3>
              <span className="text-[10px] bg-neutral-850 text-neutral-400 px-3 py-1 rounded-full border border-neutral-750 font-mono">
                Keyboard Engine Online | Use Arrow Keys ↑↓ to Navigate inputs
              </span>
            </div>

            <div className="overflow-x-auto border-t border-l border-neutral-800">
              <table className="w-full text-left text-xs border-separate border-spacing-0">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr 
                      key={headerGroup.id} 
                      className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-800 tracking-wider font-semibold font-mono"
                    >
                      {headerGroup.headers.map((header) => {
                        let alignClass = "text-left";
                        if (header.id === "costType" || header.id === "uom") alignClass = "text-center";
                        if (["matchedQty", "unitPrice", "total", "costPerUnit", "costPerSf"].includes(header.id)) alignClass = "text-right";
                        
                        const colDef = columnDefs.find(c => c.id === header.column.id);
                        const isCustom = colDef && colDef.type === "custom";

                        return (
                          <th 
                            key={header.id} 
                            className={`p-4 border-r border-b border-neutral-800 relative group/header ${alignClass}`}
                            style={{ width: header.getSize() }}
                          >
                            {header.isPlaceholder ? null : isCustom ? (
                              <div className="flex items-center gap-1.5 justify-start">
                                <input
                                  type="text"
                                  value={colDef.header}
                                  onChange={(e) => handleRenameColumn(colDef.id, e.target.value)}
                                  className="bg-neutral-900/80 border border-neutral-800 focus:border-blue-500 rounded px-2 py-1 text-xs text-neutral-100 font-bold outline-none uppercase w-28 text-left"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDeleteColumn(colDef.id)}
                                  title="Delete Column"
                                  className="text-neutral-500 hover:text-red-400 font-bold text-xs p-1 transition-colors cursor-pointer animate-fade-in"
                                >
                                  ×
                                </button>
                              </div>
                            ) : (
                              flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )
                            )}
                            {header.column.getCanResize() && (
                              <div
                                onMouseDown={header.getResizeHandler()}
                                onTouchStart={header.getResizeHandler()}
                                className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-opacity ${
                                  header.column.getIsResizing()
                                    ? "bg-blue-500 opacity-100 w-1.5"
                                    : "bg-neutral-700 opacity-0 group-hover/header:opacity-100"
                                }`}
                              />
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-neutral-850">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={table.getVisibleFlatColumns().length} className="p-12 border-r border-b border-neutral-800 text-center text-neutral-555 italic font-mono uppercase tracking-wider">
                        No takeoff items ingested. Drag and drop a Togal.ai CSV to initialize.
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      let lastDivision = "";
                      return table.getRowModel().rows.map((row, idx) => {
                        const itemId = row.original.itemId || "";
                        const currentDivision = itemId.split("-")[0] || "";
                        
                        let dividerRow = null;
                        if (currentDivision && currentDivision !== lastDivision) {
                          lastDivision = currentDivision;
                          
                          let divLabel = `DIVISION ${currentDivision}`;
                          if (currentDivision === "01") divLabel = "DIVISION 01 — GENERAL CONDITIONS";
                          else if (currentDivision === "02") divLabel = "DIVISION 02 — SITE REQUIREMENTS";
                          else if (currentDivision === "03") divLabel = "DIVISION 03 — CONCRETE";
                          else if (currentDivision === "04") divLabel = "DIVISION 04 — MASONRY";
                          else if (currentDivision === "05") divLabel = "DIVISION 05 — METALS";
                          else if (currentDivision === "06") divLabel = "DIVISION 06 — WOOD & PLASTICS";
                          else if (currentDivision === "07") divLabel = "DIVISION 07 — THERMAL & MOISTURE";
                          else if (currentDivision === "08") divLabel = "DIVISION 08 — OPENINGS";
                          else if (currentDivision === "09") divLabel = "DIVISION 09 — FINISHES";

                          dividerRow = (
                            <tr key={`div-header-${currentDivision}`} className="bg-blue-955/40 border-y border-blue-900/60 font-sans select-none">
                              <td colSpan={table.getVisibleFlatColumns().length} className="p-3 border-r border-b border-neutral-800 text-left font-extrabold text-blue-400 uppercase tracking-widest text-[10px]">
                                {divLabel}
                              </td>
                            </tr>
                          );
                        }

                        const rowHoverClass = !row.original.isMapped ? "group-hover:bg-amber-900/20" : "group-hover:bg-neutral-900/60";

                        return (
                          <React.Fragment key={row.original.id || `row-${idx}`}>
                            {dividerRow}
                            <tr 
                              className={`group transition-colors ${
                                !row.original.isMapped 
                                  ? "bg-amber-955/10 hover:bg-amber-955/15 border-l-4 border-l-amber-500" 
                                  : "hover:bg-neutral-900/30 border-l-4 border-l-transparent"
                              }`}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({
                                  visible: true,
                                  x: e.clientX,
                                  y: e.clientY,
                                  rowIndex: idx,
                                  columnId: ""
                                });
                              }}
                            >
                              {row.getVisibleCells().map((cell) => {
                                let alignClass = "text-left";
                                if (cell.column.id === "costType" || cell.column.id === "uom") alignClass = "text-center";
                                if (["matchedQty", "unitPrice", "total", "costPerUnit", "costPerSf"].includes(cell.column.id)) alignClass = "text-right";
                                
                                const colDef = columnDefs.find(c => c.id === cell.column.id);
                                const isCustom = colDef && colDef.type === "custom";
                                const isEditable = isCustom || ["itemId", "description", "matchedQty", "unitPrice"].includes(cell.column.id);
                                const paddingClass = isEditable ? "p-0" : "p-3";

                                return (
                                  <td 
                                    key={cell.id} 
                                    className={`${paddingClass} border-r border-b border-neutral-800 ${alignClass} ${rowHoverClass} transition-colors`}
                                    style={{ width: cell.column.getSize() }}
                                  >
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </td>
                                );
                              })}
                            </tr>
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
                </tbody>
                
                {/* Complete Locked-down Summary Row Appendices */}
                {rows.length > 0 && (
                  <tfoot>
                    {/* Subtotal Row */}
                    <tr className="border-t border-neutral-855 bg-neutral-900/30 text-xs font-bold text-neutral-300 font-mono">
                      {table.getVisibleFlatColumns().map((column) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left";
                        if (column.id === "costType") {
                          content = "TI";
                          alignClass = "text-center";
                        } else if (column.id === "description") {
                          content = "Takeoff Subtotal";
                          alignClass = "text-left";
                        } else if (column.id === "total") {
                          content = `$${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-white";
                        } else if (column.id === "costPerUnit") {
                          content = `$${(subtotal / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "costPerSf") {
                          content = `$${(subtotal / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "uom") {
                          alignClass = "text-center";
                        } else if (["matchedQty", "unitPrice"].includes(column.id)) {
                          alignClass = "text-right";
                        }
                        return (
                          <td key={column.id} className={`p-3 border-r border-b border-neutral-800 ${alignClass}`} style={{ width: column.getSize() }}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>

                    {/* General Liability Row */}
                    <tr className="bg-neutral-900/30 text-xs font-bold text-neutral-350 font-mono">
                      {table.getVisibleFlatColumns().map((column) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left";
                        if (column.id === "costType") {
                          content = "TI";
                          alignClass = "text-center";
                        } else if (column.id === "description") {
                          content = "General Liability (1%)";
                          alignClass = "text-left";
                        } else if (column.id === "matchedQty") {
                          content = "1.00";
                          alignClass = "text-right";
                        } else if (column.id === "uom") {
                          content = "LS";
                          alignClass = "text-center";
                        } else if (column.id === "unitPrice") {
                          content = `$${generalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "total") {
                          content = `$${generalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-white";
                        } else if (column.id === "costPerUnit") {
                          content = `$${(generalLiability / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "costPerSf") {
                          content = `$${(generalLiability / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        }
                        return (
                          <td key={column.id} className={`p-3 border-r border-b border-neutral-800 ${alignClass}`} style={{ width: column.getSize() }}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Contractor Fee Row */}
                    <tr className="bg-neutral-900/30 text-xs font-bold text-neutral-355 font-mono">
                      {table.getVisibleFlatColumns().map((column) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left";
                        if (column.id === "costType") {
                          content = "TI";
                          alignClass = "text-center";
                        } else if (column.id === "description") {
                          content = "Contractor Fee (5%)";
                          alignClass = "text-left";
                        } else if (column.id === "matchedQty") {
                          content = "1.00";
                          alignClass = "text-right";
                        } else if (column.id === "uom") {
                          content = "LS";
                          alignClass = "text-center";
                        } else if (column.id === "unitPrice") {
                          content = `$${fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "total") {
                          content = `$${fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-white";
                        } else if (column.id === "costPerUnit") {
                          content = `$${(fee / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        } else if (column.id === "costPerSf") {
                          content = `$${(fee / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right";
                        }
                        return (
                          <td key={column.id} className={`p-3 border-r border-b border-neutral-800 ${alignClass}`} style={{ width: column.getSize() }}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Total Estimated Cost Row */}
                    <tr className="border-t border-double border-emerald-500/50 bg-emerald-950/15 text-xs font-black text-emerald-400 font-mono">
                      {table.getVisibleFlatColumns().map((column) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left";
                        if (column.id === "costType") {
                          content = "TI";
                          alignClass = "text-center text-emerald-500 font-extrabold";
                        } else if (column.id === "description") {
                          content = "Total Estimated Cost";
                          alignClass = "text-left uppercase tracking-wider";
                        } else if (column.id === "total") {
                          content = `$${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-sm text-emerald-450";
                        } else if (column.id === "costPerUnit") {
                          content = `$${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-sm";
                        } else if (column.id === "costPerSf") {
                          content = `$${costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          alignClass = "text-right text-sm";
                        } else if (column.id === "uom") {
                          alignClass = "text-center";
                        } else if (["matchedQty", "unitPrice"].includes(column.id)) {
                          alignClass = "text-right";
                        }
                        return (
                          <td key={column.id} className={`p-3 border-r border-b border-neutral-800 ${alignClass}`} style={{ width: column.getSize() }}>
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
      
      {/* Hidden Option Datalist */}
      <datalist id="estimate-items-options">
        {Object.keys(ESTIMATE_ITEMS_MASTER).map((key) => (
          <option key={key} value={key}>
            {ESTIMATE_ITEMS_MASTER[key].description}
          </option>
        ))}
      </datalist>

      {/* Floating Context Menu Portal UI */}
      {contextMenu.visible && (() => {
        const currentRow = rows[contextMenu.rowIndex];
        const currentRowId = currentRow ? currentRow.id : "";
        const isCurrentCellLocked = currentRowId && contextMenu.columnId ? !!lockedCells[`${currentRowId}::${contextMenu.columnId}`] : false;

        return (
          <div
            className="fixed bg-neutral-900 border border-neutral-800 p-1.5 shadow-2xl rounded-md z-50 flex flex-col gap-1 min-w-[160px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.columnId && (
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-neutral-300 hover:bg-neutral-800 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer border-b border-neutral-800/60 pb-2 mb-1"
                onClick={() => {
                  handleToggleCellLock(currentRowId, contextMenu.columnId);
                }}
              >
                {isCurrentCellLocked ? "🔓 UNLOCK CELL" : "🔒 LOCK CELL"}
              </button>
            )}
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-neutral-300 hover:bg-neutral-800 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              onClick={() => {
                insertManualRow("above", contextMenu.rowIndex);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              Insert Row Above
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-neutral-300 hover:bg-neutral-800 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              onClick={() => {
                insertManualRow("below", contextMenu.rowIndex);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              Insert Row Below
            </button>
          </div>
        );
      })()}
    </div>
  );
}
