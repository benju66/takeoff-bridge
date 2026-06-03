"use client";
"use no compiler";

import React, { use, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  FileDown,
  MapPin,
  Calendar,
  Menu
} from "lucide-react";
import {
  computeTakeoffSummary,
  computeDivisionBreakdown,
  computeCostTypeBreakdown,
} from "@/lib/calculations";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { usePersonnelCalculations } from "@/hooks/usePersonnelCalculations";
import { useInfrastructureCalculations } from "@/hooks/useInfrastructureCalculations";
import { useTakeoffWorkbook } from "@/hooks/useTakeoffWorkbook";
import { useEstimatePersistence } from "@/hooks/useEstimatePersistence";

import { ArchitecturalParametersStep } from "@/components/workspace/ArchitecturalParametersStep";
import { PersonnelPricingStep } from "@/components/workspace/PersonnelPricingStep";
import { InfrastructureStep } from "@/components/workspace/InfrastructureStep";
import { EstimateTable } from "@/components/workspace/EstimateTable";
import { ContextMenuPortal } from "@/components/workspace/ContextMenuPortal";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ProjectSettingsStep } from "@/components/workspace/ProjectSettingsStep";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

function WorkspaceInner({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("step") || "step4";

  // Project metadata & duration
  const {
    project,
    projectEstimate,
    isLoaded,
    error,
    projectDurationMonths,
    handleProjectParamChange,
  } = useProjectWorkspace(projectId);

  // Step 2: Division 01 General Conditions
  const personnel = usePersonnelCalculations(
    projectDurationMonths,
    isLoaded,
    projectEstimate?.gcUtilization,
    projectEstimate?.gcEquipmentOverrides,
  );

  // Step 3: Division 02 Site Operations
  const squareFootage: number = project ? project.squareFootage : 0;
  const infrastructure = useInfrastructureCalculations(
    projectDurationMonths,
    squareFootage,
    isLoaded,
    projectEstimate?.siteOpsQuantities,
    projectEstimate?.siteOpsRates,
  );

  // Step 4: Takeoff Workbook
  const workbook = useTakeoffWorkbook(projectId, isLoaded, project);
  const {
    rows, columnDefs, lockedCells, table,
    dragActive, appendData, setAppendData,
    contextMenu, setContextMenu,
    unmappedTakeoffClassifications,
    isExportingExcel, exportError, setExportError,
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
    scrollToRowRef,
    selection,
  } = workbook;

  // Step 4: Takeoff Summary
  // Amendment F: When a filter is active, summaries reflect only visible rows
  const unitCount: number = project ? project.unitCount : 0;
  const isFiltered = globalFilter !== "" || columnFilters.length > 0;
  const filteredRows = React.useMemo(() => {
    if (!isFiltered) return rows;
    return table.getFilteredRowModel().rows.map(r => r.original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltered, rows, table, globalFilter, columnFilters]);

  const takeoffSummary = React.useMemo(
    () => computeTakeoffSummary(filteredRows, squareFootage, unitCount, {
      overheadRate: project?.overheadRate ?? 10,
      feeRate: project?.feeRate ?? 5,
      liabilityRate: project?.liabilityRate ?? 1,
      taxRate: project?.taxRate ?? 8.25,
      roundingRule: project?.roundingRule ?? "dollar"
    }),
    [filteredRows, squareFootage, unitCount, project]
  );

  // Divisional & Cost Type Budget Aggregations
  const subtotal = takeoffSummary.subtotal;
  const divisionBreakdown = React.useMemo(
    () => computeDivisionBreakdown(filteredRows, subtotal),
    [filteredRows, subtotal]
  );
  const costTypeBreakdown = React.useMemo(
    () => computeCostTypeBreakdown(filteredRows, subtotal),
    [filteredRows, subtotal]
  );

  // UI Metrics
  const totalRows = rows.length;
  const mappedCount = rows.filter((r) => r.isMapped).length;
  const unmappedCount = totalRows - mappedCount;

  // ---------------------------------------------------------------------------
  // Persistence Orchestration
  // ---------------------------------------------------------------------------
  const { saveStatus, saveError } = useEstimatePersistence(
    projectId,
    isLoaded,
    rows,
    rowVersion,
    takeoffSummary,
    personnel.totalGCs,
    personnel.gcUtilization,
    personnel.gcEquipmentOverrides,
    infrastructure.siteOperationsTotal,
    infrastructure.siteOpsQuantities,
    infrastructure.siteOpsRates
  );

  // ---------------------------------------------------------------------------
  // Global Keyboard Shortcuts — Ctrl+Z (undo), Ctrl+Y / Ctrl+Shift+Z (redo)
  // ---------------------------------------------------------------------------
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  useEffect(() => { handleUndoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { handleRedoRef.current = handleRedo; }, [handleRedo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

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

        <div className="flex flex-wrap gap-4 items-center">
          {rows.length > 0 && (
            <>
              <button
                onClick={handleExportExcelWorkbook}
                disabled={unmappedCount > 0 || isExportingExcel}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-blue-500/10 dark:shadow-blue-955/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} className={isExportingExcel ? "animate-spin" : ""} />
                {isExportingExcel ? "Compiling Workbook..." : "Download Full Estimate Workbook (.xlsx)"}
              </button>
              <button
                onClick={handleExportExcel}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-card hover:bg-background/80 dark:bg-card dark:hover:bg-background/80 text-foreground border border-grid-border text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:shadow-md"
              >
                <FileDown size={18} /> Export Excel Payload
              </button>
              <button
                onClick={handleExportProcore}
                disabled={unmappedCount > 0}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm px-5 py-3 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-emerald-500/10 dark:shadow-emerald-955/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FileDown size={18} /> Export Procore Budget
              </button>
            </>
          )}
        </div>
      </header>

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

      {activeTab === "step2" && (
        <ErrorBoundary>
          <PersonnelPricingStep
            durationMonths={projectDurationMonths}
            utilizations={personnel.utilizations}
            onUtilizationChange={personnel.setUtilization}
            equipment={personnel.equipment}
            onEquipmentChange={personnel.handleEquipmentChange}
            calcResult={personnel.calcResult}
            totalGCs={personnel.totalGCs}
          />
        </ErrorBoundary>
      )}

      {activeTab === "step3" && (
        <ErrorBoundary>
          <InfrastructureStep
            durationMonths={projectDurationMonths}
            squareFootage={squareFootage}
            quantities={infrastructure.quantities}
            rates={infrastructure.rates}
            onSiteOpsChange={infrastructure.handleSiteOpsChange}
            calcResult={infrastructure.calcResult}
            siteOperationsTotal={infrastructure.siteOperationsTotal}
          />
        </ErrorBoundary>
      )}

      {activeTab === "step4" && (
        <ErrorBoundary>
          <EstimateTable
            project={project}
            projectDurationMonths={projectDurationMonths}
            squareFootage={squareFootage}
            unitCount={unitCount}
            rows={rows}
            columnDefs={columnDefs}
            lockedCells={lockedCells}
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
            takeoffSummary={takeoffSummary}
            divisionBreakdown={divisionBreakdown}
            costTypeBreakdown={costTypeBreakdown}
            globalFilter={globalFilter}
            setGlobalFilter={setGlobalFilter}
            selection={selection}
            scrollToRowRef={scrollToRowRef}
            pendingImport={pendingImport}
            confirmImport={confirmImport}
            cancelImport={cancelImport}
            reParseWithSheet={reParseWithSheet}
            handleProjectParamChange={handleProjectParamChange as (field: string, value: string | number) => void}
          />
        </ErrorBoundary>
      )}

      {activeTab === "settings" && (
        <ErrorBoundary>
          <ProjectSettingsStep projectId={projectId} />
        </ErrorBoundary>
      )}

      {/* Floating Context Menu Portal */}
      <ErrorBoundary>
        <ContextMenuPortal
          contextMenu={contextMenu}
          rows={rows}
          lockedCells={lockedCells}
          onToggleCellLock={handleToggleCellLock}
          onInsertRow={insertManualRow}
          onDeleteRow={deleteRow}
          onDismiss={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        />
      </ErrorBoundary>
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
