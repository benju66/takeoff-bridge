"use client";

import React from "react";
import {
  X, FileSpreadsheet, AlertTriangle, Info, CheckCircle,
  ArrowRight, Plus, Minus, Pencil, GitBranch,
} from "lucide-react";
import type { RoundTripDelta, RowDelta, DialDelta, FieldDelta } from "@/lib/roundTrip";
import type { RoundTripApplyPlan } from "@/lib/applyRoundTrip";
import type { RoundTripPreviewData } from "@/hooks/useRoundTripUpload";

// ---------------------------------------------------------------------------
// RoundTripUploadModal — Excel re-upload delta preview (round-trip Phase 6).
//
// Shows exactly what the uploaded workbook changes (rows AND dials), with the
// three-way staleness/conflict story (locked decision 3): a staleness banner
// when the db moved since export, per-field conflict flags, and an explicit
// acknowledgment checkbox gating conflicted fields. The planner's
// `inapplicable`/`notes` are surfaced verbatim — nothing is silently dropped.
// ---------------------------------------------------------------------------

interface RoundTripUploadModalProps {
  preview: RoundTripPreviewData;
  plan: RoundTripApplyPlan;
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const fmt = (v: number | string): string =>
  typeof v === "number"
    ? v.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : v === "" ? "—" : String(v);

function FieldRow({ label, field }: { label: string; field: FieldDelta }) {
  const isConflict = field.classification === "conflict";
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 px-3">
      {isConflict ? (
        <GitBranch size={13} className="text-amber-500 shrink-0" />
      ) : (
        <Pencil size={13} className="text-blue-500 shrink-0" />
      )}
      <span className="font-bold text-foreground min-w-0 flex-1 truncate">{label}</span>
      <span className="text-slate-500 dark:text-slate-400 tabular-nums">{fmt(field.baseline)}</span>
      <ArrowRight size={12} className="text-slate-400 shrink-0" />
      <span className="font-bold text-foreground tabular-nums">{fmt(field.excel)}</span>
      {isConflict && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5 shrink-0">
          app now {fmt(field.current)}
        </span>
      )}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  qty: "Quantity",
  unitPrice: "Unit price",
  description: "Description",
  E: "Utilization",
  F: "Quantity / amount",
  H: "Rate / amount",
};

function RowDeltaCard({ delta }: { delta: RowDelta }) {
  if (delta.kind === "added") {
    return (
      <div className="border border-grid-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50/60 dark:bg-emerald-950/20 text-xs">
          <Plus size={13} className="text-emerald-600 shrink-0" />
          <span className="font-bold">{delta.itemId}</span>
          <span className="truncate flex-1">{delta.description}</span>
          <span className="tabular-nums font-bold">
            {fmt(delta.excelRow?.qty ?? 0)} × ${fmt(delta.excelRow?.unitPrice ?? 0)}
          </span>
          {delta.conflict && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              deleted in app
            </span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            needs code mapping
          </span>
        </div>
      </div>
    );
  }
  if (delta.kind === "removed") {
    return (
      <div className="border border-grid-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-rose-50/60 dark:bg-rose-950/20 text-xs">
          <Minus size={13} className="text-rose-600 shrink-0" />
          <span className="font-bold">{delta.itemId}</span>
          <span className="truncate flex-1">{delta.description}</span>
          <span className="text-slate-500">deleted in Excel</span>
          {delta.conflict && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              edited in app since export
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="border border-grid-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background/60 text-xs border-b border-grid-border">
        <span className="font-bold">{delta.itemId}</span>
        <span className="truncate text-slate-500">{delta.description}</span>
      </div>
      {(delta.fields ?? []).map((f) => (
        <FieldRow key={f.field} label={FIELD_LABEL[f.field] ?? f.field} field={f} />
      ))}
    </div>
  );
}

function dialGroupLabel(scope: DialDelta["scope"]): string {
  switch (scope) {
    case "step23": return "Step 2/3 dials";
    case "step1": return "Project parameters";
    case "modifier": return "Estimate modifiers";
  }
}

export function RoundTripUploadModal({
  preview, plan, acknowledged, setAcknowledged, busy, onConfirm, onCancel,
}: RoundTripUploadModalProps) {
  const { delta }: { delta: RoundTripDelta } = preview;
  const conflictCount =
    delta.rowDeltas.filter((r) => r.conflict || r.fields?.some((f) => f.classification === "conflict")).length +
    delta.dialDeltas.filter((d) => d.classification === "conflict").length;

  const dialGroups = (["step23", "step1", "modifier"] as const)
    .map((scope) => ({ scope, deltas: delta.dialDeltas.filter((d) => d.scope === scope) }))
    .filter((g) => g.deltas.length > 0);

  const infoItems = [...preview.issues, ...plan.notes];
  const exportedAt = new Date(preview.stamp.exportedAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative bg-card border border-grid-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-grid-border">
          <FileSpreadsheet size={20} className="text-emerald-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-foreground truncate">{preview.fileName}</h2>
            <p className="text-xs text-slate-500">
              Exported {exportedAt.toLocaleString()} from “{preview.stamp.projectName}”
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-foreground transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Staleness banner (locked decision 3 — warn + flag, never block) */}
          {delta.isStale && (
            <div className="flex items-start gap-2 text-xs bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                The estimate changed in the app after this file was exported.
                {conflictCount > 0
                  ? ` ${conflictCount} item${conflictCount === 1 ? "" : "s"} changed in BOTH places — each shows the app's current value; acknowledging below applies the Excel value over it.`
                  : " Fields the file doesn't touch keep their current app values."}
              </span>
            </div>
          )}

          {/* Row deltas */}
          {delta.rowDeltas.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Estimate lines ({delta.rowDeltas.length})
              </h3>
              {delta.rowDeltas.map((r) => <RowDeltaCard key={r.key} delta={r} />)}
            </section>
          )}

          {/* Dial deltas */}
          {dialGroups.map((g) => (
            <section key={g.scope} className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {dialGroupLabel(g.scope)} ({g.deltas.length})
              </h3>
              <div className="border border-grid-border rounded-lg divide-y divide-grid-border">
                {g.deltas.map((d) => (
                  <FieldRow key={`${d.scope}-${d.code ?? d.field}-${d.field}`} label={`${d.label} (${FIELD_LABEL[d.field] ?? d.field})`} field={d} />
                ))}
              </div>
            </section>
          ))}

          {plan.isEmpty && delta.rowDeltas.length === 0 && delta.dialDeltas.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-6 justify-center">
              <CheckCircle size={14} className="text-emerald-600" />
              The uploaded file matches the current estimate — nothing to apply.
            </div>
          )}

          {/* Not-applied / informational (planner notes, extraction issues,
              cells with no app input — surfaced, never silently dropped) */}
          {(infoItems.length > 0 || plan.inapplicable.length > 0) && (
            <section className="space-y-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Not applied / informational
              </h3>
              {plan.inapplicable.map((d, i) => (
                <div key={`inap-${i}`} className="flex items-start gap-2 text-xs text-slate-500 px-1">
                  <Info size={13} className="shrink-0 mt-0.5" />
                  <span>
                    {d.label}: {FIELD_LABEL[d.field] ?? d.field} {fmt(d.baseline)} → {fmt(d.excel)} has no app-side
                    input — set it in the app if intended.
                  </span>
                </div>
              ))}
              {infoItems.map((note, i) => (
                <div key={`note-${i}`} className="flex items-start gap-2 text-xs text-slate-500 px-1">
                  <Info size={13} className="shrink-0 mt-0.5" />
                  <span>{note}</span>
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-grid-border px-5 py-4 space-y-3">
          {conflictCount > 0 && (
            <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-grid-border text-amber-600 focus:ring-amber-500 cursor-pointer"
              />
              <span>
                Apply the <strong>Excel values</strong> over the {conflictCount} conflicted
                item{conflictCount === 1 ? "" : "s"} (the app&apos;s newer values shown above will be replaced).
                Unacknowledged conflicts keep the app&apos;s values.
              </span>
            </label>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 text-xs font-bold text-foreground border border-grid-border rounded-lg hover:bg-background/80 transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || plan.isEmpty}
              title={plan.isEmpty ? "Nothing applicable to apply" : undefined}
              className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy ? "Applying…" : "Apply changes (one undo)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
