/**
 * Division 60 Fee-Block Addressability — the markup fee-line shape (PURE, no React).
 *
 * Phase 1 — storage foundation. A FEE LINE is an estimator-authored flat dollar
 * amount that lives in the Division 60 fee/markup block at the bottom of the STEP 4
 * estimate (e.g. "Preconstruction Fee" = $2,500.00). It is, end to end, an
 * `estimate_section_lines` row with the NEW `section: 'markup'` discriminator and
 * `entry_kind: 'lumpSum'`. Storage reuses the GC/Site-Ops addressable-line table +
 * its atomic `save_section_lines` RPC (both section-agnostic), so a fee line behaves
 * like a GC/Site-Ops line: inputs-only, never a frozen total ("derived, never
 * frozen", plan ID-1).
 *
 * A fee line carries a label, a flat dollar `amount` (in `inputs.amount`), an
 * optional Procore BLI code (BLANK until assigned — never guessed, AGENTS.md "No
 * Speculative Changes"), and a provenance `source` ('manual' for an estimator
 * insert, 'csv_import' for an imported hand-keyed fee line).
 *
 * Phase 1 lays the pipe + TypeScript types ONLY — there is NO UI, NO calc, NO
 * render, NO export. The flat-fee math (a below-subtotal addend that is never marked
 * up) lands in Phase 2; render/edit/export/import follow in Phases 3-6.
 */

import type { EstimateSectionLine } from "@/types/db";
import { ENTRY_KIND } from "./entryKinds";

/**
 * The `section` discriminator for a Division 60 fee/markup line — the third value
 * (after 'gc' / 'site_ops') the CHECK constraint now accepts.
 */
export const MARKUP_SECTION = "markup" as const;

/** True for a Division 60 fee/markup section line (vs a GC/Site-Ops line). */
export function isMarkupLine(line: EstimateSectionLine): boolean {
  return line.section === MARKUP_SECTION;
}

/** Coerce a JSONB `inputs` value to a finite number (the amount is stored as a number). */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Reads a fee line's flat dollar amount from `inputs.amount` (0 when absent/invalid).
 * The amount is the line's whole contribution — a fee line is a flat lump sum, so it
 * has no quantity/rate.
 */
export function feeLineAmount(line: EstimateSectionLine): number {
  return num(line.inputs.amount);
}

let feeLineCounter = 0;
/** A stable, unique fee-line identifier (`markup:fee:<rand>`) used as the row id. */
function newFeeLineId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(feeLineCounter++).toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
  return `markup:fee:${rand}`;
}

export interface NewFeeLineInput {
  /** Display label, e.g. "Preconstruction Fee". */
  label: string;
  /** Flat dollar amount the line adds (stored in `inputs.amount`). */
  amount: number;
  /**
   * Procore BLI code — OPTIONAL and BLANK by default. Imported / freshly-inserted
   * lines come in unmapped ("needs-review"); the estimator assigns a valid code
   * later (never guessed). The matching cost type is resolved at assignment time.
   */
  procoreCode?: string;
  /**
   * Provenance: 'manual' (estimator insert, the default), 'csv_import' (a hand-keyed
   * fee line captured on import), or 'template'. Mirrors estimate_line_items.source.
   */
  source?: string;
}

/**
 * Builds a brand-new markup fee line. `id` is the generated `markup:fee:<rand>`
 * identity (the row PK is `(project_id, id)`); `code` stays '' — a fee line has no
 * STEP 2/3 criterion code. The flat dollar rides `inputs.amount`. `sortOrder` is
 * informational (the gateway re-stamps it from the array index on save). `costType`
 * is '' until a Procore code is assigned. Per the locked decision, every fee line is
 * a flat, below-subtotal, never-marked-up `lumpSum`.
 */
export function newFeeLine(input: NewFeeLineInput): EstimateSectionLine {
  return {
    id: newFeeLineId(),
    projectId: "",
    section: MARKUP_SECTION,
    code: "",
    procoreCode: input.procoreCode ?? "",
    costType: "",
    label: input.label,
    entryKind: ENTRY_KIND.LumpSum,
    inputs: { amount: num(input.amount) },
    sortOrder: 0,
    source: input.source ?? "manual",
    updatedAt: "",
  };
}
