"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Loader2, Building2, MapPin, Calendar, Flag,
  Link2, Sparkles, Wand2, ScrollText, History,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { MARKET_SECTORS, MASTER_TEMPLATE_NAME, isLinkedDivisionRow } from "@/lib/constants";
import { loadTemplateWorkbook, extractEstimate, type ExtractedEstimate } from "@/lib/templateExtractor";
import { deriveLegacyBridge } from "@/lib/legacyBridge";
import { computeTakeoffSummary } from "@/lib/calculations";
import {
  enrichImportedRows, importSummaryRates, projectFromExtract, estimateTotalsForImport,
  checkImportTieOut, linkedTotalsFromRows, buildReverseProcoreMap, suggestImportMappings,
  applyAcceptedMappings, linkedMappingConflict, lumpOverridesFromExtract, overrideMapFromIntents,
  catalogCostCodeEntries, step23LinesForImport, uomMismatch,
  type MappingSuggestion, type LumpOverrideIntent,
} from "@/lib/importEstimate";
import { validateAssignInput } from "@/lib/assignCode";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { getDivisionCode } from "@/lib/division";
import { primeCostCodeResolver, primeCostCodeResolverFromCatalog } from "@/lib/costCodeResolver";
import {
  getCostCodeMap, saveProject, saveEstimate, createEstimateSnapshot,
  recordEstimateOverride, recordClassificationResolution, saveImportedStep23Lines,
  getClassificationHistoryBulk,
} from "@/lib/db";
import type { ProcessedTakeoffRow } from "@/types";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Static (per-file) parse artifacts; the estimator's acceptances live in their own state. */
interface Parsed {
  fileName: string;
  extracted: ExtractedEstimate;
  /** The ORIGINAL enriched rows — never mutated; acceptances layer over them. */
  rows: ProcessedTakeoffRow[];
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
  /**
   * The estimator's confirmations: rowId → accepted itemId. Kept separate from
   * the (immutable) parsed rows so a confirmation can be CHANGED or withdrawn
   * any time before save — approving the wrong code is never one-way.
   */
  const [accepted, setAccepted] = useState<Map<string, string>>(new Map());
  /** Working rows = original enriched rows + current acceptances. */
  const rows = useMemo(
    () => (parsed ? applyAcceptedMappings(parsed.rows, accepted) : []),
    [parsed, accepted]
  );

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
    setAccepted(new Map());
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

      // Past confirmations for this bid's exact descriptions (Phase 3 Slice 1).
      // ADVISORY + fail-soft: a history outage degrades to the pre-history tiers.
      let history: Map<string, { resolvedCode: string; count: number }[]> | undefined;
      try {
        history = await getClassificationHistoryBulk(extracted.adHocLineItems.map((i) => i.description));
      } catch {
        history = undefined;
      }

      const suggestions = suggestImportMappings(extracted, bridge, buildReverseProcoreMap(mapEntries), history);
      const lumpIntents = lumpOverridesFromExtract(extracted, file.name);

      setParsed({ fileName: file.name, extracted, rows: enrichImportedRows(extracted), suggestions, lumpIntents });
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

  /** Confirm (or re-confirm with a different code) one row's mapping. */
  const acceptMapping = (rowId: string, itemId: string) => {
    if (!parsed) return;
    // A linked GC/Site-Ops code may live on ONE row only — a duplicate would
    // silently drop the second row's dollars and break the tie.
    if (linkedMappingConflict(parsed.rows, accepted, rowId, itemId)) {
      setError(`"${itemId}" is a linked GC/Site-Ops code and is already assigned to another line.`);
      return;
    }
    setError(null);
    setAccepted((prev) => new Map(prev).set(rowId, itemId));
  };

  /** Withdraw a confirmation — the row returns to its suggested/pending state. */
  const unacceptMapping = (rowId: string) => {
    setError(null);
    setAccepted((prev) => {
      const next = new Map(prev);
      next.delete(rowId);
      return next;
    });
  };

  /** Accept every bridge/linked suggestion still pending — the high-confidence tiers only. */
  const acceptAllHighConfidence = () => {
    if (!parsed) return;
    setAccepted((prev) => {
      const next = new Map(prev);
      for (const r of parsed.rows) {
        if (r.isMapped || next.has(r.id)) continue;
        const s = parsed.suggestions.get(r.id);
        if (!s || (s.confidence !== "bridge" && s.confidence !== "linked") || !s.itemId) continue;
        if (linkedMappingConflict(parsed.rows, next, r.id, s.itemId)) continue; // first claim wins
        next.set(r.id, s.itemId);
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

      // The bid's own STEP 2/3 line detail — what the workspace GC/Site-Ops
      // pages show read-only instead of fabricated parametric defaults.
      await saveImportedStep23Lines(id, step23LinesForImport(parsed.extracted));

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
  // Bid-vs-catalog UOM disagreements (display-only; the as-bid UOM is kept).
  const uomMismatchCount = rows.filter((r) => uomMismatch(r) !== null).length;

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
                        <th className="px-3 py-2 font-bold text-center">UOM</th>
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
                          onUnaccept={() => unacceptMapping(r.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* One shared datalist backs every row's free-entry box: type a code
                    OR part of a name and the browser narrows the choices. */}
                <datalist id="import-code-options">
                  {Object.values(ESTIMATE_ITEMS_MASTER)
                    .sort((a, b) => a.itemId.localeCompare(b.itemId, undefined, { numeric: true }))
                    .map((i) => (
                      <option key={i.itemId} value={i.itemId}>
                        {i.description}
                      </option>
                    ))}
                </datalist>
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
                <Field
                  label="UOM differs from catalog"
                  value={`${uomMismatchCount}`}
                  icon={uomMismatchCount > 0 ? <AlertTriangle size={11} className="text-amber-500" /> : undefined}
                />
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
  linked: { label: "Linked row", cls: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300", icon: <Link2 size={10} /> },
  history: { label: "Confirmed on past imports", cls: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300", icon: <History size={10} /> },
  similar: { label: "Best guesses — pick one", cls: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300", icon: <Sparkles size={10} /> },
  none: { label: "No match found", cls: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300", icon: <Flag size={10} /> },
};

/** The chip for a suggestion; linked rows name their actual home (GC vs Site-Ops);
 *  history chips say how many past confirmations back the code. */
function chipFor(suggestion: MappingSuggestion): { label: string; cls: string; icon: React.ReactNode } {
  const base = CONFIDENCE_STYLE[suggestion.confidence];
  if (suggestion.confidence === "history") {
    const n = suggestion.historyCount ?? 0;
    return { ...base, label: n === 1 ? "Seen in 1 past bid" : `Seen in ${n} past bids` };
  }
  if (suggestion.confidence !== "linked") return base;
  const division = getDivisionCode(suggestion.itemId);
  return { ...base, label: division === "01" ? "GC row" : division === "02" ? "Site-Ops row" : base.label };
}

/** Catalog name for a code ("" when uncatalogued — e.g. a linked division row). */
const codeName = (itemId: string) => ESTIMATE_ITEMS_MASTER[itemId]?.description ?? "";

function ReviewRow({
  row,
  suggestion,
  disabled,
  onAccept,
  onUnaccept,
}: {
  row: ProcessedTakeoffRow;
  suggestion: MappingSuggestion;
  disabled: boolean;
  onAccept: (itemId: string) => void;
  onUnaccept: () => void;
}) {
  const [freeEntry, setFreeEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const style = chipFor(suggestion);
  const amount = row.matchedQty * row.unitPrice;
  const comment = row.customFields?.["Comment"];
  // As-bid UOM + the display-only mismatch marker (bid vs catalog for the
  // confirmed code). Never blocks; the UOM is editable later in the grid.
  const mismatch = uomMismatch(row);
  const uomCell = (
    <td className="px-3 py-2 text-center font-mono text-foreground whitespace-nowrap">
      {row.uom || "—"}
      {mismatch && (
        <span
          title={`As bid: ${mismatch.bid} — catalog default for ${row.itemId}: ${mismatch.catalog}. The bid's UOM is kept (you can edit it in the grid after saving).`}
          className="inline-flex align-middle ml-1 text-amber-500 cursor-help"
        >
          <AlertTriangle size={11} />
        </span>
      )}
    </td>
  );
  const descriptionCell = (
    <td className="px-3 py-2 text-foreground">
      {row.description}
      {comment && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-0.5" title="Estimator's note from the bid (STEP 4 col E)">
          📝 {comment}
        </div>
      )}
    </td>
  );

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
        {descriptionCell}
        <td className="px-3 py-2 text-right font-mono text-foreground">{money(amount)}</td>
        {uomCell}
        <td className="px-3 py-2 text-emerald-700 dark:text-emerald-300" colSpan={2}>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={12} /> <span className="font-mono">{row.itemId}</span>
              {codeName(row.itemId) && <span className="text-emerald-600/80 dark:text-emerald-400/80">{codeName(row.itemId)}</span>}
            </span>
            <button
              onClick={onUnaccept}
              disabled={disabled}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border border-grid-border text-slate-500 hover:text-foreground hover:bg-background disabled:opacity-40 transition-colors"
              title="Withdraw this confirmation and pick a different code"
            >
              Change
            </button>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-grid-border">
      {descriptionCell}
      <td className="px-3 py-2 text-right font-mono text-foreground">{money(amount)}</td>
      {uomCell}
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${style.cls}`} title={style.label}>
          {style.icon} {style.label}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(suggestion.confidence === "bridge" || suggestion.confidence === "linked" || suggestion.confidence === "history") && suggestion.itemId && (
            <>
              <button
                onClick={() => onAccept(suggestion.itemId)}
                disabled={disabled}
                className={`px-2 py-1 rounded font-mono text-[11px] font-bold text-white disabled:opacity-40 transition-colors ${
                  suggestion.confidence === "history"
                    ? "bg-violet-600 hover:bg-violet-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
                title={`Accept ${suggestion.itemId}${codeName(suggestion.itemId) ? ` — ${codeName(suggestion.itemId)}` : ""}`}
              >
                {suggestion.itemId} ✓
              </button>
              {codeName(suggestion.itemId) && (
                <span className="text-[10px] text-slate-500 dark:text-slate-400 max-w-40 truncate" title={codeName(suggestion.itemId)}>
                  {codeName(suggestion.itemId)}
                </span>
              )}
              {/* History runner-ups (other codes the team has confirmed before). */}
              {suggestion.confidence === "history" &&
                suggestion.candidates.slice(1, 3).map((c) => (
                  <button
                    key={c.itemId}
                    onClick={() => onAccept(c.itemId)}
                    disabled={disabled}
                    className="px-2 py-1 rounded font-mono text-[11px] border border-grid-border text-foreground hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-40 transition-colors"
                    title={c.description}
                  >
                    {c.itemId} <span className="font-sans text-[10px] text-slate-500">{c.description}</span>
                  </button>
                ))}
            </>
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
                {c.itemId} <span className="font-sans text-[10px] text-slate-500">{c.description}</span>
              </button>
            ))}
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              placeholder="code…"
              list="import-code-options"
              value={freeEntry}
              onChange={(e) => { setFreeEntry(e.target.value); setEntryError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") assignFreeEntry(); }}
              disabled={disabled}
              className="w-40 bg-transparent border border-grid-border rounded px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-blue-500"
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
