"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { EngineLinkBadge } from "@/components/workspace/EngineLinkBadge";
import { ColumnDefinition } from "@/types";
import type { EstimateSectionLine } from "@/types/db";
import type { OverridePayload } from "@/lib/overrideSetter";
import type { UseInfrastructureCalculationsReturn } from "./useInfrastructureCalculations";
import {
  useSectionLineGrid,
  fmtSectionUSD as fmtUSD,
  type SectionColumnContext,
  type SectionColumnDefs,
  type UseSectionLineGridReturn,
} from "./useSectionLineGrid";
import { ENTRY_KIND } from "@/lib/sectionLines/entryKinds";
import { siteOpsLeafNodeId } from "@/lib/bindings/types";
import {
  SITEOPS_ROW_META,
  buildSiteOpsCalcLookup,
  entryValue,
  fmtQty,
  num,
  resolveQtyKey,
  resolveRateKey,
  siteOpsGroupKey,
  siteOpsGroupLabel,
  siteOpsIsDerivedQtyLine,
} from "@/lib/sectionLines/siteOpsGridModel";

// ---------------------------------------------------------------------------
// useSiteOpsGrid — Step 3 (Site Operations) grid spec (B3; on the shared core)
//
// The Site-Ops twin of useGcPersonnelGrid: supplies the Site-Ops pieces to the shared
// useSectionLineGrid core. A veneer over useInfrastructureCalculations.
//
// Columns match the company estimate template's STEP 3 sheet (row 9 headers):
//   Code · Description · Quantity · Unit · Rate · Total · Cost/S.F.
// Total = Quantity × Rate; Cost/S.F. = Total ÷ Building Sqft. Per kind:
//   - dynamic (auto): Quantity DERIVED (locked, overridable); Rate = card rate (read-only).
//   - qty           : Quantity editable (typed); Rate = card rate (read-only).
//   - qtyRate       : Quantity editable AND Rate editable (e.g. Soil Borings).
//   - lumpSum       : Quantity 1; the lump amount is the editable Rate.
// ---------------------------------------------------------------------------

const STEP3_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "code", header: "Code", type: "default", size: 110 },
  { id: "description", header: "Description", type: "default", size: 320 },
  { id: "quantity", header: "Quantity", type: "default", size: 130 },
  { id: "unit", header: "Unit", type: "default", size: 64 },
  { id: "rate", header: "Rate", type: "default", size: 130 },
  { id: "total", header: "Total", type: "default", size: 140 },
  { id: "costPerSf", header: "Cost/S.F.", type: "default", size: 110 },
];

const STEP3_EDITABLE_COLUMN_IDS = ["quantity", "rate", "total"] as const;
const STEP3_CENTER_ALIGNED_COLUMN_IDS = ["code", "quantity", "unit", "rate", "total", "costPerSf"] as const;

const columnHelper = createColumnHelper<EstimateSectionLine>();

// Cast the custom filter-fn key to a built-in name so column defs typecheck (the
// same shim useTakeoffWorkbook uses); resolved at runtime by the core's `filterFns`.
const multiSelect = "multiSelect" as "includesString";

/** The concise description hint per entry kind. */
function describeLine(line: EstimateSectionLine): string {
  if (line.entryKind === ENTRY_KIND.Dynamic) return " (auto — quantity follows schedule/sqft)";
  if (line.entryKind === ENTRY_KIND.LumpSum) return " (lump sum)";
  if (line.entryKind === ENTRY_KIND.QtyRate) return " (quantity × rate)";
  return "";
}

/** Builds the Site-Ops (Step 3) columns using the shared cell helpers + commit fns. */
function buildSiteOpsColumns(ctx: SectionColumnContext): SectionColumnDefs {
  const {
    renderNumberCell, renderDisplayCell, commitInputEdit, commitFieldOverride,
    renderDerivedQtyCell, calcLookupRef, canOverride, squareFootageRef,
  } = ctx;

  return [
    columnHelper.accessor((l) => l.code, {
      id: "code", header: "Code", size: 110, filterFn: multiSelect,
      cell: (info) => renderDisplayCell(info, info.row.original.code, "center", "text-blue-600 dark:text-blue-400 font-semibold font-mono"),
    }),
    columnHelper.accessor((l) => l.label, {
      id: "description", header: "Description", size: 320, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        return renderDisplayCell(
          info,
          <span className="font-semibold text-foreground">
            {line.label}
            <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">{describeLine(line)}</span>
          </span>,
          "left"
        );
      },
    }),
    // Quantity — derived (locked) for dynamic; editable for qty/qtyRate; 1 for lump-sum.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.qty ?? 0, {
      id: "quantity", header: "Quantity", size: 130, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        if (siteOpsIsDerivedQtyLine(line)) return renderDerivedQtyCell(info);
        if (line.entryKind === ENTRY_KIND.Qty || line.entryKind === ENTRY_KIND.QtyRate) {
          // typed quantity — the estimator's direct input
          const val = entryValue(line);
          const qtyKey = resolveQtyKey(line);
          return renderNumberCell(info, {
            colId: "quantity",
            value: val,
            display: fmtQty(val),
            editable: !!qtyKey,
            onCommit: (n) => { if (qtyKey) commitInputEdit(line.id, "quantity", qtyKey, val, Math.max(0, n)); },
          });
        }
        // lump-sum — quantity is 1 (the dollar amount lives in Rate).
        return renderDisplayCell(info, fmtQty(calc?.qty ?? 0), "center", "text-slate-600 dark:text-slate-400 font-mono");
      },
    }),
    columnHelper.accessor((l) => SITEOPS_ROW_META.get(l.code)?.unit ?? "", {
      id: "unit", header: "Unit", size: 64, filterFn: multiSelect,
      cell: (info) => renderDisplayCell(info, SITEOPS_ROW_META.get(info.row.original.code)?.unit ?? "", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono"),
    }),
    // Rate — editable for qtyRate (typed rate) + lump-sum (the amount); card rate read-only otherwise.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.rate ?? 0, {
      id: "rate", header: "Rate", size: 130, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        if (line.entryKind === ENTRY_KIND.QtyRate) {
          const rateKey = resolveRateKey(line);
          return renderNumberCell(info, {
            colId: "rate",
            value: calc?.rate ?? 0,
            display: fmtUSD(calc?.rate ?? 0),
            editable: !!rateKey,
            onCommit: (n) => { if (rateKey) commitInputEdit(line.id, "rate", rateKey, num(line.inputs.rate), n); },
          });
        }
        if (line.entryKind === ENTRY_KIND.LumpSum) {
          // the lump amount lives in Rate (quantity = 1); edit drives the quantity setter
          // (a lump-sum line stores its dollar amount in `quantities`).
          const val = entryValue(line);
          const qtyKey = resolveQtyKey(line);
          return renderNumberCell(info, {
            colId: "rate",
            value: val,
            display: fmtUSD(val),
            editable: !!qtyKey,
            onCommit: (n) => { if (qtyKey) commitInputEdit(line.id, "quantity", qtyKey, val, Math.max(0, n)); },
          });
        }
        // dynamic + qty: read-only card rate
        return renderDisplayCell(info, fmtUSD(calc?.rate ?? 0), "center", "text-foreground font-mono");
      },
    }),
    // Total — Quantity × Rate; carries the engine 🔗 badge + the audited type-over.
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.total ?? 0, {
      id: "total", header: "Total", size: 140, filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        const engineGroup = SITEOPS_ROW_META.get(line.code)?.engineGroup ?? "manual";
        const display = (
          <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold font-mono">
            {fmtUSD(calc?.total ?? 0)}
            <EngineLinkBadge nodeId={siteOpsLeafNodeId(engineGroup, line.code, "total")} label={line.label} />
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

export type UseSiteOpsGridReturn = UseSectionLineGridReturn;

export function useSiteOpsGrid(
  infrastructure: UseInfrastructureCalculationsReturn,
  squareFootage: number,
  onSaveOverride?: (payload: OverridePayload) => Promise<void>,
): UseSiteOpsGridReturn {
  // Live ref so `applyEdit` stays stable while always driving the latest setters.
  // Updated in an effect (not at render) — `applyEdit` only reads it in event handlers
  // (commit / undo / redo), which run after commit, so the ref is always fresh by then.
  const infraRef = useRef(infrastructure);
  useEffect(() => { infraRef.current = infrastructure; }, [infrastructure]);

  const calcLookup = useMemo(() => buildSiteOpsCalcLookup(infrastructure.calcResult), [infrastructure.calcResult]);

  // Display-ordered Site-Ops section lines (02.A → 02.H, dynamic-before-manual within
  // a section). Persistence order (the synthesized array) is untouched.
  const rows = useMemo(
    () =>
      infrastructure.sectionLines
        .filter((l) => l.section === "site_ops")
        .slice()
        .sort((a, b) => (SITEOPS_ROW_META.get(a.code)?.order ?? 999) - (SITEOPS_ROW_META.get(b.code)?.order ?? 999)),
    [infrastructure.sectionLines]
  );

  const applyEdit = useCallback((target: string, key: string, value: number | undefined) => {
    const inf = infraRef.current;
    switch (target) {
      case "quantity": inf.handleLineQuantityChange(key, String(value ?? 0)); break;
      case "rate": inf.handleLineRateChange(key, String(value ?? 0)); break;
    }
  }, []);

  return useSectionLineGrid(
    {
      columnDefs: STEP3_COLUMN_DEFS,
      editableColumnIds: STEP3_EDITABLE_COLUMN_IDS,
      centerAlignedColumnIds: STEP3_CENTER_ALIGNED_COLUMN_IDS,
      rows,
      calcLookup,
      overridesTrace: infrastructure.calcResult.overrides,
      grandTotal: infrastructure.siteOperationsTotal,
      applyEdit,
      // Module-level → stable reference (the core's columns memo treats it as fixed).
      buildColumns: buildSiteOpsColumns,
      getGroupKey: siteOpsGroupKey,
      getGroupLabel: siteOpsGroupLabel,
      squareFootage,
      isDerivedQtyLine: siteOpsIsDerivedQtyLine,
    },
    onSaveOverride
  );
}
