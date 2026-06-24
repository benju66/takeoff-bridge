"use client";
"use no compiler";

import React, { use, useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  MapPin,
  Calendar,
  Menu,
  Database
} from "lucide-react";
import {
  computeTakeoffSummary,
  computeDivisionBreakdown,
  computeCostTypeBreakdown,
} from "@/lib/calculations";
import {
  computeLinkedDivisionTotalsViaEngine,
  computeImportedLinkedDivisionTotalsViaEngine,
  projectAppBornSectionLines,
  projectImportedSectionLines,
} from "@/lib/bindings/registry";
import { isLinkedDivisionRow } from "@/lib/constants";
import { sectionTotalsFromLinked } from "@/lib/importEstimate";
import { synthesizeImportedSectionLines } from "@/lib/sectionLines/imported";
import { ImportedStep23Panel } from "@/components/workspace/ImportedStep23Panel";
import { validateExportReadiness, rollupEffectiveModifiers, RECONCILIATION_TOLERANCE } from "@/lib/exporter";
import { buildReconciliationModel } from "@/lib/trustInspector";
import { recordEstimateOverride } from "@/lib/db";
import type { OverridePayload } from "@/lib/overrideSetter";
import { computeBuyoutProfit } from "@/lib/buyout";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { usePersonnelCalculations } from "@/hooks/usePersonnelCalculations";
import { useInfrastructureCalculations } from "@/hooks/useInfrastructureCalculations";
import { useTakeoffWorkbook } from "@/hooks/useTakeoffWorkbook";
import { useEstimatePersistence } from "@/hooks/useEstimatePersistence";
import { useRateCardSnapshot } from "@/hooks/useRateCardSnapshot";
import { useEstimateOverrides } from "@/hooks/useEstimateOverrides";
import { useEstimateBindings } from "@/hooks/useEstimateBindings";

import { ArchitecturalParametersStep } from "@/components/workspace/ArchitecturalParametersStep";
import { DataHealthStrip } from "@/components/workspace/DataHealthStrip";
import { GcPersonnelGridStep } from "@/components/workspace/GcPersonnelGridStep";
import { SiteOpsGridStep } from "@/components/workspace/SiteOpsGridStep";
import { EstimateTable } from "@/components/workspace/EstimateTable";
import { ContextMenuPortal } from "@/components/workspace/ContextMenuPortal";
import { DefineLinkPanel } from "@/components/workspace/DefineLinkPanel";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ProjectSettingsStep } from "@/components/workspace/ProjectSettingsStep";
import { ExportOverrideModal } from "@/components/workspace/ExportOverrideModal";
import { VersionsPanel } from "@/components/workspace/VersionsPanel";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

function WorkspaceInner({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("step") || "step4";

  // Bucket B Phase 5 — cross-step Links coordinator. A GC (STEP 2) / Site-Ops (STEP 3)
  // EngineLinkBadge dispatches `tb:inspect-binding` with a raw engine `nodeId`, but the
  // Trust Inspector lives in the EstimateTable, which is unmounted on those steps. When the
  // event fires off STEP 4 we navigate there and hand EstimateTable the focused node so it
  // opens the Links tab on mount; when STEP 4 is already mounted its own listener handles it
  // (so we ignore those here — no double-open). `seq` makes a repeat click reopen it.
  const [pendingInspect, setPendingInspect] = useState<{ nodeId: string; seq: number } | null>(null);
  const inspectSeqRef = useRef(0);
  useEffect(() => {
    const onInspect = (e: Event) => {
      const nodeId = (e as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (!nodeId) return; // a bare `rowId` event is STEP 4-internal (EstimateTable handles it)
      if (activeTab === "step4") return; // already mounted — its own listener handles it
      inspectSeqRef.current += 1;
      setPendingInspect({ nodeId, seq: inspectSeqRef.current });
      router.push(`/projects/${projectId}?step=step4`);
    };
    window.addEventListener("tb:inspect-binding", onInspect);
    return () => window.removeEventListener("tb:inspect-binding", onInspect);
  }, [activeTab, router, projectId]);

  // Project metadata & duration
  const {
    project,
    projectEstimate,
    isLoaded,
    error,
    projectDurationMonths,
    handleProjectParamChange,
    persistedRemovedCodes,
    persistedOneOffLines,
  } = useProjectWorkspace(projectId);

  const squareFootage: number = project ? project.squareFootage : 0;

  // Rate-card Phase B: the per-project point-in-time rate snapshot. Frozen at
  // first save; layered over the live company card in the calc hooks below.
  const { rateCardSnapshot, freezeRateCardSnapshot } = useRateCardSnapshot(
    isLoaded,
    projectEstimate?.rateCardSnapshot,
  );

  // Phase 4: active estimator overrides, layered over the computed summary below so a
  // persisted override applies on reload. The glass-box UI that sets/reverts an override
  // is Phase 5 (this is the read+apply wiring only).
  const { activeOverrides, overrideRecords, refresh: refreshOverrides } = useEstimateOverrides(projectId, isLoaded);

  // Linked Values Phase 4: persisted bindings (lookups/rollups). Owned here and passed
  // into the workbook so SET_BINDING / CLEAR_BINDING share its undo history. `[]` =
  // inert (no bound cells; summary + export untouched → goldens tie $0.00).
  const { bindings, setBindings } = useEstimateBindings(projectId, isLoaded);

  // A brand-new estimate (no persisted project_estimates row yet) gets a one-time
  // "Estimate created" milestone snapshot on its first save (Phase 4 audit wiring).
  const isNewEstimate = !projectEstimate;

  // Step 2: Division 01 General Conditions. `activeOverrides` threads the per-line
  // type-overs (D3 / A+1) into the GC engine — `{}` until one is recorded, so the
  // result stays byte-identical and the export goldens tie $0.00 (gc-siteops B2).
  const personnel = usePersonnelCalculations(
    projectDurationMonths,
    squareFootage,
    isLoaded,
    projectEstimate?.gcUtilization,
    projectEstimate?.gcEquipmentOverrides,
    rateCardSnapshot,
    activeOverrides,
    // Phase B4 (D2): persisted removed GC catalog lines (app-born only; undefined for
    // imported, D4). The page guards on isImported; the workspace hook already returns
    // empties for imports, this keeps the intent explicit at the call site.
    project?.isImported ? undefined : persistedRemovedCodes.gc,
    // Phase B5 (D1): persisted one-off GC lines (app-born only; undefined for imported, D4).
    project?.isImported ? undefined : persistedOneOffLines.gc,
  );

  // Step 3: Division 02 Site Operations. `activeOverrides` threads the per-line
  // type-overs (D3 / A+1) into the Site-Ops engine — `{}` until one is recorded, so
  // the result stays byte-identical and the export goldens tie $0.00 (gc-siteops B3).
  const infrastructure = useInfrastructureCalculations(
    projectDurationMonths,
    squareFootage,
    isLoaded,
    projectEstimate?.siteOpsQuantities,
    projectEstimate?.siteOpsRates,
    rateCardSnapshot,
    activeOverrides,
    // Phase B4 (D2): persisted removed Site-Ops catalog lines (app-born only; undefined
    // for imported, D4).
    project?.isImported ? undefined : persistedRemovedCodes.siteOps,
    // Phase B5 (D1): persisted one-off Site-Ops lines (app-born only; undefined for imported, D4).
    project?.isImported ? undefined : persistedOneOffLines.siteOps,
  );

  // GC/Site-Ops Addressability section lines (GC first, then Site Ops — sort_order
  // is re-stamped from the array index by the gateway), persisted alongside the
  // legacy blobs by the dual-write below.
  //  - APP-BORN (Phase A3): synthesized from the live STEP 2/3 blobs (derived).
  //  - IMPORTED (Phase A4): synthesized from the FROZEN imported_step23_lines detail
  //    as lumpSum constants — never the parametric personnel/infrastructure lines
  //    (those are app DEFAULTS for imports, finding G-2). A live STEP 2/3 input can
  //    never move them; only the frozen detail does.
  const sectionLines = React.useMemo(
    () =>
      project?.isImported
        ? synthesizeImportedSectionLines(projectEstimate?.importedStep23Lines)
        : [...personnel.sectionLines, ...infrastructure.sectionLines],
    [project?.isImported, projectEstimate?.importedStep23Lines, personnel.sectionLines, infrastructure.sectionLines]
  );

  // GC/Site-Ops Addressability Phase A5: project the section lines to BindingLines so
  // each GC/Site-Ops line is a binding TARGET / rollup MEMBER in the kind-blind graph.
  // The total-resolution seam (app-born = live engine per-line total; imported = frozen
  // inputs.value constant) lives in the two projectors. Handed to the binding engine
  // below; INERT until a binding actually targets/aggregates a section line.
  const sectionBindingLines = React.useMemo(
    () =>
      project?.isImported
        ? projectImportedSectionLines(sectionLines)
        : projectAppBornSectionLines(sectionLines, personnel.calcResult, infrastructure.calcResult),
    [project?.isImported, sectionLines, personnel.calcResult, infrastructure.calcResult]
  );

  // Step 4: Takeoff Workbook (GC + Site Ops calc results thread through to the
  // export handlers — gc-siteops Phase 3)
  const workbook = useTakeoffWorkbook(projectId, isLoaded, project, personnel.calcResult, infrastructure.calcResult, activeOverrides, bindings, setBindings, sectionBindingLines);
  const {
    rows, columnDefs, lockedCells, layoutConfig, table,
    dragActive, appendData, setAppendData,
    contextMenu, setContextMenu,
    unmappedTakeoffClassifications,
    isExportingExcel, exportError, setExportError,
    exportBlockers, pendingExportKind, clearExportBlockers, applyProcoreOverrides,
    handleAddCustomColumn,
    handleDeleteColumn, handleRenameColumn,
    insertManualRow, deleteRow, handleToggleCellLock,
    handleFileUpload, handleDrag, handleDrop,
    pendingImport, confirmImport, cancelImport, reParseWithSheet,
    handleExportExcel, handleExportProcore, handleExportExcelWorkbook,
    handleUndo, handleRedo,
    canUndo, canRedo, undoStackSize, redoStackSize,
    rowVersion,
    globalFilter, setGlobalFilter,
    columnFilters,
    lensView, setLensView, buyoutRollup,
    scrollToRowRef,
    selection,
    boundRowIds, commitBinding, clearBindingForRow,
  } = workbook;

  // Linked Values Phase 5: the "Define link…" authoring panel target (a row id) or null.
  // Opened from the grid context menu; the panel writes through the workbook command path.
  const [defineLinkRowId, setDefineLinkRowId] = React.useState<string | null>(null);
  const defineLinkRow = defineLinkRowId ? rows.find((r) => r.id === defineLinkRowId) ?? null : null;

  // Step 4: Takeoff Summary
  // Amendment F: When a filter is active, summaries reflect only visible rows
  const unitCount: number = project ? project.unitCount : 0;
  const isFiltered = globalFilter !== "" || columnFilters.length > 0;
  const filteredRows = React.useMemo(() => {
    if (!isFiltered) return rows;
    return table.getFilteredRowModel().rows.map(r => r.original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltered, rows, table, globalFilter, columnFilters]);

  // gc-siteops Phase 5: live linked values for the 10 STEP 4 division rows
  // (template rows 12–24). They join the subtotal/modifier basis whenever
  // their row is visible — exactly like the template's I331.
  //
  // IMPORTED projects (finding G-2): a finished bid's GC/Site-Ops lump sums are
  // hand-authored and cannot be re-derived from staffing inputs, so the saved
  // linked-division rows ARE the authority — derive the linked totals from those
  // rows instead of recomputing from STEP 2/3. This is what lets a reopened import
  // still tie to the cent.
  //
  // Both branches now flow through the Linked Values binding engine (registry.ts) as
  // a drop-in: app-born = 10 lookups into the STEP 2/3 source nodes; imported = the
  // linked nodes are CONSTANTS from the saved rows (never STEP 2/3 lookups — §6). The
  // numbers are identical to the legacy bridge (proven in bindingRegistry.test.ts).
  const linkedDivisionTotals = React.useMemo(
    () => project?.isImported
      ? computeImportedLinkedDivisionTotalsViaEngine(rows)
      : computeLinkedDivisionTotalsViaEngine(personnel.calcResult, infrastructure.calcResult),
    [project?.isImported, rows, personnel.calcResult, infrastructure.calcResult]
  );

  // Stray typed dollars on linked rows count nowhere (trap closure) — surface
  // them in the EstimateTable banner instead of silently dropping. For an
  // imported project those typed dollars are the AUTHORITATIVE linked statics
  // (counted via the imported engine branch above), not stray, so none are flagged.
  const strayLinkedRows = React.useMemo(
    () =>
      project?.isImported
        ? []
        : rows
            .filter((r) => isLinkedDivisionRow(r.itemId) && r.matchedQty * r.unitPrice !== 0)
            .map((r) => ({ itemId: r.itemId, description: r.description, amount: r.matchedQty * r.unitPrice })),
    [rows, project?.isImported]
  );

  // Modifier rates + rounding (template defaults applied) — shared by the on-screen
  // (filtered) summary and the full-row reconciliation summary so they can never drift.
  const summaryRates = React.useMemo(() => ({
    constructionContingencyRate: project?.constructionContingencyRate ?? 0,
    designContingencyRate: project?.designContingencyRate ?? 0,
    buildersRiskRate: project?.buildersRiskRate ?? 0,
    specialInsuranceRate: project?.specialInsuranceRate ?? 0,
    glInsuranceRate: project?.glInsuranceRate ?? 0.01,
    bondRate: project?.bondRate ?? 0,
    feeRate: project?.feeRate ?? 0.05,
    roundingRule: project?.roundingRule ?? "none",
  }), [project]);

  const takeoffSummary = React.useMemo(
    () => computeTakeoffSummary(filteredRows, squareFootage, unitCount, summaryRates, linkedDivisionTotals, activeOverrides),
    [filteredRows, squareFootage, unitCount, summaryRates, linkedDivisionTotals, activeOverrides]
  );

  // Reconciliation (Phase 5 slice 3 — 5b): ALWAYS over the FULL unfiltered row set and
  // the full summary. Export uses every row, so the chip/tab must never reflect a
  // filtered partial (Amendment F). When unfiltered this is identical to takeoffSummary;
  // only a search/filter forks a second full computation.
  const fullTakeoffSummary = React.useMemo(
    () => isFiltered
      ? computeTakeoffSummary(rows, squareFootage, unitCount, summaryRates, linkedDivisionTotals, activeOverrides)
      : takeoffSummary,
    [isFiltered, rows, squareFootage, unitCount, summaryRates, linkedDivisionTotals, activeOverrides, takeoffSummary]
  );

  // Estimate Buyout Lens (Phase 4 follow-on) — Projected Profit for the buyout footer,
  // mirroring the template's STEP 4 bottom block (P341 / O347 / P347). Anchored on the
  // WHOLE-estimate bid + fee (fullTakeoffSummary, never the filtered partial) so it stays
  // consistent with the whole-estimate buyoutRollup. Display-only; profit is derived live
  // from the engine bid + the browser-local data-line savings, never stored.
  const buyoutProfit = React.useMemo(
    () => computeBuyoutProfit({
      bid: fullTakeoffSummary.totalEstimatedCost,
      fee: fullTakeoffSummary.fee,
      dataLineRollup: buyoutRollup,
    }),
    [fullTakeoffSummary.totalEstimatedCost, fullTakeoffSummary.fee, buyoutRollup]
  );

  // Single source with the export gate: the same validateExportReadiness, surfaced
  // live instead of thrown away when it passes. Adds the modifier rollup → grand-total tie.
  const reconciliation = React.useMemo(() => {
    // IMPORTED projects: gate on the saved linked rows, not the parametric
    // calc results (which are app defaults for imports — G-2).
    const readiness = validateExportReadiness(
      rows,
      personnel.calcResult,
      infrastructure.calcResult,
      project?.isImported ? { importedLinkedBasis: true } : undefined
    );
    return buildReconciliationModel({
      reconciliation: readiness.reconciliation,
      blockerCount: readiness.blockers.length,
      summary: fullTakeoffSummary,
      modifierRollupTotal: rollupEffectiveModifiers(fullTakeoffSummary),
      roundingMode: summaryRates.roundingRule,
      tolerance: RECONCILIATION_TOLERANCE,
    });
  }, [rows, personnel.calcResult, infrastructure.calcResult, fullTakeoffSummary, summaryRates, project?.isImported]);

  // Phase 5 slice 4 — the override WRITE path. The Trust Inspector's editor builds the
  // payload (pure overrideSetter.ts); this records the immutable event and re-syncs the
  // active overrides. recordEstimateOverride THROWS on failure — we let it reject so the
  // editor surfaces "save failed" and never shows an unpersisted override.
  const handleSaveOverride = React.useCallback(
    async (payload: OverridePayload) => {
      await recordEstimateOverride(
        projectId,
        payload.field,
        payload.computedValue,
        payload.overrideValue,
        payload.reason
      );
      refreshOverrides();
    },
    [projectId, refreshOverrides]
  );

  // Divisional & Cost Type Budget Aggregations
  const subtotal = takeoffSummary.subtotal;
  const divisionBreakdown = React.useMemo(
    () => computeDivisionBreakdown(filteredRows, subtotal, linkedDivisionTotals),
    [filteredRows, subtotal, linkedDivisionTotals]
  );
  const costTypeBreakdown = React.useMemo(
    () => computeCostTypeBreakdown(filteredRows, subtotal, linkedDivisionTotals),
    [filteredRows, subtotal, linkedDivisionTotals]
  );

  // ---------------------------------------------------------------------------
  // Persistence Orchestration
  // ---------------------------------------------------------------------------
  // IMPORTED projects: the persisted GC/Site-Ops section totals must stay
  // derived from the saved linked rows — personnel.totalGCs / infrastructure
  // .siteOperationsTotal are PARAMETRIC DEFAULTS for imports, and persisting
  // them would overwrite the as-imported totals on the first workspace edit.
  // Derives from the linkedDivisionTotals memo above (for imported projects that
  // memo is the engine's saved-row constants) — no second walk of the row set.
  const importedSectionTotals = React.useMemo(
    () => (project?.isImported ? sectionTotalsFromLinked(linkedDivisionTotals) : null),
    [project?.isImported, linkedDivisionTotals]
  );

  // The section lines (synthesized above, before the workbook so they can also feed the
  // binding engine — Phase A5) persist alongside the legacy blobs via the dual-write.
  const { saveStatus, saveError } = useEstimatePersistence(
    projectId,
    isLoaded,
    rows,
    rowVersion,
    takeoffSummary,
    importedSectionTotals?.generalConditionsTotal ?? personnel.totalGCs,
    importedSectionTotals?.siteOperationsTotal ?? infrastructure.siteOperationsTotal,
    freezeRateCardSnapshot,
    isNewEstimate,
    sectionLines
  );

  // ---------------------------------------------------------------------------
  // Global Keyboard Shortcuts — Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo)
  // ---------------------------------------------------------------------------
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  useEffect(() => { handleUndoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { handleRedoRef.current = handleRedo; }, [handleRedo]);

  // This global handler drives the STEP 4 workbook history only. STEP 2's grid
  // (GcPersonnelGridStep, B2) owns its own command history + Ctrl+Z/Y listener while
  // mounted, so guard here to avoid both firing on step2 (it mounts one step at a time).
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (activeTabRef.current !== "step4") return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        handleRedoRef.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------------------------------------------------------------------------
  // Unsaved Changes Guard — beforeunload
  // ---------------------------------------------------------------------------
  const hasPendingChangesRef = useRef(false);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (isLoaded) {
      hasPendingChangesRef.current = true;
    }
  }, [rows, isLoaded]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      hasPendingChangesRef.current = false;
    }
  }, [saveStatus]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChangesRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ---------------------------------------------------------------------------
  // Guards: Loading → Error → Not Found
  // ---------------------------------------------------------------------------
  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin mb-4" />
        <h3 className="text-sm font-bold text-foreground mb-1 uppercase tracking-wider">Loading Project</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Retrieving workspace data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <AlertTriangle className="text-red-500 dark:text-red-400 mb-4" size={48} />
        <h3 className="text-lg font-bold text-red-700 dark:text-red-300 mb-2">Failed to Load Project</h3>
        <p className="text-xs text-red-600/80 dark:text-red-400/80 mb-6 max-w-md text-center font-mono break-all">{error}</p>
        <Link href="/projects" className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-grid-border text-xs px-5 py-2.5 rounded font-bold uppercase transition-colors">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh]">
        <AlertTriangle className="text-amber-500 mb-4 animate-bounce" size={48} />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Project Not Found</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-6">Project ID &quot;{projectId}&quot; does not exist.</p>
        <Link href="/projects" className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-grid-border text-xs px-5 py-2.5 rounded font-bold uppercase transition-colors">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 selection:bg-blue-100 dark:selection:bg-blue-900/50 animate-fade-in">
      {/* Header Panel */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-grid-border pb-6 mb-2 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("toggle-sidebar"))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800/65 rounded-lg text-slate-655 dark:text-slate-355 transition-colors cursor-pointer"
            title="Toggle Sidebar"
          >
            <Menu size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
                {project.name}
              </h1>
              <span className="text-[10px] bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-md font-bold tracking-widest uppercase">
                {project.id}
              </span>
            </div>

            <div className="flex flex-wrap gap-4 mt-3 text-slate-600 dark:text-slate-400 text-xs items-center uppercase font-semibold">
              <span className="flex items-center gap-1"><MapPin size={13} /> {project.location}</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span className="flex items-center gap-1"><Calendar size={13} /> Bid: {project.bidDate}</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span>Size: {project.squareFootage.toLocaleString()} SF</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span>Units: {project.unitCount.toLocaleString()}</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span className="text-cyan-600 dark:text-cyan-400">Duration: {projectDurationMonths} mo</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span className="text-emerald-600 dark:text-emerald-400">${takeoffSummary.costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / SF</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span>Start: {project.expectedStart || "—"}</span>
              <span className="text-slate-400 dark:text-slate-650">|</span>
              <span>Finish: {project.expectedFinish || "—"}</span>
              {saveStatus !== 'idle' && (
                <>
                  <span className="text-slate-400 dark:text-slate-650">|</span>
                  {saveStatus === 'saving' && (
                    <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Saving…
                    </span>
                  )}
                  {saveStatus === 'saved' && (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Saved ✓
                    </span>
                  )}
                  {saveStatus === 'error' && (
                    <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400" title={saveError || undefined}>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      Save failed
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <Link
          href={`/projects/${projectId}/snapshots`}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase rounded-lg border border-grid-border text-foreground hover:bg-background transition-colors flex-shrink-0"
          title="Procore actuals snapshots & reconciliation"
        >
          <Database size={14} className="text-blue-600 dark:text-blue-400" /> Actuals snapshots
        </Link>
      </header>

      {/* Data Health strip (fidelity Phase 4) — the company audit filtered to
          this project. Advisory + fail-soft: renders nothing while loading,
          on outage, or when this project has no findings. */}
      <ErrorBoundary>
        <DataHealthStrip projectId={projectId} />
      </ErrorBoundary>

      {/* Export Error Banner */}
      {exportError && (
        <div className="bg-red-50 dark:bg-red-950/25 border border-red-200 dark:border-red-900/50 rounded-xl p-4 flex items-center gap-3 text-red-700 dark:text-red-400 text-xs font-mono animate-shake mb-6 shadow-sm">
          <AlertTriangle className="text-red-500 animate-pulse" size={16} />
          <span><strong>System Alert:</strong> {exportError}</span>
          <button
            onClick={() => setExportError(null)}
            className="ml-auto bg-transparent hover:text-slate-900 dark:hover:text-white font-bold uppercase text-[10px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step Panels — Single active panel based on URL parameter */}
      {activeTab === "step1" && (
        <ErrorBoundary>
          <ArchitecturalParametersStep
            project={project}
            onParamChange={handleProjectParamChange}
          />
        </ErrorBoundary>
      )}

      {/* IMPORTED projects: the parametric STEP 2/3 calculators would fabricate
          default-derived numbers a finished bid never carried — show the bid's
          own captured detail read-only instead. */}
      {activeTab === "step2" && (
        <ErrorBoundary>
          {project?.isImported ? (
            <ImportedStep23Panel
              step="step2"
              payload={projectEstimate?.importedStep23Lines}
              linkedTotals={linkedDivisionTotals}
            />
          ) : (
            <GcPersonnelGridStep
              personnel={personnel}
              durationMonths={projectDurationMonths}
              squareFootage={squareFootage}
              onSaveOverride={handleSaveOverride}
            />
          )}
        </ErrorBoundary>
      )}

      {activeTab === "step3" && (
        <ErrorBoundary>
          {project?.isImported ? (
            <ImportedStep23Panel
              step="step3"
              payload={projectEstimate?.importedStep23Lines}
              linkedTotals={linkedDivisionTotals}
            />
          ) : (
            <SiteOpsGridStep
              infrastructure={infrastructure}
              durationMonths={projectDurationMonths}
              squareFootage={squareFootage}
              onSaveOverride={handleSaveOverride}
            />
          )}
        </ErrorBoundary>
      )}

      {activeTab === "step4" && (
        <ErrorBoundary>
          <EstimateTable
            project={project}
            squareFootage={squareFootage}
            unitCount={unitCount}
            rows={rows}
            columnDefs={columnDefs}
            lockedCells={lockedCells}
            layoutConfig={layoutConfig}
            table={table}
            dragActive={dragActive}
            appendData={appendData}
            setAppendData={setAppendData}
            contextMenu={contextMenu}
            setContextMenu={setContextMenu}
            unmappedTakeoffClassifications={unmappedTakeoffClassifications}
            canUndo={canUndo}
            canRedo={canRedo}
            undoStackSize={undoStackSize}
            redoStackSize={redoStackSize}
            handleAddCustomColumn={handleAddCustomColumn}
            handleDeleteColumn={handleDeleteColumn}
            handleRenameColumn={handleRenameColumn}
            handleFileUpload={handleFileUpload}
            handleDrag={handleDrag}
            handleDrop={handleDrop}
            handleUndo={handleUndo}
            handleRedo={handleRedo}
            handleExportExcelWorkbook={handleExportExcelWorkbook}
            handleExportExcel={handleExportExcel}
            handleExportProcore={handleExportProcore}
            isExportingExcel={isExportingExcel}
            takeoffSummary={takeoffSummary}
            divisionBreakdown={divisionBreakdown}
            costTypeBreakdown={costTypeBreakdown}
            linkedDivisionTotals={linkedDivisionTotals}
            bindings={bindings}
            gcCalcResult={personnel.calcResult}
            siteOpsCalcResult={infrastructure.calcResult}
            reconciliation={reconciliation}
            overrideRecords={overrideRecords}
            isFiltered={isFiltered}
            onSaveOverride={handleSaveOverride}
            strayLinkedRows={strayLinkedRows}
            globalFilter={globalFilter}
            setGlobalFilter={setGlobalFilter}
            lensView={lensView}
            setLensView={setLensView}
            buyoutRollup={buyoutRollup}
            buyoutProfit={buyoutProfit}
            selection={selection}
            scrollToRowRef={scrollToRowRef}
            pendingImport={pendingImport}
            confirmImport={confirmImport}
            cancelImport={cancelImport}
            reParseWithSheet={reParseWithSheet}
            handleProjectParamChange={handleProjectParamChange as (field: string, value: string | number) => void}
            pendingInspect={pendingInspect}
            onInspectConsumed={() => setPendingInspect(null)}
          />
        </ErrorBoundary>
      )}

      {/* Estimate Versioning: freeze/submit/compare always works over the FULL
          unfiltered row set + summary — a saved version must never be a
          filtered partial (same rule as the export gate, Amendment F). */}
      {activeTab === "versions" && (
        <ErrorBoundary>
          <VersionsPanel
            projectId={projectId}
            rows={rows}
            summary={fullTakeoffSummary}
          />
        </ErrorBoundary>
      )}

      {activeTab === "settings" && (
        <ErrorBoundary>
          <ProjectSettingsStep projectId={projectId} />
        </ErrorBoundary>
      )}

      {/* Export Override Modal — unmapped Procore dollars require explicit user assignment */}
      {exportBlockers.length > 0 && (
        <ErrorBoundary>
          <ExportOverrideModal
            blockers={exportBlockers}
            onApply={(assignments) => {
              const updatedRows = applyProcoreOverrides(assignments);
              const retryKind = pendingExportKind;
              clearExportBlockers();
              if (retryKind === "procore") {
                handleExportProcore(updatedRows);
              } else {
                handleExportExcelWorkbook(updatedRows);
              }
            }}
            onCancel={clearExportBlockers}
          />
        </ErrorBoundary>
      )}

      {/* Floating Context Menu Portal */}
      <ErrorBoundary>
        <ContextMenuPortal
          contextMenu={contextMenu}
          // filteredRows so the menu's rowIndex (a filtered-model position) resolves to
          // the correct row under an active grid filter (identical to rows when unfiltered).
          rows={filteredRows}
          lockedCells={lockedCells}
          boundRowIds={boundRowIds}
          onToggleCellLock={handleToggleCellLock}
          onInsertRow={insertManualRow}
          onDeleteRow={deleteRow}
          onDefineLink={setDefineLinkRowId}
          onDismiss={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        />
      </ErrorBoundary>

      {/* Linked Values "Define link…" authoring panel (Phase 5). Writes through the
          workbook command path (commitBinding / clearBindingForRow) — undoable. */}
      {defineLinkRow && (
        <ErrorBoundary>
          <DefineLinkPanel
            targetRow={defineLinkRow}
            rows={rows}
            bindings={bindings}
            gc={personnel.calcResult}
            siteOps={infrastructure.calcResult}
            onCommit={commitBinding}
            onClear={clearBindingForRow}
            onClose={() => setDefineLinkRowId(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default function ProjectWorkspace({ params }: PageProps) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.projectId;

  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] font-sans">
          <div className="w-10 h-10 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin mb-4" />
          <h3 className="text-sm font-bold text-foreground mb-1 uppercase tracking-wider">Loading Workspace</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">Initializing project engine nodes…</p>
        </div>
      }
    >
      <WorkspaceInner projectId={projectId} />
    </Suspense>
  );
}
