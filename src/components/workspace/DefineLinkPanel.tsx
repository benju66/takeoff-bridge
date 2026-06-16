"use client";

import React, { useMemo, useState } from "react";
import { X, AlertTriangle, Plus, Trash2, Info, Link2, CheckCircle2 } from "lucide-react";
import type { ProcessedTakeoffRow } from "@/types";
import type { PersonnelCalcResult, SiteOpsCalcResult } from "@/lib/calculations";
import type {
  Binding,
  RollupField,
  RollupOp,
  SetRule,
} from "@/lib/bindings/types";
import { findBindingByTarget } from "@/lib/bindings/store";
import { lineFieldNodeId } from "@/lib/bindings/compile";
import { describeSourceNode } from "@/lib/bindings/registry";
import {
  listLookupSourceOptions,
  buildLookupBinding,
  buildRollupBinding,
  setRuleFromLeaves,
  explicitIdsRule,
  validateLookupDraft,
  validateRollupDraft,
  previewBinding,
  isBindableRow,
  EXPLICIT_IDS_WARNING,
  ROLLUP_OPS,
  ROLLUP_FIELDS,
  SET_RULE_FIELDS,
  SET_RULE_MATCHES,
  type LeafDraft,
  type SetCombinator,
} from "@/lib/bindings/authoring";

// ---------------------------------------------------------------------------
// DefineLinkPanel — the "Define link…" authoring panel (Linked Values Phase 5).
//
// The estimator builds a LOOKUP (mirror a source value ±transform) or a ROLLUP (an
// op over a rule-described set of lines) and saves it as a Binding through the EXISTING
// SET_BINDING command path (onCommit → workbook commitBinding). Editing pre-fills from
// the current binding; delete clears it (CLEAR_BINDING). All decision logic is the pure
// authoring.ts (unit-tested); this is the I/O shell (mirrors the override editor).
//
// Glass box: it previews the result LIVE from source and REJECTS a circular reference
// (graph.ts findCycle, surfaced via authoring.previewBinding) before a save can happen.
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface DefineLinkPanelProps {
  /** The row whose total becomes a derived, read-only linked cell. */
  targetRow: ProcessedTakeoffRow;
  /** All rows — the lookup source picker + the hand-pick membership list. */
  rows: ProcessedTakeoffRow[];
  /** Current authored bindings — cycle check + edit pre-fill. */
  bindings: Binding[];
  gc: PersonnelCalcResult;
  siteOps: SiteOpsCalcResult;
  /** Persist/replace the binding (SET_BINDING via the workbook command path). */
  onCommit: (binding: Binding) => void;
  /** Clear the binding on the target row (CLEAR_BINDING) — the Delete action. */
  onClear: (rowId: string) => void;
  onClose: () => void;
}

type Mode = "lookup" | "rollup";

/** Parse an existing SetRule back into the flat builder state (best-effort for edit). */
function setRuleToDraft(set: SetRule): {
  useExplicit: boolean;
  explicitIds: string[];
  combinator: SetCombinator;
  leaves: LeafDraft[];
} {
  const leafToDraft = (rule: SetRule): LeafDraft | null => {
    if ("field" in rule && "match" in rule) {
      return {
        field: rule.field,
        match: rule.match,
        value: Array.isArray(rule.value) ? rule.value.join(", ") : rule.value,
      };
    }
    return null;
  };

  if ("explicitIds" in set) {
    return { useExplicit: true, explicitIds: set.explicitIds, combinator: "all", leaves: [] };
  }
  if ("all" in set) {
    return { useExplicit: false, explicitIds: [], combinator: "all", leaves: set.all.map(leafToDraft).filter((l): l is LeafDraft => l !== null) };
  }
  if ("any" in set) {
    return { useExplicit: false, explicitIds: [], combinator: "any", leaves: set.any.map(leafToDraft).filter((l): l is LeafDraft => l !== null) };
  }
  const leaf = leafToDraft(set);
  return { useExplicit: false, explicitIds: [], combinator: "all", leaves: leaf ? [leaf] : [] };
}

const DEFAULT_LEAF: LeafDraft = { field: "division", match: "equals", value: "" };

export function DefineLinkPanel({
  targetRow,
  rows,
  bindings,
  gc,
  siteOps,
  onCommit,
  onClear,
  onClose,
}: DefineLinkPanelProps) {
  const targetNodeId = lineFieldNodeId(targetRow.id, "total");
  const existing = findBindingByTarget(bindings, targetNodeId);
  const existingRollup =
    existing && existing.definition.kind === "rollup" ? existing.definition : null;
  const existingLookup =
    existing && existing.definition.kind === "lookup" ? existing.definition : null;
  const editingDraft = existingRollup ? setRuleToDraft(existingRollup.set) : null;

  const [mode, setMode] = useState<Mode>(existingRollup ? "rollup" : "lookup");
  const [error, setError] = useState<string | null>(null);

  // Lookup state
  const sourceOptions = useMemo(
    () => listLookupSourceOptions(rows, targetRow.id),
    [rows, targetRow.id]
  );
  const [source, setSource] = useState<string>(existingLookup?.source ?? "");
  const [multiplyRaw, setMultiplyRaw] = useState<string>(
    existingLookup?.transform?.multiply != null ? String(existingLookup.transform.multiply) : "1"
  );
  const [addRaw, setAddRaw] = useState<string>(
    existingLookup?.transform?.add != null ? String(existingLookup.transform.add) : "0"
  );

  // Rollup state
  const [op, setOp] = useState<RollupOp>(existingRollup?.op ?? "sum");
  const [field, setField] = useState<RollupField>(existingRollup?.field ?? "total");
  const [useExplicit, setUseExplicit] = useState<boolean>(editingDraft?.useExplicit ?? false);
  const [combinator, setCombinator] = useState<SetCombinator>(editingDraft?.combinator ?? "all");
  const [leaves, setLeaves] = useState<LeafDraft[]>(
    editingDraft && !editingDraft.useExplicit && editingDraft.leaves.length > 0
      ? editingDraft.leaves
      : [DEFAULT_LEAF]
  );
  const [explicitIds, setExplicitIds] = useState<string[]>(editingDraft?.explicitIds ?? []);

  const membershipRows = useMemo(
    () => rows.filter((r) => isBindableRow(r) && r.id !== targetRow.id),
    [rows, targetRow.id]
  );

  // Build the candidate binding from the current draft (null when the draft is invalid).
  const validation =
    mode === "lookup"
      ? validateLookupDraft(source, multiplyRaw, addRaw)
      : validateRollupDraft(useExplicit, leaves, explicitIds);

  const candidate: Binding | null = useMemo(() => {
    if (mode === "lookup") {
      if (!validateLookupDraft(source, multiplyRaw, addRaw).ok) return null;
      const transform = {
        multiply: multiplyRaw.trim() === "" ? 1 : Number(multiplyRaw),
        add: addRaw.trim() === "" ? 0 : Number(addRaw),
      };
      return buildLookupBinding(targetRow.id, source, transform);
    }
    if (!validateRollupDraft(useExplicit, leaves, explicitIds).ok) return null;
    const set = useExplicit ? explicitIdsRule(explicitIds) : setRuleFromLeaves(combinator, leaves);
    return buildRollupBinding(targetRow.id, op, set, field);
  }, [mode, source, multiplyRaw, addRaw, useExplicit, leaves, explicitIds, combinator, op, field, targetRow.id]);

  const preview = useMemo(
    () => (candidate ? previewBinding(candidate, bindings, gc, siteOps, rows) : null),
    [candidate, bindings, gc, siteOps, rows]
  );

  const cycleLabel = preview?.cycle
    ? preview.cycle.map((id) => describeSourceNode(id, rows).label).join(" → ")
    : null;

  const handleSave = () => {
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!candidate) {
      setError("This link is incomplete.");
      return;
    }
    if (preview?.cycle) {
      setError(`This link would create a circular reference (${cycleLabel}). Pick a different source.`);
      return;
    }
    onCommit(candidate);
    onClose();
  };

  const targetLabel = `${targetRow.itemId || "(no code)"}${targetRow.description ? ` · ${targetRow.description}` : ""}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] rounded-xl border border-grid-border shadow-2xl overflow-hidden bg-card text-card-foreground flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-grid-border bg-background/60 dark:bg-background/40">
          <div className="flex items-center gap-2 min-w-0">
            <Link2 size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-widest text-foreground">
              {existing ? "Edit link" : "Define link"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-background dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid-scroll p-4 space-y-4 text-xs">
          {/* Target */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              This cell
            </div>
            <div className="font-mono text-foreground truncate">{targetLabel}</div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              A linked cell shows a live, traceable value but is a reference — it does not add to the
              estimate total (that would double-count). The cell becomes read-only.
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex items-stretch rounded-lg border border-grid-border overflow-hidden">
            {(["lookup", "rollup"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`define-mode-${m}`}
                onClick={() => { setMode(m); setError(null); }}
                aria-current={mode === m}
                className={`flex-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  mode === m
                    ? "bg-blue-600 text-white"
                    : "bg-background/40 text-slate-600 dark:text-slate-300 hover:bg-background"
                }`}
              >
                {m === "lookup" ? "Lookup (mirror a value)" : "Rollup (aggregate lines)"}
              </button>
            ))}
          </div>

          {/* Lookup builder */}
          {mode === "lookup" && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Mirror this value</span>
                <select
                  data-testid="lookup-source"
                  value={source}
                  onChange={(e) => { setSource(e.target.value); setError(null); }}
                  className="mt-1 w-full rounded border border-grid-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">— pick a source —</option>
                  {["General Conditions (STEP 2)", "Site Operations (STEP 3)", "Estimate lines"].map((group) => {
                    const opts = sourceOptions.filter((o) => o.group === group);
                    if (opts.length === 0) return null;
                    return (
                      <optgroup key={group} label={group}>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">× Multiply</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    data-testid="lookup-multiply"
                    value={multiplyRaw}
                    onChange={(e) => { setMultiplyRaw(e.target.value); setError(null); }}
                    className="mt-1 w-full rounded border border-grid-border bg-card px-2 py-1.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">+ Add</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    data-testid="lookup-add"
                    value={addRaw}
                    onChange={(e) => { setAddRaw(e.target.value); setError(null); }}
                    className="mt-1 w-full rounded border border-grid-border bg-card px-2 py-1.5 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </label>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Value = source × multiply + add.</p>
            </div>
          )}

          {/* Rollup builder */}
          {mode === "rollup" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Operation</span>
                  <select
                    data-testid="rollup-op"
                    value={op}
                    onChange={(e) => setOp(e.target.value as RollupOp)}
                    className="mt-1 w-full rounded border border-grid-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {ROLLUP_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Of field</span>
                  <select
                    data-testid="rollup-field"
                    value={field}
                    onChange={(e) => setField(e.target.value as RollupField)}
                    disabled={op === "count"}
                    className="mt-1 w-full rounded border border-grid-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                  >
                    {ROLLUP_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </label>
              </div>

              {/* Membership: rule-based (default) vs hand-picked (discouraged) */}
              <div className="flex items-stretch rounded-lg border border-grid-border overflow-hidden text-[10px]">
                <button
                  type="button"
                  data-testid="rollup-mode-rule"
                  onClick={() => { setUseExplicit(false); setError(null); }}
                  className={`flex-1 px-2 py-1.5 font-bold uppercase tracking-wider transition-colors cursor-pointer ${!useExplicit ? "bg-blue-600 text-white" : "bg-background/40 text-slate-600 dark:text-slate-300 hover:bg-background"}`}
                >
                  By rule
                </button>
                <button
                  type="button"
                  data-testid="rollup-mode-explicit"
                  onClick={() => { setUseExplicit(true); setError(null); }}
                  className={`flex-1 px-2 py-1.5 font-bold uppercase tracking-wider transition-colors cursor-pointer ${useExplicit ? "bg-amber-600 text-white" : "bg-background/40 text-slate-600 dark:text-slate-300 hover:bg-background"}`}
                >
                  Hand-pick rows
                </button>
              </div>

              {!useExplicit ? (
                <div className="space-y-2">
                  {leaves.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Match</span>
                      <select
                        value={combinator}
                        onChange={(e) => setCombinator(e.target.value as SetCombinator)}
                        className="rounded border border-grid-border bg-card px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="all">ALL of these</option>
                        <option value="any">ANY of these</option>
                      </select>
                    </div>
                  )}
                  {leaves.map((leaf, i) => (
                    <div key={i} className="flex items-center gap-1.5" data-testid={`rule-leaf-${i}`}>
                      <select
                        value={leaf.field}
                        onChange={(e) => setLeaves((ls) => ls.map((l, j) => j === i ? { ...l, field: e.target.value as LeafDraft["field"] } : l))}
                        className="rounded border border-grid-border bg-card px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        {SET_RULE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <select
                        value={leaf.match}
                        onChange={(e) => setLeaves((ls) => ls.map((l, j) => j === i ? { ...l, match: e.target.value as LeafDraft["match"] } : l))}
                        className="rounded border border-grid-border bg-card px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        {SET_RULE_MATCHES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <input
                        type="text"
                        data-testid={`rule-value-${i}`}
                        value={leaf.value}
                        onChange={(e) => { setLeaves((ls) => ls.map((l, j) => j === i ? { ...l, value: e.target.value } : l)); setError(null); }}
                        placeholder={leaf.match === "in" ? "03, 04, 09" : "03"}
                        className="flex-1 min-w-0 rounded border border-grid-border bg-card px-2 py-1 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      {leaves.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLeaves((ls) => ls.filter((_, j) => j !== i))}
                          aria-label="Remove rule"
                          className="p-1 text-slate-400 hover:text-red-500 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    data-testid="rule-add-leaf"
                    onClick={() => setLeaves((ls) => [...ls, { ...DEFAULT_LEAF }])}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <Plus size={12} /> Add rule
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {EXPLICIT_IDS_WARNING}
                  </p>
                  <div className="max-h-40 overflow-y-auto grid-scroll rounded border border-grid-border divide-y divide-grid-border">
                    {membershipRows.length === 0 && (
                      <div className="px-2 py-2 text-slate-500 dark:text-slate-400 italic">No bindable rows.</div>
                    )}
                    {membershipRows.map((r) => {
                      const checked = explicitIds.includes(r.id);
                      return (
                        <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-background/50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => { setExplicitIds((ids) => checked ? ids.filter((x) => x !== r.id) : [...ids, r.id]); setError(null); }}
                          />
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-blue-600 dark:text-blue-400">{r.itemId || "(no code)"}</span>{" "}
                            <span className="text-foreground">{r.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live preview */}
          <div className="rounded-lg border border-grid-border bg-background/50 dark:bg-slate-900/30 px-3 py-2">
            {preview?.cycle ? (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>Circular reference: <span className="font-mono">{cycleLabel}</span></span>
              </div>
            ) : preview ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" /> Result
                  {mode === "rollup" && preview.memberCount != null && (
                    <span className="font-normal normal-case text-slate-400">· {preview.memberCount} row{preview.memberCount === 1 ? "" : "s"}</span>
                  )}
                </span>
                <span data-testid="define-preview-value" className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{fmtUSD(preview.value)}</span>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Finish the link to preview its value.</span>
            )}
          </div>

          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-grid-border bg-background/60 dark:bg-background/40">
          {existing ? (
            <button
              type="button"
              data-testid="define-delete"
              onClick={() => { onClear(targetRow.id); onClose(); }}
              className="rounded border border-grid-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
            >
              Delete link
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="define-save"
              onClick={handleSave}
              disabled={!candidate || !!preview?.cycle}
              className="rounded bg-blue-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {existing ? "Save changes" : "Create link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
