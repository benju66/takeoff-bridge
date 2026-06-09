"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Loader2, Building2, MapPin, Calendar, Flag,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { MARKET_SECTORS, MASTER_TEMPLATE_NAME, isLinkedDivisionRow } from "@/lib/constants";
import { loadTemplateWorkbook, extractEstimate, linkedTotalsFromExtract, type ExtractedEstimate } from "@/lib/templateExtractor";
import { computeTakeoffSummary, type TakeoffSummary } from "@/lib/calculations";
import {
  enrichImportedRows, importSummaryRates, projectFromExtract, estimateTotalsForImport,
  checkImportTieOut, type ImportTieOut,
} from "@/lib/importEstimate";
import { primeCostCodeResolver, primeCostCodeResolverFromCatalog } from "@/lib/costCodeResolver";
import { getCostCodeMap, saveProject, saveEstimate, createEstimateSnapshot } from "@/lib/db";
import type { ProcessedTakeoffRow } from "@/types";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Parsed {
  fileName: string;
  extracted: ExtractedEstimate;
  rows: ProcessedTakeoffRow[];
  summary: TakeoffSummary;
  tieOut: ImportTieOut;
}

export default function ImportPastEstimatePage() {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);

  // Editable project metadata (defaults; the bid drives sqft/units/dates/rates).
  const [location, setLocation] = useState("");
  const [marketSector, setMarketSector] = useState("");
  const [bidDate, setBidDate] = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setParsed(null);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = await loadTemplateWorkbook(buffer);
      const extracted = extractEstimate(wb); // throws if not a template-shape workbook

      // Prime the granular-code resolver the same way the workspace mount does.
      try {
        const map = await getCostCodeMap(MASTER_TEMPLATE_NAME);
        if (map.length > 0) primeCostCodeResolver(map);
        else primeCostCodeResolverFromCatalog();
      } catch {
        primeCostCodeResolverFromCatalog();
      }

      const rows = enrichImportedRows(extracted);
      const summary = computeTakeoffSummary(
        rows,
        extracted.inputs.squareFootage,
        extracted.inputs.unitCount,
        importSummaryRates(extracted.inputs),
        linkedTotalsFromExtract(extracted.lineItems)
      );
      const tieOut = checkImportTieOut(summary, extracted.oracle);
      setParsed({ fileName: file.name, extracted, rows, summary, tieOut });
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

  const handleSave = async () => {
    if (!parsed || !parsed.tieOut.ok) return;
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

      const estimate = estimateTotalsForImport(id, parsed.summary, parsed.rows);
      await saveEstimate(estimate, parsed.rows);

      // Fire-and-forget milestone snapshot (training data — loss is non-critical).
      createEstimateSnapshot(
        id,
        parsed.rows,
        "milestone",
        `Imported from ${parsed.fileName}`,
        {
          subtotal: parsed.summary.subtotal,
          totalEstimatedCost: parsed.summary.totalEstimatedCost,
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
  const lineCount = parsed?.rows.length ?? 0;
  const unmappedCount = parsed ? parsed.rows.filter((r) => !r.isMapped && !r.needsReview && !isLinkedDivisionRow(r.itemId)).length : 0;
  const reviewCount = parsed ? parsed.rows.filter((r) => r.needsReview).length : 0;

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6 max-w-4xl">
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
              to tie to the cent before you save it as an editable project.
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

        {parsed && inp && (
          <>
            {/* Tie-out gate — the trust centerpiece */}
            <div
              className={`rounded-xl p-5 border ${
                parsed.tieOut.ok
                  ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900/50"
                  : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {parsed.tieOut.ok ? (
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={20} />
                ) : (
                  <AlertTriangle className="text-amber-600 dark:text-amber-400" size={20} />
                )}
                <h3 className={`text-sm font-bold ${parsed.tieOut.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                  {parsed.tieOut.ok
                    ? "Imported total ties your original to the cent ✓"
                    : "Imported total does NOT tie — review before saving"}
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mt-4 text-xs font-mono">
                <Row label="Imported subtotal" value={money(parsed.tieOut.importedSubtotal)} />
                <Row label="Original subtotal" value={money(parsed.tieOut.oracleSubtotal)} />
                <Row label="Imported total" value={money(parsed.tieOut.importedTotal)} bold />
                <Row label="Original total" value={money(parsed.tieOut.oracleTotal)} bold />
                {!parsed.tieOut.ok && (
                  <>
                    <Row label="Subtotal delta" value={money(parsed.tieOut.deltaSubtotal)} warn />
                    <Row label="Total delta" value={money(parsed.tieOut.deltaTotal)} warn />
                  </>
                )}
              </div>
            </div>

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
                disabled={!parsed.tieOut.ok || saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold uppercase rounded-lg text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title={parsed.tieOut.ok ? "Save as a new project" : "Cannot save: the imported total does not tie to the original"}
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
