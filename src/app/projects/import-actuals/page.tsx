"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Upload, Database, CheckCircle2, AlertTriangle, ArrowLeft, Loader2, Building2,
  FileText, Layers, X, Sparkles, Info, ScrollText,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
  CsvActualsSource, computeNormalizedActuals,
  classifyActualsCsv, extractEmbeddedProjectToken, suggestProjectMatch,
  type ActualsExportKind, type EmbeddedProjectToken, type ProjectMatchCandidate,
  type NormalizedActuals,
} from "@/lib/actuals";
import { getProjects, saveBudgetSnapshot } from "@/lib/db";
import type { Project, BudgetSnapshotMeta } from "@/types/db";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One filled file slot, keyed by the export kind it was classified as. */
interface FileSlot {
  fileName: string;
  csv: string;
}

/** Human labels + required/role for each of the six export shapes. */
const EXPORT_META: Record<
  ActualsExportKind,
  { label: string; role: "core" | "supplementary"; note: string }
> = {
  budget: { label: "Budget Detail", role: "core", note: "Required — the per-code EAC totals" },
  changeEventSummary: { label: "Change Events — Summary", role: "core", note: "Scope / Type / Reason classification" },
  changeEventDetail: { label: "Change Events — Detail", role: "core", note: "Per-code change dollars" },
  subcontractorCommitments: { label: "Subcontractor Commitments", role: "supplementary", note: "Carries the project number for auto-suggest" },
  potentialChangeOrders: { label: "Potential Change Orders", role: "supplementary", note: "Supplementary metadata" },
  primeContractChangeOrders: { label: "Prime Contract Change Orders", role: "supplementary", note: "Supplementary metadata" },
};

/** Display order: the three normalization-core exports first. */
const EXPORT_ORDER: ActualsExportKind[] = [
  "budget", "changeEventSummary", "changeEventDetail",
  "subcontractorCommitments", "potentialChangeOrders", "primeContractChangeOrders",
];

/** Everything derived from the dropped files in one parse (only what the UI reads). */
interface Parsed {
  normalized: NormalizedActuals;
  token: EmbeddedProjectToken | null;
  /** Which file landed in which slot (recorded on the snapshot metadata). */
  fileNames: Partial<Record<ActualsExportKind, string>>;
}

export default function ImportActualsPage() {
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Per-export-kind file slots; a new file of a known kind replaces its slot. */
  const [slots, setSlots] = useState<Partial<Record<ActualsExportKind, FileSlot>>>({});
  /** Dropped files whose header matched no known export (surfaced, never silently ignored). */
  const [unrecognized, setUnrecognized] = useState<string[]>([]);
  const [parsed, setParsed] = useState<Parsed | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  /** True once the user picks a project by hand — stops the auto-suggest from overriding. */
  const [userPickedProject, setUserPickedProject] = useState(false);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<BudgetSnapshotMeta | null>(null);

  // Existing projects for the picker + auto-suggest. Fail-soft: an outage leaves
  // an empty picker (the page shows a "create a project first" hint).
  useEffect(() => {
    let cancelled = false;
    getProjects()
      .then((rows) => { if (!cancelled) setProjects(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Auto-suggest the target project from the embedded token, until the user picks.
  const suggestion: ProjectMatchCandidate | null = useMemo(
    () => (parsed?.token ? suggestProjectMatch(parsed.token, projects) : null),
    [parsed, projects],
  );
  useEffect(() => {
    if (suggestion && !userPickedProject) setSelectedProjectId(suggestion.projectId);
  }, [suggestion, userPickedProject]);

  /** Re-parse the current slot set (budget is the minimum the engine needs). */
  const reparse = async (next: Partial<Record<ActualsExportKind, FileSlot>>) => {
    if (!next.budget) { setParsed(null); return; }
    const source = new CsvActualsSource({
      budgetCsv: next.budget.csv,
      changeEventSummaryCsv: next.changeEventSummary?.csv ?? "",
      changeEventDetailCsv: next.changeEventDetail?.csv ?? "",
      potentialChangeOrdersCsv: next.potentialChangeOrders?.csv,
      primeContractChangeOrdersCsv: next.primeContractChangeOrders?.csv,
      subcontractorCommitmentsCsv: next.subcontractorCommitments?.csv,
    });
    const raw = await source.loadRawExport();
    const fileNames: Partial<Record<ActualsExportKind, string>> = {};
    for (const k of EXPORT_ORDER) if (next[k]) fileNames[k] = next[k]!.fileName;
    setParsed({
      normalized: computeNormalizedActuals(raw),
      token: extractEmbeddedProjectToken(raw),
      fileNames,
    });
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setSaved(null);
    setParsing(true);
    try {
      const next = { ...slots };
      const nextUnrecognized = [...unrecognized];
      for (const f of files) {
        const text = await f.text();
        const kind = classifyActualsCsv(text);
        if (kind) next[kind] = { fileName: f.name, csv: text };
        else if (!nextUnrecognized.includes(f.name)) nextUnrecognized.push(f.name);
      }
      setSlots(next);
      setUnrecognized(nextUnrecognized);
      await reparse(next);
    } catch (err) {
      console.error("Actuals parse failed:", err);
      setError(
        err instanceof Error
          ? `Could not read these exports: ${err.message}`
          : "Could not read these exports.",
      );
    } finally {
      setParsing(false);
      e.target.value = ""; // allow re-selecting the same file
    }
  };

  /** Remove one slot (and re-parse) — e.g. the wrong file was routed there. */
  const clearSlot = async (kind: ActualsExportKind) => {
    setError(null);
    setSaved(null);
    const next = { ...slots };
    delete next[kind];
    setSlots(next);
    await reparse(next);
  };

  const resetAll = () => {
    setSlots({});
    setUnrecognized([]);
    setParsed(null);
    setSelectedProjectId("");
    setUserPickedProject(false);
    setLabel("");
    setError(null);
    setSaved(null);
  };

  const handleSave = async () => {
    if (!parsed || !selectedProjectId) return;
    setSaving(true);
    setError(null);
    try {
      const meta = await saveBudgetSnapshot({
        projectId: selectedProjectId,
        normalized: parsed.normalized,
        label: label.trim() || undefined,
        sourceKind: "csv",
        metadata: {
          files: parsed.fileNames,
          embeddedProjectNumber: parsed.token?.projectNumber ?? "",
          embeddedProjectName: parsed.token?.projectName ?? "",
          uploadedAt: new Date().toISOString(),
        },
      });
      setSaved(meta);
    } catch (err) {
      console.error("Snapshot save failed:", err);
      setError(err instanceof Error ? `Failed to save the snapshot: ${err.message}` : "Failed to save.");
      setSaving(false);
    }
  };

  const n = parsed?.normalized;
  const diag = n?.diagnostics;
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // ----- success state -----------------------------------------------------
  if (saved) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col gap-6 max-w-3xl">
          <div className="rounded-xl p-6 border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900/50">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={22} />
              <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                Snapshot #{saved.snapshotNumber} saved
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              An un-promoted budget snapshot was stored for{" "}
              <span className="font-semibold text-foreground">{selectedProject?.name ?? "the project"}</span>.
              Reconciliation and promotion to FINAL come later — this is purely the captured point-in-time data.
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mt-4 text-xs font-mono">
              <Row label="Total actual (EAC)" value={money(saved.grandTotalActual)} bold />
              <Row label="Normalized actual" value={money(saved.grandNormalizedActual)} bold />
              <Row label="Direct cost" value={money(saved.directTotalActual)} />
              <Row label="Burden (Fee + GL)" value={money(saved.burdenTotalActual)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${saved.projectId}`}
              className="px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors"
            >
              Go to project
            </Link>
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all"
            >
              <Upload size={14} /> Upload another snapshot
            </button>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-5xl">
        <header className="border-b border-grid-border pb-6">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 mb-3 transition-colors">
            <ArrowLeft size={14} /> Back to projects
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
            <Database className="text-blue-600 dark:text-blue-400" size={26} /> Import Project Actuals
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            Drop a project&apos;s Procore CSV exports — the Budget Detail plus the change-event summary/detail
            (the supplementary files are optional). They&apos;re parsed into a point-in-time budget snapshot:
            per-code actuals with both the raw EAC and the normalized number, and a full diagnostics readout so
            nothing is silently dropped. Pick the project, then save. No reconciliation or promotion yet.
          </p>
        </header>

        {/* Upload */}
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-10 text-center bg-card dark:bg-card/10 cursor-pointer hover:border-blue-500/50 transition-colors">
          {parsing ? (
            <Loader2 className="animate-spin text-blue-600 dark:text-blue-400 mb-3" size={32} />
          ) : (
            <Upload className="text-slate-500 mb-3" size={32} />
          )}
          <span className="text-sm font-bold text-foreground">
            {parsing ? "Reading exports…" : "Choose the Procore CSV exports"}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Select one or more .csv files — each is routed to its export type automatically.
          </span>
          <input
            type="file" accept=".csv" multiple className="hidden"
            onChange={handleFiles} disabled={parsing || saving}
          />
        </label>

        {error && (
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-4 flex items-start gap-2.5 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {/* File routing — which file landed in which export slot (visible, never silent) */}
        {(Object.keys(slots).length > 0 || unrecognized.length > 0) && (
          <div className="bg-card border border-grid-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <FileText size={13} className="text-blue-500" /> Uploaded files
              </h3>
              <button
                onClick={resetAll}
                disabled={parsing || saving}
                className="text-[11px] font-bold uppercase text-slate-500 hover:text-foreground disabled:opacity-40 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {EXPORT_ORDER.map((kind) => {
                const slot = slots[kind];
                const meta = EXPORT_META[kind];
                return (
                  <div key={kind} className="flex items-center justify-between gap-3 text-xs py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {slot ? (
                        <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                      ) : (
                        <span className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 ${meta.role === "core" ? "border-amber-400" : "border-grid-border"}`} />
                      )}
                      <span className="font-semibold text-foreground whitespace-nowrap">{meta.label}</span>
                      {meta.role === "core" && !slot && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-bold">needed</span>
                      )}
                      <span className="text-slate-500 truncate hidden sm:inline">— {meta.note}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {slot ? (
                        <>
                          <span className="font-mono text-slate-500 truncate max-w-48" title={slot.fileName}>{slot.fileName}</span>
                          <button
                            onClick={() => clearSlot(kind)}
                            disabled={parsing || saving}
                            className="text-slate-400 hover:text-rose-500 disabled:opacity-40 transition-colors"
                            title={`Remove ${meta.label}`}
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <span className="text-slate-400 italic">not provided</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {unrecognized.length > 0 && (
              <div className="mt-3 pt-3 border-t border-grid-border flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-bold">Not recognized as a Procore export</span> (ignored):{" "}
                  <span className="font-mono">{unrecognized.join(", ")}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {parsed && n && diag && (
          <>
            {/* Parsed totals */}
            <div className="bg-card border border-grid-border rounded-xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-2">
                <Layers size={13} className="text-indigo-500" /> Parsed snapshot
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <Field label="Total actual (EAC)" value={money(n.grandTotalActual)} />
                <Field label="Normalized actual" value={money(n.grandNormalizedActual)} />
                <Field label="Direct cost" value={money(n.directTotalActual)} />
                <Field label="Burden (Fee + GL)" value={money(n.burdenTotalActual)} />
                <Field label="Cost codes" value={`${n.codeActuals.length}`} />
                <Field label="Change events" value={`${n.events.length}`} />
                <Field
                  label="Unclassified events"
                  value={`${diag.unclassifiedEvents.length}`}
                  icon={diag.unclassifiedEvents.length > 0 ? <AlertTriangle size={11} className="text-amber-500" /> : undefined}
                />
                <Field
                  label="Duplicate groups"
                  value={`${diag.duplicateEventGroups.length}`}
                  icon={diag.duplicateEventGroups.length > 0 ? <Info size={11} className="text-blue-500" /> : undefined}
                />
              </div>
            </div>

            {/* Diagnostics — nothing silently dropped */}
            <DiagnosticsPanel diag={diag} />

            {/* Code actuals preview */}
            <div className="bg-card border border-grid-border rounded-xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3 flex items-center gap-2">
                <ScrollText size={13} className="text-violet-500" /> Per-code actuals
                <span className="font-normal normal-case text-slate-500">{n.codeActuals.length} codes</span>
              </h3>
              <div className="max-h-96 overflow-y-auto border border-grid-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2 font-bold">Budget code</th>
                      <th className="px-3 py-2 font-bold">Description</th>
                      <th className="px-3 py-2 font-bold text-right">Original budget</th>
                      <th className="px-3 py-2 font-bold text-right">Total (EAC)</th>
                      <th className="px-3 py-2 font-bold text-right">Normalized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.codeActuals.map((c) => (
                      <tr key={c.budgetCode} className="border-t border-grid-border">
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap text-foreground">
                          {c.budgetCode}
                          {c.isBurden && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-bold">burden</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={c.description}>{c.description}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500">{money(c.originalBudget)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">{money(c.totalActual)}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${c.normalizedActual !== c.totalActual ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-foreground"}`}>
                          {money(c.normalizedActual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Project match + save */}
            <div className="bg-card border border-grid-border rounded-xl p-5 flex flex-col gap-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <Building2 size={13} className="text-emerald-500" /> Target project
              </h3>
              {parsed.token && (parsed.token.projectNumber || parsed.token.projectName) && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Sparkles size={12} className="text-amber-500" />
                  Embedded in the export:{" "}
                  <span className="font-mono text-foreground">{parsed.token.projectNumber || "—"}</span>
                  {parsed.token.projectName && <span className="text-foreground">· {parsed.token.projectName}</span>}
                  {suggestion
                    ? <span className="text-emerald-600 dark:text-emerald-400">→ auto-matched ({suggestion.matchedOn === "number" ? "project number" : "name"})</span>
                    : <span className="text-slate-400">— no existing project matched; pick one below</span>}
                </p>
              )}
              {projects.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  No projects yet — <Link href="/projects" className="underline hover:no-underline">create a project</Link> to attach this snapshot to.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Project</div>
                    <select
                      className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      value={selectedProjectId}
                      onChange={(e) => { setSelectedProjectId(e.target.value); setUserPickedProject(true); }}
                    >
                      <option value="">Select a project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Label (optional)</div>
                    <input
                      type="text"
                      placeholder="e.g. March 2026 EAC"
                      className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-1">
                <Link href="/projects" className="px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors">
                  Cancel
                </Link>
                <button
                  onClick={handleSave}
                  disabled={!selectedProjectId || saving}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  title={selectedProjectId ? "Save as an un-promoted snapshot" : "Pick a project first"}
                >
                  {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                  {saving ? "Saving…" : "Save snapshot"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics panel — the engine's "nothing silently dropped" readout
// ---------------------------------------------------------------------------

function DiagnosticsPanel({ diag }: { diag: NormalizedActuals["diagnostics"] }) {
  const clean =
    diag.unjoinedDetailEventIds.length === 0 &&
    diag.summaryOnlyEventIds.length === 0 &&
    diag.duplicateEventGroups.length === 0 &&
    diag.unattributedDetailLineCount === 0 &&
    diag.internalNonZeroEventIds.length === 0 &&
    diag.unclassifiedEvents.length === 0;

  return (
    <div className="bg-card border border-grid-border rounded-xl p-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3 flex items-center gap-2">
        <Info size={13} className="text-blue-500" /> Diagnostics
        <span className="font-normal normal-case text-slate-500">nothing is silently dropped</span>
      </h3>
      {clean ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={14} /> Clean — every change event joined and classified, no duplicates or unattributed lines.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <DiagLine
            warn label="Unclassified events"
            ids={diag.unclassifiedEvents.map((e) => e.eventId)}
            note="blank/TBD scope — kept, flagged for human resolution (Phase 5)"
          />
          <DiagLine
            warn label="Detail events with no summary"
            ids={diag.unjoinedDetailEventIds}
            note="classification unknown until the summary export is matched"
          />
          <DiagLine
            label="Summary events with no detail"
            ids={diag.summaryOnlyEventIds}
            note="no per-code dollars to attribute"
          />
          <DiagLine
            label="Duplicate event groups"
            ids={diag.duplicateEventGroups.map((g) => `${g.keptEventId}←${g.suppressedEventIds.join(",")}`)}
            note="one kept, the rest suppressed by cost-side fingerprint"
          />
          <DiagLine
            warn label="Internal reclasses that are NOT net-zero"
            ids={diag.internalNonZeroEventIds}
            note="kept (not cancelled) and flagged — an internal shuffle should sum to zero"
          />
          {diag.unattributedDetailLineCount > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-slate-500">Detail lines with a blank cost code:</span>
              <span className="font-mono text-foreground">{diag.unattributedDetailLineCount}</span>
              <span className="text-slate-400">— cannot be attributed to a code</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiagLine({ label, ids, note, warn }: { label: string; ids: string[]; note: string; warn?: boolean }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      {warn
        ? <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
        : <Info size={13} className="text-blue-500 mt-0.5 flex-shrink-0" />}
      <div>
        <span className="font-semibold text-foreground">{label}</span>{" "}
        <span className="text-slate-500">({ids.length})</span>{" "}
        <span className="text-slate-400">— {note}</span>
        <div className="font-mono text-[10px] text-slate-500 mt-0.5 break-all">{ids.join(", ")}</div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`${bold ? "font-bold" : ""} text-foreground`}>{value}</span>
    </div>
  );
}

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1">{label}</div>
      <div className="text-foreground font-semibold flex items-center gap-1.5">{icon}{value}</div>
    </div>
  );
}
