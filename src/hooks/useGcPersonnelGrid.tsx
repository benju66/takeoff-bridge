"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { EngineLinkBadge } from "@/components/workspace/EngineLinkBadge";
import { OneOffCodeCell } from "@/components/workspace/OneOffCodeCell";
import { ColumnDefinition } from "@/types";
import type { EstimateSectionLine } from "@/types/db";
import type { OverridePayload } from "@/lib/overrideSetter";
import { isOneOffLine } from "@/lib/sectionLines/oneOff";
import type { UsePersonnelCalculationsReturn } from "./usePersonnelCalculations";
import {
  useSectionLineGrid,
  fmtSectionUSD as fmtUSD,
  type SectionColumnContext,
  type SectionColumnDefs,
  type UseSectionLineGridReturn,
} from "./useSectionLineGrid";
import { ENTRY_KIND } from "@/lib/sectionLines/entryKinds";
import { gcLeafNodeId } from "@/lib/bindings/types";
import {
  GC_CATALOG_LINES,
  GC_ROW_META,
  buildCalcLookup,
  entryValue,
  fmtQty,
  gcGroupKey,
  gcGroupLabel,
  gcIsDerivedQtyLine,
  gcRowUnit,
  num,
  resolveEntryTarget,
  resolveRoleKey,
} from "@/lib/sectionLines/gcGridModel";

// (derived-quantity cell rendering is centralized in the core's `renderDerivedQtyCell`)

// ---------------------------------------------------------------------------
// useGcPersonnelGrid — Step 2 (GC Personnel) grid spec (B2; B3 onto the core)
//
// A thin specialization of the shared useSectionLineGrid core: it supplies ONLY the
// GC-specific pieces — the display-ordered GC section lines (01.A–01.F), the calc-by-
// code lookup, the `applyEdit` setter dispatch, the GC column definitions, and the
// section grouping. The core owns every section-agnostic mechanic.
//
// Columns match the company estimate template's STEP 2 sheet (row 9 headers):
//   Code · Description · Utilization · Quantity · Unit · Rate · Total · Cost/S.F.
// Total = Quantity × Rate; Cost/S.F. = Total ÷ Building Sqft. Per kind:
//   - staff      : Utilization editable (→ hours); Quantity DERIVED (locked, overridable);
//                  Rate editable ($/hr override).
//   - operational: Quantity DERIVED (locked, overridable); Rate = card rate (read-only).
//   - equipment  : Quantity 1; the lump amount is the editable Rate.
//   - manual qty : Quantity editable (typed); Rate = card rate (read-only).
//   - manual lump: Quantity 1; the lump amount is the editable Rate.
// ---------------------------------------------------------------------------

const STEP2_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "code", header: "Code", type: "default", size: 110 },
  { id: "description", header: "Description", type: "default", size: 300 },
  { id: "utilization", header: "Utilization", type: "default", size: 110 },
  { id: "quantity", header: "Quantity", type: "default", size: 130 },
  { id: "unit", header: "Unit", type: "default", size: 64 },
  { id: "rate", header: "Rate", type: "default", size: 120 },
  { id: "total", header: "Total", type: "default", size: 140 },
  { id: "costPerSf", header: "Cost/S.F.", type: "default", size: 110 },
];

const STEP2_EDITABLE_COLUMN_IDS = ["utilization", "quantity", "rate", "total"] as const;
const STEP2_CENTER_ALIGNED_COLUMN_IDS = ["code", "utilization", "quantity", "unit", "rate", "total", "costPerSf"] as const;

const columnHelper = createColumnHelper<EstimateSectionLine>();

// Cast the custom filter-fn key to a built-in name so column defs typecheck (the
// same shim useTakeoffWorkbook uses); resolved at runtime by the core's `filterFns`.
const multiSelect = "multiSelect" as "includesString";

/** Builds the GC (Step 2) columns using the shared cell helpers + commit fns. */
function buildGcColumns(ctx: SectionColumnContext): SectionColumnDefs {
  const {
    renderNumberCell, renderDisplayCell, commitInputEdit, commitFieldOverride,
    renderDerivedQtyCell, calcLookupRef, canOverride, squareFootageRef, requestAssign,
  } = ctx;

  return [
    columnHelper.accessor((l) => l.code, {
      id: "code", header: "Code", size: 110, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        // One-off lines (B5 / D1) carry no template code — their Code cell is the
        // assign-and-place affordance (resolve a valid Procore code before export).
        if (isOneOffLine(line)) {
          return renderDisplayCell(
            info,
            <OneOffCodeCell line={line} onRequestAssign={requestAssign} />,
            "center"
          );
        }
        return renderDisplayCell(info, line.code, "center", "text-blue-600 dark:text-blue-400 font-semibold font-mono");
      },
    }),
    columnHelper.accessor((l) => l.label, {
      id: "description", header: "Description", size: 300, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const isStaff = line.entryKind === ENTRY_KIND.StaffRole;
        const overridden = isStaff && typeof line.inputs.rate === "number";
        return renderDisplayCell(
          info,
          <span className="font-semibold text-foreground">
            {line.label}
            {overridden && (
              <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400 mt-0.5">
                Project rate override{" "}
                <button
                  type="button"
                  className="underline font-semibold hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    const roleKey = resolveRoleKey(line);
                    if (roleKey) commitInputEdit(line.id, "rate", roleKey, num(line.inputs.rate), undefined);
                  }}
                >
                  Reset
                </button>
              </span>
            )}
          </span>,
          "left"
        );
      },
    }),
    // Utilization — editable % for staff; "—" otherwise.
    columnHelper.accessor((l) => (l.entryKind === ENTRY_KIND.StaffRole ? entryValue(l) : 0), {
      id: "utilization", header: "Utilization", size: 110, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        if (line.entryKind !== ENTRY_KIND.StaffRole) {
          return renderDisplayCell(info, "—", "center", "text-slate-500 dark:text-slate-500 font-mono");
        }
        const val = entryValue(line);
        const tgt = resolveEntryTarget(line); // { target: "utilization", key }
        return renderNumberCell(info, {
          colId: "utilization",
          value: val,
          display: `${val}%`,
          editable: !!tgt,
          onCommit: (n) => { if (tgt) commitInputEdit(line.id, tgt.target, tgt.key, val, Math.max(0, Math.min(100, n))); },
        });
      },
    }),
    // Quantity — derived (locked) for staff/operational; editable for manual qty; 1 for lump/equipment.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.qty ?? 0, {
      id: "quantity", header: "Quantity", size: 130, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        if (gcIsDerivedQtyLine(line)) return renderDerivedQtyCell(info);
        // One-off (B5): qty → editable quantity (drives setOneOffValue); lump-sum → 1 (display).
        if (isOneOffLine(line)) {
          if (line.entryKind === ENTRY_KIND.Qty) {
            const val = entryValue(line);
            return renderNumberCell(info, {
              colId: "quantity", value: val, display: fmtQty(val), editable: true,
              onCommit: (n) => commitInputEdit(line.id, "oneOffValue", line.id, val, Math.max(0, n)),
            });
          }
          return renderDisplayCell(info, fmtQty(calc?.qty ?? 0), "center", "text-slate-600 dark:text-slate-400 font-mono");
        }
        if (line.entryKind === ENTRY_KIND.Qty) {
          // Manual qty line — the quantity is the estimator's direct input.
          const val = entryValue(line);
          const tgt = resolveEntryTarget(line); // { target: "manual", key }
          return renderNumberCell(info, {
            colId: "quantity",
            value: val,
            display: fmtQty(val),
            editable: !!tgt,
            onCommit: (n) => { if (tgt) commitInputEdit(line.id, tgt.target, tgt.key, val, Math.max(0, n)); },
          });
        }
        // Equipment / lump-sum — quantity is 1 (the dollar amount lives in Rate).
        return renderDisplayCell(info, fmtQty(calc?.qty ?? 0), "center", "text-slate-600 dark:text-slate-400 font-mono");
      },
    }),
    columnHelper.accessor((l) => gcRowUnit(l), {
      id: "unit", header: "Unit", size: 64, filterFn: multiSelect,
      cell: (info) => renderDisplayCell(info, gcRowUnit(info.row.original), "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono"),
    }),
    // Rate — editable $/hr override for staff; editable lump amount for equipment/lump; card rate read-only otherwise.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.rate ?? 0, {
      id: "rate", header: "Rate", size: 120, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        const roleKey = resolveRoleKey(line);
        if (roleKey) {
          // staff: project $/hr rate override
          return renderNumberCell(info, {
            colId: "rate",
            value: calc?.rate ?? 0,
            display: fmtUSD(calc?.rate ?? 0),
            editable: true,
            onCommit: (n) => commitInputEdit(line.id, "rate", roleKey, typeof line.inputs.rate === "number" ? num(line.inputs.rate) : undefined, n),
          });
        }
        // One-off (B5): qty → editable $/unit rate (setOneOffRate); lump-sum → the editable
        // lump amount lives in Rate (setOneOffValue), like the catalog lump/equipment lines.
        if (isOneOffLine(line)) {
          if (line.entryKind === ENTRY_KIND.Qty) {
            return renderNumberCell(info, {
              colId: "rate", value: num(line.inputs.rate), display: fmtUSD(calc?.rate ?? 0), editable: true,
              onCommit: (n) => commitInputEdit(line.id, "oneOffRate", line.id, num(line.inputs.rate), Math.max(0, n)),
            });
          }
          const lumpVal = entryValue(line);
          return renderNumberCell(info, {
            colId: "rate", value: lumpVal, display: fmtUSD(lumpVal), editable: true,
            onCommit: (n) => commitInputEdit(line.id, "oneOffValue", line.id, lumpVal, Math.max(0, n)),
          });
        }
        if (line.entryKind === ENTRY_KIND.Equipment || line.entryKind === ENTRY_KIND.LumpSum) {
          // the dollar amount lives in Rate (quantity = 1); edit drives the equipment/manual setter
          const val = entryValue(line);
          const tgt = resolveEntryTarget(line);
          return renderNumberCell(info, {
            colId: "rate",
            value: val,
            display: fmtUSD(val),
            editable: !!tgt,
            onCommit: (n) => { if (tgt) commitInputEdit(line.id, tgt.target, tgt.key, val, Math.max(0, n)); },
          });
        }
        // operational + manual-qty: read-only card rate
        return renderDisplayCell(info, fmtUSD(calc?.rate ?? 0), "center", "text-foreground font-mono");
      },
    }),
    // Total — Quantity × Rate; carries the engine 🔗 badge + the audited type-over.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.total ?? 0, {
      id: "total", header: "Total", size: 140, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        const engineGroup = GC_ROW_META.get(line.code)?.engineGroup ?? "manual";
        const display = (
          <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold font-mono">
            {fmtUSD(calc?.total ?? 0)}
            <EngineLinkBadge nodeId={gcLeafNodeId(engineGroup, line.code, "total")} label={line.label} />
          </span>
        );
        return renderNumberCell(info, {
          colId: "total",
          value: calc?.total ?? 0,
          display,
          editable: canOverride,
          onCommit: (n) => commitFieldOverride(line.id, "total", line.code, n),
        });
      },
    }),
    // Cost/S.F. — Total ÷ project square footage (read-only); "—" when sqft is unset.
    columnHelper.accessor((l) => {
      const total = calcLookupRef.current.get(l.code)?.total ?? 0;
      const sf = squareFootageRef.current;
      return sf > 0 ? total / sf : 0;
    }, {
      id: "costPerSf", header: "Cost/S.F.", size: 110, filterFn: multiSelect,
      cell: (info) => {
        const total = calcLookupRef.current.get(info.row.original.code)?.total ?? 0;
        const sf = squareFootageRef.current;
        return renderDisplayCell(info, sf > 0 ? fmtUSD(total / sf) : "—", "center", "text-slate-600 dark:text-slate-400 font-mono");
      },
    }),
  ];
}

export type UseGcPersonnelGridReturn = UseSectionLineGridReturn;

export function useGcPersonnelGrid(
  personnel: UsePersonnelCalculationsReturn,
  squareFootage: number,
  onSaveOverride?: (payload: OverridePayload) => Promise<void>,
  /** Opens the host-owned one-off assign popover (B5 / D1). Supplied by GcPersonnelGridStep. */
  onRequestAssign?: (line: EstimateSectionLine, x: number, y: number) => void,
): UseGcPersonnelGridReturn {
  // Live ref so `applyEdit` stays stable while always driving the latest setters.
  // Updated in an effect (not at render) — `applyEdit` only reads it in event handlers
  // (commit / undo / redo), which run after commit, so the ref is always fresh by then.
  const personnelRef = useRef(personnel);
  useEffect(() => { personnelRef.current = personnel; }, [personnel]);

  const calcLookup = useMemo(() => buildCalcLookup(personnel.calcResult), [personnel.calcResult]);

  // Display-ordered GC section lines (01.A → 01.F). Persistence order is untouched.
  const rows = useMemo(
    () =>
      personnel.sectionLines
        .filter((l) => l.section === "gc")
        .slice()
        .sort((a, b) => (GC_ROW_META.get(a.code)?.order ?? 999) - (GC_ROW_META.get(b.code)?.order ?? 999)),
    [personnel.sectionLines]
  );

  const applyEdit = useCallback((target: string, key: string, value: number | undefined) => {
    const p = personnelRef.current;
    switch (target) {
      case "utilization": p.setUtilization(key, value ?? 0); break;
      case "rate":
        if (value === undefined) p.resetRate(key);
        else p.handleRateChange(key, String(value));
        break;
      case "equipment": p.handleEquipmentChange(key as "dumpsters" | "toilets" | "electric", String(value ?? 0)); break;
      case "manual": p.handleManualEntryChange(key, String(value ?? 0)); break;
      // B5 (D1): one-off value / rate edits (key = the one-off line id).
      case "oneOffValue": p.setOneOffValue(key, value ?? 0); break;
      case "oneOffRate": p.setOneOffRate(key, value ?? 0); break;
    }
  }, []);

  // B4 (D2): remove / re-add a catalog line — drives the calc hook's removed-codes set.
  const applyRemove = useCallback((code: string) => personnelRef.current.removeLine(code), []);
  const applyRestore = useCallback((code: string) => personnelRef.current.restoreLine(code), []);
  // B5 (D1): one-off line appliers — drive the calc hook's one-off setters.
  const applyAddOneOff = useCallback((line: EstimateSectionLine) => personnelRef.current.addOneOff(line), []);
  const applyRemoveOneOff = useCallback((line: EstimateSectionLine) => personnelRef.current.removeOneOff(line.id), []);
  const applyAssignOneOffCode = useCallback((id: string, code: string, type: string) => personnelRef.current.assignOneOffCode(id, code, type), []);

  return useSectionLineGrid(
    {
      columnDefs: STEP2_COLUMN_DEFS,
      editableColumnIds: STEP2_EDITABLE_COLUMN_IDS,
      centerAlignedColumnIds: STEP2_CENTER_ALIGNED_COLUMN_IDS,
      rows,
      calcLookup,
      overridesTrace: personnel.calcResult.overrides,
      grandTotal: personnel.totalGCs,
      applyEdit,
      // Module-level → stable reference (the core's columns memo treats it as fixed).
      buildColumns: buildGcColumns,
      getGroupKey: gcGroupKey,
      getGroupLabel: gcGroupLabel,
      squareFootage,
      isDerivedQtyLine: gcIsDerivedQtyLine,
      catalog: GC_CATALOG_LINES,
      applyRemove,
      applyRestore,
      applyAddOneOff,
      applyRemoveOneOff,
      applyAssignOneOffCode,
      onRequestAssign,
    },
    onSaveOverride
  );
}
