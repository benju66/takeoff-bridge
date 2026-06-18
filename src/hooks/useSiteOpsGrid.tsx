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
  SITEOPS_DYNAMIC_BY_CODE,
  SITEOPS_MANUAL_BY_CODE,
  SITEOPS_ROW_META,
  buildSiteOpsCalcLookup,
  entryValue,
  num,
  resolveQtyKey,
  resolveRateKey,
  siteOpsGroupKey,
  siteOpsGroupLabel,
} from "@/lib/sectionLines/siteOpsGridModel";

// ---------------------------------------------------------------------------
// useSiteOpsGrid — Step 3 (Site Operations) grid spec (Phase B3; on the shared core)
//
// The Site-Ops twin of useGcPersonnelGrid: a thin specialization of useSectionLineGrid
// that supplies ONLY the Site-Ops pieces — the display-ordered Site-Ops section lines
// (02.A–02.H), the calc-by-code lookup, the `applyEdit` setter dispatch (quantity /
// rate), the Site-Ops column definitions, and the section grouping. The core owns every
// section-agnostic mechanic.
//
// It is a VENEER over useInfrastructureCalculations: that hook stays the authoritative
// owner of the Site-Ops inputs, the legacy blob snapshots, the A3 dual-write/dual-read,
// and `calcResult`. Site-Ops differs from GC in ONE way that matters here: a `qtyRate`
// manual line (today only Soil Borings) has BOTH a typed quantity AND a typed rate, so
// its rate cell is editable (`resolveRateKey`) on top of the editable quantity cell.
// ---------------------------------------------------------------------------

// Step-3 grid columns (display:flex like Step 2/4). All accessor columns so the shared
// FilterableColumnHeader (rendered by GridShell) reads a value per column.
const STEP3_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "code", header: "Code", type: "default", size: 120 },
  { id: "description", header: "Description", type: "default", size: 340 },
  { id: "unit", header: "Unit", type: "default", size: 70 },
  { id: "rate", header: "Rate", type: "default", size: 130 },
  { id: "entry", header: "Estimator Entry", type: "default", size: 150 },
  { id: "calcQty", header: "Calculated Qty", type: "default", size: 150 },
  { id: "total", header: "Total Cost", type: "default", size: 160 },
];

const STEP3_EDITABLE_COLUMN_IDS = ["rate", "entry", "total"] as const;
const STEP3_CENTER_ALIGNED_COLUMN_IDS = ["code", "unit", "rate", "entry", "calcQty", "total"] as const;

const columnHelper = createColumnHelper<EstimateSectionLine>();

// Cast the custom filter-fn key to a built-in name so column defs typecheck (the
// same shim useTakeoffWorkbook uses); resolved at runtime by the core's `filterFns`.
const multiSelect = "multiSelect" as "includesString";

/** The description hint per entry kind (mirrors the old InfrastructureStep copy). */
function describeLine(line: EstimateSectionLine): string {
  const cfg = SITEOPS_MANUAL_BY_CODE.get(line.code);
  if (line.entryKind === ENTRY_KIND.Dynamic) {
    const d = SITEOPS_DYNAMIC_BY_CODE.get(line.code);
    if (!d) return "";
    const driver = d.quantityDriver === "duration" ? "schedule duration" : "project square footage";
    return ` (Rate ${fmtUSD(d.rate)}/${d.unit}, quantity follows ${driver})`;
  }
  if (!cfg) return "";
  if (cfg.entry === "lumpSum") return " (Lump Sum — enter total $)";
  if (cfg.entry === "qtyRate") return " (enter quantity and rate)";
  return ` (Rate ${fmtUSD(cfg.rate ?? 0)}/${cfg.unit})`;
}

/** Builds the Site-Ops (Step 3) columns using the shared cell helpers + commit fns. */
function buildSiteOpsColumns(ctx: SectionColumnContext): SectionColumnDefs {
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
      header: "Description",
      size: 340,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        return renderDisplayCell(
          info,
          <span className="font-semibold text-foreground">
            {line.label}
            {describeLine(line)}
          </span>,
          "left"
        );
      },
    }),
    columnHelper.accessor((l) => SITEOPS_ROW_META.get(l.code)?.unit ?? "", {
      id: "unit",
      header: "Unit",
      size: 70,
      filterFn: multiSelect,
      cell: (info) =>
        renderDisplayCell(info, SITEOPS_ROW_META.get(info.row.original.code)?.unit ?? "", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono"),
    }),
    columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.rate ?? 0, {
      id: "rate",
      header: "Rate",
      size: 130,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        const calc = calcLookupRef.current.get(line.code);
        // Rate is editable ONLY for `qtyRate` lines (typed rate, e.g. soil borings).
        // Dynamic + qty lines show their card rate read-only; lump-sum shows "—".
        const rateKey = resolveRateKey(line);
        if (rateKey) {
          return renderNumberCell(info, {
            colId: "rate",
            value: calc?.rate ?? 0,
            display: fmtUSD(calc?.rate ?? 0),
            editable: true,
            onCommit: (n) => commitInputEdit(line.id, "rate", rateKey, num(line.inputs.rate), n),
          });
        }
        const isLump = line.entryKind === ENTRY_KIND.LumpSum;
        return renderDisplayCell(info, isLump ? "—" : fmtUSD(calc?.rate ?? 0), "center", "text-foreground font-mono");
      },
    }),
    columnHelper.accessor((l) => entryValue(l), {
      id: "entry",
      header: "Estimator Entry",
      size: 150,
      filterFn: multiSelect,
      cell: (info) => {
        const line = info.row.original;
        if (line.entryKind === ENTRY_KIND.Dynamic) {
          return renderDisplayCell(info, "auto", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono");
        }
        const val = entryValue(line);
        const isLump = line.entryKind === ENTRY_KIND.LumpSum;
        // lump-sum lines hold a dollar amount; qty / qtyRate hold a plain quantity.
        const display = isLump ? fmtUSD(val) : String(val);
        const qtyKey = resolveQtyKey(line);
        const onCommit = (n: number) => {
          if (qtyKey) commitInputEdit(line.id, "quantity", qtyKey, val, Math.max(0, n));
        };
        return renderNumberCell(info, { colId: "entry", value: val, display, editable: !!qtyKey, onCommit });
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
        const meta = SITEOPS_ROW_META.get(line.code);
        // Only dynamic (driver) lines have a derived qty; manual lines show "—"
        // (their typed quantity already lives in the Estimator Entry column).
        const content =
          line.entryKind === ENTRY_KIND.Dynamic
            ? `${(calc?.qty ?? 0).toLocaleString()} ${meta?.unit ?? ""}`
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
          onCommit: (n) => commitOverride(line.id, line.code, n),
        });
      },
    }),
  ];
}

export type UseSiteOpsGridReturn = UseSectionLineGridReturn;

export function useSiteOpsGrid(
  infrastructure: UseInfrastructureCalculationsReturn,
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
    },
    onSaveOverride
  );
}
