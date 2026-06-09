"use client";

import React, { useEffect, useState } from "react";
import { Search, Maximize2, Minimize2, X, ChevronRight, ChevronDown, Pencil, Settings, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { Project } from "@/types/db";
import type { LinkedDivisionTotal, TakeoffSummary } from "@/lib/calculations";
import { buildTraceModel, TrustTab, TraceModifierNode, TraceModel, ReconciliationModel } from "@/lib/trustInspector";

// ---------------------------------------------------------------------------
// Trust Inspector — the glass-box surface (Phase 5).
//
// One shared content tree (Trace · Reconcile · Flags) rendered in TWO layout
// shells: a docked right slide-over (keeps the clicked number visible for a
// quick trace) and an expand-⤢ full-screen modal for deep review. Escape /
// restore drops the full-screen modal back to the slide-over.
//
// This is a PURE VIEW over data the engine already returns (`buildTraceModel`
// rearranges `computeTakeoffSummary` outputs; no dollar is computed here).
// Reconcile (slice 3) and Flags (slice 5) are scaffolded placeholders.
// The override setter is slice 4 — there is no write path here.
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface TrustInspectorProps {
  open: boolean;
  onClose: () => void;
  /** Summary field the inspector opened focused on (e.g. "fee", "subtotal"). */
  focusField: string;
  /** Tab to open on (the status-bar chip opens on "reconcile"). Defaults to "trace". */
  initialTab?: TrustTab;
  summary: TakeoffSummary;
  linkedTotals: LinkedDivisionTotal[];
  project: Project;
  /** Count of contributing (non-linked) takeoff rows, for the "· N rows" label. */
  takeoffRowCount: number;
  /** Live Procore reconciliation (5b) — built from the FULL unfiltered rows (Amendment F). */
  reconciliation?: ReconciliationModel;
  /** [view rows] — reveal/scroll the grid to the contributing takeoff rows. */
  onViewTakeoffRows: () => void;
}

export function TrustInspector({
  open,
  onClose,
  focusField,
  initialTab = "trace",
  summary,
  linkedTotals,
  project,
  takeoffRowCount,
  reconciliation,
  onViewTakeoffRows,
}: TrustInspectorProps) {
  // Each (re)open remounts this component (parent bumps a `key` per open), so the
  // tab starts on the requested tab and the layout starts as the slide-over — a 🔍
  // affordance / chip reliably lands on its tab without a setState-in-effect.
  const [tab, setTab] = useState<TrustTab>(initialTab);
  const [expanded, setExpanded] = useState(false);

  // Escape: collapse the full-screen modal back to the slide-over first, else close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setExpanded(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, expanded, onClose]);

  if (!open) return null;

  const traceModel = buildTraceModel({
    summary,
    linkedTotals,
    project,
    takeoffRowCount,
    focusField,
  });

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-grid-border bg-background/80 dark:bg-background/50">
      <div className="flex items-center gap-2">
        <Search size={15} className="text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-bold uppercase tracking-widest text-foreground">Trust Inspector</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Restore to side panel" : "Expand to full screen"}
          aria-label={expanded ? "Restore to side panel" : "Expand to full screen"}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-background dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close Trust Inspector"
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-background dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );

  const tabs = (
    <div className="flex items-stretch border-b border-grid-border bg-card text-[11px] font-bold uppercase tracking-wider">
      {(["trace", "reconcile", "flags"] as TrustTab[]).map((t) => {
        const active = tab === t;
        const label = t === "trace" ? "Trace" : t === "reconcile" ? "Reconcile" : "Flags";
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={active}
            className={`px-4 py-2.5 transition-colors cursor-pointer border-b-2 ${
              active
                ? "border-blue-600 dark:border-blue-400 text-blue-700 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/15"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const body = (
    <div className="flex-1 overflow-y-auto grid-scroll">
      {tab === "trace" && (
        <TraceTab model={traceModel} onViewTakeoffRows={onViewTakeoffRows} />
      )}
      {tab === "reconcile" && (
        reconciliation ? (
          <ReconcileTab model={reconciliation} />
        ) : (
          <Placeholder
            title="Procore reconciliation"
            note="Reconciliation data is unavailable for this view."
          />
        )
      )}
      {tab === "flags" && (
        <Placeholder
          title="Provenance & override flags"
          note="Row provenance, the needs-review worklist, and the override audit log land in slice 5."
        />
      )}
    </div>
  );

  const content = (
    <div className="flex flex-col h-full min-h-0 bg-card text-card-foreground">
      {header}
      {tabs}
      {body}
    </div>
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
        <div className="w-full max-w-4xl h-[88vh] max-h-[88vh] rounded-xl border border-grid-border shadow-2xl overflow-hidden">
          {content}
        </div>
      </div>
    );
  }

  // Docked slide-over — no dimming backdrop, so the clicked number stays visible.
  return (
    <div className="fixed top-0 right-0 z-40 h-full w-full sm:w-[460px] border-l border-grid-border shadow-2xl animate-fade-in">
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trace tab (5a) — decomposition tree
// ---------------------------------------------------------------------------

function TraceTab({ model, onViewTakeoffRows }: { model: TraceModel; onViewTakeoffRows: () => void }) {
  const [linkedOpen, setLinkedOpen] = useState(false);

  return (
    <div className="p-4 font-sans text-xs text-foreground space-y-4">
      {/* Grand total headline */}
      <Row
        label="Total Estimated Cost"
        value={model.total.value}
        emphasis="total"
        focused={model.focusField === "totalEstimatedCost"}
        overridden={model.total.overridden}
      />

      <div className="border-l border-grid-border pl-3 space-y-2">
        {/* Subtotal */}
        <Row
          label="Subtotal (incl. GC + Site Ops)"
          value={model.subtotal.value}
          emphasis="subtotal"
          focused={model.focusField === "subtotal"}
          overridden={model.subtotal.overridden}
        />

        {/* Subtotal decomposition */}
        <div className="border-l border-grid-border pl-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 dark:text-slate-400">
              Takeoff &nbsp;Σ(qty × price) · {model.subtotal.takeoff.rowCount} row
              {model.subtotal.takeoff.rowCount === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-foreground">{fmtUSD(model.subtotal.takeoff.value)}</span>
              <button
                type="button"
                onClick={onViewTakeoffRows}
                className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                view rows
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setLinkedOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 cursor-pointer hover:text-foreground transition-colors"
              aria-expanded={linkedOpen}
            >
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                {linkedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Linked divisions (GC + Site Ops) · {model.subtotal.linked.rows.length} rows
              </span>
              <span className="font-mono text-foreground shrink-0">{fmtUSD(model.subtotal.linked.value)}</span>
            </button>
            {linkedOpen && (
              <div className="mt-1.5 border-l border-grid-border pl-3 space-y-1">
                {model.subtotal.linked.rows.length === 0 ? (
                  <div className="text-slate-500 dark:text-slate-500 italic">No linked division values.</div>
                ) : (
                  model.subtotal.linked.rows.map((r) => (
                    <div key={r.itemId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-blue-600 dark:text-blue-400">{r.itemId}</span>{" "}
                        <span className="text-slate-600 dark:text-slate-400">{r.description}</span>
                        <span className="text-slate-400 dark:text-slate-500"> · {r.sourceLabel}</span>
                      </span>
                      <span className="font-mono text-foreground shrink-0">{fmtUSD(r.total)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modifiers */}
        {model.modifiers.map((mod) => (
          <ModifierRow key={mod.key} mod={mod} focused={model.focusField === mod.key} />
        ))}
      </div>

      {/* Rounding mode (B-3 visibility) */}
      <div className="flex items-start gap-2 pt-2 border-t border-grid-border text-[11px] text-slate-600 dark:text-slate-400">
        <span className="font-bold uppercase tracking-wider shrink-0">Rounding</span>
        <span>
          <span className="font-mono text-foreground">{model.roundingMode}</span> — {model.roundingLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconcile tab (5b) — live Procore tie-out + grand-total tie (INV-1)
// ---------------------------------------------------------------------------

function ReconcileTab({ model }: { model: ReconciliationModel }) {
  const { scope, grandTotal, status } = model;
  return (
    <div className="p-4 font-sans text-xs text-foreground space-y-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Procore Export Reconciliation
      </div>

      {/* Layer 1 — scope tie: line items + GC/Site Ops ↔ the 217-code rollup */}
      <div className="space-y-1.5">
        <ReconLine label="Scope subtotal (line items + GC + Site Ops)" value={scope.lineItemTotal} />
        <ReconLine label="rolls up to 217 budget codes" value={scope.rollupTotal} muted ok={scope.ok} />
        <ReconLine label="+ 7 modifiers (60-xxxx codes)" value={model.modifierRollupTotal} muted />
      </div>

      {/* Layer 2 — grand-total tie: Total Estimated Cost ↔ full Procore budget */}
      <div className="border-t border-grid-border pt-2 space-y-1.5">
        <ReconLine
          label="= TOTAL ESTIMATED COST"
          value={grandTotal.totalEstimatedCost}
          emphasis
          flag={model.hasDirectOverride ? "overridden" : undefined}
        />
        <ReconLine label="full Procore budget total" value={grandTotal.fullProcoreBudgetTotal} muted />
        <DifferenceLine model={model} />
      </div>

      {/* Rounding mode (B-3 visibility) */}
      <div className="flex items-start gap-2 pt-2 border-t border-grid-border text-[11px] text-slate-600 dark:text-slate-400">
        <span className="font-bold uppercase tracking-wider shrink-0">Rounding</span>
        <span>
          <span className="font-mono text-foreground">{model.roundingMode}</span> — {model.roundingLabel}
          {model.roundingMode !== "none" && (
            <span className="block text-slate-500 dark:text-slate-500 mt-0.5">
              Per-line rounding can shift the total vs. the raw Procore lines by up to half a unit.
              Switch this project to <span className="font-mono">none</span> to tie the source spreadsheet to the cent.
            </span>
          )}
        </span>
      </div>

      {/* Unmapped blockers */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-grid-border">
        <span className="font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
          Unmapped rows carrying dollars
        </span>
        <span
          className={`flex items-center gap-1 font-mono shrink-0 ${
            model.blockerCount > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {model.blockerCount}
          {model.blockerCount > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
        </span>
      </div>
      {status === "blocked" && model.blockerCount > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
          These rows carry dollars that reach no Procore Budget Line Items code. Assign a code (the
          override interface) before exporting — every scope dollar must land on a code.
        </p>
      )}
    </div>
  );
}

/** The headline Difference row: ✅ ties / ⚠ blocked / ⓘ deliberate override. */
function DifferenceLine({ model }: { model: ReconciliationModel }) {
  const delta = model.status === "ties" ? 0 : Math.abs(model.grandTotal.delta);
  if (model.status === "ties") {
    return (
      <div className="flex items-center justify-between gap-3 font-bold">
        <span className="uppercase tracking-wider text-slate-600 dark:text-slate-400">Difference</span>
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono">
          {fmtUSD(0)} <CheckCircle2 size={14} /> <span className="not-italic">TIES</span>
        </span>
      </div>
    );
  }
  if (model.status === "override") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 font-bold">
          <span className="uppercase tracking-wider text-slate-600 dark:text-slate-400">Difference</span>
          <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-mono">
            {fmtUSD(delta)} <Info size={14} />
          </span>
        </div>
        <p className="text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed">
          A direct total/subtotal override is active. The Procore budget carries line items only, so
          its total reflects the computed scope; the workbook export carries your override.
        </p>
      </div>
    );
  }
  // blocked
  return (
    <div className="flex items-center justify-between gap-3 font-bold">
      <span className="uppercase tracking-wider text-slate-600 dark:text-slate-400">Difference</span>
      <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-mono">
        {fmtUSD(delta)} <AlertTriangle size={14} />
      </span>
    </div>
  );
}

function ReconLine({
  label,
  value,
  muted,
  emphasis,
  ok,
  flag,
}: {
  label: string;
  value: number;
  muted?: boolean;
  emphasis?: boolean;
  ok?: boolean;
  flag?: "overridden";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={`min-w-0 truncate flex items-center gap-1.5 ${
          emphasis
            ? "font-bold uppercase tracking-wider text-foreground"
            : muted
              ? "text-slate-500 dark:text-slate-400"
              : "text-slate-600 dark:text-slate-300"
        }`}
      >
        {label}
        {flag === "overridden" && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            overridden
          </span>
        )}
      </span>
      <span
        className={`font-mono shrink-0 flex items-center gap-1 ${
          emphasis ? "text-emerald-600 dark:text-emerald-400 font-black text-sm" : "text-foreground"
        }`}
      >
        {fmtUSD(value)}
        {ok === true && <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />}
      </span>
    </div>
  );
}

function ModifierRow({ mod, focused }: { mod: TraceModifierNode; focused: boolean }) {
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-md px-2 py-1 ${
        focused ? "ring-1 ring-blue-400 dark:ring-blue-500 bg-blue-50/40 dark:bg-blue-950/15" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-foreground font-semibold truncate">{mod.label}</span>
          <span className="text-slate-500 dark:text-slate-500 font-mono text-[10px]">
            {mod.ratePercent}% × Subtotal
          </span>
          <RateOriginBadge origin={mod.rateOrigin} />
          {mod.overridden && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              overridden
            </span>
          )}
        </span>
        <span className="font-mono text-foreground shrink-0">{fmtUSD(mod.value)}</span>
      </div>
      {mod.overridden && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono pl-0.5">
          computed {fmtUSD(mod.overridden.computedValue)} → override {fmtUSD(mod.overridden.overrideValue)}
        </div>
      )}
    </div>
  );
}

function RateOriginBadge({ origin }: { origin: "project" | "default" }) {
  if (origin === "project") {
    return (
      <span
        title="Rate set on this project"
        className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
      >
        <Pencil size={10} /> project-set
      </span>
    );
  }
  return (
    <span
      title="Engine default rate (no project value)"
      className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
    >
      <Settings size={10} /> default
    </span>
  );
}

function Row({
  label,
  value,
  emphasis,
  focused,
  overridden,
}: {
  label: string;
  value: number;
  emphasis: "total" | "subtotal";
  focused: boolean;
  overridden?: { computedValue: number; overrideValue: number };
}) {
  const valueClass =
    emphasis === "total"
      ? "text-emerald-600 dark:text-emerald-400 font-black text-sm"
      : "text-foreground font-bold";
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-md px-2 py-1 ${
        focused ? "ring-1 ring-blue-400 dark:ring-blue-500 bg-blue-50/40 dark:bg-blue-950/15" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
          {label}
          {overridden && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              overridden
            </span>
          )}
        </span>
        <span className={`font-mono shrink-0 ${valueClass}`}>{fmtUSD(value)}</span>
      </div>
      {overridden && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono pl-0.5">
          computed {fmtUSD(overridden.computedValue)} → override {fmtUSD(overridden.overrideValue)}
        </div>
      )}
    </div>
  );
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="p-6 font-sans text-xs text-slate-500 dark:text-slate-400">
      <div className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">{title}</div>
      <p className="leading-relaxed">{note}</p>
    </div>
  );
}
