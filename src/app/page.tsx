"use client";

import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { parseTogalCSV } from "@/lib/parser";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, TogalRowPayload } from "@/types";
import { Upload, Layers, AlertTriangle, CheckCircle2, TrendingUp, DollarSign, FileDown } from "lucide-react";
import { generateExcelPayload, generateProcoreBudget } from "@/lib/exporter";

export default function Home() {
  const [rows, setRows] = useState<ProcessedTakeoffRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});

  useEffect(() => {
    const saved = localStorage.getItem("takeoff_user_registry");
    if (saved) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUserRegistry(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse userRegistry from localStorage", e);
      }
    }
  }, []);

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

  const handleExportExcel = () => {
    const payload = generateExcelPayload(rows);
    downloadCSVFile(payload, "takeoff_excel_payload.csv");
  };

  const handleExportProcore = () => {
    const payload = generateProcoreBudget(rows);
    downloadCSVFile(payload, "procore_budget_import.csv");
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

  const updateItemCode = (index: number, newCode: string) => {
    const updated = [...rows];
    const trimmedCode = newCode.trim();
    const targetItem = ESTIMATE_ITEMS_MASTER[trimmedCode];
    const classification = updated[index].classification;
    
    updated[index].itemId = newCode;

    // Save the classification-to-itemId string pair directly to userRegistry state and localStorage
    const updatedRegistry = {
      ...userRegistry,
      [classification]: trimmedCode,
    };
    setUserRegistry(updatedRegistry);
    localStorage.setItem("takeoff_user_registry", JSON.stringify(updatedRegistry));

    if (targetItem) {
      updated[index].description = targetItem.description;
      updated[index].procoreParentCode = targetItem.procoreParentCode;
      updated[index].unitPrice = targetItem.defaultUnitPrice;
      updated[index].uom = targetItem.targetUom;
      updated[index].costType = targetItem.costType;
      
      // Dynamic multi-quantity re-indexing based on the target UOM of the matched master item
      const targetUom = targetItem.targetUom;
      const matched = updated[index].rawQuantities.find(
        (m) => m.uom?.trim().toUpperCase() === targetUom.toUpperCase()
      ) || updated[index].rawQuantities[0];
      
      const qty = matched?.qty || 0;
      updated[index].matchedQty = qty;
      updated[index].total = qty * targetItem.defaultUnitPrice;
      updated[index].isMapped = true;

      // Automatically reconcile all other rows with this same classification in the grid
      for (let i = 0; i < updated.length; i++) {
        if (i !== index && updated[i].classification === classification) {
          updated[i].itemId = trimmedCode;
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
      // Clear mapped data to avoid stale information and enforce interactive user override rules
      updated[index].description = "UNMAPPED - RECONCILE CODE";
      updated[index].procoreParentCode = "";
      updated[index].unitPrice = 0;
      updated[index].total = 0;
      updated[index].isMapped = false;
      updated[index].costType = "M";
      
      // Reset back to first raw measurement fallback
      const firstMeasure = updated[index].rawQuantities[0];
      updated[index].matchedQty = firstMeasure?.qty || 0;
      updated[index].uom = firstMeasure?.uom || "SF";
    }
    setRows(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.getElementById(`code-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      document.getElementById(`code-input-${rIdx - 1}`)?.focus();
    }
  };

  // UI Metrics
  const totalRows = rows.length;
  const mappedCount = rows.filter((r) => r.isMapped).length;
  const unmappedCount = totalRows - mappedCount;
  const totalEstimatedCost = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-mono p-8 selection:bg-blue-600/30 selection:text-blue-200">
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-wider text-white flex items-center gap-3">
            <Layers className="text-blue-500 animate-pulse" size={32} /> TAKEOFF BRIDGE
          </h1>
          <p className="text-xs text-neutral-400 mt-2 uppercase tracking-widest font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
            Local Processing Terminal v1.1.0
          </p>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          {rows.length > 0 && (
            <>
              <button 
                onClick={handleExportExcel}
                className="flex items-center gap-2 bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-800 hover:border-neutral-700 text-sm px-5 py-3 rounded-lg cursor-pointer font-bold transition-all duration-300 shadow-lg cursor-pointer"
              >
                <FileDown size={18} /> Export Excel Payload
              </button>
              <button 
                onClick={handleExportProcore}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm px-5 py-3 rounded-lg cursor-pointer font-bold transition-all duration-300 shadow-lg shadow-emerald-950/20 cursor-pointer"
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
            Drag and drop your multi-quantity Togal.ai project export file here, or click upload to begin exact matching routines.
          </p>
          <span className="text-neutral-600 text-[10px] uppercase tracking-widest bg-neutral-900 border border-neutral-800 px-3 py-1 rounded">
            UTF-8 CSV Only
          </span>
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          {/* KPI Dashboard Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <h2 className="text-2xl font-black text-emerald-400 mt-2">{mappedCount}</h2>
              <div className="text-[10px] text-neutral-500 mt-1">Registry exact matches</div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <AlertTriangle size={40} className="text-amber-400 animate-pulse" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Unmapped Items</p>
              <h2 className={`text-2xl font-black mt-2 ${unmappedCount > 0 ? "text-amber-500" : "text-neutral-400"}`}>{unmappedCount}</h2>
              <div className="text-[10px] text-neutral-500 mt-1">
                {unmappedCount > 0 ? "Requires manual suffix override" : "All matches reconciled"}
              </div>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <DollarSign size={40} className="text-blue-400" />
              </div>
              <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Estimated Cost</p>
              <h2 className="text-2xl font-black text-emerald-400 mt-2">
                ${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h2>
              <div className="text-[10px] text-neutral-500 mt-1 flex items-center gap-1">
                <TrendingUp size={10} className="text-emerald-400" /> Based on unit price sheets
              </div>
            </div>
          </div>

          {/* Interactive Table Container */}
          <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 bg-neutral-900/50 border-b border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
                Reconciliation Matrix
              </h3>
              <span className="text-[10px] bg-neutral-800 text-neutral-400 px-3 py-1 rounded-full border border-neutral-700">
                Use Arrow Keys ↑↓ to Navigate Input Suffixes
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-800 tracking-wider font-semibold">
                    <th className="p-4">Togal Classification</th>
                    <th className="p-4">Internal Suffix Code</th>
                    <th className="p-4">Procore Parent Code</th>
                    <th className="p-4">Item Description</th>
                    <th className="p-4 text-right">Extracted Qty (Target UOM)</th>
                    <th className="p-4 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-850">
                  {rows.map((row, index) => (
                    <tr 
                      key={row.id} 
                      className={`transition-colors ${
                        !row.isMapped 
                          ? "bg-amber-950/10 hover:bg-amber-950/15 border-l-4 border-l-amber-500" 
                          : "hover:bg-neutral-900/30 border-l-4 border-l-transparent"
                      }`}
                    >
                      <td className="p-4 font-bold text-neutral-300">{row.classification}</td>
                      <td className="p-3">
                        <div className="relative flex items-center w-full">
                          <input
                            id={`code-input-${index}`}
                            type="text"
                            className={`bg-neutral-900 border rounded px-3 py-1.5 w-36 text-neutral-100 outline-none font-mono text-xs uppercase transition-all focus:ring-1 ${
                              row.isMapped 
                                ? "border-neutral-800 focus:border-blue-500 focus:ring-blue-500" 
                                : "border-amber-900/60 focus:border-amber-500 focus:ring-amber-500 bg-amber-950/20"
                            }`}
                            value={row.itemId}
                            onChange={(e) => updateItemCode(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, index)}
                            placeholder="Assign suffix..."
                          />
                        </div>
                      </td>
                      <td className="p-4 font-semibold text-neutral-400">{row.procoreParentCode || "—"}</td>
                      <td className={`p-4 font-semibold ${row.isMapped ? "text-neutral-300" : "text-amber-500/70"}`}>
                        {row.description}
                      </td>
                      <td className="p-4 text-right text-white font-bold">
                        {row.matchedQty.toLocaleString()} <span className="text-neutral-500 font-normal">{row.uom}</span>
                      </td>
                      <td className="p-4 text-right font-black">
                        <span className={row.total > 0 ? "text-emerald-400" : "text-neutral-600"}>
                          ${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
