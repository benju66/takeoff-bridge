"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Folder, Plus, X, Layers, MapPin, Calendar, Hash, ExternalLink, Activity, Info, Trash2, Menu, Building2 } from "lucide-react";
import { getProjects, saveProject, deleteProjectData } from "@/lib/db";
import { MARKET_SECTORS } from "@/lib/constants";
import { Project } from "@/types/db";
import ProtectedRoute from "@/components/ProtectedRoute";


export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [marketSector, setMarketSector] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [bidDate, setBidDate] = useState("");

  // Load projects from Supabase on client load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getProjects();
        if (!cancelled) setProjects(loaded);
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const sqFt = parseFloat(squareFootage) || 0;
    const units = parseInt(unitCount, 10) || 0;
    const loc = location.trim() || "Local Workspace";
    const bDate = bidDate || new Date().toISOString().split("T")[0];

    const newProject: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      location: loc,
      squareFootage: sqFt,
      unitCount: units,
      bidDate: bDate,
      createdAt: new Date().toISOString(),
      marketSector,
    };

    try {
      await saveProject(newProject);
      const updated = await getProjects();
      setProjects(updated);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert('Failed to create project. Please try again.');
      return;
    }

    // Reset Form Fields
    setName("");
    setLocation("");
    setMarketSector("");
    setSquareFootage("");
    setUnitCount("");
    setBidDate("");
    setIsModalOpen(false);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (window.confirm("Are you sure you want to permanently erase this project and all associated estimate matrices?")) {
      try {
        await deleteProjectData(projectId);
        const updated = await getProjects();
        setProjects(updated);
      } catch (err) {
        console.error('Failed to delete project:', err);
        alert('Failed to delete project. Please try again.');
      }
    }
  };


  return (
    <ProtectedRoute>
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
                <Layers className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> TAKEOFF PORTAL
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
                Multi-Project Directory Node v2.0.0
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm px-5 py-3 rounded-lg cursor-pointer font-bold transition-all duration-300 shadow-lg shadow-blue-900/30 hover:shadow-indigo-900/40 transform hover:-translate-y-0.5"
            >
              <Plus size={18} /> Initialize Project
            </button>
          </div>
        </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Relational Isolation Enabled</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            Each project functions as an isolated digital sandbox. Calculations, registry bindings, and unit-metric mappings are dynamically containerized per project to avoid global state pollution.
          </p>
        </div>
      </div>

      {/* Projects Matrix */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <div className="p-4 bg-background rounded-full border border-grid-border mb-6 text-slate-600 dark:text-slate-400">
            <Folder size={48} className="text-slate-600 dark:text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">No Projects Detected</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed mb-6">
            Begin by initializing a new takeoff database entity. You will be prompted to supply scope details prior to uploading project estimation sheets.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-card hover:bg-background dark:bg-card dark:hover:bg-background text-blue-600 dark:text-blue-400 border border-grid-border hover:border-blue-500/50 dark:hover:border-blue-400/50 text-xs px-5 py-2.5 rounded-lg font-bold uppercase tracking-wider transition-all cursor-pointer"
          >
            Initialize First Project
          </button>
        </div>
      ) : (
        <div className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="text-emerald-600 dark:text-emerald-400" size={16} /> Active Terminal Nodes
            </h3>
            <span className="text-[10px] bg-background dark:bg-slate-800 border border-grid-border px-3 py-1 rounded-full text-slate-600 dark:text-slate-400 font-sans font-semibold">
              Total Managed: {projects.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-separate border-spacing-0 border-t border-l border-grid-border">
              <thead>
                <tr className="bg-background/80 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="p-4 border-r border-b border-grid-border font-semibold">Project ID</th>
                  <th className="p-4 border-r border-b border-grid-border font-semibold">Name</th>
                  <th className="p-4 border-r border-b border-grid-border font-semibold">Location</th>
                  <th className="p-4 border-r border-b border-grid-border font-semibold">Market Sector</th>
                  <th className="p-4 text-right border-r border-b border-grid-border font-semibold">Square Footage</th>
                  <th className="p-4 text-right border-r border-b border-grid-border font-semibold">Unit Count</th>
                  <th className="p-4 text-right border-r border-b border-grid-border font-semibold">Bid Date</th>
                  <th className="p-4 text-center border-r border-b border-grid-border font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((proj) => (
                  <tr key={proj.id} className="group transition-colors">
                    <td className="p-4 font-bold text-blue-600 dark:text-blue-400 tracking-widest border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40 font-mono">{proj.id}</td>
                    <td className="p-4 font-bold text-foreground text-sm border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40">{proj.name}</td>
                    <td className="p-4 text-slate-600 dark:text-slate-400 border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40">
                      <div className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-slate-600 dark:text-slate-400" />
                        {proj.location}
                      </div>
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-400 border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40">
                      <div className="flex items-center gap-1.5">
                        <Building2 size={12} className="text-slate-600 dark:text-slate-400" />
                        {proj.marketSector || "—"}
                      </div>
                    </td>
                    <td className="p-4 text-right text-foreground font-bold border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40 font-mono">
                      {proj.squareFootage.toLocaleString()} <span className="text-slate-600 dark:text-slate-400 font-normal">SF</span>
                    </td>
                    <td className="p-4 text-right text-foreground font-bold border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40 font-mono">
                      {proj.unitCount.toLocaleString()} <span className="text-slate-600 dark:text-slate-400 font-normal">Units</span>
                    </td>
                    <td className="p-4 text-right text-slate-600 dark:text-slate-400 border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40 font-mono">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Calendar size={12} className="text-slate-600 dark:text-slate-400" />
                        {proj.bidDate}
                      </div>
                    </td>
                    <td className="p-4 text-center border-r border-b border-grid-border transition-colors group-hover:bg-background dark:group-hover:bg-slate-800/40">
                      <div className="flex items-center justify-center gap-2">
                        <Link
                          href={`/projects/${proj.id}`}
                          className="inline-flex items-center gap-1.5 bg-background hover:bg-blue-50 dark:bg-card dark:hover:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-grid-border hover:border-blue-500/50 dark:hover:border-blue-400/50 rounded-lg px-3.5 py-1.5 font-bold uppercase transition-all duration-300 shadow-sm hover:shadow-md"
                        >
                          Launch <ExternalLink size={12} />
                        </Link>
                        <button
                          onClick={() => handleDeleteProject(proj.id)}
                          className="inline-flex items-center gap-1.5 bg-background hover:bg-rose-50 dark:bg-card dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-grid-border hover:border-rose-500/50 dark:hover:border-rose-400/50 rounded-lg px-3.5 py-1.5 font-bold uppercase transition-all duration-300 shadow-sm cursor-pointer hover:shadow-md"
                        >
                          Delete <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Creation Modal dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-card border border-grid-border w-full max-w-lg rounded-xl shadow-xl overflow-hidden text-card-foreground">
            <div className="flex justify-between items-center bg-background/80 dark:bg-background/50 p-4 border-b border-grid-border">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Plus size={16} className="text-blue-600 dark:text-blue-400" /> Initialize New Estimate Scope
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oakridge Residential Phase II"
                  className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                  Location / Region
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="e.g. Chicago, IL"
                    className="w-full bg-transparent border border-grid-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                  Market Sector
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400" size={14} />
                  <select
                    required
                    className="w-full bg-transparent border border-grid-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                    value={marketSector}
                    onChange={(e) => setMarketSector(e.target.value)}
                  >
                    <option value="" disabled>Select market sector…</option>
                    {MARKET_SECTORS.map((sector) => (
                      <option key={sector} value={sector}>{sector}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                    Square Footage (SF)
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400" size={14} />
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 145000"
                      className="w-full bg-transparent border border-grid-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                    Unit Count
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400" size={14} />
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 120"
                      className="w-full bg-transparent border border-grid-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                      value={unitCount}
                      onChange={(e) => setUnitCount(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 font-bold">
                  Bid Submission Date
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 text-slate-600 dark:text-slate-400" size={14} />
                  <input
                    type="date"
                    className="w-full bg-transparent border border-grid-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground outline-none font-sans transition-all focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40"
                    value={bidDate}
                    onChange={(e) => setBidDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-grid-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="bg-card hover:bg-background dark:bg-card dark:hover:bg-background text-foreground border border-grid-border rounded-lg px-4 py-2 text-xs font-bold uppercase transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg px-5 py-2 text-xs font-bold uppercase shadow-md shadow-blue-500/10 transition-all cursor-pointer"
                >
                  Create Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </ProtectedRoute>
  );
}
