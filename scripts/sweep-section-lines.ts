/**
 * GC/Site-Ops Addressability — Phase B6 one-shot IDEMPOTENT sweep.
 *
 * Synthesizes `estimate_section_lines` for every project that does not yet have
 * any (the "stragglers" the A3/A4 dual-write never reached), so the table can
 * become the SOLE store for Step 2/3 inputs before the four legacy blob columns
 * are dropped.
 *
 * IDEMPOTENCY + SAFETY: a project that ALREADY has section lines is SKIPPED — never
 * re-synthesized. This is what makes a re-run a no-op AND what protects B4 removals
 * / B5 one-offs (those live only in the table; re-synthesizing from the blobs would
 * resurrect removed lines and drop one-offs). Only projects with ZERO section lines
 * are synthesized.
 *
 *   - app-born  → synthesizeSectionLines({ gc_utilization, … })  (Phase A3, verbatim)
 *   - imported  → synthesizeImportedSectionLines(imported_step23_lines)  (Phase A4)
 *
 * Reuses the EXACT pure synthesis the app uses, so the rows are identical to what
 * the dual-write would have produced. Writes via the same `save_section_lines` RPC.
 *
 * Run (preview):  npm run sweep-section-lines -- --dry-run
 * Run (apply):    npm run sweep-section-lines
 * Re-run after applying → reports every project already migrated (no-op).
 *
 * MUST run BEFORE the blob columns are dropped (it reads them).
 */

import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import { synthesizeSectionLines } from "@/lib/sectionLines/synthesize";
import { synthesizeImportedSectionLines } from "@/lib/sectionLines/imported";
import type { EstimateSectionLine, ImportedStep23Lines } from "@/types/db";

// Self-load .env.local (Node 21+/24) so the script needs no --env-file flag.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be present in the process */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

// Service-role client bypasses RLS (the established migration-script pattern).
const supabase = createClient(url, serviceKey);

/**
 * Mirrors db.ts `buildSectionLinePayload` — line → snake_case JSONB the
 * save_section_lines RPC consumes, sort_order from array index. Inlined so the
 * script stays decoupled from the anon-client module (src/lib/db.ts).
 */
function buildSectionLinePayload(lines: EstimateSectionLine[]) {
  return lines.map((line, index) => ({
    id: line.id,
    section: line.section,
    code: line.code,
    procore_code: line.procoreCode,
    cost_type: line.costType,
    label: line.label,
    entry_kind: line.entryKind,
    inputs: line.inputs ?? {},
    sort_order: index,
    source: line.source || "template",
  }));
}

/** A valid imported detail payload has a step2Lines array (matches mapEstimateFromRow's guard). */
function asImportedDetail(v: unknown): ImportedStep23Lines | undefined {
  if (v != null && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as ImportedStep23Lines).step2Lines)) {
    return v as ImportedStep23Lines;
  }
  return undefined;
}

const asBlob = (v: unknown): Record<string, number> =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};

async function main() {
  console.log(`\n=== Phase B6 section-line sweep ${DRY_RUN ? "(DRY RUN)" : "(APPLY)"} ===\n`);

  // 1. Every estimate row (the only rows that can carry Step 2/3 inputs).
  const { data: estimates, error: e1 } = await supabase
    .from("project_estimates")
    .select(
      "project_id, gc_utilization, gc_equipment_overrides, site_ops_quantities, site_ops_rates, imported_step23_lines"
    );
  if (e1) throw new Error(`Failed to read project_estimates: ${e1.message}`);

  // 2. is_imported per project (drives the synthesis branch).
  const { data: projects, error: e2 } = await supabase.from("projects").select("id, is_imported");
  if (e2) throw new Error(`Failed to read projects: ${e2.message}`);
  const isImportedById = new Map<string, boolean>((projects ?? []).map((p) => [p.id as string, p.is_imported === true]));

  let migrated = 0;
  let skipped = 0;

  for (const est of estimates ?? []) {
    const projectId = est.project_id as string;

    // Idempotency + B4/B5 guard: skip any project that already has section lines.
    const { count, error: cErr } = await supabase
      .from("estimate_section_lines")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (cErr) throw new Error(`Failed to count section lines for ${projectId}: ${cErr.message}`);
    if ((count ?? 0) > 0) {
      console.log(`  SKIP  ${projectId}  (already migrated: ${count} section lines)`);
      skipped++;
      continue;
    }

    const imported = isImportedById.get(projectId) === true;
    const lines = imported
      ? synthesizeImportedSectionLines(asImportedDetail(est.imported_step23_lines), undefined, projectId)
      : synthesizeSectionLines(
          {
            gcUtilization: asBlob(est.gc_utilization),
            gcEquipmentOverrides: asBlob(est.gc_equipment_overrides),
            siteOpsQuantities: asBlob(est.site_ops_quantities),
            siteOpsRates: asBlob(est.site_ops_rates),
          },
          projectId
        );

    if (lines.length === 0) {
      console.log(`  SKIP  ${projectId}  (${imported ? "imported, no detail" : "app-born"}: synthesized 0 lines)`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  WOULD WRITE  ${projectId}  (${imported ? "imported" : "app-born"}: ${lines.length} lines)`);
      migrated++;
      continue;
    }

    const { error: wErr } = await supabase.rpc("save_section_lines", {
      p_project_id: projectId,
      p_lines: buildSectionLinePayload(lines),
    });
    if (wErr) throw new Error(`Failed to write section lines for ${projectId}: ${wErr.message}`);
    console.log(`  WRITE ${projectId}  (${imported ? "imported" : "app-born"}: ${lines.length} lines)`);
    migrated++;
  }

  console.log(
    `\n=== Done. ${DRY_RUN ? "would migrate" : "migrated"} ${migrated}, skipped ${skipped} (of ${estimates?.length ?? 0} estimates) ===\n`
  );
}

main().catch((err) => {
  console.error("Sweep failed:", err);
  process.exit(1);
});
