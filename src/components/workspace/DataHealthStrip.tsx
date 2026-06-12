"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { useDataHealth } from "@/hooks/useDataHealth";
import {
  findingsForProject,
  DATA_HEALTH_SEVERITY_ORDER,
  FINDING_TYPE_LABELS,
  type DataHealthSeverity,
} from "@/lib/dataHealth";

/**
 * DataHealthStrip — the project workspace's compact Data Health surface
 * (fidelity Phase 4): the SAME audit engine as /data-health, filtered to one
 * project (the locked one-engine-two-surfaces decision). Read-only, advisory,
 * fail-soft: while loading, on outage, or with nothing to report it renders
 * nothing — the workspace never waits on or breaks over an audit.
 */
const SEVERITY_CHIPS: Record<DataHealthSeverity, { label: string; classes: string }> = {
  high: {
    label: "needs attention",
    classes:
      "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50",
  },
  medium: {
    label: "to review",
    classes:
      "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50",
  },
  low: {
    label: "housekeeping",
    classes:
      "bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800",
  },
};

export function DataHealthStrip({ projectId }: { projectId: string }) {
  const { findings, isLoading } = useDataHealth();
  const mine = useMemo(() => findingsForProject(findings, projectId), [findings, projectId]);

  if (isLoading || mine.length === 0) return null;

  const counts = new Map<DataHealthSeverity, number>();
  for (const f of mine) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const summary = mine
    .map((f) => `${FINDING_TYPE_LABELS[f.type]}: ${f.title}`)
    .join("\n");

  return (
    <div
      className="bg-card border border-grid-border rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs shadow-sm"
      title={summary}
    >
      <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
        <HeartPulse size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
        Data Health
      </span>
      {DATA_HEALTH_SEVERITY_ORDER.map((sev) => {
        const count = counts.get(sev);
        if (!count) return null;
        const chip = SEVERITY_CHIPS[sev];
        return (
          <span
            key={sev}
            className={`inline-block text-[10px] px-2 py-0.5 border rounded-md font-bold tracking-wider ${chip.classes}`}
          >
            {count} {chip.label}
          </span>
        );
      })}
      <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate min-w-0 flex-1">
        {mine[0].title}
        {mine.length > 1 && ` (+${mine.length - 1} more)`}
      </span>
      <Link
        href="/data-health"
        className="ml-auto text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:underline shrink-0"
      >
        Full report →
      </Link>
    </div>
  );
}
