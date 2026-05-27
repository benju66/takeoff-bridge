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
import { getProject, getProjectEstimate, saveProjectEstimate } from "@/lib/db";
import { 
  Upload, 
  Layers, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  DollarSign, 
  FileDown, 
  ChevronLeft, 
  MapPin, 
  Calendar, 
  Activity 
} from "lucide-react";
import { generateExcelPayload, generateProcoreBudget, generateExcelWorkbook } from "@/lib/exporter";
import { getFuzzySuggestions } from "@/lib/similarity";

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
  const [isLoaded, setIsLoaded] = useState(false);

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

    // Load Project Isolated Estimate Items
    const savedEstimate = getProjectEstimate(projectId);
    if (savedEstimate && savedEstimate.items) {
      setRows(savedEstimate.items);
    }

    setIsLoaded(true);
  }, [projectId]);

  // UI Metrics
  const totalRows = rows.length;
  const mappedCount = rows.filter((r) => r.isMapped).length;
  const unmappedCount = totalRows - mappedCount;
  const subtotal = rows.reduce((sum, r) => sum + r.total, 0);
  const generalLiability = subtotal * 0.01;
  const fee = subtotal * 0.05;
  const totalEstimatedCost = subtotal + generalLiability + fee;

  // Multi-Family Unit Assembly Metrics Layer
  const squareFootage: number = project ? project.squareFootage : 0;
  const unitCount: number = project ? project.unitCount : 0;

  const costPerSf: number = squareFootage > 0 ? totalEstimatedCost / squareFootage : 0;
  const costPerUnit: number = unitCount > 0 ? totalEstimatedCost / unitCount : 0;

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
    };
    saveProjectEstimate(estimate);
  }, [rows, projectId, subtotal, generalLiability, fee, totalEstimatedCost, isLoaded]);

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
    const payload = generateExcelPayload(rows);
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
      const blob = await generateExcelWorkbook(rows, project);
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
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry);
        setRows(parsed);
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
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry);
        setRows(parsed);
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
      newRegistry = {
        ...currentRegistry,
        [classification]: newCode,
      };

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
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].classification === classification) {
          updated[i].description = String(value);
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
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].classification === classification) {
          updated[i].unitPrice = price;
          updated[i].total = updated[i].matchedQty * price;
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
          }
        }
      }
      
      if (didModify) {
        if (registryChanged) {
          setUserRegistry(currentRegistry);
          localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(currentRegistry));
        }
        setRows(updated);
      }
    }
  };

  // Central onCellEditChange cell modification handler using applyCellEditDirect Cascader
  const handleCellEdit = (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => {
    const updated = [...rows];
    const newRegistry = applyCellEditDirect(updated, index, field, value, userRegistry);
    if (newRegistry) {
      setUserRegistry(newRegistry);
      localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(newRegistry));
    }
    setRows(updated);
  };

  // Define column builder using createColumnHelper and inline input items
  const columnHelper = createColumnHelper<ProcessedTakeoffRow>();
  const columns = [
    columnHelper.accessor("classification", {
      header: "Togal Classification",
      cell: (info) => <span className="font-bold text-neutral-300">{info.getValue()}</span>,
    }),
    columnHelper.accessor("itemId", {
      header: "Internal Suffix Code",
      cell: (info) => {
        const index = info.row.index;
        const row = info.row.original;
        return (
          <div className="flex flex-col gap-2 w-full">
            <input
              id={`code-input-${index}`}
              type="text"
              list="estimate-items-options"
              className={`bg-neutral-900 border rounded px-3 py-1.5 w-36 text-neutral-100 outline-none font-mono text-xs uppercase transition-all focus:ring-1 ${
                row.isMapped 
                  ? "border-neutral-800 focus:border-blue-500 focus:ring-blue-500" 
                  : "border-amber-900/65 focus:border-amber-500 focus:ring-amber-500 bg-amber-950/20"
              }`}
              value={row.itemId}
              onChange={(e) => handleCellEdit(index, "itemId", e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, index, "code")}
              onPaste={(e) => handlePaste(e, index, "code")}
              placeholder="Assign suffix..."
            />
            {!row.isMapped && (
              <div className="flex flex-col gap-1 mt-1">
                <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold">Suggestions:</span>
                <div className="flex flex-wrap gap-1.5">
                  {getFuzzySuggestions(row.classification, ESTIMATE_ITEMS_MASTER).map((sugg) => (
                    <button
                      key={sugg.itemId}
                      type="button"
                      onClick={() => handleCellEdit(index, "itemId", sugg.itemId)}
                      title={sugg.description}
                      className="bg-neutral-900 hover:bg-amber-950/40 text-amber-500/90 hover:text-amber-400 border border-neutral-850 hover:border-amber-800/80 rounded px-2 py-0.5 text-[10px] font-sans font-semibold transition-all cursor-pointer shadow-sm"
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
    }),
    columnHelper.accessor("procoreParentCode", {
      header: "Procore Parent Code",
      cell: (info) => <span className="font-semibold text-neutral-400">{info.getValue() || "—"}</span>,
    }),
    columnHelper.accessor("description", {
      header: "Item Description",
      cell: (info) => {
        const index = info.row.index;
        const row = info.row.original;
        return (
          <input
            id={`desc-input-${index}`}
            type="text"
            className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-1.5 w-64 text-neutral-100 outline-none font-mono text-xs transition-all"
            value={row.description}
            onChange={(e) => handleCellEdit(index, "description", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, index, "desc")}
            onPaste={(e) => handlePaste(e, index, "desc")}
          />
        );
      },
    }),
    columnHelper.accessor("matchedQty", {
      header: "Extracted Qty (UOM)",
      cell: (info) => {
        const index = info.row.index;
        const row = info.row.original;
        return (
          <div className="flex items-center gap-1.5 justify-end">
            <input
              id={`qty-input-${index}`}
              type="number"
              className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1.5 w-24 text-right text-white font-bold outline-none font-mono text-xs transition-all"
              value={row.matchedQty}
              onChange={(e) => handleCellEdit(index, "matchedQty", e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, index, "qty")}
              onPaste={(e) => handlePaste(e, index, "qty")}
            />
            <span className="text-neutral-500 text-[10px] w-6 text-left">{row.uom}</span>
          </div>
        );
      },
    }),
    columnHelper.accessor("unitPrice", {
      header: "Unit Price ($)",
      cell: (info) => {
        const index = info.row.index;
        const row = info.row.original;
        return (
          <div className="flex items-center gap-1 justify-end">
            <span className="text-neutral-500">$</span>
            <input
              id={`price-input-${index}`}
              type="number"
              step="0.01"
              className="bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1.5 w-20 text-right text-white font-bold outline-none font-mono text-xs transition-all"
              value={row.unitPrice}
              onChange={(e) => handleCellEdit(index, "unitPrice", e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, index, "price")}
              onPaste={(e) => handlePaste(e, index, "price")}
            />
          </div>
        );
      },
    }),
    columnHelper.accessor("total", {
      header: "Total Cost",
      cell: (info) => (
        <div className="text-right font-black">
          <span className={info.getValue() > 0 ? "text-emerald-400" : "text-neutral-600"}>
            ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ),
    }),
  ];

  // Instantiate useReactTable Core Hook
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
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
        <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-400 transition-colors uppercase tracking-widest font-bold">
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
            <span className="text-[10px] bg-blue-950 border border-blue-900 text-blue-450 px-2 py-0.5 rounded-md font-bold tracking-widest uppercase">
              {project.id}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 mt-3 text-neutral-400 text-xs items-center uppercase font-semibold">
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
                className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-blue-950/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} className={isExportingExcel ? "animate-spin" : ""} /> 
                {isExportingExcel ? "Compiling Workbook..." : "Download Full Estimate Workbook (.xlsx)"}
              </button>
              <button 
                onClick={handleExportExcel}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-800 hover:border-neutral-700 text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} /> Export Excel Payload
              </button>
              <button 
                onClick={handleExportProcore}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-emerald-950/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} /> Export Procore Budget
              </button>
            </>
          )}
          <label className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm px-5 py-3 rounded-lg cursor-pointer font-bold transition-all duration-300 shadow-lg shadow-blue-900/30 hover:shadow-indigo-900/40 transform hover:-translate-y-0.5">
            <Upload size={18} /> Upload Togal CSV
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </header>

      {/* CSV Takeoff Workspace */}
      {rows.length === 0 ? (
        <div 
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-24 text-center transition-all duration-300 ${
            dragActive 
              ? "border-blue-500 bg-blue-950/20 scale-[1.01] shadow-2xl shadow-blue-900/10" 
              : "border-neutral-800 bg-neutral-900/20 hover:border-neutral-700"
          }`}
        >
          <div className="p-4 bg-neutral-900 rounded-full border border-neutral-800 mb-6 text-neutral-400">
            <Upload size={48} className={dragActive ? "text-blue-500 animate-bounce" : "text-neutral-500"} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Ingest Project CSV</h3>
          <p className="text-neutral-400 max-w-md text-xs leading-relaxed mb-6">
            Drag and drop your multi-quantity Togal.ai CSV export here, or click upload to begin exact matching routines for this project workspace.
          </p>
          <span className="text-neutral-600 text-[10px] uppercase tracking-widest bg-neutral-900 border border-neutral-800 px-3 py-1 rounded">
            UTF-8 CSV Only
          </span>
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          {exportError && (
            <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-4 flex items-center gap-3 text-red-400 text-xs font-mono animate-shake">
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
          {/* KPI Dashboard Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Layers size={40} className="text-blue-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Total Records</p>
              <h2 className="text-2xl font-black text-white mt-2">{totalRows}</h2>
              <div className="text-[10px] text-neutral-500 mt-1">Uploaded and processed</div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <CheckCircle2 size={40} className="text-emerald-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Mapped Items</p>
              <h2 className="text-2xl font-black text-emerald-450 mt-2">{mappedCount}</h2>
              <div className="text-[10px] text-neutral-500 mt-1">Registry exact matches</div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <AlertTriangle size={40} className="text-amber-400 animate-pulse" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Unmapped Items</p>
              <h2 className={`text-2xl font-black mt-2 ${unmappedCount > 0 ? "text-amber-500" : "text-neutral-400"}`}>{unmappedCount}</h2>
              <div className="text-[10px] text-neutral-500 mt-1">
                {unmappedCount > 0 ? "Requires manual override" : "All reconciled"}
              </div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <DollarSign size={40} className="text-blue-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Subtotal</p>
              <h2 className="text-2xl font-black text-emerald-450 mt-2">
                ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[10px] text-neutral-500 mt-1">Raw takeoff sum</div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <TrendingUp size={40} className="text-blue-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">GL Insurance (1%)</p>
              <h2 className="text-2xl font-black text-blue-400 mt-2">
                ${generalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[10px] text-neutral-500 mt-1">General Liability</div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <TrendingUp size={40} className="text-indigo-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Fee (5%)</p>
              <h2 className="text-2xl font-black text-indigo-400 mt-2">
                ${fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[10px] text-neutral-500 mt-1">Contractor markup</div>
            </div>

            <div className="bg-gradient-to-br from-neutral-900 to-neutral-950 border border-blue-900/40 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-20">
                <DollarSign size={40} className="text-emerald-400 animate-pulse" />
              </div>
              <p className="text-neutral-300 text-xs uppercase tracking-wider font-bold">Total Est. Cost</p>
              <h2 className="text-2xl font-black text-emerald-450 mt-2">
                ${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[10px] text-neutral-400 mt-1 flex items-center gap-1 font-semibold">
                <CheckCircle2 size={10} className="text-emerald-450" /> Subtotal + GL + Fee
              </div>
            </div>

            {/* Card A: Cost Per Square Foot (Terminal Theme) */}
            <div className="bg-zinc-950 border border-emerald-900/50 p-5 rounded-xl shadow-lg relative overflow-hidden group font-mono">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <span className="text-emerald-500 text-3xl font-black">{`_`}</span>
              </div>
              <p className="text-emerald-500/80 text-[10px] uppercase tracking-wider font-bold flex items-center gap-1">
                <span className="animate-pulse text-emerald-400">●</span> sys.est::sf_cost
              </p>
              <p className="text-neutral-400 text-xs mt-1 uppercase tracking-wider font-semibold">Cost Per SF</p>
              <h2 className="text-2xl font-black text-emerald-400 mt-2 font-mono">
                ${costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[9px] text-emerald-600 mt-1 font-bold">
                &gt;_ READY_
              </div>
            </div>

            {/* Card B: Cost Per Unit (Terminal Theme) */}
            <div className="bg-zinc-950 border border-cyan-900/50 p-5 rounded-xl shadow-lg relative overflow-hidden group font-mono">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <span className="text-cyan-500 text-3xl font-black">{`_`}</span>
              </div>
              <p className="text-cyan-500/80 text-[10px] uppercase tracking-wider font-bold flex items-center gap-1">
                <span className="animate-pulse text-cyan-400">●</span> sys.est::unit_cost
              </p>
              <p className="text-neutral-400 text-xs mt-1 uppercase tracking-wider font-semibold">Cost Per Unit</p>
              <h2 className="text-2xl font-black text-cyan-400 mt-2 font-mono">
                ${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[9px] text-cyan-600 mt-1 font-bold">
                &gt;_ READY_
              </div>
            </div>
          </div>

          {/* TanStack Table Grid */}
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 bg-neutral-900/50 border-b border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
                <Activity size={16} className="text-blue-500 animate-pulse" /> Interactive Cell Grid Matrix
              </h3>
              <span className="text-[10px] bg-neutral-800 text-neutral-400 px-3 py-1 rounded-full border border-neutral-700">
                Excel Engine Online | Use Arrow Keys ↑↓ to Navigate inputs
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr 
                      key={headerGroup.id} 
                      className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-800 tracking-wider font-semibold"
                    >
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="p-4">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-neutral-850">
                  {table.getRowModel().rows.map((row) => (
                    <tr 
                      key={row.id} 
                      className={`transition-colors ${
                        !row.original.isMapped 
                          ? "bg-amber-950/10 hover:bg-amber-950/15 border-l-4 border-l-amber-500" 
                          : "hover:bg-neutral-900/30 border-l-4 border-l-transparent"
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="p-3">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
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
    </div>
  );
}
