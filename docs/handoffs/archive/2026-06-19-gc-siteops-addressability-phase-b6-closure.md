# GC/Site-Ops Addressability — Phase B6 closure (WORKSTREAM COMPLETE)

_2026-06-19 · branch `gc-siteops-addressability` · B6 commit `894a115` (on top of B5 `d7ec7cf`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (Phase B6, decisions D4 / ID-2). Predecessor: `…-phase-b5-closure.md`.
> **B6 is the FINAL phase. The only remaining step is the workstream-end merge → `main`
> (architect's call) — see "Next" below.**

---

## What Phase B6 shipped — finish the migration, retire the legacy blobs (⛔ DDL)

`estimate_section_lines` is now the **SOLE store** for Step 2 (GC Personnel) / Step 3 (Site
Operations) inputs. The four legacy JSONB blob columns are **retired** and the strangler-fig
dual-read/dual-write shim is **gone**. The fail-soft reload caveat that rode A3→B5 is removed —
the table is authoritative.

### Live DB (project `nefvkrhbbkiqnpeabyqz`, architect-approved at the DDL gate)
- **Idempotent sweep** (`scripts/sweep-section-lines.ts`, run via `npm run sweep-section-lines`):
  synthesized section lines for the **one** remaining un-migrated app-born project
  (`aee099a7…` → 76 lines = 35 GC + 41 Site-Ops). The other two estimates were already migrated
  (74 / 76 lines) and were **skipped**. Verified idempotent: a re-run reports `migrated 0,
  skipped 3` (no-op). **No imported projects exist** (the A4 frozen branch is built for
  correctness but exercises no live rows). Post-sweep: 0 estimates without section lines.
- **DDL migration** `gc_siteops_b6_retire_step23_blob_columns`: `CREATE OR REPLACE` the
  `save_estimate` RPC (blob columns removed from its INSERT / VALUES / ON CONFLICT) **then**
  `ALTER TABLE project_estimates DROP COLUMN` ×4. Confirmed: the deployed RPC body has **zero**
  blob references; the four columns are gone (`imported_step23_lines`, `rate_card_snapshot`,
  `general_conditions_total`, `site_operations_total` remain).
- **Advisors before == after** for both security and performance (no new finding). Types
  regenerated (the client is untyped — no committed types artifact to update).

### Code — the "section lines as sole store" flip (minimal blast radius)
The hooks' blob-shaped working state is **unchanged**; only *where the initial blob records come
from* changed:
- **NEW pure `sectionLinesToBlobs()`** (`src/lib/sectionLines/synthesize.ts`) — the **exact
  inverse** of synthesis (iterate the catalog by stable id, read each present line's `inputs`;
  absent = B4 removal → key omitted; non-catalog = B5 one-off → skipped). Round-trip identity
  (`synthesizeSectionLines(sectionLinesToBlobs(lines)) === lines`) is unit-proven; combined with
  the existing forward dual-read proof this guarantees totals are unchanged to the cent.
- **`useProjectWorkspace`** — `getSectionLines` is **authoritative** (no `.catch(() => [])`); for
  app-born projects it reconstructs the four blob records via `sectionLinesToBlobs` and overlays
  them onto `projectEstimate`, so the page + calc hooks consume the same blob-shaped initial state
  with zero hook changes. Imported projects leave blobs empty (hook output unused; imported rides
  the frozen path, D4).
- **`usePersonnelCalculations` / `useInfrastructureCalculations`** — removed the dev dual-read
  tripwire `useEffect` (the section-line path IS the load path now; the round-trip test replaces
  the runtime tripwire). Comments refreshed.
- **`useEstimatePersistence`** — the section-line write is **authoritative** (removed the
  fail-soft `.catch`; a failure now surfaces as a save error and the next debounced save retries).
  Dropped the 4 blob params + payload fields. **Debounce trigger switched to a section-line
  *content* key** (`JSON.stringify(sectionLines)`) so in-line value edits still fire a save —
  the retired id-only key would have missed value-only edits.
- **`db.ts`** — `buildEstimateRow` drops the 4 blob fields; `mapEstimateFromRow` drops the 4 blob
  reads. **`page.tsx`** — drops the 4 blob args from the persistence call. **`importEstimate.ts`** —
  drops the now-inert empty-blob assignments.

The `ProjectEstimate` TS type keeps the 4 optional blob fields (reconstructed-in-memory for
app-born). The `computePersonnelFromSectionLines` / `computeSiteOpsFromSectionLines` bridge stays
(still tested; the canonical section-line→engine projection).

## Behavior change (documented, architect-approved)
Removing a Step 2/3 catalog line, then **save + reload + re-add**, now yields a **zeroed** line —
the orphaned blob value no longer survives (removal = absent from the table = gone). **Within a
session, re-add is unchanged.** No test or designed feature depended on the old reload-restore (it
was an artifact of the retired blob persistence). The architect approved this on 2026-06-19.

## Files
- **NEW `scripts/sweep-section-lines.ts`** (+ `package.json` `sweep-section-lines` script).
- `src/lib/sectionLines/synthesize.ts` — `sectionLinesToBlobs()`.
- `src/hooks/useProjectWorkspace.ts`, `useEstimatePersistence.ts`,
  `usePersonnelCalculations.ts`, `useInfrastructureCalculations.ts`.
- `src/lib/db.ts`, `src/lib/importEstimate.ts`, `src/app/projects/[projectId]/page.tsx`.
- `supabase_schema.sql` (header + project_estimates + save_estimate RPC).
- `src/lib/__tests__/sectionLinesSynthesis.test.ts` — 7 new B6 round-trip tests.

## Verification (CLAUDE.md Definition of Done)
- **DDL gate** honored: `supabase_schema.sql` updated first → architect approval of the exact
  SQL → live apply; advisors before/after; types regenerated.
- **Unit:** `npm run test` → **98 files / 1181 pass** (B5 baseline 1174 + 7 new). **McKenna /
  synthetic / CARE goldens tie $0.00.**
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green. **Lint:** no new problems
  in the changed files (one pre-existing unrelated `db.ts` warning).
- **/code-review (high, 8 angles inline):** no correctness findings; the cross-file check confirms
  the only reader of the retired fields is `page.tsx` (reconstructed for app-born, unused for
  imported). Two trivial quality notes deemed not worth changing.
- **No push, no merge** (kickoff: stop at the B6 boundary).

## Manual /verify (architect spot-check — recommended before merge)
B6 changed how Step 2/3 loads (from section lines, not blobs), so a 2-minute browser pass is the
right gate (no new UI; no e2e mandated by the B6 plan):
1. Open an existing app-born project → Step 2 (GC) and Step 3 (Site Ops) show the **same** values
   as before (data intact post-migration).
2. Edit a Step 2/3 value → it auto-saves → **reload** → the edit persisted (the table is now
   authoritative; the old fail-soft caveat is gone).
3. A Procore **export** still ties (goldens prove $0.00; confirm a real project exports).
4. (Optional) Remove a line → save → reload → re-add → it returns **zeroed** (the documented B6
   behavior change).

---

## NEXT — workstream-end merge → `main` (architect's call)

Per CLAUDE.md Git Workflow, the **only** remaining step is to merge `gc-siteops-addressability`
into `main`. This is the one action that touches `main` and requires **explicit architect
approval** (the push-guard hook prompt on the `main` push IS the gate). Default is a direct merge;
a PR is opt-in (e.g. if you want the cloud `/code-review ultra` or CI first).

**Branch state:** `gc-siteops-addressability` is **AHEAD of `origin` by the whole Track B run**
(B1a…B6) and has **not been pushed** since B4. Before merging, the agent should:
1. (Optional, recommended) **push the branch** to back it up (`git push -u origin
   gc-siteops-addressability` — feature-branch pushes are auto-allowed).
2. On the architect's go: merge → `main` and push `main` (this prompts once — that prompt is the
   gate). The live DB is **already migrated** (B6 DDL applied), so `main` and the live schema are
   in sync the moment the code lands.

⚠️ **DB-vs-code ordering note for the merge:** the live DB blob columns are **already dropped**.
Any environment still running pre-B6 code (e.g. a stale deploy) would error on save (the old
`save_estimate` payload references dropped columns — actually the RPC ignores extra JSONB keys, but
the old `mapEstimateFromRow` reads of the dropped columns just yield `{}`). In practice this is a
single-user internal tool with the architect controlling deploys, so land B6 code promptly after
the merge.

## Where this sits — WORKSTREAM COMPLETE
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: B1a → B1b → B2 → B3 → B4 → B5 →
**B6 (sweep + retire blob columns, ⛔DDL) ✅ (this session) = FINAL.** Section lines are the sole,
authoritative store for Step 2/3; the GC/Site-Ops values are first-class addressable lines end to
end. Only the merge → `main` remains.
