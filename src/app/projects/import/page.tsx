"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Loader2, Building2, MapPin, Calendar, Flag,
  Link2, Sparkles, Wand2, ScrollText, History, HardHat, ChevronDown, ChevronRight, PlusCircle,
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
  applyStep23Corrections, step23LineKey, step23ReviewStats,
  type MappingSuggestion, type LumpOverrideIntent,
} from "@/lib/importEstimate";
import {
  resolveStep23Line, suggestNextStep23Code, activeStep23Defs, isBuiltInStep23Code,
  type Step23LineDef,
} from "@/lib/step23Normalization";
import { PROCORE_VALID_CODES } from "@/lib/procoreValidCodes";
import { validateAssignInput } from "@/lib/assignCode";
import { getCatalogItems } from "@/lib/catalog";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import { getDivisionCode } from "@/lib/division";
import { primeCostCodeResolver, primeCostCodeResolverFromCatalog } from "@/lib/costCodeResolver";
import {
  getCostCodeMap, saveProject, saveEstimate, createEstimateSnapshot,
  recordEstimateOverride, recordClassificationResolution, saveImportedStep23Lines,
  getClassificationHistoryBulk, getCustomStep23LineDefs, createCustomStep23LineDef,
  getCatalogAdditions,
} from "@/lib/db";
import type { ProcessedTakeoffRow } from "@/types";
import type { CustomStep23LineDef, ImportedSheetLine } from "@/types/db";

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
  /**
   * The estimator's UOM corrections: rowId → unit (uppercased). Same escape-
   * hatch pattern as `accepted` — an entry is a deliberate correction of a
   * wrong as-bid unit; clearing it restores the bid's own value. Untouched
   * rows always save exactly as bid.
   */
  const [uomOverrides, setUomOverrides] = useState<Map<string, string>>(new Map());
  /** Working rows = original enriched rows + current acceptances + UOM edits. */
  const rows = useMemo(
    () => (parsed ? applyAcceptedMappings(parsed.rows, accepted, uomOverrides) : []),
    [parsed, accepted, uomOverrides]
  );

  /**
   * STEP 2/3 review-gate corrections (ADVISORY — save is never gated on them).
   * Same escape-hatch pattern as `accepted`/`uomOverrides`, but keyed by the
   * sheet-scoped step23LineKey over the immutable parsed payload; they are
   * applied via applyStep23Corrections only at save time.
   */
  const [step23Uom, setStep23Uom] = useState<Map<string, string>>(new Map());
  const [step23Assignments, setStep23Assignments] = useState<Map<string, string>>(new Map());
  /** Line key the "create new code" mini-form is open for (null = closed). */
  const [mintForKey, setMintForKey] = useState<string | null>(null);
  /** null = auto (open while unmapped lines remain); the toggle pins it. */
  const [step23Open, setStep23Open] = useState<boolean | null>(null);
  /**
   * User-minted custom defs overlaying the built-ins in the resolver and the
   * assign dropdown. FAIL-SOFT: an outage degrades to built-ins only — the
   * review (and the import itself) must never block on this table.
   */
  const [customDefs, setCustomDefs] = useState<CustomStep23LineDef[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCustomStep23LineDefs()
      .then((defs) => {
        if (!cancelled) setCustomDefs(defs);
      })
      .catch((err) => {
        console.error("Failed to load custom GC/Site-Ops codes (review resolves with built-ins only):", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The codes the assign dropdown OFFERS: built-ins + only ACTIVE custom defs,
   * code-ordered (activeStep23Defs). Retired/merged customs leave the picker
   * here while the FULL customDefs still drive resolveStep23Line/suffix
   * suggestion below, so old lines keep their labels.
   */
  const step23AssignOptions = useMemo(() => activeStep23Defs(customDefs), [customDefs]);

  /** The exact payload handleSave persists (pre-corrections) — built once per parse. */
  const step23Payload = useMemo(
    () => (parsed ? step23LinesForImport(parsed.extracted) : null),
    [parsed]
  );
  const step23Corrections = useMemo(
    () => ({ uomCorrections: step23Uom, assignments: step23Assignments }),
    [step23Uom, step23Assignments]
  );
  const step23Stats = useMemo(
    () => (step23Payload ? step23ReviewStats(step23Payload, step23Corrections, customDefs) : null),
    [step23Payload, step23Corrections, customDefs]
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
    setUomOverrides(new Map());
    setStep23Uom(new Map());
    setStep23Assignments(new Map());
    setMintForKey(null);
    setStep23Open(null);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = await loadTemplateWorkbook(buffer);
      const extracted = extractEstimate(wb); // throws if not a template-shape workbook

      // Prime the STEP 4 catalog-additions overlay BEFORE the cost-code prime so
      // the degraded catalog-fallback path (and the catalog read used for import
      // matching) already includes additions. Self-contained — additions carry
      // their own procore_code + default_unit_price — so the catalog item overlay
      // + BOTH resolvers carry them; cost_code_map / rate_card untouched. FAIL-SOFT.
      primeCatalogAdditionOverlays(await getCatalogAdditions().catch(() => []));

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

  /**
   * Correct one row's UOM (empty input = clear the correction → back to the
   * bid's own value). Free-text on purpose: real bids carry units the catalog
   * doesn't (STOP, FLR, GAL, %) and a correction must be able to say them.
   */
  const setUomOverride = (rowId: string, value: string) => {
    const uom = value.trim().toUpperCase();
    setUomOverrides((prev) => {
      const next = new Map(prev);
      const original = parsed?.rows.find((r) => r.id === rowId)?.uom ?? "";
      if (uom === "" || uom === original) next.delete(rowId);
      else next.set(rowId, uom);
      return next;
    });
  };

  /**
   * Correct one STEP 2/3 line's UOM (empty input or the bid's own value =
   * clear the correction). Free-text for the same reason as setUomOverride:
   * hand-authored sheets carry units no catalog lists.
   */
  const setStep23UomCorrection = (lineKey: string, original: string, value: string) => {
    const uom = value.trim().toUpperCase();
    setStep23Uom((prev) => {
      const next = new Map(prev);
      if (uom === "" || uom === original) next.delete(lineKey);
      else next.set(lineKey, uom);
      return next;
    });
  };

  /** Assign an existing GC/Site-Ops code to an unmapped STEP 2/3 line. */
  const assignStep23 = (lineKey: string, code: string) => {
    setStep23Assignments((prev) => new Map(prev).set(lineKey, code));
  };

  /** Withdraw a STEP 2/3 assignment — the line returns to unmapped. */
  const clearStep23Assignment = (lineKey: string) => {
    setStep23Assignments((prev) => {
      const next = new Map(prev);
      next.delete(lineKey);
      return next;
    });
  };

  /**
   * The mint mini-form's submit: create the custom def (db.ts validates shape,
   * built-in shadowing, and duplicates — and throws readable messages the form
   * surfaces inline), then assign it to the line in the same step. The new def
   * joins the overlay immediately, so the resolver labels the line live.
   */
  const mintAndAssignStep23 = async (
    lineKey: string,
    input: { code: string; label: string; unit: string; procoreCode: string }
  ) => {
    const def = await createCustomStep23LineDef({
      code: input.code,
      label: input.label,
      unit: input.unit,
      procoreCode: input.procoreCode || null,
    });
    setCustomDefs((prev) =>
      [...prev, def].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    );
    setStep23Assignments((prev) => new Map(prev).set(lineKey, def.code));
    setMintForKey(null);
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
    if (!parsed || !step23Payload || !summary || !tieOut?.ok) return;
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
      // pages show read-only instead of fabricated parametric defaults. The
      // review gate's corrections (UOM fixes + assignments) are applied IN
      // MEMORY here, right before the single write — the stored column stays
      // write-once, and only uom/assignedCode can differ from the parse.
      await saveImportedStep23Lines(id, applyStep23Corrections(step23Payload, step23Corrections));

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
  /** The bid's ORIGINAL unit per row (for the "corrected" cue + revert hint). */
  const originalUomById = useMemo(
    () => new Map((parsed?.rows ?? []).map((r) => [r.id, r.uom])),
    [parsed]
  );
  const pendingHighConfidence = parsed
    ? reviewRows.filter((r) => {
        const s = parsed.suggestions.get(r.id);
        return !r.isMapped && s && (s.confidence === "bridge" || s.confidence === "linked") && s.itemId;
      }).length
    : 0;
  const acceptedCount = reviewRows.filter((r) => r.isMapped).length;
  /** Collapsed/expanded: auto-open while unmapped lines remain; toggle pins it. */
  const step23SectionOpen = step23Open ?? (step23Stats?.unmapped ?? 0) > 0;

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
                          uomEdited={uomOverrides.has(r.id)}
                          asBidUom={originalUomById.get(r.id) ?? ""}
                          onAccept={(itemId) => acceptMapping(r.id, itemId)}
                          onUnaccept={() => unacceptMapping(r.id)}
                          onUomChange={(value) => setUomOverride(r.id, value)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* One shared datalist backs every row's free-entry box: type a code
                    OR part of a name and the browser narrows the choices. */}
                <datalist id="import-code-options">
                  {Object.values(getCatalogItems())
                    .sort((a, b) => a.itemId.localeCompare(b.itemId, undefined, { numeric: true }))
                    .map((i) => (
                      <option key={i.itemId} value={i.itemId}>
                        {i.description}
                      </option>
                    ))}
                </datalist>
              </div>
            )}

            {/* GC/Site-Ops (STEP 2/3) review — ADVISORY: save is never gated on it */}
            {step23Payload && step23Stats && step23Stats.lineCount > 0 && (
              <div className="bg-card border border-grid-border rounded-xl p-5">
                <button
                  onClick={() => setStep23Open(!step23SectionOpen)}
                  aria-expanded={step23SectionOpen}
                  className="w-full flex items-center justify-between text-left"
                >
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-2">
                    <HardHat size={13} className="text-violet-500" /> GC/Site-Ops (STEP 2/3) review
                    <span className="font-normal normal-case text-slate-500">
                      {step23Stats.resolved}/{step23Stats.lineCount} resolved
                      {step23Stats.unmapped > 0 && (
                        <span className="text-amber-600 dark:text-amber-400"> · {step23Stats.unmapped} unmapped</span>
                      )}
                      {step23Stats.corrected > 0 && ` · ${step23Stats.corrected} corrected`}
                    </span>
                  </h3>
                  {step23SectionOpen ? (
                    <ChevronDown size={16} className="text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />
                  )}
                </button>
                {step23SectionOpen && (
                  <>
                    <p className="text-[11px] text-slate-500 mt-3 mb-3 leading-relaxed">
                      The bid&apos;s own General Conditions and Site Operations lines, with the app code each will
                      resolve to. Fix a wrong unit, assign a code to an unmapped line, or create a new code when
                      nothing fits — dollars never change. This review is advisory: anything you skip saves exactly
                      as bid.
                    </p>
                    <div className="max-h-96 overflow-y-auto border border-grid-border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-background z-10">
                          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                            <th className="px-3 py-2 font-bold">Code</th>
                            <th className="px-3 py-2 font-bold">Description</th>
                            <th className="px-3 py-2 font-bold text-right">Qty</th>
                            <th className="px-3 py-2 font-bold text-center">UOM</th>
                            <th className="px-3 py-2 font-bold text-right">Rate</th>
                            <th className="px-3 py-2 font-bold text-right">Total</th>
                            <th className="px-3 py-2 font-bold">Assign</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["step2", "step3"] as const).map((step) => {
                            const lines = step === "step2" ? step23Payload.step2Lines : step23Payload.step3Lines;
                            if (lines.length === 0) return null;
                            return (
                              <React.Fragment key={step}>
                                <tr className="border-t border-grid-border bg-background">
                                  <td colSpan={7} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    {step === "step2" ? "STEP 2 — General Conditions" : "STEP 3 — Site Operations"}
                                  </td>
                                </tr>
                                {lines.map((l) => {
                                  const lineKey = step23LineKey(step, l.rowNumber);
                                  const assignedRaw = step23Assignments.get(lineKey);
                                  const resolved = resolveStep23Line(l.code, l.description, assignedRaw, customDefs);
                                  return (
                                    <React.Fragment key={lineKey}>
                                      <Step23ReviewRow
                                        line={l}
                                        resolved={resolved}
                                        isAssigned={resolved !== null && resolved.code === assignedRaw?.trim()}
                                        uom={step23Uom.get(lineKey) ?? l.uom ?? ""}
                                        uomEdited={step23Uom.has(lineKey)}
                                        assignOptions={step23AssignOptions}
                                        disabled={saving}
                                        onUomChange={(value) => setStep23UomCorrection(lineKey, l.uom ?? "", value)}
                                        onAssign={(code) => assignStep23(lineKey, code)}
                                        onClearAssign={() => clearStep23Assignment(lineKey)}
                                        onOpenMint={() => setMintForKey(lineKey)}
                                      />
                                      {mintForKey === lineKey && (
                                        <tr className="border-t border-grid-border">
                                          <td colSpan={7} className="px-3 py-3 bg-violet-50/40 dark:bg-violet-950/10">
                                            <MintStep23CodeForm
                                              line={l}
                                              suggestedCode={suggestNextStep23Code(l.code, customDefs)}
                                              defaultUnit={step23Uom.get(lineKey) ?? l.uom ?? ""}
                                              disabled={saving}
                                              onCancel={() => setMintForKey(null)}
                                              onMint={(input) => mintAndAssignStep23(lineKey, input)}
                                            />
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
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
                {step23Stats && (
                  <>
                    <Field label="STEP 2/3 resolved" value={`${step23Stats.resolved}/${step23Stats.lineCount}`} />
                    <Field
                      label="STEP 2/3 unmapped"
                      value={`${step23Stats.unmapped}`}
                      icon={step23Stats.unmapped > 0 ? <AlertTriangle size={11} className="text-amber-500" /> : undefined}
                    />
                    <Field label="STEP 2/3 corrected" value={`${step23Stats.corrected}`} />
                  </>
                )}
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
const codeName = (itemId: string) => getCatalogItems()[itemId]?.description ?? "";

function ReviewRow({
  row,
  suggestion,
  disabled,
  uomEdited,
  asBidUom,
  onAccept,
  onUnaccept,
  onUomChange,
}: {
  row: ProcessedTakeoffRow;
  suggestion: MappingSuggestion;
  disabled: boolean;
  /** True when the estimator has corrected this row's UOM (override active). */
  uomEdited: boolean;
  /** The bid's ORIGINAL unit (pre-correction), for the cue + revert hint. */
  asBidUom: string;
  onAccept: (itemId: string) => void;
  onUnaccept: () => void;
  /** Commit a UOM correction; empty input restores the bid's own value. */
  onUomChange: (value: string) => void;
}) {
  const [freeEntry, setFreeEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const style = chipFor(suggestion);
  const amount = row.matchedQty * row.unitPrice;
  const comment = row.customFields?.["Comment"];
  // As-bid UOM, EDITABLE (architect-approved 2026-06-10): a correction here
  // fixes a wrong unit before it enters the project + pricing database.
  // Untouched = saves exactly as bid; clearing the box restores the bid's
  // value. The amber marker is the display-only bid-vs-catalog disagreement.
  const mismatch = uomMismatch(row);
  const uomCell = (
    <td className="px-3 py-2 text-center whitespace-nowrap">
      <UomBox
        value={row.uom}
        edited={uomEdited}
        original={asBidUom}
        disabled={disabled}
        onCommit={onUomChange}
        extra={
          mismatch && (
            <span
              title={`As bid: ${mismatch.bid} — catalog default for ${row.itemId}: ${mismatch.catalog}. The bid's UOM is kept unless you correct it.`}
              className="inline-flex text-amber-500 cursor-help"
            >
              <AlertTriangle size={11} />
            </span>
          )
        }
      />
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

// ---------------------------------------------------------------------------
// Shared editable-UOM box — violet corrected-state + original-in-tooltip
// ---------------------------------------------------------------------------

function UomBox({
  value,
  edited,
  original,
  disabled,
  onCommit,
  extra,
}: {
  /** The current effective unit (correction applied when one exists). */
  value: string;
  /** True when a correction is active (violet cue + revert hint). */
  edited: boolean;
  /** The bid's ORIGINAL unit, for the tooltip. */
  original: string;
  disabled: boolean;
  /** Commit a correction; empty input restores the bid's own value. */
  onCommit: (value: string) => void;
  /** Optional trailing adornment (e.g. the catalog-mismatch marker). */
  extra?: React.ReactNode;
}) {
  /** Local draft while typing; null = not editing (show the effective value). */
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      onCommit(draft);
      setDraft(null);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={draft ?? value}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className={`w-14 bg-transparent border rounded px-1.5 py-0.5 font-mono text-[11px] text-center outline-none focus:ring-1 focus:ring-blue-500 ${
          edited ? "border-violet-400 dark:border-violet-700 text-violet-700 dark:text-violet-300" : "border-grid-border text-foreground"
        }`}
        title={
          edited
            ? `Corrected — the bid says ${original || "(blank)"}. Clear the box to restore it.`
            : "As-bid unit. Edit to correct a wrong unit; untouched rows save exactly as bid."
        }
      />
      {extra}
    </span>
  );
}

// ---------------------------------------------------------------------------
// STEP 2/3 review row — resolution label + editable UOM + assign controls
// ---------------------------------------------------------------------------

function Step23ReviewRow({
  line,
  resolved,
  isAssigned,
  uom,
  uomEdited,
  assignOptions,
  disabled,
  onUomChange,
  onAssign,
  onClearAssign,
  onOpenMint,
}: {
  line: ImportedSheetLine;
  /** The def the line currently resolves to (assignment applied), or null. */
  resolved: Step23LineDef | null;
  /** True when the resolution comes from the estimator's assignment. */
  isAssigned: boolean;
  /** Effective unit (correction applied) + whether a correction is active. */
  uom: string;
  uomEdited: boolean;
  /** Codes the dropdown offers — built-ins + ACTIVE customs (activeStep23Defs). */
  assignOptions: Step23LineDef[];
  disabled: boolean;
  onUomChange: (value: string) => void;
  onAssign: (code: string) => void;
  onClearAssign: () => void;
  onOpenMint: () => void;
}) {
  return (
    <tr className="border-t border-grid-border">
      <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
        {line.code || "—"}
        {resolved ? (
          <div
            className="text-[10px] text-violet-700 dark:text-violet-300"
            title={
              isAssigned
                ? `Assigned to the app's GC/Site-Ops line "${resolved.label}" — saved on this line and fed to the rate history`
                : `Maps to the app's GC/Site-Ops line "${resolved.label}"`
            }
          >
            → {resolved.code}
          </div>
        ) : (
          <div
            className="text-[10px] italic text-amber-600 dark:text-amber-400"
            title="No matching app GC/Site-Ops line — assign one or create a new code; skipping saves it exactly as bid"
          >
            unmapped
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-foreground">{line.description}</td>
      <td className="px-3 py-2 text-right font-mono text-foreground">
        {line.qty !== 0 ? line.qty.toLocaleString() : "—"}
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <UomBox value={uom} edited={uomEdited} original={line.uom ?? ""} disabled={disabled} onCommit={onUomChange} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-foreground">{line.rate !== 0 ? money(line.rate) : "—"}</td>
      <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">{money(line.total)}</td>
      <td className="px-3 py-2">
        {isAssigned && resolved ? (
          <span className="inline-flex items-center gap-1.5 text-violet-700 dark:text-violet-300">
            <CheckCircle2 size={12} />
            <span className="text-[10px] max-w-36 truncate" title={resolved.label}>{resolved.label}</span>
            <button
              onClick={onClearAssign}
              disabled={disabled}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border border-grid-border text-slate-500 hover:text-foreground hover:bg-background disabled:opacity-40 transition-colors"
              title="Withdraw this assignment — the line returns to unmapped"
            >
              Clear
            </button>
          </span>
        ) : resolved ? (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">—</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onAssign(e.target.value);
              }}
              disabled={disabled}
              className="max-w-44 bg-transparent border border-grid-border rounded px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-blue-500"
              title="Assign an existing GC/Site-Ops code to this line"
            >
              <option value="">Assign code…</option>
              {assignOptions.some((d) => !isBuiltInStep23Code(d.code)) && (
                <optgroup label="Your custom codes">
                  {assignOptions
                    .filter((d) => !isBuiltInStep23Code(d.code))
                    .map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code} — {d.label}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Built-in GC/Site-Ops lines">
                {assignOptions
                  .filter((d) => isBuiltInStep23Code(d.code))
                  .map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.code} — {d.label}
                    </option>
                  ))}
              </optgroup>
            </select>
            <button
              onClick={onOpenMint}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-bold uppercase border border-grid-border text-foreground hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-40 transition-colors whitespace-nowrap"
              title="No existing line fits — create a new deterministic code and assign it in one step"
            >
              <PlusCircle size={11} /> New code
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// "Create new code" mini-form — mints via createCustomStep23LineDef + assigns
// ---------------------------------------------------------------------------

function MintStep23CodeForm({
  line,
  suggestedCode,
  defaultUnit,
  disabled,
  onCancel,
  onMint,
}: {
  line: ImportedSheetLine;
  /** Next free `.NNN` for the line's base ("" when no base — type it by hand). */
  suggestedCode: string;
  /** The line's EFFECTIVE unit (a UOM correction wins over the as-bid value). */
  defaultUnit: string;
  disabled: boolean;
  onCancel: () => void;
  /** Mints + assigns; rejects with a user-readable message shown inline. */
  onMint: (input: { code: string; label: string; unit: string; procoreCode: string }) => Promise<void>;
}) {
  const [code, setCode] = useState(suggestedCode);
  const [label, setLabel] = useState(line.description);
  const [unit, setUnit] = useState(defaultUnit);
  const [procoreCode, setProcoreCode] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setFormError(null);
    try {
      // On success the parent closes (unmounts) this form — no state to reset.
      await onMint({ code, label, unit, procoreCode });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create the code.");
      setPending(false);
    }
  };

  const busy = disabled || pending;
  const inputCls =
    "w-full bg-transparent border border-grid-border rounded px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-violet-500";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
        <PlusCircle size={11} /> New GC/Site-Ops code for “{line.description}”
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Code
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 02-4100.003"
            disabled={busy}
            className={`${inputCls} font-mono`}
            title="Deterministic NN-NNNN.NNN — pre-filled with the next free suffix for this line's base"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Name
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            className={inputCls}
            title="The name auto-resolves matching lines in every other bid — keep it the line's exact description unless it's wrong"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Unit
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="—"
            disabled={busy}
            className={`${inputCls} font-mono`}
            title="Defaults to the as-bid unit"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Procore budget line (optional)
          <select
            value={procoreCode}
            onChange={(e) => setProcoreCode(e.target.value)}
            disabled={busy}
            className={inputCls}
          >
            <option value="">None — set later in Catalog Manager</option>
            {PROCORE_VALID_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.description}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || code.trim() === "" || label.trim() === ""}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? <Loader2 className="animate-spin" size={11} /> : <CheckCircle2 size={11} />}
          Create &amp; assign
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background disabled:opacity-40 transition-colors"
        >
          Cancel
        </button>
        {formError && <span className="text-[10px] text-rose-600 dark:text-rose-400">{formError}</span>}
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        The new code applies retroactively: any line in any stored bid whose code and description match will
        resolve to it — no re-import needed. It carries no rate and moves no dollars.
      </p>
    </div>
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
