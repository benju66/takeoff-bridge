"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Loader2, Building2, MapPin, Calendar, Flag,
  Link2, Sparkles, Wand2, ScrollText,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { MARKET_SECTORS, MASTER_TEMPLATE_NAME, isLinkedDivisionRow } from "@/lib/constants";
import { loadTemplateWorkbook, extractEstimate, type ExtractedEstimate } from "@/lib/templateExtractor";
import { deriveLegacyBridge } from "@/lib/legacyBridge";
import { computeTakeoffSummary } from "@/lib/calculations";
import {
  enrichImportedRows, importSummaryRates, projectFromExtract, estimateTotalsForImport,
  checkImportTieOut, linkedTotalsFromRows, buildReverseProcoreMap, suggestImportMappings,
  applyImportMapping, lumpOverridesFromExtract, overrideMapFromIntents, catalogCostCodeEntries,
  type MappingSuggestion, type LumpOverrideIntent,
} from "@/lib/importEstimate";
import { validateAssignInput } from "@/lib/assignCode";
import { primeCostCodeResolver, primeCostCodeResolverFromCatalog } from "@/lib/costCodeResolver";
import {
  getCostCodeMap, saveProject, saveEstimate, createEstimateSnapshot,
  recordEstimateOverride, recordClassificationResolution,
} from "@/lib/db";
import type { ProcessedTakeoffRow } from "@/types";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Static (per-file) parse artifacts; the editable rows live in their own state. */
interface Parsed {
  fileName: string;
  extracted: ExtractedEstimate;
  /** Per-row mapping suggestions (legacy normalization), keyed by row id. */
  suggestions: Map<string, MappingSuggestion>;
  /** Legacy lump-sum modifiers → audited override intents (recorded on save). */
  lumpIntents: LumpOverrideIntent[];
}

export default function ImportPastEstimatePage() {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  /** Enriched rows — mutated (replaced) as the estimator confirms mappings. */
  const [rows, setRows] = useState<ProcessedTakeoffRow[]>([]);

  // Editable project metadata (defaults; the bid drives sqft/units/dates/rates).
  const [location, setLocation] = useState("");
  const [marketSector, setMarketSector] = useState("");
  const [bidDate, setBidDate] = useState("");

  // The tie-out recomputes whenever rows change (mapping acceptances). The
  // linked-totals basis is the ROWS themselves (linkedTotalsFromRows): once a
  // GC/Site-Ops row is mapped to a linked itemId the engine excludes its typed
  // qty×price and counts the linked value instead — same dollars, same tie.
  // Lump overrides ride the engine's own overrides arg (override ?? computed).
  const overrideMap = useMemo(
    () => overrideMapFromIntents(parsed?.lumpIntents ?? []),
    [parsed]
  );
  const summary = useMemo(() => {
    if (!parsed) return null;
    return computeTakeoffSummary(
      rows,
      parsed.extracted.inputs.squareFootage,
      parsed.extracted.inputs.unitCount,
      importSummaryRates(parsed.extracted.inputs),
      linkedTotalsFromRows(rows),
      overrideMap
    );
  }, [parsed, rows, overrideMap]);
  const tieOut = useMemo(
    () => (parsed && summary ? checkImportTieOut(summary, parsed.extracted.oracle) : null),
    [parsed, summary]
  );

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);
    setRows([]);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = await loadTemplateWorkbook(buffer);
      const extracted = extractEstimate(wb); // throws if not a template-shape workbook

      // Prime the granular-code resolver the same way the workspace mount does;
      // the same entries (reversed) feed the bridge's procore→internal lookup.
      let mapEntries: { internalCode: string; procoreCode: string }[] = [];
      try {
        const map = await getCostCodeMap(MASTER_TEMPLATE_NAME);
        if (map.length > 0) {
          primeCostCodeResolver(map);
          mapEntries = map;
        } else {
          primeCostCodeResolverFromCatalog();
        }
      } catch {
        primeCostCodeResolverFromCatalog();
      }
      if (mapEntries.length === 0) {
        mapEntries = catalogCostCodeEntries();
      }

      // Legacy normalization inputs: the workbook's own BLI bridge + reverse map.
      const bridge = deriveLegacyBridge(wb);
      const suggestions = suggestImportMappings(extracted, bridge, buildReverseProcoreMap(mapEntries));
      const lumpIntents = lumpOverridesFromExtract(extracted, file.name);

      setParsed({ fileName: file.name, extracted, suggestions, lumpIntents });
      setRows(enrichImportedRows(extracted));
    } catch (err) {
      console.error("Import parse failed:", err);
      setError(
        err instanceof Error
          ? `Could not read this workbook as a company-template estimate: ${err.message}`
          : "Could not read this workbook."
      );
    } finally {
      setParsing(false);
      e.target.value = ""; // allow re-selecting the same file
    }
  };

  /**
   * A linked itemId may exist on ONE row only: the engine counts a linked
   * value once per itemId but excludes EVERY row carrying it, so assigning the
   * same linked code twice would drop the second row's dollars and break the
   * tie with no way to un-map short of re-uploading. Refuse the duplicate.
   */
  const linkedAlreadyTaken = (prev: ProcessedTakeoffRow[], rowId: string, itemId: string) =>
    isLinkedDivisionRow(itemId) && prev.some((r) => r.id !== rowId && r.itemId === itemId);

  /** Apply a HUMAN-CONFIRMED mapping to one row (qty/unitPrice never move). */
  const acceptMapping = (rowId: string, itemId: string) => {
    if (linkedAlreadyTaken(rows, rowId, itemId)) {
      setError(`"${itemId}" is a linked GC/Site-Ops code and is already assigned to another line.`);
      return;
    }
    setError(null);
    setRows((prev) => prev.map((r) => (r.id === rowId ? applyImportMapping(r, itemId) : r)));
  };

  /** Accept every bridge/linked suggestion still pending — the high-confidence tiers only. */
  const acceptAllHighConfidence = () => {
    if (!parsed) return;
    setRows((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        const r = next[i];
        if (r.isMapped) continue;
        const s = parsed.suggestions.get(r.id);
        if (!s || (s.confidence !== "bridge" && s.confidence !== "linked") || !s.itemId) continue;
        if (linkedAlreadyTaken(next, r.id, s.itemId)) continue; // first claim wins; rest stay pending
        next[i] = applyImportMapping(r, s.itemId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!parsed || !summary || !tieOut?.ok) return;
    setSaving(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      const project = projectFromExtract(parsed.extracted, {
        id,
        location: location.trim(),
        marketSector,
        bidDate: bidDate || undefined,
      });
      await saveProject(project);

      const estimate = estimateTotalsForImport(id, summary, rows);
      await saveEstimate(estimate, rows);

      // Lump-sum modifiers → APPEND-ONLY audit records. Financial intent: these
      // MUST persist (db.ts throws on failure), so they are awaited — a legacy
      // bid whose lumps fail to record must not look saved-and-tied.
      for (const intent of parsed.lumpIntents) {
        await recordEstimateOverride(id, intent.field, intent.computedValue, intent.overrideValue, intent.reason);
      }

      // Confirmed mappings feed the recurring-bid memory (Phase 3 consumes
      // classification_history). Training data: fire-and-forget.
      for (const r of rows) {
        if (r.itemId && parsed.suggestions.has(r.id)) {
          recordClassificationResolution(r.description, r.itemId, id, "user").catch(() => {});
        }
      }

      // Fire-and-forget milestone snapshot (training data — loss is non-critical).
      createEstimateSnapshot(
        id,
        rows,
        "milestone",
        `Imported from ${parsed.fileName}`,
        {
          subtotal: summary.subtotal,
          totalEstimatedCost: summary.totalEstimatedCost,
        }
      ).catch(() => {});

      router.push(`/projects/${id}`);
    } catch (err) {
      console.error("Import save failed:", err);
      setError(err instanceof Error ? `Failed to save the imported project: ${err.message}` : "Failed to save.");
      setSaving(false);
    }
  };

  const inp = parsed?.extracted.inputs;
  const lineCount = rows.length;
  const unmappedCount = rows.filter((r) => !r.isMapped && !r.needsReview && !isLinkedDivisionRow(r.itemId)).length;
  const reviewCount = rows.filter((r) => r.needsReview).length;

  /** Rows the review table shows: every line a suggestion exists for. */
  const reviewRows = useMemo(
    () => (parsed ? rows.filter((r) => parsed.suggestions.has(r.id)) : []),
    [parsed, rows]
  );
  const pendingHighConfidence = parsed
    ? reviewRows.filter((r) => {
        const s = parsed.suggestions.get(r.id);
        return !r.isMapped && s && (s.confidence === "bridge" || s.confidence === "linked") && s.itemId;
      }).length
    : 0;
  const acceptedCount = reviewRows.filter((r) => r.isMapped).length;

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-5xl">
        <header className="flex items-center justify-between border-b border-grid-border pb-6">
          <div>
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 mb-3 transition-colors">
              <ArrowLeft size={14} /> Back to projects
            </Link>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
              <FileSpreadsheet className="text-blue-600 dark:text-blue-400" size={26} /> Import Past Estimate
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              Upload a finished company-template workbook (STEP 1–4). It will be parsed, enriched, and proven
              to tie to the cent before you save it as an editable project. Legacy bids (bare cost codes,
              lump-sum modifiers) are normalized with your confirmation — dollars never move.
            </p>
          </div>
        </header>

        {/* Upload */}
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-grid-border rounded-xl p-10 text-center bg-card dark:bg-card/10 cursor-pointer hover:border-blue-500/50 transition-colors">
          {parsing ? (
            <Loader2 className="animate-spin text-blue-600 dark:text-blue-400 mb-3" size={32} />
          ) : (
            <Upload className="text-slate-500 mb-3" size={32} />
          )}
          <span className="text-sm font-bold text-foreground">
            {parsing ? "Reading workbook…" : parsed ? `Loaded: ${parsed.fileName}` : "Choose a company-template .xlsx"}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">Only company-template estimates are supported.</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={handleFile} disabled={parsing || saving} />
        </label>

        {error && (
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/50 rounded-lg p-4 flex items-start gap-2.5 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {parsed && inp && summary && tieOut && (
          <>
            {/* Tie-out gate — the trust centerpiece */}
            <div
              className={`rounded-xl p-5 border ${
                tieOut.ok
                  ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900/50"
                  : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {tieOut.ok ? (
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={20} />
                ) : (
                  <AlertTriangle className="text-amber-600 dark:text-amber-400" size={20} />
                )}
                <h3 className={`text-sm font-bold ${tieOut.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                  {tieOut.ok
                    ? "Imported total ties your original to the cent ✓"
                    : "Imported total does NOT tie — review before saving"}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mt-4 text-xs font-mono">
                <Row label="Imported subtotal" value={money(tieOut.importedSubtotal)} />
                <Row label="Original subtotal" value={money(tieOut.oracleSubtotal)} />
                <Row label="Imported total" value={money(tieOut.importedTotal)} bold />
                <Row label="Original total" value={money(tieOut.oracleTotal)} bold />
                {!tieOut.ok && (
                  <>
                    <Row label="Subtotal delta" value={money(tieOut.deltaSubtotal)} warn />
                    <Row label="Total delta" value={money(tieOut.deltaTotal)} warn />
                  </>
                )}
              </div>
            </div>

            {/* Legacy lump-sum modifiers — recorded as audited overrides on save */}
            {parsed.lumpIntents.length > 0 && (
              <div className="bg-card border border-grid-border rounded-xl p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3 flex items-center gap-2">
                  <ScrollText size={13} className="text-indigo-500" /> As-bid lump sums (logged on save)
                </h3>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  These modifier rows carry hand-typed amounts instead of percentages. Each is honored exactly
                  as bid and recorded as a permanent, auditable override with its original label — so recurring
                  items build a history across imports.
                </p>
                <div className="flex flex-col gap-1.5 text-xs font-mono">
                  {parsed.lumpIntents.map((l) => (
                    <div key={l.field} className="flex items-center justify-between gap-4">
                      <span className="text-slate-500 dark:text-slate-400 truncate" title={l.reason}>{l.reason}</span>
                      <span className="font-bold text-foreground whitespace-nowrap">{money(l.overrideValue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Code mapping review — normalize legacy codes with one click each */}
            {reviewRows.length > 0 && (
              <div className="bg-card border border-grid-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                    <Wand2 size={13} className="text-blue-500" /> Code mapping review
                    <span className="font-normal normal-case text-slate-500">
                      {acceptedCount}/{reviewRows.length} confirmed
                    </span>
                  </h3>
                  <button
                    onClick={acceptAllHighConfidence}
                    disabled={pendingHighConfidence === 0 || saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Sparkles size={12} /> Accept all high-confidence ({pendingHighConfidence})
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  This bid uses legacy cost codes. Confirm a current code for each line — dollars never change,
                  only the code. Anything you skip still saves and stays flagged in the workspace Flags worklist.
                </p>
                <div className="max-h-96 overflow-y-auto border border-grid-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2 font-bold">Line</th>
                        <th className="px-3 py-2 font-bold text-right">Amount</th>
                        <th className="px-3 py-2 font-bold">Suggested code</th>
                        <th className="px-3 py-2 font-bold">Confirm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewRows.map((r) => (
                        <ReviewRow
                          key={r.id}
                          row={r}
                          suggestion={parsed.suggestions.get(r.id)!}
                          disabled={saving}
                          onAccept={(itemId) => acceptMapping(r.id, itemId)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Parsed summary */}
            <div className="bg-card border border-grid-border rounded-xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-4">Parsed estimate</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                <Field label="Project name" value={inp.projectName || "—"} />
                <Field label="Square footage" value={`${inp.squareFootage.toLocaleString()} SF`} />
                <Field label="Unit count" value={inp.unitCount.toLocaleString()} />
                <Field label="Line items" value={`${lineCount}`} />
                <Field label="Unmapped (Flags)" value={`${unmappedCount}`} />
                <Field label="Needs review (ad-hoc)" value={`${reviewCount}`} icon={reviewCount > 0 ? <Flag size={11} className="text-amber-500" /> : undefined} />
              </div>
            </div>

            {/* Editable metadata */}
            <div className="bg-card border border-grid-border rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <LabeledInput label="Location" icon={<MapPin size={13} />}>
                <input
                  type="text"
                  placeholder="e.g. Chicago, IL"
                  className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </LabeledInput>
              <LabeledInput label="Market sector" icon={<Building2 size={13} />}>
                <select
                  className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  value={marketSector}
                  onChange={(e) => setMarketSector(e.target.value)}
                >
                  <option value="">Select…</option>
                  {MARKET_SECTORS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </LabeledInput>
              <LabeledInput label="Bid date" icon={<Calendar size={13} />}>
                <input
                  type="date"
                  className="w-full bg-transparent border border-grid-border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  value={bidDate}
                  onChange={(e) => setBidDate(e.target.value)}
                />
              </LabeledInput>
            </div>

            <div className="flex items-center justify-end gap-3">
              <Link href="/projects" className="px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors">
                Cancel
              </Link>
              <button
                onClick={handleSave}
                disabled={!tieOut.ok || saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title={tieOut.ok ? "Save as a new project" : "Cannot save: the imported total does not tie to the original"}
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                {saving ? "Saving…" : "Save as project"}
              </button>
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// Mapping review row — chips for the suggestion tiers + a free-entry fallback
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLE: Record<MappingSuggestion["confidence"], { label: string; cls: string; icon: React.ReactNode }> = {
  bridge: { label: "From this bid's own mapping", cls: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300", icon: <Link2 size={10} /> },
  linked: { label: "GC / Site-Ops row", cls: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300", icon: <Link2 size={10} /> },
  similar: { label: "Best guesses — pick one", cls: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300", icon: <Sparkles size={10} /> },
  none: { label: "No match found", cls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300", icon: <Flag size={10} /> },
};

function ReviewRow({
  row,
  suggestion,
  disabled,
  onAccept,
}: {
  row: ProcessedTakeoffRow;
  suggestion: MappingSuggestion;
  disabled: boolean;
  onAccept: (itemId: string) => void;
}) {
  const [freeEntry, setFreeEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const style = CONFIDENCE_STYLE[suggestion.confidence];
  const amount = row.matchedQty * row.unitPrice;

  const assignFreeEntry = () => {
    const result = validateAssignInput(freeEntry);
    if (!result.ok) {
      setEntryError(result.error);
      return;
    }
    setEntryError(null);
    setFreeEntry("");
    onAccept(result.itemId);
  };

  if (row.isMapped) {
    return (
      <tr className="border-t border-grid-border bg-emerald-50/40 dark:bg-emerald-950/10">
        <td className="px-3 py-2 text-foreground">{row.description}</td>
        <td className="px-3 py-2 text-right font-mono text-foreground">{money(amount)}</td>
        <td className="px-3 py-2 font-mono text-emerald-700 dark:text-emerald-300" colSpan={2}>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} /> {row.itemId}</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-grid-border">
      <td className="px-3 py-2 text-foreground">{row.description}</td>
      <td className="px-3 py-2 text-right font-mono text-foreground">{money(amount)}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${style.cls}`} title={style.label}>
          {style.icon} {style.label}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(suggestion.confidence === "bridge" || suggestion.confidence === "linked") && suggestion.itemId && (
            <button
              onClick={() => onAccept(suggestion.itemId)}
              disabled={disabled}
              className="px-2 py-1 rounded font-mono text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              title={`Accept ${suggestion.itemId}`}
            >
              {suggestion.itemId} ✓
            </button>
          )}
          {suggestion.confidence === "similar" &&
            suggestion.candidates.slice(0, 3).map((c) => (
              <button
                key={c.itemId}
                onClick={() => onAccept(c.itemId)}
                disabled={disabled}
                className="px-2 py-1 rounded font-mono text-[11px] border border-grid-border text-foreground hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-40 transition-colors"
                title={c.description}
              >
                {c.itemId}
              </button>
            ))}
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              placeholder="code…"
              value={freeEntry}
              onChange={(e) => { setFreeEntry(e.target.value); setEntryError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") assignFreeEntry(); }}
              disabled={disabled}
              className="w-28 bg-transparent border border-grid-border rounded px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={assignFreeEntry}
              disabled={disabled || freeEntry.trim() === ""}
              className="px-2 py-1 rounded text-[10px] font-bold uppercase border border-grid-border text-foreground hover:bg-background disabled:opacity-40 transition-colors"
            >
              Assign
            </button>
          </span>
          {entryError && <span className="text-[10px] text-rose-600 dark:text-rose-400">{entryError}</span>}
        </div>
      </td>
    </tr>
  );
}

function Row({ label, value, bold, warn }: { label: string; value: string; bold?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`${bold ? "font-bold" : ""} ${warn ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>{value}</span>
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

function LabeledInput({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold mb-1.5 flex items-center gap-1.5">
        {icon}{label}
      </div>
      {children}
    </div>
  );
}
