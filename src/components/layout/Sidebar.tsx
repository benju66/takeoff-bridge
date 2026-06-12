"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Folder,
  Database,
  Layers,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Settings,
  Users,
  Activity,
  Sliders,
  LayoutGrid,
  Info,
  Sigma,
  DollarSign,
  Boxes,
  GitBranch,
  HeartPulse,
  FileSpreadsheet
} from "lucide-react";
import { getProject, getSession, signOut } from "@/lib/db";
import { Project } from "@/types/db";

interface SidebarProps {
  sidebarState: "expanded" | "collapsed" | "hidden";
  setSidebarState: (state: "expanded" | "collapsed" | "hidden") => void;
}

export default function Sidebar({ sidebarState, setSidebarState }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStep = searchParams.get("step") || "step4";

  // Parse project ID from URL if active
  const pathParts = pathname.split("/");
  const urlProjectId = pathParts[1] === "projects" && pathParts[2] && pathParts[2] !== "page" ? pathParts[2] : null;

  const [project, setProject] = useState<Project | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [lastProjectId, setLastProjectId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("takeoff-bridge-last-project");
    }
    return null;
  });
  const [isHovered, setIsHovered] = useState(false);
  const [hoverExpandEnabled, setHoverExpandEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("takeoff-bridge-sidebar-hover-expand") === "true";
    }
    return false;
  });

  // Load user session and last project memory
  useEffect(() => {
    const handleSettingsUpdate = () => {
      const current = localStorage.getItem("takeoff-bridge-sidebar-hover-expand") === "true";
      setHoverExpandEnabled(current);
    };
    window.addEventListener("sidebar-settings-updated", handleSettingsUpdate);
    return () => {
      window.removeEventListener("sidebar-settings-updated", handleSettingsUpdate);
    };
  }, []);

  // Fetch project details if in project scope
  useEffect(() => {
    if (!urlProjectId) {
      Promise.resolve().then(() => setProject(null));
      return;
    }

    // Save as last active project
    localStorage.setItem("takeoff-bridge-last-project", urlProjectId);
    Promise.resolve().then(() => setLastProjectId(urlProjectId));

    let active = true;
    getProject(urlProjectId)
      .then((p) => {
        if (active && p) {
          setProject(p);
        }
      })
      .catch((err) => console.error("Failed to load project in sidebar:", err));

    const handleProjectUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<Project>;
      if (customEvent.detail && customEvent.detail.id === urlProjectId) {
        setProject(customEvent.detail);
      }
    };

    window.addEventListener("project-updated", handleProjectUpdate);
    return () => {
      active = false;
      window.removeEventListener("project-updated", handleProjectUpdate);
    };
  }, [urlProjectId]);

  // Load user session and last project memory
  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (active && session?.user?.email) {
          setUserEmail(session.user.email);
        }
      })
      .catch((err) => console.error("Failed to load session in sidebar:", err));

    return () => {
      active = false;
    };
  }, []);

  const handleToggleCollapse = () => {
    setSidebarState(sidebarState === "expanded" ? "collapsed" : "expanded");
  };

  const handleSignOut = async () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      try {
        await signOut();
        window.location.href = "/login";
      } catch (err) {
        console.error("Sign out failed:", err);
      }
    }
  };

  // Skip rendering if hidden
  if (sidebarState === "hidden") {
    return null;
  }

  const isCollapsed = sidebarState === "collapsed" && !(hoverExpandEnabled && isHovered);
  const activeProjectSlug = urlProjectId || lastProjectId;

  return (
    <aside
      onMouseEnter={() => {
        if (sidebarState === "collapsed" && hoverExpandEnabled) {
          setIsHovered(true);
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      className={`h-screen bg-slate-950 text-slate-350 border-r border-slate-900 flex flex-col justify-between select-none relative z-40 transition-all duration-300 ease-in-out shrink-0 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Collapse Toggle Button */}
      <button
        onClick={handleToggleCollapse}
        className="absolute -right-3 top-6 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-full p-1 z-50 transition-colors shadow-md hover:shadow-lg cursor-pointer"
        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Inner Container to clip content overflow during transition while keeping the toggle button visible outside */}
      <div className="w-full h-full flex flex-col justify-between overflow-hidden">
        {/* Top Section: Logo & Main Navigation */}
        <div className="flex flex-col gap-6">
          {/* Brand Header */}
          <div className={`p-4 border-b border-slate-900/80 flex items-center gap-3 ${isCollapsed ? "justify-center" : ""}`}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0 transform hover:rotate-6 transition-transform">
              <Layers size={18} />
            </div>
            <div className={`flex flex-col min-w-0 transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
              <span className="font-extrabold text-white tracking-wider text-sm whitespace-nowrap">TAKEOFF BRIDGE</span>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest font-semibold whitespace-nowrap">v2.0.0</span>
            </div>
          </div>

          {/* Primary Directories */}
          <div className={`flex flex-col gap-1.5 px-3 ${isCollapsed ? "items-center" : ""}`}>
            <span className={`text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2 mb-1.5 transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0 h-0 mb-0 py-0" : "opacity-100 max-w-xs"}`}>
              Portal Nodes
            </span>

            {/* Projects Directory Link */}
            <Link
              href="/projects"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/projects"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Projects Directory" : undefined}
            >
              <Folder size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Projects Directory
              </span>
            </Link>

            {/* Global Registry Link */}
            <Link
              href="/registry"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/registry"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Global Registry" : undefined}
            >
              <Database size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Global Registry
              </span>
            </Link>

            {/* Cost Code Mapping Link */}
            <Link
              href="/cost-codes"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/cost-codes"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Cost Code Mapping" : undefined}
            >
              <Sigma size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Cost Code Mapping
              </span>
            </Link>

            {/* Procore Cost Codes (master list) Link */}
            <Link
              href="/procore-codes"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/procore-codes"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Procore Cost Codes" : undefined}
            >
              <FileSpreadsheet size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Procore Cost Codes
              </span>
            </Link>

            {/* Rate Card Link */}
            <Link
              href="/rates"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/rates"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Company Rate Card" : undefined}
            >
              <DollarSign size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Company Rate Card
              </span>
            </Link>

            {/* Catalog Manager Link */}
            <Link
              href="/catalog"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/catalog"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Catalog Manager" : undefined}
            >
              <Boxes size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Catalog Manager
              </span>
            </Link>

            {/* Data Health Link */}
            <Link
              href="/data-health"
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname === "/data-health"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Data Health" : undefined}
            >
              <HeartPulse size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Data Health
              </span>
            </Link>

            {/* Resume Workspace Link */}
            {!urlProjectId && (
              <Link
                href={activeProjectSlug ? `/projects/${activeProjectSlug}` : "#"}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  activeProjectSlug
                    ? "hover:bg-slate-900 hover:text-slate-100 text-slate-400 cursor-pointer"
                    : "opacity-30 cursor-not-allowed text-slate-655"
                }`}
                title={isCollapsed ? "Enter Workspace" : undefined}
                onClick={(e) => {
                  if (!activeProjectSlug) e.preventDefault();
                }}
              >
                <LayoutGrid size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  Active Workspace
                </span>
              </Link>
            )}
          </div>

          {/* Project Scope Steps Navigation */}
          {urlProjectId && project && (
            <div className={`flex flex-col gap-1 px-3 ${isCollapsed ? "items-center" : ""}`}>
              <div className={`flex flex-col pl-2 mb-2 border-l border-slate-800 transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0 h-0 mb-0 py-0" : "opacity-100 max-w-xs"}`}>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                  Workspace
                </span>
                <span className="text-[11px] font-black text-white truncate max-w-[200px] uppercase mt-0.5 whitespace-nowrap" title={project.name}>
                  {project.name}
                </span>
              </div>
              <div className={`w-full h-px bg-slate-900 my-1 transition-all duration-300 ${isCollapsed ? "opacity-100" : "opacity-0 h-0 my-0 overflow-hidden"}`} />

              {/* Step 1: Project Data */}
              <Link
                href={`/projects/${urlProjectId}?step=step1`}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  pathname.startsWith("/projects/") && activeStep === "step1"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                    : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
                }`}
                title={isCollapsed ? "Project Data" : undefined}
              >
                <Info size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  Project Data
                </span>
              </Link>

              {/* Step 2: General Conditions */}
              <Link
                href={`/projects/${urlProjectId}?step=step2`}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  pathname.startsWith("/projects/") && activeStep === "step2"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                    : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
                }`}
                title={isCollapsed ? "General Conditions" : undefined}
              >
                <Users size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  General Conditions
                </span>
              </Link>

              {/* Step 3: Site Operations */}
              <Link
                href={`/projects/${urlProjectId}?step=step3`}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  pathname.startsWith("/projects/") && activeStep === "step3"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                    : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
                }`}
                title={isCollapsed ? "Site Operations" : undefined}
              >
                <Activity size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  Site Operations
                </span>
              </Link>

              {/* Step 4: Estimate */}
              <Link
                href={`/projects/${urlProjectId}?step=step4`}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  pathname.startsWith("/projects/") && activeStep === "step4"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                    : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
                }`}
                title={isCollapsed ? "Estimate" : undefined}
              >
                <Sliders size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  Estimate
                </span>
              </Link>

              {/* Estimate Versions (save / submit / compare) */}
              <Link
                href={`/projects/${urlProjectId}?step=versions`}
                className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                  isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
                } ${
                  pathname.startsWith("/projects/") && activeStep === "versions"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                    : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
                }`}
                title={isCollapsed ? "Versions" : undefined}
              >
                <GitBranch size={16} className="shrink-0" />
                <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                  Versions
                </span>
              </Link>
            </div>
          )}
        </div>

        {/* Bottom Section: Settings & Signout */}
        <div className={`p-3 border-t border-slate-900 bg-slate-950/60 flex flex-col gap-1.5 ${isCollapsed ? "items-center" : ""}`}>
          {/* Project Settings (Active Project Context) */}
          {urlProjectId && (
            <Link
              href={`/projects/${urlProjectId}?step=settings`}
              className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
                isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
              } ${
                pathname.startsWith("/projects/") && activeStep === "settings"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/10"
                  : "hover:bg-slate-900 hover:text-slate-100 text-slate-400"
              }`}
              title={isCollapsed ? "Settings" : undefined}
            >
              <Settings size={16} className="shrink-0" />
              <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
                Settings
              </span>
            </Link>
          )}

          {/* User Account Info Display */}
          <div className={`px-3.5 py-1.5 flex flex-col min-w-0 transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0 h-0 py-0" : "opacity-100 max-w-xs"}`}>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold whitespace-nowrap">Logged In As</span>
            <span className="text-[11px] font-mono text-slate-350 truncate mt-0.5 whitespace-nowrap" title={userEmail}>
              {userEmail}
            </span>
          </div>

          {/* Sign Out Button */}
          <button
            onClick={handleSignOut}
            className={`flex items-center rounded-lg font-bold text-xs uppercase tracking-wider text-rose-500 hover:bg-rose-500/10 transition-all duration-200 w-full text-left cursor-pointer ${
              isCollapsed ? "p-2.5 justify-center" : "gap-3 px-3.5 py-2.5"
            }`}
            title={isCollapsed ? "Sign Out" : undefined}
          >
            <LogOut size={16} className="shrink-0" />
            <span className={`whitespace-nowrap transition-all duration-300 overflow-hidden ${isCollapsed ? "opacity-0 max-w-0" : "opacity-100 max-w-xs"}`}>
              Sign Out
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
