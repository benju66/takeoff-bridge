"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Trash, MessageSquare } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  createColumnHelper,
  ColumnFiltersState,
  Table,
} from "@tanstack/react-table";
import { getCatalogItems } from "@/lib/catalog";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import { ProcessedTakeoffRow, ColumnDefinition, ContextMenuState, GridSelectionState, PasteCommand, EstimateOverrideMap } from "@/types";
import { ExportBlocker } from "@/lib/exporter";
import { NumberCellInput } from "@/components/workspace/NumberCellInput";
import { StringCellInput } from "@/components/workspace/StringCellInput";
import { SelectCellInput } from "@/components/workspace/SelectCellInput";
import { RowProvenanceGlyph } from "@/components/workspace/RowProvenanceGlyph";
import { PendingImport } from "./useFileIngestion";
import { ArchParamSuggestion } from "@/lib/archParamDetector";
import { Project, DivisionLayout, CatalogAddition, ProcoreCostCode } from "@/types/db";
import {
  getEstimateLineItems,
  getProjectRegistry,
  getGlobalRegistry,
  getProjectColumnDefs,
  getProjectLockedCells,
  getTemplateConfig,
  getCostCodeMap,
  getRateCard,
  getCatalogAdditions,
  getProcoreCostCodes,
} from "@/lib/db";
import { primeProcoreValidCodesFromList } from "@/lib/procoreValidCodesPrime";
import {
  primeCostCodeResolver,
  primeCostCodeResolverFromCatalog,
  resolveProcoreCode,
} from "@/lib/costCodeResolver";
import { primeRateCard, resolveCatalogPrice } from "@/lib/rateResolver";
import { getFuzzySuggestions } from "@/lib/similarity";
import { MASTER_TEMPLATE_NAME, LINKED_DIVISION_ROWS, isLinkedDivisionRow } from "@/lib/constants";
import { PersonnelCalcResult, SiteOpsCalcResult, computeLinkedDivisionTotals } from "@/lib/calculations";
import { useCommandHistory } from "./useCommandHistory";
import { useLockedCells } from "./useLockedCells";
import { useColumnDefinitions } from "./useColumnDefinitions";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import { useCommandDispatch } from "./useCommandDispatch";
import { useCellEditing } from "./useCellEditing";
import { usePasteHandler } from "./usePasteHandler";
import { useFileIngestion } from "./useFileIngestion";
import { useExportHandlers } from "./useExportHandlers";
import { useCopyHandler } from "./useCopyHandler";

// ---------------------------------------------------------------------------
// useTakeoffWorkbook — Orchestration shell
// Composes sub-hooks for cell editing, paste, file ingestion, export,
// command dispatch, column definitions, keyboard navigation, and locked cells.
// ---------------------------------------------------------------------------

export interface UseTakeoffWorkbookReturn {
  // Core data
  rows: ProcessedTakeoffRow[];
  columnDefs: ColumnDefinition[];
  lockedCells: Record<string, boolean>;
  layoutConfig: DivisionLayout[] | null;

  // TanStack table instance (AMENDMENT GAP-4)
  table: ReturnType<typeof useReactTable<ProcessedTakeoffRow>>;

  // UI state
  dragActive: boolean;
  appendData: boolean;
  setAppendData: (val: boolean) => void;
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  unmappedTakeoffClassifications: string[];
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
  isExportingExcel: boolean;
  exportError: string | null;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;
  exportBlockers: ExportBlocker[];
  pendingExportKind: "workbook" | "procore" | null;
  clearExportBlockers: () => void;
  applyProcoreOverrides: (assignments: Record<string, string>) => ProcessedTakeoffRow[];
  rowVersion: number;

  // Filter state (Phase 4)
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  columnFilters: ColumnFiltersState;

  // Handlers
  handleCellEdit: (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => void;
  commitCellEdit: (rowId: string, field: keyof ProcessedTakeoffRow, prevValue: string | number | boolean, nextValue: string | number | boolean) => void;
  handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
  commitCustomCellEdit: (rowId: string, columnId: string, prevValue: string, nextValue: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price" | "uom", table: Table<ProcessedTakeoffRow>) => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string, table: Table<ProcessedTakeoffRow>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleAddCustomColumn: () => void;
  handleDeleteColumn: (colId: string) => void;
  handleRenameColumn: (colId: string, newHeader: string) => void;
  insertManualRow: (direction: "above" | "below", targetIndex: number) => void;
  deleteRow: (rowId: string) => void;
  handleToggleCellLock: (rowId: string, columnId: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  selection: GridSelectionState;
  setSelection: React.Dispatch<React.SetStateAction<GridSelectionState>>;
  scrollToRowRef: React.MutableRefObject<((index: number) => void) | undefined>;
  handleExportExcel: () => void;
  handleExportProcore: (overrideRows?: ProcessedTakeoffRow[]) => void;
  handleExportExcelWorkbook: (overrideRows?: ProcessedTakeoffRow[]) => Promise<void>;
  handleUndo: () => void;
  handleRedo: () => void;

  // Import modal
  pendingImport: PendingImport | null;
  confirmImport: (archParams: ArchParamSuggestion[], overriddenRows?: ProcessedTakeoffRow[]) => void;
  cancelImport: () => void;
  reParseWithSheet: (sheetName: string) => Promise<void>;
}
const multiSelect = "multiSelect" as "includesString";

export function useTakeoffWorkbook(
  projectId: string,
  isLoaded: boolean,
  project: Project | null,
  // gc-siteops Phase 3: GC + Site Ops calc results, threaded to the export handlers
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult,
  // Phase 5 (INV-1): active estimator overrides, forwarded to the export handlers
  // so exported numbers match the on-screen/saved summary. `{}` = inert.
  activeOverrides: EstimateOverrideMap = {}
): UseTakeoffWorkbookReturn {
  const unitCount = project?.unitCount ?? 0;
  const squareFootage = project?.squareFootage ?? 0;

  // Core row data
  const [rows, setRowsRaw] = useState<ProcessedTakeoffRow[]>([]);
  const [rowVersion, setRowVersion] = useState(0);
  const [appendData, setAppendData] = useState(false);
  const [layoutConfig, setLayoutConfig] = useState<DivisionLayout[] | null>(null);

  // setRowsTracked — wraps setRows with a version counter bump
  // Sub-hooks use this instead of raw setRows so rowVersion increments
  // on every mutation, allowing useEstimatePersistence to use it as
  // a dependency instead of JSON.stringify(rows)
  const setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>> = React.useCallback(
    (action) => {
      setRowsRaw(action);
      setRowVersion((v) => v + 1);
    },
    []
  );

  // Registry state (project-isolated → global corporate)
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});
  const [globalRegistry, setGlobalRegistry] = useState<Record<string, string>>({});

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, rowIndex: -1, columnId: "",
  });

  // Unmapped classifications
  const [unmappedTakeoffClassifications, setUnmappedTakeoffClassifications] = useState<string[]>([]);

  // Grid Selection State
  const [selection, setSelection] = useState<GridSelectionState>({
    rowId: null,
    columnId: null,
    isEditing: false,
  });

  // Command Pattern history engine
  const commandHistory = useCommandHistory();

  // Stable refs — must be declared before hooks that consume them
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const userRegistryRef = useRef(userRegistry);
  useEffect(() => { userRegistryRef.current = userRegistry; }, [userRegistry]);
  const globalRegistryRef = useRef(globalRegistry);
  useEffect(() => { globalRegistryRef.current = globalRegistry; }, [globalRegistry]);
  const unmappedRef = useRef(unmappedTakeoffClassifications);
  useEffect(() => { unmappedRef.current = unmappedTakeoffClassifications; }, [unmappedTakeoffClassifications]);

  // --- Extracted hooks ---
  const scrollToRowRef = useRef<((index: number) => void) | undefined>(undefined);

  const {
    lockedCells, setLockedCells, handleToggleCellLock,
  } = useLockedCells(projectId, isLoaded, commandHistory);

  const {
    columnDefs, setColumnDefs,
    handleAddCustomColumn, handleDeleteColumn, handleRenameColumn,
  } = useColumnDefinitions(projectId, isLoaded, commandHistory, rowsRef);

  const { handleKeyDown, handleCustomKeyDown } = useKeyboardNavigation(rowsRef, scrollToRowRef);

  const {
    editingValues, editingCellId,
    setEditingValues, setEditingCellId,
    focusedCellRef, focusedCustomCellRef, flushEditingBufferRef,
    applyCellEditDirect,
    handleCellEdit, commitCellEdit,
    handleCustomCellEdit, commitCustomCellEdit,
  } = useCellEditing(
    projectId, rowsRef, userRegistryRef, globalRegistryRef,
    commandHistory, setRows, setUserRegistry, setGlobalRegistry,
  );

  const { handlePaste } = usePasteHandler(
    rows, userRegistry, globalRegistry, projectId,
    commandHistory, applyCellEditDirect,
    setRows, setUserRegistry, setGlobalRegistry,
  );

  useCopyHandler(
    rows,
    selection,
    project?.squareFootage || 0,
    project?.unitCount || 0,
  );

  const {
    dragActive,
    pendingImport,
    handleFileUpload, handleDrag, handleDrop,
    confirmImport, cancelImport, reParseWithSheet,
  } = useFileIngestion(
    projectId, rowsRef, unmappedRef,
    userRegistry, globalRegistry, appendData,
    setUserRegistry, userRegistryRef,
    commandHistory, setRows, setUnmappedTakeoffClassifications,
  );

  const {
    isExportingExcel, exportError, setExportError,
    exportBlockers, pendingExportKind, clearExportBlockers,
    handleExportExcel, handleExportProcore, handleExportExcelWorkbook,
  } = useExportHandlers(rows, columnDefs, project, projectId, gcCalcResult, siteOpsCalcResult, activeOverrides);

  // ---------------------------------------------------------------------------
  // Export override — assign granular Procore codes to blocker rows.
  // One PASTE command = one atomic undo unit (AGENTS.md history preservation).
  // In-memory for Phase 2; procore_code persistence lands with the Phase 3
  // schema column. Returns the updated rows so the caller can retry the
  // export immediately without waiting for a re-render.
  // ---------------------------------------------------------------------------
  const applyProcoreOverrides = (assignments: Record<string, string>): ProcessedTakeoffRow[] => {
    const edits: PasteCommand["edits"] = [];
    for (const [rowId, assigned] of Object.entries(assignments)) {
      const code = (assigned || "").trim();
      if (!code) continue;
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.procoreCode === code) continue;
      edits.push({
        rowId,
        field: "procoreCode",
        prevFields: { procoreCode: row.procoreCode },
        nextFields: { procoreCode: code },
      });
    }
    if (edits.length === 0) return rows;

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({ type: "PASTE", edits });

    const updated = rows.map((r) => {
      const code = (assignments[r.id] || "").trim();
      return code && code !== r.procoreCode ? { ...r, procoreCode: code } : r;
    });
    setRows(updated);
    return updated;
  };

  const {
    handleUndo, handleRedo,
  } = useCommandDispatch(
    commandHistory, projectId,
    setRows, setUserRegistry, setGlobalRegistry,
    setColumnDefs, setLockedCells, setUnmappedTakeoffClassifications,
    globalRegistry,
  );

  // ---------------------------------------------------------------------------
  // Context menu outside-click dismiss
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [contextMenu.visible]);

  // ---------------------------------------------------------------------------
  // Initialize default rows
  // ---------------------------------------------------------------------------
  const initializeDefaultEstimateRows = (): ProcessedTakeoffRow[] => {
    const catalog = getCatalogItems();
    const sortedKeys = Object.keys(catalog).sort();
    return sortedKeys.map((key) => {
      const item = catalog[key];
      return {
        id: `row-${item.itemId}`,
        classification: "",
        itemId: item.itemId,
        procoreParentCode: item.procoreParentCode,
        // Single chokepoint: cost_code_map (primed at mount), never the catalog
        procoreCode: resolveProcoreCode(item.itemId),
        description: item.description,
        matchedQty: 0,
        uom: item.targetUom,
        // Company-default layer: card rate on a hit, else the catalog default
        // (resolver primed at mount). Day-one byte-identical; Phase C edits flow
        // into new rows only — the price freezes on the row once saved.
        unitPrice: resolveCatalogPrice(item.itemId, item.defaultUnitPrice),
        total: 0,
        isMapped: true,
        rawQuantities: [],
        costType: item.costType,
        customFields: {},
        source: 'template' as const,
      };
    });
  };

  // ---------------------------------------------------------------------------
  // Load estimate + registries + columns + locks on mount (async Supabase)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    (async () => {
      try {
        // Load all data sources in parallel. Catalog additions are FAIL-SOFT
        // (`.catch(() => [])`) so an additions outage degrades to built-ins only
        // and never rejects the whole mount batch.
        const [savedLineItems, savedRegistry, savedGlobalReg, savedColDefs, savedLocks, savedTemplateConfig, savedCostCodeMap, savedRateCard, savedCatalogAdditions, savedProcoreCodes] =
          await Promise.all([
            getEstimateLineItems(projectId),
            getProjectRegistry(projectId),
            getGlobalRegistry(),
            getProjectColumnDefs(projectId),
            getProjectLockedCells(projectId),
            getTemplateConfig(MASTER_TEMPLATE_NAME),
            getCostCodeMap(MASTER_TEMPLATE_NAME),
            getRateCard(MASTER_TEMPLATE_NAME),
            getCatalogAdditions().catch(() => [] as CatalogAddition[]),
            getProcoreCostCodes().catch(() => [] as ProcoreCostCode[]),
          ]);

        if (cancelled) return;

        // Phase 4: prime the Procore validation oracle from the live master list
        // (its ACTIVE rows) so the export gate / ExportOverrideModal validate
        // against DB-active codes. Fail-soft — an empty/failed load keeps the
        // JSON baseline (a superset, so it never blocks a legitimate code).
        primeProcoreValidCodesFromList(savedProcoreCodes);

        // Prime the STEP 4 catalog-additions overlay BEFORE any row init AND
        // before the cost-code/rate primes below (the degraded
        // primeCostCodeResolverFromCatalog path reads getCatalogItems(), which
        // must already include additions). Additions are self-contained — they
        // carry their own procore_code + default_unit_price — so the catalog item
        // overlay + BOTH resolvers carry them; cost_code_map / rate_card untouched.
        // An empty list is a no-op identity (nothing primed).
        primeCatalogAdditionOverlays(savedCatalogAdditions);

        // Prime the company-default rate chokepoint (Rate-card Phase B). On an
        // EMPTY result (unseeded DB / template-name mismatch) leave it unprimed:
        // resolveCompanyRate then returns the injected constants fallback, so
        // calc stays byte-identical — no degraded path needed (unlike cost codes,
        // the fallback IS the safe default).
        if (savedRateCard.length > 0) {
          primeRateCard(savedRateCard);
        }

        // Prime the procoreCode chokepoint BEFORE any row initialization —
        // every row-creation path (template init, parser, itemId cascade)
        // resolves through cost_code_map, never the static catalog. An EMPTY
        // result (unseeded DB / template-name mismatch) gets the same degraded
        // catalog fallback as a failed fetch — otherwise every row would
        // resolve to "" and the whole estimate would become an export blocker.
        if (savedCostCodeMap.length > 0) {
          primeCostCodeResolver(savedCostCodeMap);
        } else {
          primeCostCodeResolverFromCatalog();
        }

        // Apply registries
        setUserRegistry(savedRegistry);
        setGlobalRegistry(savedGlobalReg);
        if (savedTemplateConfig) {
          // EstimateTable consumes the division ranges/labels only
          setLayoutConfig(savedTemplateConfig.configData.divisions);
        }

        // Apply line items — honor sort_order from DB
        if (savedLineItems.length > 0) {
          // Automatically merge any newly harvested master cost codes
          const masterItems = initializeDefaultEstimateRows();
          const merged = [...savedLineItems];

          masterItems.forEach((masterItem) => {
            const exists = savedLineItems.some(
              (savedItem) => savedItem.itemId === masterItem.itemId
            );
            if (!exists) {
              // Append new master codes to TAIL — do NOT re-sort
              merged.push(masterItem);
            }
          });

          // Normalize standard row IDs — ensure uniqueness for rows sharing an itemId
          const seenIds = new Map<string, number>();
          merged.forEach((row) => {
            if (row.itemId && row.id && row.id.startsWith("row-")) {
              const baseId = `row-${row.itemId}`;
              const count = (seenIds.get(baseId) || 0) + 1;
              seenIds.set(baseId, count);
              row.id = count === 1 ? baseId : `${baseId}-${count}`;
            }
          });

          // DO NOT sort — honor sort_order from DB to preserve manual row positions
          setRows(merged);
        } else {
          // First initialization — sort by itemId for clean divisional ordering
          const defaultRows = initializeDefaultEstimateRows();
          setRows(defaultRows);
        }

        // Apply column definitions
        if (savedColDefs) {
          const normalizeColumnDefs = (loaded: ColumnDefinition[]): ColumnDefinition[] => {
            const merged = [...loaded].filter((col, idx, self) => self.findIndex(c => c.id === col.id) === idx);
            const actIdx = merged.findIndex(c => c.id === "actions");
            if (actIdx === -1) {
              merged.unshift({ id: "actions", header: "", type: "default" });
            } else if (actIdx > 0) {
              const [col] = merged.splice(actIdx, 1);
              merged.unshift(col);
            }
            const valIdx = merged.findIndex(c => c.id === "validationStatus");
            if (valIdx === -1) {
              merged.splice(1, 0, { id: "validationStatus", header: "", type: "default" });
            } else if (valIdx !== 1) {
              const [col] = merged.splice(valIdx, 1);
              merged.splice(1, 0, col);
            }
            if (!merged.some(c => c.id === "notes")) {
              const totIdx = merged.findIndex(c => c.id === "total");
              if (totIdx !== -1) {
                merged.splice(totIdx + 1, 0, { id: "notes", header: "", type: "default" });
              } else {
                merged.push({ id: "notes", header: "", type: "default" });
              }
            }
            return merged;
          };
          setColumnDefs(normalizeColumnDefs(savedColDefs));
        }

        // Apply cell locks
        setLockedCells(savedLocks);
      } catch (err) {
        console.error('Failed to load workbook data:', err);
        if (!cancelled) {
          // Graceful degradation: initialize with defaults. Prime the resolver
          // from the catalog so default rows carry the same procoreCodes they
          // did pre-3c (cost_code_map is unreachable on this path anyway).
          primeCostCodeResolverFromCatalog();
          const defaultRows = initializeDefaultEstimateRows();
          setRows(defaultRows);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, setColumnDefs, setLockedCells, setRows]);

  // ---------------------------------------------------------------------------
  // Re-prime the procoreCode resolver when the tab becomes visible again —
  // covers mappings edited in /cost-codes in ANOTHER tab while this workspace
  // stayed mounted. (Same-tab navigation remounts this hook and re-primes.)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // No cancellation guard needed: priming only mutates the module-level
      // resolver cache (no React state), and a post-unmount prime is harmless.
      getCostCodeMap(MASTER_TEMPLATE_NAME)
        .then((entries) => {
          if (entries.length > 0) primeCostCodeResolver(entries);
        })
        .catch(() => {}); // keep the existing prime on transient failure
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ---------------------------------------------------------------------------
  // Re-prime the company rate card when the tab becomes visible again — covers
  // rates edited in /rates (Phase C) in ANOTHER tab while this workspace stayed
  // mounted. Mirrors the cost-code resolver re-prime above. A project that has
  // frozen its snapshot is unaffected (the frozen snapshot wins in the calc
  // hooks); only un-frozen new drafts see the refreshed live card.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      getRateCard(MASTER_TEMPLATE_NAME)
        .then((entries) => {
          if (entries.length > 0) primeRateCard(entries);
        })
        .catch(() => {}); // keep the existing prime on transient failure
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ---------------------------------------------------------------------------
  // Insert manual row
  // ---------------------------------------------------------------------------
  const insertManualRow = (direction: "above" | "below", targetIndex: number) => {
    const newRow: ProcessedTakeoffRow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      classification: "MANUAL ENTRY",
      itemId: "",
      procoreParentCode: "",
      procoreCode: "",
      description: "",
      matchedQty: 0,
      uom: "SF",
      unitPrice: 0,
      total: 0,
      isMapped: false,
      rawQuantities: [],
      costType: "M",
      customFields: {},
      source: 'manual' as const,
    };
    const insertIdx = direction === "above" ? targetIndex : targetIndex + 1;

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "INSERT_ROW",
      rowId: newRow.id,
      insertIndex: insertIdx,
      rowData: { ...newRow },
    });

    const updated = [...rows];
    updated.splice(insertIdx, 0, newRow);
    setRows(updated);
  };

  // ---------------------------------------------------------------------------
  // Linked division rows (gc-siteops Phase 5) — the 10 STEP 4 rows the template
  // links to STEP 2/3 subtotals. Display-only: each shows its live linked value
  // (qty 1) and is read-only while clean. A row carrying stray typed dollars
  // (legacy data / itemId edits) stays editable so the estimator can clear it;
  // its dollars count NOWHERE (trap closure) and the banner surfaces it.
  // ---------------------------------------------------------------------------
  const linkedTotalByItemId = useMemo(() => {
    const map = new Map<string, { total: number; sourceLabel: string }>();
    const labels = new Map(LINKED_DIVISION_ROWS.map((c) => [c.itemId, c.sourceLabel]));
    for (const l of computeLinkedDivisionTotals(gcCalcResult, siteOpsCalcResult)) {
      map.set(l.itemId, { total: l.total, sourceLabel: labels.get(l.itemId) || "" });
    }
    return map;
  }, [gcCalcResult, siteOpsCalcResult]);

  /** null for normal rows; linked-row display state otherwise. */
  const getLinkedRowState = (row: ProcessedTakeoffRow) => {
    if (!isLinkedDivisionRow(row.itemId)) return null;
    // IMPORTED projects (finding G-2): the saved linked row carries the bid's
    // authoritative GC/Site-Ops lump sum (its stored qty×unitPrice), not a stray
    // typed value — show that as the linked value and keep the row read-only so
    // the displayed total ties the reopened import.
    if (project?.isImported) {
      const cfg = LINKED_DIVISION_ROWS.find((c) => c.itemId === (row.itemId || "").trim());
      return {
        value: row.matchedQty * row.unitPrice,
        sourceLabel: cfg?.sourceLabel ?? "",
        stray: false,
      };
    }
    const entry = linkedTotalByItemId.get((row.itemId || "").trim());
    return {
      value: entry?.total ?? 0,
      sourceLabel: entry?.sourceLabel ?? "",
      stray: row.matchedQty * row.unitPrice !== 0,
    };
  };

  // ---------------------------------------------------------------------------
  // Delete row — GAP-2: uses rowId (not index) for virtualization/sort safety
  // ---------------------------------------------------------------------------
  const deleteRow = (rowId: string) => {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;
    // Linked division rows are structural (fed by Steps 2/3) — never deletable
    if (isLinkedDivisionRow(rows[idx].itemId)) return;

    // Deep-clone row data for undo restoration (GAP-3)
    const rowData: ProcessedTakeoffRow = {
      ...rows[idx],
      rawQuantities: rows[idx].rawQuantities.map((rq) => ({ ...rq })),
      customFields: { ...(rows[idx].customFields || {}) },
    };

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "DELETE_ROW",
      rowId,
      deletedIndex: idx,
      rowData,
    });

    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // ---------------------------------------------------------------------------
  // TanStack table columns — maps columnDefs to TanStack ColumnDef instances
  // ---------------------------------------------------------------------------
  const columnHelper = createColumnHelper<ProcessedTakeoffRow>();

  // Default pixel widths for built-in columns. ColumnDefinition.size overrides these.
  const DEFAULT_COLUMN_SIZES: Record<string, { size: number; minSize: number; maxSize?: number }> = {
    actions:          { size: 40,  minSize: 40,  maxSize: 40  },
    validationStatus: { size: 45,  minSize: 45,  maxSize: 45  },
    costType:    { size: 110, minSize: 30 },
    itemId:      { size: 220, minSize: 30 },
    description: { size: 600, minSize: 30 },
    matchedQty:  { size: 180, minSize: 30 },
    uom:         { size: 110, minSize: 30 },
    unitPrice:   { size: 180, minSize: 30 },
    total:       { size: 200, minSize: 30 },
    notes:            { size: 55,  minSize: 55,  maxSize: 55  },
    costPerUnit: { size: 180, minSize: 30 },
    costPerSf:   { size: 180, minSize: 30 },
  };

  /** Resolve column size from ColumnDefinition overrides or DEFAULT_COLUMN_SIZES. */
  const getSizeConfig = (def: ColumnDefinition) => {
    if (def.size != null) {
      return { size: def.size, minSize: def.minSize ?? 50, maxSize: def.maxSize };
    }
    return DEFAULT_COLUMN_SIZES[def.id] ?? { size: 150, minSize: 50 };
  };

  const columns = useMemo(() => {
    return columnDefs.map((def) => {
      if (def.type === "custom") {
        // Custom Column
        return columnHelper.accessor((row) => row.customFields?.[def.id] ?? "", {
          id: def.id,
          header: def.header,
          ...getSizeConfig(def),
          filterFn: multiSelect,
          cell: (info) => {
            const index = info.row.index;
            const row = info.row.original;
            const meta = info.table.options.meta!;
            const isCellHardLocked = !!meta.lockedCells[`${row.id}::${def.id}`];
            const val = row.customFields?.[def.id] ?? "";

            const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === def.id;
            const isEditing = isSelected && meta.selection.isEditing;

            if (isEditing) {
              return (
                <StringCellInput
                  id={`custom-${def.id}-input-${index}`}
                  value={String(val)}
                  disabled={isCellHardLocked}
                  className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-sans text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : "text-slate-900 dark:text-slate-100 font-medium"
                  }`}
                  onCommit={(newVal) => {
                    handleCustomCellEdit(index, def.id, newVal);
                    commitCustomCellEdit(row.id, def.id, String(val), newVal);
                  }}
                  onKeyDown={(e) => handleCustomKeyDown(e, index, def.id, info.table)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: def.id });
                  }}
                  initialEditChar={meta.selection.initialEditChar}
                />
              );
            }

            return (
              <div
                id={`cell-${row.id}-${def.id}`}
                className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center text-left font-sans text-xs transition-all outline-none focus:outline-none ${
                  isCellHardLocked
                    ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                    : isSelected
                    ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative font-medium text-slate-900 dark:text-slate-100"
                    : "text-slate-900 dark:text-slate-100 font-medium"
                }`}
                onClick={() => {
                  if (!isCellHardLocked) {
                    if (isSelected) {
                      meta.setSelection({ rowId: row.id, columnId: def.id, isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: def.id, isEditing: false });
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  meta.setSelection({ rowId: row.id, columnId: def.id, isEditing: false });
                  meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: def.id });
                }}
              >
                {val || <span className="text-slate-400 dark:text-slate-600">...</span>}
              </div>
            );
          },
        });
      }

      switch (def.id) {
        case "actions":
          return columnHelper.display({
            id: "actions",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              // Linked division rows are structural — no delete affordance
              if (isLinkedDivisionRow(row.itemId)) return null;
              return (
                <div className="flex items-center justify-center h-full w-full">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Delete this row? This action can be undone with Ctrl+Z.")) {
                        meta.deleteRow(row.id);
                      }
                    }}
                    title="Delete Row"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          });
        case "validationStatus":
          return columnHelper.accessor("isMapped", {
            id: "validationStatus",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const hasLockedCell = Object.keys(meta.lockedCells).some(
                (key) => key.startsWith(`${row.id}::`) && meta.lockedCells[key]
              );
              
              return (
                <div className="flex items-center justify-center h-full w-full">
                  {hasLockedCell ? (
                    <span className="text-blue-500 text-xs select-none" title="Row contains locked values">🔒</span>
                  ) : !row.isMapped ? (
                    <span className="text-amber-500 text-xs select-none animate-pulse" title="Item not mapped to corporate registry">⚠️</span>
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" title="Verified & Mapped" />
                  )}
                </div>
              );
            },
          });
        case "notes":
          return columnHelper.display({
            id: "notes",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const noteText = String(row.customFields?.notes || "");
              return (
                <div className="flex items-center justify-center h-full w-full">
                  <button
                    className={`p-1.5 rounded transition-all duration-200 ${
                      noteText
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                        : "text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentVal = String(row.customFields?.notes || "");
                      const newVal = window.prompt("Edit Estimator Notes:", currentVal);
                      if (newVal !== null && newVal !== currentVal) {
                        meta.handleCustomCellEdit(info.row.index, "notes", newVal);
                        meta.commitCustomCellEdit(row.id, "notes", currentVal, newVal);
                      }
                    }}
                    title={noteText ? `Notes: ${noteText}` : "Add Notes"}
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          });
        case "costType":
          return columnHelper.accessor("costType", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => (
              <div className="text-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {info.getValue()}
              </div>
            ),
          });
        case "itemId": {
          return columnHelper.accessor("itemId", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const linked = getLinkedRowState(row);
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::itemId`] || (!!linked && !linked.stray);
              const suggestions = getFuzzySuggestions(row.classification, getCatalogItems());

              const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === "itemId";
              const isEditing = isSelected && meta.selection.isEditing;

              if (isEditing) {
                return (
                  <div className="flex items-center gap-2 relative w-full h-full">
                    <StringCellInput
                      id={`code-input-${index}`}
                      value={row.itemId}
                      disabled={isCellHardLocked}
                      className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                        isCellHardLocked
                          ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                          : !row.isMapped && row.classification
                          ? "text-amber-600 dark:text-amber-400 font-bold"
                          : "text-slate-900 dark:text-white font-bold"
                      }`}
                      onCommit={(newVal) => {
                        meta.handleCellEdit(index, "itemId", newVal);
                        meta.commitCellEdit(row.id, "itemId" as keyof ProcessedTakeoffRow, row.itemId, newVal);
                      }}
                      onKeyDown={(e) => meta.handleKeyDown(e, index, "code", info.table)}
                      onPaste={(e) => meta.handlePaste(e, index, "code")}
                      list={!row.isMapped && row.classification ? `suggestions-${index}` : undefined}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "itemId" });
                      }}
                      initialEditChar={meta.selection.initialEditChar}
                    />
                    {!row.isMapped && row.classification && suggestions.length > 0 && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1 z-20">
                        {suggestions.slice(0, 2).map((s) => (
                          <button
                            key={s.itemId}
                            className="text-[10px] bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60 text-blue-700 dark:text-blue-300 transition-colors"
                            onClick={() => {
                              meta.handleCellEdit(index, "itemId", s.itemId);
                              meta.commitCellEdit(row.id, "itemId", row.itemId, s.itemId);
                            }}
                            title={`${s.itemId}: ${s.description}`}
                          >
                            {s.itemId}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  id={`cell-${row.id}-itemId`}
                  className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-between gap-2 font-mono text-xs transition-all outline-none focus:outline-none ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : isSelected
                      ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative font-bold text-slate-900 dark:text-white"
                      : !row.isMapped && row.classification
                      ? "text-amber-600 dark:text-amber-400 font-bold"
                      : "text-slate-900 dark:text-white font-bold"
                  }`}
                  onClick={() => {
                    if (isSelected && !isCellHardLocked) {
                      meta.setSelection({ rowId: row.id, columnId: "itemId", isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: "itemId", isEditing: false });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    meta.setSelection({ rowId: row.id, columnId: "itemId", isEditing: false });
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "itemId" });
                  }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <RowProvenanceGlyph row={row} />
                    <span className="truncate">{row.itemId || <span className="text-slate-400 dark:text-slate-600">...</span>}</span>
                  </span>
                  {!row.isMapped && row.classification && suggestions.length > 0 && (isSelected || isCellHardLocked) && (
                    <div className="flex gap-1 shrink-0">
                      {suggestions.slice(0, 2).map((s) => (
                        <button
                          key={s.itemId}
                          className="text-[10px] bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60 text-blue-700 dark:text-blue-300 transition-colors z-20"
                          onClick={(e) => {
                            e.stopPropagation();
                            meta.handleCellEdit(index, "itemId", s.itemId);
                            meta.commitCellEdit(row.id, "itemId", row.itemId, s.itemId);
                          }}
                          title={`${s.itemId}: ${s.description}`}
                        >
                          {s.itemId}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            },
          });
        }
        case "description":
          return columnHelper.accessor("description", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const linked = getLinkedRowState(row);
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::description`] || (!!linked && !linked.stray);

              const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === "description";
              const isEditing = isSelected && meta.selection.isEditing;


              if (isEditing) {
                return (
                  <StringCellInput
                    id={`desc-input-${index}`}
                    value={row.description}
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none outline-none text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-slate-100 font-medium"
                    }`}
                    onCommit={(newVal) => {
                      meta.handleCellEdit(index, "description", newVal);
                      meta.commitCellEdit(row.id, "description" as keyof ProcessedTakeoffRow, row.description, newVal);
                    }}
                    onKeyDown={(e) => meta.handleKeyDown(e, index, "desc", info.table)}
                    onPaste={(e) => meta.handlePaste(e, index, "desc")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "description" });
                    }}
                    initialEditChar={meta.selection.initialEditChar}
                  />
                );
              }

              return (
                <div
                  id={`cell-${row.id}-description`}
                  className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center text-left font-sans text-xs transition-all outline-none focus:outline-none ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : isSelected
                      ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative font-medium text-slate-900 dark:text-slate-100"
                      : "text-slate-900 dark:text-slate-100 font-medium"
                  }`}
                  onClick={() => {
                    if (isSelected && !isCellHardLocked) {
                      meta.setSelection({ rowId: row.id, columnId: "description", isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: "description", isEditing: false });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    meta.setSelection({ rowId: row.id, columnId: "description", isEditing: false });
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "description" });
                  }}
                >
                  <span className="truncate">{row.description || <span className="text-slate-400 dark:text-slate-600">...</span>}</span>
                  {linked && !linked.stray && (
                    <span
                      className="ml-2 shrink-0 text-[10px] text-blue-500 dark:text-blue-400 font-bold uppercase tracking-wider select-none"
                      title={`Read-only — linked live from ${linked.sourceLabel}`}
                    >
                      🔗 {linked.sourceLabel}
                    </span>
                  )}
                </div>
              );
            },
          });
        case "matchedQty": {
          return columnHelper.accessor("matchedQty", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const linked = getLinkedRowState(row);
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::matchedQty`] || (!!linked && !linked.stray);

              const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === "matchedQty";
              const isEditing = isSelected && meta.selection.isEditing;

              if (isEditing) {
                return (
                  <NumberCellInput
                    id={`qty-input-${index}`}
                    value={row.matchedQty}
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-white"
                    }`}
                    onCommit={(numVal) => {
                      meta.handleCellEdit(index, "matchedQty", numVal);
                      meta.commitCellEdit(row.id, "matchedQty" as keyof ProcessedTakeoffRow, row.matchedQty, numVal);
                    }}
                    onKeyDown={(e) => meta.handleKeyDown(e, index, "qty", info.table)}
                    onPaste={(e) => meta.handlePaste(e, index, "qty")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "matchedQty" });
                    }}
                    initialEditChar={meta.selection.initialEditChar}
                  />
                );
              }

              return (
                <div
                  id={`cell-${row.id}-matchedQty`}
                  className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-center text-center font-bold font-mono text-xs transition-all outline-none focus:outline-none ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : isSelected
                      ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative text-slate-900 dark:text-white"
                      : "text-slate-900 dark:text-white"
                  }`}
                  onClick={() => {
                    if (isSelected && !isCellHardLocked) {
                      meta.setSelection({ rowId: row.id, columnId: "matchedQty", isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: "matchedQty", isEditing: false });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    meta.setSelection({ rowId: row.id, columnId: "matchedQty", isEditing: false });
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "matchedQty" });
                  }}
                >
                  {(linked && !linked.stray ? 1 : row.matchedQty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              );
            },
          });
        }
        case "uom":
          return columnHelper.accessor("uom", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const linked = getLinkedRowState(row);
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::uom`] || (!!linked && !linked.stray);

              const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === "uom";
              const isEditing = isSelected && meta.selection.isEditing;

              if (isEditing) {
                const prevUom = row.uom;
                return (
                  <SelectCellInput
                    id={`uom-select-${index}`}
                    value={row.uom}
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-1 py-1 bg-transparent border-none rounded-none text-center font-bold uppercase font-mono text-xs outline-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 cursor-pointer appearance-none ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-white"
                    }`}
                    onCommit={(newUom) => {
                      meta.handleCellEdit(index, "uom", newUom);
                      meta.commitCellEdit(row.id, "uom" as keyof ProcessedTakeoffRow, prevUom, newUom);
                      meta.setSelection({ rowId: row.id, columnId: "uom", isEditing: false });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" || e.key === "Tab" || e.key === "Enter") {
                        meta.setSelection({ rowId: row.id, columnId: "uom", isEditing: false });
                      }
                      meta.handleKeyDown(e as unknown as React.KeyboardEvent<HTMLInputElement>, index, "uom", info.table);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "uom" });
                    }}
                  />
                );
              }

              return (
                <div
                  id={`cell-${row.id}-uom`}
                  className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-center text-center font-bold uppercase font-mono text-xs transition-all outline-none focus:outline-none ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : isSelected
                      ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative text-slate-900 dark:text-white"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                  onClick={() => {
                    if (isSelected && !isCellHardLocked) {
                      meta.setSelection({ rowId: row.id, columnId: "uom", isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: "uom", isEditing: false });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    meta.setSelection({ rowId: row.id, columnId: "uom", isEditing: false });
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "uom" });
                  }}
                >
                  {row.uom}
                </div>
              );
            },
          });
        case "unitPrice": {
          return columnHelper.accessor("unitPrice", {
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const linked = getLinkedRowState(row);
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::unitPrice`] || (!!linked && !linked.stray);

              const isSelected = meta.selection.rowId === row.id && meta.selection.columnId === "unitPrice";
              const isEditing = isSelected && meta.selection.isEditing;

              if (isEditing) {
                return (
                  <NumberCellInput
                    id={`price-input-${index}`}
                    value={row.unitPrice}
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-white"
                    }`}
                    onCommit={(numVal) => {
                      meta.handleCellEdit(index, "unitPrice", numVal);
                      meta.commitCellEdit(row.id, "unitPrice" as keyof ProcessedTakeoffRow, row.unitPrice, numVal);
                    }}
                    onKeyDown={(e) => meta.handleKeyDown(e, index, "price", info.table)}
                    onPaste={(e) => meta.handlePaste(e, index, "price")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "unitPrice" });
                    }}
                    initialEditChar={meta.selection.initialEditChar}
                  />
                );
              }

              return (
                <div
                  id={`cell-${row.id}-unitPrice`}
                  className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-center text-center font-bold font-mono text-xs transition-all outline-none focus:outline-none ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : isSelected
                      ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative text-slate-900 dark:text-white"
                      : "text-slate-900 dark:text-white"
                  }`}
                  onClick={() => {
                    if (isSelected && !isCellHardLocked) {
                      meta.setSelection({ rowId: row.id, columnId: "unitPrice", isEditing: true });
                    } else {
                      meta.setSelection({ rowId: row.id, columnId: "unitPrice", isEditing: false });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    meta.setSelection({ rowId: row.id, columnId: "unitPrice", isEditing: false });
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "unitPrice" });
                  }}
                >
                  ${(linked && !linked.stray ? linked.value : row.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              );
            },
          });
        }
        case "total":
          return columnHelper.accessor((row) => {
            // Linked division rows: total = live linked value; a stray row's
            // typed dollars count nowhere (Phase 5 trap closure) so show $0.
            const linked = getLinkedRowState(row);
            return linked ? (linked.stray ? 0 : linked.value) : row.total;
          }, {
            id: "total",
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => (
              <div className="text-center font-black font-mono">
                <span className={info.getValue() > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}>
                  ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ),
          });
        case "costPerUnit":
          return columnHelper.accessor((row) => {
            const linked = getLinkedRowState(row);
            const total = linked ? (linked.stray ? 0 : linked.value) : row.total;
            return unitCount > 0 ? total / unitCount : 0;
          }, {
            id: "costPerUnit",
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => (
              <div className="text-center font-bold font-mono text-slate-600 dark:text-slate-300">
                ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ),
          });
        case "costPerSf":
          return columnHelper.accessor((row) => {
            const linked = getLinkedRowState(row);
            const total = linked ? (linked.stray ? 0 : linked.value) : row.total;
            return squareFootage > 0 ? total / squareFootage : 0;
          }, {
            id: "costPerSf",
            header: def.header,
            ...getSizeConfig(def),
            filterFn: multiSelect,
            cell: (info) => (
              <div className="text-center font-bold font-mono text-slate-600 dark:text-slate-300">
                ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ),
          });
        default:
          return columnHelper.display({ id: def.id, header: def.header, ...getSizeConfig(def), cell: () => null });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefs, unitCount, squareFootage, handleCustomCellEdit, commitCustomCellEdit, linkedTotalByItemId]); // selection intentionally excluded — cell renderers read meta.selection during parent re-render

  // Filter state (Phase 4)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Instantiate TanStack table with filter pipeline
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters, globalFilter },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    columnResizeMode: "onChange",
    columnResizeDirection: "ltr",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    filterFns: {
      multiSelect: (row, columnId, filterValue) => {
        if (!filterValue || filterValue.length === 0) return true;
        const val = row.getValue(columnId);
        return filterValue.includes(String(val));
      },
    },
    meta: {
      editingCellId,
      editingValues,
      setEditingCellId,
      setEditingValues,
      flushEditingBufferRef,
      focusedCellRef,
      focusedCustomCellRef,
      lockedCells,
      handleCellEdit,
      commitCellEdit,
      handleKeyDown,
      handleCustomKeyDown,
      handlePaste,
      setContextMenu,
      deleteRow,
      insertManualRow,
      handleCustomCellEdit,
      commitCustomCellEdit,
      selection,
      setSelection,
    },
  });

  return {
    rows,
    columnDefs,
    lockedCells,
    layoutConfig,
    table,
    dragActive,
    appendData,
    setAppendData,
    contextMenu,
    setContextMenu,
    unmappedTakeoffClassifications,
    canUndo: commandHistory.canUndo,
    canRedo: commandHistory.canRedo,
    undoStackSize: commandHistory.undoStackSize,
    redoStackSize: commandHistory.redoStackSize,
    isExportingExcel,
    exportError,
    setExportError,
    exportBlockers,
    pendingExportKind,
    clearExportBlockers,
    applyProcoreOverrides,
    rowVersion,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    handleCellEdit,
    commitCellEdit,
    handleCustomCellEdit,
    commitCustomCellEdit,
    handleKeyDown,
    handleCustomKeyDown,
    handlePaste,
    handleAddCustomColumn,
    handleDeleteColumn,
    handleRenameColumn,
    insertManualRow,
    deleteRow,
    handleToggleCellLock,
    handleFileUpload,
    handleDrag,
    handleDrop,
    pendingImport,
    confirmImport,
    cancelImport,
    reParseWithSheet,
    selection,
    setSelection,
    scrollToRowRef,
    handleExportExcel,
    handleExportProcore,
    handleExportExcelWorkbook,
    handleUndo,
    handleRedo,
  };
}
