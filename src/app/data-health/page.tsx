"use client";

import React from "react";
import Link from "next/link";
import {
  HeartPulse,
  Info,
  Menu,
  Terminal,
  AlertTriangle,
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  Boxes,
  FolderOpen,
} from "lucide-react";
import { useDataHealth } from "@/hooks/useDataHealth";
import {
  DATA_HEALTH_SEVERITY_ORDER,
  FINDING_TYPE_LABELS,
  type DataHealthFinding,
  type DataHealthSeverity,
} from "@/lib/dataHealth";

// ---------------------------------------------------------------------------
// /data-health — the company-wide Data Health dashboard (fidelity Phase 4).
// READ-ONLY by design: this page detects; the fixes deliberately live where
// they already exist — /catalog (merge / retire / BLI backfill / promote),
// the workspace Flags view (assign unmapped lines), the Projects directory
// (capture-field backfill, deleting a verified duplicate), and re-import.
// One audit engine, two surfaces: this page shows every finding; the project
// workspace strip shows the same findings filtered to one project.
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<
  DataHealthSeverity,
  { label: string; header: string; headerText: string; icon: React.ReactNode }
> = {
  high: {
    label: "Needs attention",
    header: "bg-rose-50/50 dark:bg-rose-950/10 border-rose-200 dark:border-rose-900/50",
    headerText: "text-rose-700 dark:text-rose-400",
    icon: <AlertOctagon size={14} className="text-rose-500 shrink-0" />,
  },
  medium: {
    label: "Review",
    header: "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/50",
    headerText: "text-amber-700 dark:text-amber-400",
    icon: <AlertTriangle size={14} className="text-amber-500 shrink-0" />,
  },
  low: {
    label: "Housekeeping",
    header: "bg-slate-50/50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800",
    headerText: "text-slate-700 dark:text-slate-300",
    icon: <Info size={14} className="text-slate-500 shrink-0" />,
  },
};

function FindingCard({ finding }: { finding: DataHealthFinding }) {
  return (
    <div className="p-4 border-b border-grid-border last:border-b-0">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="inline-block text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest uppercase bg-background/80 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border-grid-border shrink-0 mt-0.5">
          {FINDING_TYPE_LABELS[finding.type]}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-bold text-foreground">{finding.title}</h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1 whitespace-pre-line">
            {finding.detail}
          </p>
          {(finding.projects.length > 0 || finding.code) && (
            <div className="flex items-center gap-3 flex-wrap mt-2 text-[10px] font-bold uppercase tracking-wider">
              {finding.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <FolderOpen size={11} className="shrink-0" /> {p.name}
                </Link>
              ))}
              {finding.code && (
                <Link
                  href="/catalog"
                  className="flex items-center gap-1 text-violet-600 dark:text-violet-400 hover:underline"
                  title={`Manage ${finding.code} on the Catalog Manager (merge / retire / backfill / promote)`}
                >
                  <Boxes size={11} className="shrink-0" /> {finding.code} on /catalog
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DataHealthDashboard() {
  const { findings, failedSources, isLoading } = useDataHealth();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <Terminal className="text-blue-600 dark:text-blue-400 mb-4 animate-pulse" size={48} />
        <h3 className="text-lg font-bold text-foreground mb-2">Running Data Health Audit...</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Scanning projects, line items, and price history
        </p>
      </div>
    );
  }

  const bySeverity = new Map<DataHealthSeverity, DataHealthFinding[]>();
  for (const f of findings) {
    const list = bySeverity.get(f.severity) ?? [];
    list.push(f);
    bySeverity.set(f.severity, list);
  }

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
              <HeartPulse className="text-blue-600 dark:text-blue-400 animate-pulse" size={32} /> DATA HEALTH
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block"></span>
              Company-wide cost-history audit // read-only
            </p>
          </div>
        </div>
      </header>

      {/* Info Notice Banner — detect here, fix elsewhere */}
      <div className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50 p-4 rounded-xl flex items-start gap-3">
        <Info className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
            This page detects — fixes live where the data lives
          </h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            Every finding below is read-only and links to where it can be acted on: code hygiene (merge,
            retire, Procore backfill, promote) on the{" "}
            <Link href="/catalog" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">
              Catalog Manager
            </Link>
            , unmapped lines in each project&apos;s workspace Flags view, capture-field backfill and removal of a
            verified duplicate import on the{" "}
            <Link href="/projects" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">
              Projects directory
            </Link>
            . Statistical screens (outliers, price jumps) are flag-only: nothing is ever deleted or auto-fixed.
          </p>
        </div>
      </div>

      {/* Quarterly review cadence — standing note */}
      <div className="bg-violet-50/50 dark:bg-violet-950/10 border border-violet-200 dark:border-violet-900/50 p-4 rounded-xl flex items-start gap-3">
        <CalendarClock className="text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" size={18} />
        <div>
          <h4 className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
            Quarterly review cadence
          </h4>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
            Standing practice: this Data Health report and any rates adopted from bid history get a human pass
            each quarter. Derived statistics are re-validated on a schedule — never trusted indefinitely.
          </p>
        </div>
      </div>

      {/* Honesty banner — an audit must say when a source did not load */}
      {failedSources.length > 0 && (
        <div className="bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/50 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-amber-500 mt-0.5 flex-shrink-0" size={18} />
          <div>
            <h4 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Partial audit — {failedSources.length} source{failedSources.length === 1 ? "" : "s"} failed to load
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
              Findings that depend on {failedSources.join(", ")} are missing from this run, not resolved. Check
              the connection and reload before treating this report as complete.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
        {DATA_HEALTH_SEVERITY_ORDER.map((sev) => {
          const style = SEVERITY_STYLES[sev];
          const count = bySeverity.get(sev)?.length ?? 0;
          return (
            <div
              key={sev}
              className="bg-card border border-grid-border text-card-foreground p-5 rounded-xl shadow-sm relative overflow-hidden"
            >
              <p className="text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
                {style.icon} {style.label}
              </p>
              <h2 className={`text-2xl font-extrabold mt-2 ${count > 0 ? style.headerText : "text-foreground"}`}>
                {count}
              </h2>
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
                finding{count === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Findings grouped by severity */}
      {findings.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-24 text-center bg-card dark:bg-card/10">
          <CheckCircle2 size={48} className="text-emerald-500 mb-6" />
          <h3 className="text-lg font-bold text-foreground mb-2">No Findings</h3>
          <p className="text-slate-600 dark:text-slate-400 max-w-md text-xs leading-relaxed">
            Every audit passed on the data currently on record. The quarterly human pass still applies — clean
            today is not clean forever.
          </p>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {DATA_HEALTH_SEVERITY_ORDER.map((sev) => {
            const list = bySeverity.get(sev);
            if (!list || list.length === 0) return null;
            const style = SEVERITY_STYLES[sev];
            return (
              <div key={sev} className="bg-card border border-grid-border rounded-xl shadow-sm overflow-hidden">
                <div className={`px-4 py-3 border-b flex items-center gap-2 ${style.header}`}>
                  {style.icon}
                  <h3 className={`text-xs font-bold uppercase tracking-wider ${style.headerText}`}>
                    {style.label}
                  </h3>
                  <span className="text-[10px] text-slate-500 font-mono ml-auto">{list.length}</span>
                </div>
                <div>
                  {list.map((f, i) => (
                    <FindingCard key={`${f.type}-${i}`} finding={f} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
