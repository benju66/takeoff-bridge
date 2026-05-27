"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Folder, Plus, X, Layers, MapPin, Calendar, Hash, ExternalLink, Activity, Info } from "lucide-react";
import { getProjects, saveProject } from "@/lib/db";
import { Project } from "@/types/db";

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [bidDate, setBidDate] = useState("");

  // Load projects from local storage on client load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjects(getProjects());
  }, []);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const sqFt = parseFloat(squareFootage) || 0;
    const units = parseInt(unitCount, 10) || 0;
    const loc = location.trim() || "Local Workspace";
    const bDate = bidDate || new Date().toISOString().split("T")[0];

    const newProject: Project = {
      id: `PRJ-${Math.floor(1000 + Math.random() * 9000)}`,
      name: name.trim(),
      location: loc,
      squareFootage: sqFt,
      unitCount: units,
      bidDate: bDate,
      createdAt: new Date().toISOString(),
    };

    saveProject(newProject);
    setProjects(getProjects());

    // Reset Form Fields
    setName("");
    setLocation("");
    setSquareFootage("");
    setUnitCount("");
    setBidDate("");
    setIsModalOpen(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100 font-mono p-8 selection:bg-blue-600/30 selection:text-blue-200">
      {/* Header Panel */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-neutral-850 pb-6 mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-wider text-white flex items-center gap-3">
            <Layers className="text-blue-500 animate-pulse" size={32} /> TAKEOFF PORTAL
          </h1>
          <p className="text-xs text-neutral-400 mt-2 uppercase tracking-widest font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
            Multi-Project Directory Node v2.0.0
          </p>
        </div>
        
        <div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm px-5 py-3 rounded-lg cursor-pointer font-bold transition-all duration-300 shadow-lg shadow-blue-900/30 hover:shadow-indigo-900/40 transform hover:-translate-y-0.5"
          >
            <Plus size={18} /> Initialize Project
          </button>
        </div>
      </header>

      {/* Info Notice Banner */}
      <div className="bg-blue-950/20 border border-blue-900/45 p-4 rounded-xl mb-8 flex items-start gap-3">
        <Info className="text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider">Relational Isolation Enabled</h4>
          <p className="text-[11px] text-neutral-400 leading-relaxed mt-1">
            Each project functions as an isolated digital sandbox. Calculations, registry bindings, and unit-metric mappings are dynamically containerized per project to avoid global state pollution.
          </p>
        </div>
      </div>

      {/* Projects Matrix */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-800 rounded-xl p-24 text-center bg-neutral-900/10">
          <div className="p-4 bg-neutral-900 rounded-full border border-neutral-800 mb-6 text-neutral-500">
            <Folder size={48} className="text-neutral-600" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Projects Detected</h3>
          <p className="text-neutral-400 max-w-md text-xs leading-relaxed mb-6">
            Begin by initializing a new takeoff database entity. You will be prompted to supply scope details prior to uploading project estimation sheets.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-neutral-900 hover:bg-neutral-850 text-blue-400 border border-neutral-800 hover:border-blue-900/60 text-xs px-5 py-2.5 rounded font-bold uppercase tracking-wider transition-all"
          >
            Initialize First Project
          </button>
        </div>
      ) : (
        <div className="bg-neutral-950 border border-neutral-850 rounded-xl overflow-hidden shadow-2xl">
          <div className="p-4 bg-neutral-900/50 border-b border-neutral-850 flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-2">
              <Activity className="text-emerald-500" size={16} /> Active Terminal Nodes
            </h3>
            <span className="text-[10px] bg-neutral-800 text-neutral-400 px-3 py-1 rounded-full border border-neutral-700">
              Total Managed: {projects.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-neutral-900/80 text-neutral-400 uppercase border-b border-neutral-850 tracking-wider font-semibold">
                  <th className="p-4">Project ID</th>
                  <th className="p-4">Name</th>
                  <th className="p-4">Location</th>
                  <th className="p-4 text-right">Square Footage</th>
                  <th className="p-4 text-right">Unit Count</th>
                  <th className="p-4 text-right">Bid Date</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {projects.map((proj) => (
                  <tr key={proj.id} className="hover:bg-neutral-900/30 transition-colors">
                    <td className="p-4 font-bold text-blue-450 tracking-widest">{proj.id}</td>
                    <td className="p-4 font-bold text-white text-sm">{proj.name}</td>
                    <td className="p-4 text-neutral-400">
                      <div className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-neutral-500" />
                        {proj.location}
                      </div>
                    </td>
                    <td className="p-4 text-right text-neutral-300 font-bold">
                      {proj.squareFootage.toLocaleString()} <span className="text-neutral-600 font-normal">SF</span>
                    </td>
                    <td className="p-4 text-right text-neutral-300 font-bold">
                      {proj.unitCount.toLocaleString()} <span className="text-neutral-600 font-normal">Units</span>
                    </td>
                    <td className="p-4 text-right text-neutral-400">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Calendar size={12} className="text-neutral-500" />
                        {proj.bidDate}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <Link
                        href={`/projects/${proj.id}`}
                        className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-blue-950/40 text-blue-400 hover:text-blue-300 border border-neutral-800 hover:border-blue-900/60 rounded-md px-3.5 py-1.5 font-bold uppercase transition-all duration-300 shadow-sm"
                      >
                        Launch <ExternalLink size={12} />
                      </Link>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-neutral-950 border border-neutral-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center bg-neutral-900 p-4 border-b border-neutral-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Plus size={16} className="text-blue-500" /> Initialize New Estimate Scope
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5 font-bold">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oakridge Residential Phase II"
                  className="w-full bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded px-3 py-2 text-xs text-white outline-none font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5 font-bold">
                  Location / Region
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 text-neutral-600" size={14} />
                  <input
                    type="text"
                    placeholder="e.g. Chicago, IL"
                    className="w-full bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded pl-9 pr-3 py-2 text-xs text-white outline-none font-mono"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5 font-bold">
                    Square Footage (SF)
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-2.5 text-neutral-600" size={14} />
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 145000"
                      className="w-full bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded pl-9 pr-3 py-2 text-xs text-white outline-none font-mono"
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5 font-bold">
                    Unit Count
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-2.5 text-neutral-600" size={14} />
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 120"
                      className="w-full bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded pl-9 pr-3 py-2 text-xs text-white outline-none font-mono"
                      value={unitCount}
                      onChange={(e) => setUnitCount(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1.5 font-bold">
                  Bid Submission Date
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 text-neutral-600" size={14} />
                  <input
                    type="date"
                    className="w-full bg-neutral-900 border border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded pl-9 pr-3 py-2 text-xs text-white outline-none font-mono"
                    value={bidDate}
                    onChange={(e) => setBidDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-neutral-900">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="bg-neutral-900 hover:bg-neutral-850 text-neutral-450 border border-neutral-800 rounded px-4 py-2 text-xs font-bold uppercase transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded px-5 py-2 text-xs font-bold uppercase shadow-lg shadow-blue-900/20 transition-all"
                >
                  Create Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
