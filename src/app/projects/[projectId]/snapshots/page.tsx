"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  Database, ArrowLeft, Loader2, AlertTriangle, Upload, Lock, ScrollText, Gauge,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getProject, getBudgetSnapshots } from "@/lib/db";
import type { Project, BudgetSnapshotMeta } from "@/types/db";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

function SnapshotsInner({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<BudgetSnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getProject(projectId), getBudgetSnapshots(projectId)])
      .then(([p, snaps]) => {
        if (cancelled) return;
        setProject(p);
        setSnapshots(snaps);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load snapshots.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-4xl">
        <header className="border-b border-grid-border pb-6">
          <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 mb-3 transition-colors">
            <ArrowLeft size={14} /> Back to project
          </Link>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <Database className="text-blue-600 dark:text-blue-400" size={26} /> Actuals Snapshots
            </h1>
            <div className="flex items-center gap-2">
              <Link
                href={`/projects/${projectId}/variance`}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors"
                title="Budget-vs-EAC variance & KPI dashboard"
              >
                <Gauge size={14} className="text-blue-600 dark:text-blue-400" /> Budget variance
              </Link>
              <Link
                href="/projects/import-actuals"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all"
              >
                <Upload size={14} /> Import actuals
              </Link>
            </div>
          </div>
          {project && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              Point-in-time Procore budget captures for{" "}
              <span className="font-semibold text-foreground">{project.name}</span>. Open one to
              reconcile its actuals against the estimate.
            </p>
          )}
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Loading snapshots…
          </div>
        )}

        {error && (
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-4 flex items-start gap-2.5 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <div className="bg-card border border-grid-border rounded-xl p-8 text-center">
            <Database className="mx-auto text-slate-400 mb-3" size={28} />
            <p className="text-sm font-bold text-foreground">No snapshots yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Upload this project&apos;s Procore exports to capture its first budget snapshot.
            </p>
            <Link
              href="/projects/import-actuals"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors"
            >
              <Upload size={14} /> Import actuals
            </Link>
          </div>
        )}

        {snapshots.length > 0 && (
          <div className="flex flex-col gap-2">
            {snapshots.map((s) => (
              <Link
                key={s.id}
                href={`/projects/${projectId}/snapshots/${s.id}`}
                className="bg-card border border-grid-border rounded-xl p-4 hover:border-blue-500/50 transition-colors flex items-center justify-between gap-4 group"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">Snapshot #{s.snapshotNumber}</span>
                    {s.label && <span className="text-xs text-slate-500 truncate">· {s.label}</span>}
                    {s.isFinal ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                        <Lock size={10} /> Final
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Draft</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 font-mono">
                    {fmtDate(s.createdAt)} · EAC {money(s.grandTotalActual)} · normalized {money(s.grandNormalizedActual)}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-blue-600 dark:text-blue-400 flex-shrink-0 group-hover:underline">
                  <ScrollText size={14} /> Reconcile
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}

export default function ProjectSnapshotsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <SnapshotsInner projectId={projectId} />;
}
