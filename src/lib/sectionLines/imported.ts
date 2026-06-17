/**
 * GC/Site-Ops Addressability — Phase A4 IMPORTED synthesis (PURE).
 *
 * The #1-risk phase, isolated. An imported bid's GC/Site-Ops values are
 * hand-authored lump sums the app CANNOT re-derive from staffing inputs
 * (finding G-2). So this is a SEPARATE synthesis path from the app-born one
 * (`synthesize.ts`): instead of reading the live STEP 2/3 blobs and driving the
 * calc engine, it reads the FROZEN `imported_step23_lines` detail and emits one
 * `lumpSum` section line per as-bid line whose value IS the frozen `total`.
 *
 * Because every line is a `lumpSum` carrying `inputs.value = total`, the bridge's
 * lump-sum evaluator would reproduce the frozen number with NO utilization / qty /
 * rate recomputation — but imported lines are never routed through the engine at
 * all; they are constants. A change to a live STEP 2/3 input can never move them
 * (the constants gate, `importedSectionLinesSynthesis.test.ts`). The export and
 * the frozen-total authority (`computeImportedLinkedDivisionTotalsViaEngine`) are
 * untouched, so both goldens tie $0.00.
 *
 * Each line's code is resolved AT SYNTHESIS TIME to the app's deterministic
 * GC/Site-Ops code via `resolveStep23Line` (the same resolver the read-only
 * `ImportedStep23Panel` uses), so the import review-gate's assigned-code decisions
 * are honored; an unmappable line keeps its bare as-bid code. Resolution is
 * LABELING only — the value that counts is always the frozen lump sum.
 *
 * IMPORTED PROJECTS ONLY. App-born projects synthesize from the live blobs and
 * stay derived — that is Phase A3 (`synthesize.ts`).
 */

import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "@/lib/constants";
import { resolveStep23Line, type Step23LineDef } from "@/lib/step23Normalization";
import type {
  EstimateSectionLine,
  ImportedSheetLine,
  ImportedStep23Lines,
  SectionDiscriminator,
} from "@/types/db";
import { ENTRY_KIND } from "./entryKinds";

// ---------------------------------------------------------------------------
// Catalog identity (code → procoreCode / costType) — for a RESOLVED imported
// line. Built from the SAME six DEFAULTS arrays that back STEP23_LINE_DEFS, so a
// resolved code's Procore code / cost type can never drift from the resolver.
// First claim wins, mirroring step23Normalization's built-in precedence.
// ---------------------------------------------------------------------------

interface CatalogIdentity {
  procoreCode: string;
  costType: string;
}

const CATALOG_IDENTITY_BY_CODE: ReadonlyMap<string, CatalogIdentity> = (() => {
  const m = new Map<string, CatalogIdentity>();
  const add = (code: string, procoreCode: string, costType: string) => {
    if (!m.has(code)) m.set(code, { procoreCode, costType });
  };
  for (const r of STAFF_ROLE_DEFAULTS) add(r.code, r.procoreCode, r.costType);
  for (const o of OPERATIONAL_EXPENSE_DEFAULTS) add(o.code, o.procoreCode, o.costType);
  for (const e of EQUIPMENT_DEFAULTS) add(e.code, e.procoreCode, e.costType);
  for (const g of GC_MANUAL_DEFAULTS) add(g.code, g.procoreCode, g.costType);
  for (const d of SITE_OPS_DYNAMIC_DEFAULTS) add(d.code, d.procoreCode, d.costType);
  for (const s of SITE_OPS_MANUAL_DEFAULTS) add(s.code, s.procoreCode, s.costType);
  return m;
})();

// ---------------------------------------------------------------------------
// Imported section-line synthesis
// ---------------------------------------------------------------------------

/**
 * Builds one imported section line from a frozen `ImportedSheetLine`. Always a
 * `lumpSum` whose authoritative input is `value = line.total` (the frozen as-bid
 * dollar). `qty` / `rate` / `uom` ride along in `inputs` for DISPLAY only — the
 * value that counts is the lump sum, never `qty × rate` (hand-authored sheets do
 * not always multiply cleanly; the panel surfaces that, and so must we). There is
 * NO `total` field anywhere on the line (ID-1 — no authoritative total column).
 */
function makeImportedLine(
  section: SectionDiscriminator,
  idPrefix: string,
  line: ImportedSheetLine,
  resolved: Step23LineDef | null,
  projectId: string,
  sortOrder: number
): EstimateSectionLine {
  // Resolved → the app's deterministic code/label + catalog Procore code / cost
  // type. Unmappable → keep the bare as-bid code/description, no Procore identity.
  const code = resolved?.code ?? line.code;
  const label = resolved?.label ?? line.description;
  const identity = resolved ? CATALOG_IDENTITY_BY_CODE.get(resolved.code) : undefined;

  const inputs: Record<string, number | string> = {
    value: line.total, // FROZEN as-bid lump sum — the authoritative value
    qty: line.qty, // display only
    rate: line.rate, // display only
  };
  const uom = (line.uom ?? "").trim();
  if (uom) inputs.uom = uom; // display only; present only when the bid carried it

  return {
    id: `${idPrefix}:${line.rowNumber}`,
    projectId,
    section,
    code,
    procoreCode: identity?.procoreCode ?? "",
    costType: identity?.costType ?? "",
    label,
    entryKind: ENTRY_KIND.LumpSum,
    inputs,
    sortOrder,
    source: "csv_import", // imported provenance
    updatedAt: "",
  };
}

/**
 * Synthesizes an IMPORTED project's section lines from its frozen
 * `imported_step23_lines` detail: `step2Lines` → GC (Step 2), `step3Lines` →
 * Site Ops (Step 3), GC first then Site Ops (visual order; the gateway re-stamps
 * `sort_order` from the array index). Each line is a `lumpSum` carrying the frozen
 * as-bid total — NEVER a live recompute.
 *
 * `extraDefs` overlays user-minted custom GC/Site-Ops defs on the built-ins (same
 * contract as `resolveStep23Line` / the import review gate); omit it for built-ins
 * only — the resolved identity is labeling, and the frozen value is unaffected
 * either way. Returns `[]` for an undefined payload (an import saved before detail
 * capture existed — the workspace shows the section total from the linked rows).
 *
 * PURE: same payload + defs → same lines. Reads ONLY the frozen detail, never the
 * live STEP 2/3 blobs — that is what makes imported section lines constants.
 */
export function synthesizeImportedSectionLines(
  imported: ImportedStep23Lines | undefined,
  extraDefs?: readonly Step23LineDef[],
  projectId = ""
): EstimateSectionLine[] {
  if (!imported) return [];

  const lines: EstimateSectionLine[] = [];
  let order = 0;

  for (const line of imported.step2Lines) {
    const resolved = resolveStep23Line(line.code, line.description, line.assignedCode, extraDefs);
    lines.push(makeImportedLine("gc", "imported:gc", line, resolved, projectId, order++));
  }
  for (const line of imported.step3Lines) {
    const resolved = resolveStep23Line(line.code, line.description, line.assignedCode, extraDefs);
    lines.push(makeImportedLine("site_ops", "imported:siteops", line, resolved, projectId, order++));
  }

  return lines;
}
