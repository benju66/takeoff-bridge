"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { 
  Search, 
  Trash2, 
  Database, 
  AlertTriangle, 
  Info, 
  Terminal, 
  CheckCircle2,
  Sliders,
  Save,
  Menu
} from "lucide-react";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { DIVISION_NAMES } from "@/lib/constants";
import { getGlobalRegistry, saveGlobalRegistry, deleteGlobalRegistry } from "@/lib/db";
import { evaluateDataFidelity } from "@/lib/calculations";
import { getDivisionCode } from "@/lib/division";


interface RegistryRow {
  classification: string;
  itemId: string;
  description: string;
  divisionCode: string;
  divisionName: string;
  uom: string;
  costType: string;
}

export default function GlobalRegistryDashboard() {
  const [registry, setRegistry] = useState<Record<string, string> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);

  // Custom configurations state
  const [thresholdInput, setThresholdInput] = useState("5000");
  const [keywordsInput, setKeywordsInput] = useState("LS, SUM, ALLW, LUMP");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Simulator State
  const [simQty, setSimQty] = useState(1);
  const [simUom, setSimUom] = useState("SF");
  const [simPrice, setSimPrice] = useState(6000);

  // Load registry from Supabase on client load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getGlobalRegistry();
        if (!cancelled) {
          setRegistry(loaded);
          setThresholdInput(loaded["__config_threshold"] || "5000");
          setKeywordsInput(loaded["__config_keywords"] || "LS, SUM, ALLW, LUMP");
          setIsLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load global registry:', err);
        if (!cancelled) {
          setRegistry({});
          setIsLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registry) return;

    const thresholdVal = thresholdInput.trim();
    const keywordsVal = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .join(", ");

    const updatedRegistry = {
      ...registry,
      "__config_threshold": thresholdVal,
      "__config_keywords": keywordsVal,
    };

    try {
      await saveGlobalRegistry(updatedRegistry);
      setRegistry(updatedRegistry);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save rules configuration:", err);
      alert("Failed to save rules configuration. Please try again.");
    }
  };

  const simResult = React.useMemo(() => {
    const t = Number(thresholdInput) || 5000;
    const k = keywordsInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const total = simQty * simPrice;

    const fidelity = evaluateDataFidelity(simQty, simUom, total, t, k);

    let reason = "";
    if (k.map((x) => x.toUpperCase()).includes(simUom.trim().toUpperCase())) {
      reason = `UOM "${simUom}" matches registered macro keywords (${k.join(", ")}).`;
    } else if (simQty === 1 && total > t) {
      reason = `Qty is 1 and total cost ($${total.toLocaleString()}) exceeds the threshold ($${t.toLocaleString()}).`;
    } else {
      reason = `Standard unit of measure (${simUom}) with variable quantities, or total cost under threshold.`;
    }

    return { fidelity, total, reason };
  }, [simQty, simUom, simPrice, thresholdInput, keywordsInput]);

  const handleDeleteRule = async (classificationToDelete: string) => {
    if (!registry) return;
    
    const updatedRegistry = { ...registry };
    delete updatedRegistry[classificationToDelete];
    
    setRegistry(updatedRegistry);
    try {
      await saveGlobalRegistry(updatedRegistry);
    } catch (err) {
      console.error('Failed to save registry after rule deletion:', err);
      alert('Failed to save registry update. Please try again.');
    }
  };

  const handleFlushCache = async () => {
    if (window.confirm("CRITICAL ADMIN OVERRIDE:\nAre you sure you want to permanently erase this global corporate registry cache?\nThis cannot be undone.")) {
      setRegistry({});
      try {
        await deleteGlobalRegistry();
      } catch (err) {
        console.error('Failed to flush global registry:', err);
        alert('Failed to flush registry. Please try again.');
      }
    }
  };

  const processedRows: RegistryRow[] = React.useMemo(() => {
    if (!registry) return [];

    return Object.entries(registry)
      .filter(([classification]) => !classification.startsWith("__"))
      .map(([classification, itemId]) => {
      const masterItem = ESTIMATE_ITEMS_MASTER[itemId];
      const divisionCode = getDivisionCode(itemId);
      
      return {
        classification,
        itemId,
        description: masterItem?.description || "Custom Suffix / External Code",
        divisionCode,
        divisionName: DIVISION_NAMES[divisionCode] || "Custom / General Scope",
        uom: masterItem?.targetUom || "—",
        costType: masterItem?.costType || "M"
      };
    });
  }, [registry]);

  const filteredRows = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return processedRows;

    return processedRows.filter(
      (row) =>
        row.classification.toLowerCase().includes(query) ||
        row.itemId.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        row.divisionName.toLowerCase().includes(query)
    );
  }, [processedRows, searchQuery]);

  if (!isLoaded || registry === null) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Connecting to Harvester Registry...</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Initializing secure browser sandbox</p>
      </div>
    );
  }

  const totalMappableItems = Object.keys(ESTIMATE_ITEMS_MASTER).length;
  const harvestedCount = Object.keys(registry).length;

  return (
    <div className="flex flex-col gap-6 selection:bg-blue-100 dark:selection:bg-blue-900/50">
      {/* Header Panel */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-grid-border pb-6 mb-2 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-sidebar"))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/65 rounded-lg text-slate-650 dark:text-slate-350 transition-colors cursor-pointer"
            title="Toggle Sidebar"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <Database className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> GLOBAL CORPORATE REGISTRY
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Centralized Harvester Node // Active Directory
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          <button
            onClick={handleFlushCache}
            disabled={harvestedCount === 0}
            className="flex items-center gap-2 bg-card hover:bg-rose-50 dark:bg-card dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-grid-border hover:border-rose-500/50 dark:hover:border-rose-400/50 text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card dark:disabled:hover:bg-card disabled:hover:text-rose-600 dark:disabled:hover:text-rose-400 disabled:border-grid-border"
          >
            <Trash2 size={18} /> Wipe Global Mapping Directory Cache
          </button>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Harvested Lookup Architecture</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            This directory aggregates custom classification overrides created inside individual project estimation workspaces. Mappings stored here serve as automatic corporate defaults for newly imported Togal CSV files before falling back to initial catalog defaults.
          </p>
        </div>
      </div>

      {/* KPI Cards Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden group/kpi">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Database size={40} className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Harvested Rules</p>
          <h2 className="text-2xl font-extrabold text-foreground mt-2">{harvestedCount}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Active global overrides stored</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden group/kpi">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">Master Reference Catalog</p>
          <h2 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-2">{totalMappableItems}</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">Standard cost codes available</div>
        </div>

        <div className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden group/kpi">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Terminal size={40} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">System Registry Status</p>
          <h2 className="text-2xl font-extrabold text-cyan-600 dark:text-cyan-400 mt-2">ACTIVE</h2>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            HARVESTER_MODE::LISTENING
          </div>
        </div>
      </div>

      {/* Estimation Standards & Rules Configuration Section */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Settings Configuration Card */}
        <div className="lg:col-span-2 bg-card border border-grid-border p-6 rounded-xl shadow-sm">
          <h2 className="text-lg font-extrabold text-foreground flex items-center gap-2 mb-4 uppercase tracking-wider">
            <Sliders className="text-blue-600 dark:text-blue-400" size={20} /> Data-Fidelity Classification Settings
          </h2>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-6">
            Configure default rules that automatically classify estimate line items into itemized discrete units or macro lump-sum values based on units of measure and price thresholds.
          </p>

          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Commodity Price Threshold ($)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 rounded-lg px-3 py-2.5 text-xs text-foreground outline-none font-mono transition-all focus:bg-white dark:focus:bg-slate-900/40"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  placeholder="5000"
                />
                <span className="text-[9px] text-slate-600 dark:text-slate-400 block mt-1">
                  Threshold limit where single-quantity items are tagged as lump sum.
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                  Lump Sum UOM Keywords (Comma Separated)
                </label>
                <input
                  type="text"
                  className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 rounded-lg px-3 py-2.5 text-xs text-foreground outline-none transition-all focus:bg-white dark:focus:bg-slate-900/40"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  placeholder="LS, SUM, ALLW, LUMP"
                />
                <span className="text-[9px] text-slate-600 dark:text-slate-400 block mt-1">
                  Keywords that automatically trigger lump-sum tagging.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                {saveSuccess && (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">
                    <CheckCircle2 size={14} /> Rules saved successfully to registry!
                  </span>
                )}
              </div>
              <button
                type="submit"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-6 py-2.5 rounded-lg transition-all shadow-sm cursor-pointer"
              >
                <Save size={14} /> Save Configuration
              </button>
            </div>
          </form>
        </div>

        {/* Interactive Simulator Card */}
        <div className="bg-card border border-grid-border p-6 rounded-xl shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-foreground flex items-center gap-2 mb-2 uppercase tracking-wider">
              <Terminal className="text-cyan-600 dark:text-cyan-400 animate-pulse" size={20} /> Rule Test Simulator
            </h2>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-4">
              Test your configuration changes in real time before saving them globally.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[8px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Qty
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg px-2 py-1 text-xs text-foreground outline-none font-mono"
                    value={simQty}
                    onChange={(e) => setSimQty(Number(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    UOM
                  </label>
                  <input
                    type="text"
                    className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg px-2 py-1 text-xs text-foreground outline-none font-mono"
                    value={simUom}
                    onChange={(e) => setSimUom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Rate ($)
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg px-2 py-1 text-xs text-foreground outline-none font-mono"
                    value={simPrice}
                    onChange={(e) => setSimPrice(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="border border-grid-border p-3 rounded-lg bg-background/50 dark:bg-slate-900/30 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-bold">
                    Resulting Tag:
                  </span>
                  <span
                    className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest uppercase ${
                      simResult.fidelity === "macro_lump_sum"
                        ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50"
                        : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50"
                    }`}
                  >
                    {simResult.fidelity}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-600 dark:text-slate-400">Total Cost:</span>
                  <span className="font-mono font-bold text-foreground">${simResult.total.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-600 dark:text-slate-400 italic mt-3 pt-2 border-t border-grid-border leading-normal">
            <strong>Logic Trigger:</strong> {simResult.reason}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      {harvestedCount === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Terminal size={48} className="text-slate-600 dark:text-slate-400 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">No Harvested Mappings</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed mb-6">
            The global corporate lookup dictionary is currently empty. Mappings are automatically indexed here when estimators associate a Togal CSV classification string with an internal cost code in any active project workspace.
          </p>
          <Link
            href="/projects"
            className="bg-card hover:bg-background dark:bg-card dark:hover:bg-background text-blue-600 dark:text-blue-400 border border-grid-border hover:border-blue-500/50 dark:hover:border-blue-400/50 text-xs px-5 py-2.5 rounded-lg font-bold uppercase tracking-wider transition-all cursor-pointer font-sans"
          >
            Go to Project Directory
          </Link>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-600 dark:text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search registry by Togal classification, assigned item code target, description..."
              className="w-full bg-transparent border border-grid-border focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-lg pl-12 pr-4 py-3 text-xs text-foreground outline-none font-sans transition-all focus:bg-white dark:focus:bg-slate-900/40"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Data Table */}
          <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-grid-border">
                <thead>
                  <tr className="bg-background/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Togal Classification</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Assigned Suffix Code</th>
                    <th className="p-4 text-center w-80 border-r border-b border-grid-border font-semibold">Item Description Reference</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Division Code & Scope</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Cost Type</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">UOM</th>
                    <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-600 dark:text-slate-400 italic border-r border-b border-grid-border">
                        No registry items match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      let typeColor = "bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-grid-border";
                      if (row.costType === "M") {
                        typeColor = "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50";
                      } else if (row.costType === "L") {
                        typeColor = "bg-cyan-50 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-900/50";
                      } else if (row.costType === "S") {
                        typeColor = "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/50";
                      }

                      return (
                        <tr key={row.classification} className="group transition-colors">
                          <td className="p-4 font-bold text-foreground text-sm border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {row.classification}
                          </td>
                          <td className="p-4 font-bold text-blue-600 dark:text-blue-400 font-mono tracking-widest uppercase border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {row.itemId}
                          </td>
                          <td className="p-4 text-foreground font-semibold border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            {row.description}
                          </td>
                          <td className="p-4 text-slate-600 dark:text-slate-400 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <div className="flex items-center gap-2">
                              {row.divisionCode ? (
                                <span className="bg-background dark:bg-slate-800 border border-grid-border text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                                  Div {row.divisionCode}
                                </span>
                              ) : (
                                <span className="bg-background dark:bg-slate-800 border border-grid-border text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded font-mono text-[10px]">
                                  —
                                </span>
                              )}
                              <span className="truncate max-w-[150px] font-bold">{row.divisionName}</span>
                            </div>
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${typeColor}`}>
                              {row.costType}
                            </span>
                          </td>
                          <td className="p-4 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60 font-mono">
                            {row.uom}
                          </td>
                          <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60">
                            <button
                              onClick={() => handleDeleteRule(row.classification)}
                              className="inline-flex items-center justify-center p-2 rounded-lg bg-background hover:bg-rose-50 dark:bg-card dark:hover:bg-rose-950/30 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-grid-border hover:border-rose-500/50 dark:hover:border-rose-400/50 transition-all duration-300 cursor-pointer shadow-sm"
                              title="Delete individual mapping rule"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-4 text-[10px] text-amber-700 dark:text-amber-500 font-bold uppercase tracking-wider">
            <AlertTriangle className="text-amber-500/80 animate-pulse shrink-0" size={14} />
            <span>WARNING: Modifications to lookup mappings on this page will alter CSV relational logic across all newly initialized workspaces.</span>
          </div>
        </div>
      )}
    </div>
  );
}
