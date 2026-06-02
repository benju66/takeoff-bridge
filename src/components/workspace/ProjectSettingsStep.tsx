import React, { useState } from "react";
import {
  Settings,
  Sliders,
  Activity,
  Check,
  Save,
  RotateCcw,
  Cloud,
  Database,
  SlidersHorizontal
} from "lucide-react";

interface ProjectSettingsStepProps {
  projectId: string;
}

export function ProjectSettingsStep({ projectId }: ProjectSettingsStepProps) {
  const [activeSubTab, setActiveSubTab] = useState<"general" | "integration" | "ui">("general");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Interface State
  const [hoverExpand, setHoverExpand] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("takeoff-bridge-sidebar-hover-expand") === "true";
    }
    return false;
  });
  const [showGridlines, setShowGridlines] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("takeoff-bridge-gridlines-visible") !== "false";
    }
    return true;
  });
  const [showFormulaBar, setShowFormulaBar] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("takeoff-bridge-formula-bar-visible") !== "false";
    }
    return true;
  });

  // General State
  const [currency, setCurrency] = useState("USD");
  const [unitSystem, setUnitSystem] = useState("imperial");
  const [csiVersion, setCsiVersion] = useState("2016");

  // Integration State
  const [procoreSync, setProcoreSync] = useState(true);
  const [procoreAutoMap, setProcoreAutoMap] = useState(true);
  const [togalSync, setTogalSync] = useState(false);
  const [cloudBackup, setCloudBackup] = useState(true);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleSave = () => {
    // Save to localStorage
    localStorage.setItem("takeoff-bridge-sidebar-hover-expand", String(hoverExpand));
    localStorage.setItem("takeoff-bridge-gridlines-visible", String(showGridlines));
    localStorage.setItem("takeoff-bridge-formula-bar-visible", String(showFormulaBar));

    // Dispatch global events
    window.dispatchEvent(new CustomEvent("sidebar-settings-updated"));
    window.dispatchEvent(new CustomEvent("grid-settings-updated"));

    triggerToast("Settings saved successfully! Sync preferences updated.");
  };

  const handleReset = () => {
    setHoverExpand(false);
    setShowGridlines(true);
    setShowFormulaBar(true);
    setCurrency("USD");
    setUnitSystem("imperial");
    setCsiVersion("2016");
    setProcoreSync(true);
    setProcoreAutoMap(true);
    setTogalSync(false);
    setCloudBackup(true);

    triggerToast("Settings reset to defaults.");
  };

  return (
    <div className="bg-card border border-grid-border text-card-foreground rounded-xl shadow-sm overflow-hidden animate-fade-in relative flex flex-col md:flex-row min-h-[500px]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-4 right-4 z-50 bg-emerald-600 text-white font-bold text-xs uppercase px-4 py-3 rounded-lg shadow-xl shadow-emerald-900/20 flex items-center gap-2 animate-bounce">
          <Check size={16} />
          {toastMessage}
        </div>
      )}

      {/* Left Sidebar Category Navigation */}
      <div className="w-full md:w-60 bg-slate-50 dark:bg-slate-950/40 border-b md:border-b-0 md:border-r border-grid-border p-4 flex flex-col justify-between shrink-0">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 pl-2 mb-4">
            <Settings className="text-blue-600 dark:text-blue-400" size={18} />
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 font-sans">
              Settings Category
            </span>
          </div>

          <button
            onClick={() => setActiveSubTab("general")}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold uppercase transition-all duration-200 text-left cursor-pointer ${
              activeSubTab === "general"
                ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-200"
            }`}
          >
            <Sliders size={16} />
            General Context
          </button>



          <button
            onClick={() => setActiveSubTab("integration")}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold uppercase transition-all duration-200 text-left cursor-pointer ${
              activeSubTab === "integration"
                ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-200"
            }`}
          >
            <Cloud size={16} />
            Integration Sync
          </button>

          <button
            onClick={() => setActiveSubTab("ui")}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold uppercase transition-all duration-200 text-left cursor-pointer ${
              activeSubTab === "ui"
                ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-200"
            }`}
          >
            <SlidersHorizontal size={16} />
            Interface Prefs
          </button>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col gap-2 mt-8 md:mt-0 pt-4 border-t border-grid-border">
          <button
            onClick={handleSave}
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2.5 rounded-lg font-bold transition-all shadow-md shadow-blue-500/10 cursor-pointer"
          >
            <Save size={14} />
            Save Changes
          </button>
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 w-full border border-grid-border hover:bg-slate-100 dark:hover:bg-slate-800 text-foreground text-xs px-4 py-2.5 rounded-lg font-bold transition-all cursor-pointer"
          >
            <RotateCcw size={14} />
            Reset Defaults
          </button>
        </div>
      </div>

      {/* Right Content Panel */}
      <div className="flex-1 p-6 flex flex-col justify-between font-sans text-xs bg-card">
        <div>
          {/* Header Title */}
          <div className="flex items-center justify-between border-b border-grid-border pb-4 mb-6">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {activeSubTab === "general" && "General Project Context"}
                {activeSubTab === "integration" && "External Cloud Integration Nodes"}
                {activeSubTab === "ui" && "Workspace Interface Preferences"}
              </h4>
              <p className="text-[11px] text-slate-500 mt-1">
                {activeSubTab === "general" && "Set active workspace details, CSI division mapping formats, and core dimensions."}
                {activeSubTab === "integration" && "Configure background data synchronization limits and active vendor API webhooks."}
                {activeSubTab === "ui" && "Tailor the sheet matrix, sidebar layouts, and keyboard focus behavior."}
              </p>
            </div>
            <span className="text-[9px] bg-slate-100 dark:bg-slate-900 border border-grid-border font-mono px-2 py-0.5 rounded text-slate-550 font-bold uppercase">
              Project ID: {projectId}
            </span>
          </div>

          {/* General Tab */}
          {activeSubTab === "general" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
              <div className="flex flex-col gap-2">
                <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
                  System Currency Format
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="bg-transparent border border-grid-border rounded-lg px-3 py-2 text-foreground font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USD">USD ($) — US Dollars</option>
                  <option value="CAD">CAD ($) — Canadian Dollars</option>
                  <option value="EUR">EUR (€) — Euro</option>
                  <option value="GBP">GBP (£) — British Pounds</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
                  CSI Division Reference Standard
                </label>
                <select
                  value={csiVersion}
                  onChange={(e) => setCsiVersion(e.target.value)}
                  className="bg-transparent border border-grid-border rounded-lg px-3 py-2 text-foreground font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="2016">CSI MasterFormat (2016 Edition — 50 Div)</option>
                  <option value="1995">CSI MasterFormat (1995 Edition — 16 Div)</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider">
                  Measurement Framework System
                </label>
                <div className="flex gap-4 mt-1">
                  <label className="flex items-center gap-2 font-semibold text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="unitSystem"
                      value="imperial"
                      checked={unitSystem === "imperial"}
                      onChange={() => setUnitSystem("imperial")}
                      className="accent-blue-600"
                    />
                    Imperial (SF, LF, EA, CY)
                  </label>
                  <label className="flex items-center gap-2 font-semibold text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="unitSystem"
                      value="metric"
                      checked={unitSystem === "metric"}
                      onChange={() => setUnitSystem("metric")}
                      className="accent-blue-600"
                    />
                    Metric (m², m, U, m³)
                  </label>
                </div>
              </div>
            </div>
          )}



          {/* Integration Tab */}
          {activeSubTab === "integration" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database size={24} className="text-blue-500" />
                  <div>
                    <span className="font-bold text-foreground block">Procore Budget Sync Connector</span>
                    <span className="text-[10px] text-slate-500">Auto sync columns, codes and line item totals into project prime budgets.</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProcoreSync(!procoreSync)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    procoreSync ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      procoreSync ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database size={24} className="text-orange-500" />
                  <div>
                    <span className="font-bold text-foreground block">Procore Suffix Auto-Mapping</span>
                    <span className="text-[10px] text-slate-500">Auto map fine-grained classifications directly to parent Procore structures.</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!procoreSync}
                  onClick={() => setProcoreAutoMap(!procoreAutoMap)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    !procoreSync ? "opacity-30 cursor-not-allowed bg-slate-800" : procoreAutoMap ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      procoreSync && procoreAutoMap ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity size={24} className="text-teal-500" />
                  <div>
                    <span className="font-bold text-foreground block">Togal.ai Live Feed Sync</span>
                    <span className="text-[10px] text-slate-500">Automatically pull latest plan takeoff measurement streams on file refresh.</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTogalSync(!togalSync)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    togalSync ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      togalSync ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cloud size={24} className="text-purple-500" />
                  <div>
                    <span className="font-bold text-foreground block">Database Cloud Backup</span>
                    <span className="text-[10px] text-slate-500">Replicate local change logs automatically to secure Supabase cloud records.</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCloudBackup(!cloudBackup)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    cloudBackup ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      cloudBackup ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Interface Tab */}
          {activeSubTab === "ui" && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div>
                  <span className="font-bold text-foreground block">Hover Auto-Expand Sidebar</span>
                  <span className="text-[10px] text-slate-500">Auto expand the sidebar layout on hover when it is collapsed.</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !hoverExpand;
                    setHoverExpand(nextVal);
                    localStorage.setItem("takeoff-bridge-sidebar-hover-expand", String(nextVal));
                    window.dispatchEvent(new CustomEvent("sidebar-settings-updated"));
                  }}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    hoverExpand ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      hoverExpand ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div>
                  <span className="font-bold text-foreground block">Show Table Gridlines</span>
                  <span className="text-[10px] text-slate-500">Render border boundaries explicitly around cells in the estimate matrix.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGridlines(!showGridlines)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    showGridlines ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      showGridlines ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="border border-grid-border rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/10 flex items-center justify-between">
                <div>
                  <span className="font-bold text-foreground block">Display SpreadSheet Formula Bar</span>
                  <span className="text-[10px] text-slate-500">Show the calculation editing formula bar at the top of the Estimate matrix.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFormulaBar(!showFormulaBar)}
                  className={`w-10 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${
                    showFormulaBar ? "bg-blue-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full transition-transform duration-200 ${
                      showFormulaBar ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Console Node Diagnostics Footer Info */}
        <div className="pt-4 border-t border-grid-border text-slate-500 text-[9px] font-mono flex items-center justify-between">
          <span>CONSOLE PREF BUFFER: OK</span>
          <span>TAKEOFF BRIDGE MODULE v2.0.0</span>
        </div>
      </div>
    </div>
  );
}
