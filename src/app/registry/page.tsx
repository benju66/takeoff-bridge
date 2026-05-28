"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { 
  ChevronLeft, 
  Search, 
  Trash2, 
  Database, 
  AlertTriangle, 
  Info, 
  Terminal, 
  CheckCircle2 
} from "lucide-react";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";

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

  // Load registry from local storage on client load
  useEffect(() => {
    const savedGlobalRegistry = localStorage.getItem("takeoff_global_user_registry");
    if (savedGlobalRegistry) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRegistry(JSON.parse(savedGlobalRegistry));
      } catch (e) {
        console.error("Failed to parse takeoff_global_user_registry", e);
        setRegistry({});
      }
    } else {
      setRegistry({});
    }
    setIsLoaded(true);
  }, []);

  const handleDeleteRule = (classificationToDelete: string) => {
    if (!registry) return;
    
    const updatedRegistry = { ...registry };
    delete updatedRegistry[classificationToDelete];
    
    setRegistry(updatedRegistry);
    localStorage.setItem("takeoff_global_user_registry", JSON.stringify(updatedRegistry));
  };

  const handleFlushCache = () => {
    if (window.confirm("CRITICAL ADMIN OVERRIDE:\nAre you sure you want to permanently flush the entire global corporate registry cache?\nAll harvested lookup mappings will be permanently erased. This cannot be undone.")) {
      setRegistry({});
      localStorage.removeItem("takeoff_global_user_registry");
    }
  };

  // Process rows by joining with ESTIMATE_ITEMS_MASTER mock database catalog
  const processedRows: RegistryRow[] = React.useMemo(() => {
    if (!registry) return [];

    return Object.entries(registry).map(([classification, itemId]) => {
      const masterItem = ESTIMATE_ITEMS_MASTER[itemId];
      const divisionCode = itemId && itemId.length >= 2 ? itemId.substring(0, 2) : "";
      
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

  // Filter processed rows instantly by classification or assigned item code string targets
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
      <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-mono items-center justify-center p-8">
        <Terminal className="text-blue-500 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-white mb-2">Connecting to Harvester Registry...</h3>
        <p className="text-xs text-neutral-500">Initializing secure browser sandbox</p>
      </div>
    );
  }

  const totalMappableItems = Object.keys(ESTIMATE_ITEMS_MASTER).length;
  const harvestedCount = Object.keys(registry).length;

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
          <h1 className="text-3xl font-extrabold tracking-wider text-white flex items-center gap-3">
            <Database className="text-blue-500 animate-pulse" size={32} /> GLOBAL CORPORATE REGISTRY
          </h1>
          <p className="text-xs text-neutral-400 mt-2 uppercase tracking-widest font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
            Centralized Harvester Node // Active Directory
          </p>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center">
          <button
            onClick={handleFlushCache}
            disabled={harvestedCount === 0}
            className="flex items-center gap-2 bg-neutral-900 hover:bg-rose-950/40 text-rose-450 hover:text-rose-350 border border-neutral-800 hover:border-rose-900/60 text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neutral-900 disabled:hover:text-rose-450 disabled:border-neutral-800"
          >
            <Trash2 size={18} /> Wipe Global Mapping Directory Cache
          </button>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-950/20 border border-blue-900/45 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Info className="text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider">Harvested Lookup Architecture</h4>
          <p className="text-[11px] text-neutral-400 leading-relaxed mt-1">
            This directory aggregates custom classification overrides created inside individual project estimation workspaces. Mappings stored here serve as automatic corporate defaults for newly imported Togal CSV files before falling back to initial catalog defaults.
          </p>
        </div>
      </div>

      {/* KPI Cards Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Database size={40} className="text-blue-450" />
          </div>
          <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Harvested Rules</p>
          <h2 className="text-2xl font-black text-white mt-2">{harvestedCount}</h2>
          <div className="text-[10px] text-neutral-500 mt-1">Active global overrides stored</div>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <CheckCircle2 size={40} className="text-emerald-400" />
          </div>
          <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Master Reference Catalog</p>
          <h2 className="text-2xl font-black text-emerald-450 mt-2">{totalMappableItems}</h2>
          <div className="text-[10px] text-neutral-500 mt-1">Standard cost codes available</div>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800/80 p-5 rounded-xl shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Terminal size={40} className="text-cyan-400" />
          </div>
          <p className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">System Registry Status</p>
          <h2 className="text-2xl font-black text-cyan-400 mt-2">ACTIVE</h2>
          <div className="text-[10px] text-neutral-500 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            HARVESTER_MODE::LISTENING
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {harvestedCount === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-850 rounded-xl p-24 text-center bg-neutral-900/10">
          <div className="p-4 bg-neutral-900 rounded-full border border-neutral-800 mb-6 text-neutral-500">
            <Terminal size={48} className="text-neutral-600 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Harvested Mappings</h3>
          <p className="text-neutral-400 max-w-md text-xs leading-relaxed mb-6">
            The global corporate lookup dictionary is currently empty. Mappings are automatically indexed here when estimators associate a Togal CSV classification string with an internal cost code in any active project workspace.
          </p>
          <Link
            href="/projects"
            className="bg-neutral-900 hover:bg-neutral-850 text-blue-450 border border-neutral-800 hover:border-blue-900/60 text-xs px-5 py-2.5 rounded font-bold uppercase tracking-wider transition-all"
          >
            Go to Project Directory
          </Link>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-3.5 text-neutral-600" size={16} />
            <input
              type="text"
              placeholder="Search registry by Togal classification, assigned item code target, description..."
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg pl-12 pr-4 py-3 text-xs text-white outline-none font-mono transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Data Table */}
          <div className="bg-neutral-950 border border-neutral-850 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-neutral-800">
                <thead>
                  <tr className="bg-neutral-900/80 text-neutral-400 uppercase tracking-wider font-semibold">
                    <th className="p-4 border-r border-b border-neutral-800">Togal Classification</th>
                    <th className="p-4 border-r border-b border-neutral-800">Assigned Suffix Code</th>
                    <th className="p-4 border-r border-b border-neutral-800">Item Description Reference</th>
                    <th className="p-4 border-r border-b border-neutral-800">Division Code & Scope</th>
                    <th className="p-4 text-center border-r border-b border-neutral-800">Cost Type</th>
                    <th className="p-4 text-center border-r border-b border-neutral-800">UOM</th>
                    <th className="p-4 text-center border-r border-b border-neutral-800">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-neutral-500 italic border-r border-b border-neutral-800">
                        No registry items match the query: &quot;{searchQuery}&quot;
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      let typeColor = "bg-neutral-900 text-neutral-400 border-neutral-800";
                      if (row.costType === "M") {
                        typeColor = "bg-emerald-950/40 text-emerald-400 border-emerald-900/50";
                      } else if (row.costType === "L") {
                        typeColor = "bg-cyan-950/40 text-cyan-400 border-cyan-900/50";
                      } else if (row.costType === "S") {
                        typeColor = "bg-amber-950/40 text-amber-500 border-amber-900/50";
                      }

                      return (
                        <tr key={row.classification} className="group transition-colors hover:bg-neutral-900/30">
                          <td className="p-4 font-bold text-white text-sm border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            {row.classification}
                          </td>
                          <td className="p-4 font-bold text-blue-455 font-mono tracking-widest uppercase border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            {row.itemId}
                          </td>
                          <td className="p-4 text-neutral-300 font-semibold border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            {row.description}
                          </td>
                          <td className="p-4 text-neutral-400 border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            <div className="flex items-center gap-2">
                              {row.divisionCode ? (
                                <span className="bg-neutral-900 border border-neutral-800 text-neutral-400 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                                  Div {row.divisionCode}
                                </span>
                              ) : (
                                <span className="bg-neutral-900 border border-neutral-800 text-neutral-500 px-2 py-0.5 rounded font-mono text-[10px]">
                                  —
                                </span>
                              )}
                              <span className="truncate max-w-[150px] font-bold">{row.divisionName}</span>
                            </div>
                          </td>
                          <td className="p-4 text-center border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            <span className={`inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${typeColor}`}>
                              {row.costType}
                            </span>
                          </td>
                          <td className="p-4 text-center font-bold text-neutral-555 border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            {row.uom}
                          </td>
                          <td className="p-4 text-center border-r border-b border-neutral-800 transition-colors group-hover:bg-neutral-900/40">
                            <button
                              onClick={() => handleDeleteRule(row.classification)}
                              className="inline-flex items-center justify-center p-2 rounded-md bg-neutral-900 hover:bg-rose-955/40 text-neutral-500 hover:text-rose-400 border border-neutral-850 hover:border-rose-900/50 transition-all duration-300 cursor-pointer shadow-sm"
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

          <div className="flex items-center gap-2 bg-neutral-900/40 border border-neutral-850 rounded-lg p-4 text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
            <AlertTriangle className="text-amber-500/80 animate-pulse shrink-0" size={14} />
            <span>WARNING: Modifications to lookup mappings on this page will alter CSV relational logic across all newly initialized workspaces.</span>
          </div>
        </div>
      )}
    </div>
  );
}
