"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { EngineLinkBadge } from "@/components/workspace/EngineLinkBadge";
import { ColumnDefinition } from "@/types";
import type { EstimateSectionLine } from "@/types/db";
import type { OverridePayload } from "@/lib/overrideSetter";
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
  GC_MANUAL_BY_CODE,
  GC_ROW_META,
  buildCalcLookup,
  entryValue,
  gcGroupKey,
  gcGroupLabel,
  num,
  resolveEntryTarget,
  resolveRoleKey,
} from "@/lib/sectionLines/gcGridModel";

// ---------------------------------------------------------------------------
// useGcPersonnelGrid — Step 2 (GC Personnel) grid spec (Phase B2; B3 onto the core)
//
// A thin specialization of the shared useSectionLineGrid core: it supplies ONLY the
// GC-specific pieces — the display-ordered GC section lines (01.A–01.F), the calc-by-
// code lookup, the `applyEdit` setter dispatch (utilization / rate / equipment /
// manual), the GC column definitions, and the section grouping. The core owns every
// section-agnostic mechanic (selection, cell renderers, keyboard nav, the TanStack
// instance + meta, undo/redo, the per-line type-over, and the GridShellConfig).
//
// It is a VENEER over usePersonnelCalculations (B2-D1): that hook stays the
// authoritative owner of the GC inputs, the legacy blob snapshots, the A3
// dual-write/dual-read, and the authoritative `calcResult`. An input edit maps a
// section-line cell → the matching personnel setter (`setUtilization` /
// `handleRateChange`|`resetRate` / `handleEquipmentChange` / `handleManualEntryChange`);
// the GC engine is PURE from inputs, so a single prev/next value is full-fidelity.
// ---------------------------------------------------------------------------

// Step-2 grid columns (display:flex like Step 4). All accessor columns so the
// shared FilterableColumnHeader (rendered by GridShell) reads a value per column.
const STEP2_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "code", header: "Code", type: "default", size: 120 },
  { id: "description", header: "Staff Role / Operational Scope", type: "default", size: 320 },
  { id: "unit", header: "Unit", type: "default", size: 70 },
  { id: "rate", header: "Rate", type: "default", size: 120 },
  { id: "entry", header: "Utilization / Entry", type: "default", size: 160 },
  { id: "calcQty", header: "Calculated Qty", type: "default", size: 150 },
  { id: "total", header: "Total Cost", type: "default", size: 160 },
];

const STEP2_EDITABLE_COLUMN_IDS = ["rate", "entry", "total"] as const;
const STEP2_CENTER_ALIGNED_COLUMN_IDS = ["code", "unit", "rate", "entry", "calcQty", "total"] as const;

const columnHelper = createColumnHelper<EstimateSectionLine>();

// Cast the custom filter-fn key to a built-in name so column defs typecheck (the
// same shim useTakeoffWorkbook uses); resolved at runtime by the core's `filterFns`.
const multiSelect = "multiSelect" as "includesString";

export type UseGcPersonnelGridReturn = UseSectionLineGridReturn;

/** Builds the GC (Step 2) columns using the shared cell helpers + commit fns. */
function buildGcColumns(ctx: SectionColumnContext): SectionColumnDefs {
  const { renderNumberCell, renderDisplayCell, commitInputEdit, commitOverride, calcLookupRef, canOverride } = ctx;
  return [
    columnHelper.accessor((l) => l.code, {
      id: "code",
      header: "Code",
      size: 120,
      filterFn: multiSelect,
      cell: (info) => renderDisplayCell(info, info.row.original.code, "center", "text-blue-600 dark:text-blue-400 font-semibold font-mono"),
    }),
    columnHelper.accessor((l) => l.label, {
      id: "description",
      header: "Staff Role / Operational Scope",
      size: 320,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const isStaff = line.entryKind === ENTRY_KIND.StaffRole;
        const overridden = isStaff && typeof line.inputs.rate === "number";
        const cfg = GC_MANUAL_BY_CODE.get(line.code);
        const hint =
          cfg && cfg.entry === "qty"
            ? ` (Rate ${fmtUSD(cfg.rate ?? 0)}/${cfg.unit})`
            : cfg && cfg.entry === "lumpSum" && cfg.pctHint === undefined
            ? " (Lump Sum — enter total $)"
            : "";
        return renderDisplayCell(
          info,
          <span className="font-semibold text-foreground">
            {line.label}
            {hint}
            {cfg?.pctHint !== undefined && (
              <span className="block text-[10px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                Template guidance: {(cfg.pctHint * 100).toFixed(2)}% of estimate — enter the final amount
              </span>
            )}
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
    columnHelper.accessor((l) => GC_ROW_META.get(l.code)?.unit ?? "", {
      id: "unit",
      header: "Unit",
      size: 70,
      filterFn: multiSelect,
      cell: (info) =>
        renderDisplayCell(info, GC_ROW_META.get(info.row.original.code)?.unit ?? "", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono"),
    }),
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.rate ?? 0, {
      id: "rate",
      header: "Rate",
      size: 120,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        const cfg = GC_MANUAL_BY_CODE.get(line.code);
        const roleKey = resolveRoleKey(line);
        // Rate is editable only for staff (project rate override). Operational +
        // qty-manual lines show their card rate read-only; equipment / lumpSum show "—".
        if (roleKey) {
          return renderNumberCell(info, {
            colId: "rate",
            value: calc?.rate ?? 0,
            display: fmtUSD(calc?.rate ?? 0),
            editable: true,
            onCommit: (n) => commitInputEdit(line.id, "rate", roleKey, typeof line.inputs.rate === "number" ? num(line.inputs.rate) : undefined, n),
          });
        }
        const showsRate =
          line.entryKind === ENTRY_KIND.OperationalExpense || (cfg && cfg.entry === "qty");
        return renderDisplayCell(info, showsRate ? fmtUSD(calc?.rate ?? 0) : "—", "center", "text-foreground font-mono");
      },
    }),
    columnHelper.accessor((l) => entryValue(l), {
      id: "entry",
      header: "Utilization / Entry",
      size: 160,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        if (line.entryKind === ENTRY_KIND.OperationalExpense) {
          return renderDisplayCell(info, "auto", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono");
        }
        const val = entryValue(line);
        const isStaff = line.entryKind === ENTRY_KIND.StaffRole;
        const display = isStaff ? `${val}%` : fmtUSD(val);
        const tgt = resolveEntryTarget(line);
        const clamp = (n: number) => (isStaff ? Math.max(0, Math.min(100, n)) : Math.max(0, n));
        const onCommit = (n: number) => {
          if (tgt) commitInputEdit(line.id, tgt.target, tgt.key, val, clamp(n));
        };
        return renderNumberCell(info, { colId: "entry", value: val, display, editable: !!tgt, onCommit });
      },
    }),
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.qty ?? 0, {
      id: "calcQty",
      header: "Calculated Qty",
      size: 150,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        const hasQty = line.entryKind === ENTRY_KIND.StaffRole || line.entryKind === ENTRY_KIND.OperationalExpense;
        const meta = GC_ROW_META.get(line.code);
        const content =
          line.entryKind === ENTRY_KIND.StaffRole
            ? `${(calc?.qty ?? 0).toFixed(1)} hrs`
            : hasQty
            ? `${(calc?.qty ?? 0).toFixed(2)} ${meta?.unit ?? ""}`
            : "—";
        return renderDisplayCell(info, content, "center", "text-slate-600 dark:text-slate-400 font-semibold font-mono");
      },
    }),
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.total ?? 0, {
      id: "total",
      header: "Total Cost",
      size: 160,
      filterFn: multiSelect,
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
          onCommit: (n) => commitOverride(line.id, line.code, n),
        });
      },
    }),
  ];
}

export function useGcPersonnelGrid(
  personnel: UsePersonnelCalculationsReturn,
  onSaveOverride?: (payload: OverridePayload) => Promise<void>,
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
    }
  }, []);

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
    },
    onSaveOverride
  );
}
