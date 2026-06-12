# Handoff — Phase 4 (Override + Audit Model) → Phase 5 (Visual Trust UI)

> Written 2026-06-09 at the close of Phase 4 of `docs/plans/make-the-math-trustworthy.md`.
> Read this, then the plan's **Phase 5 "Cold-start brief"**, then start Phase 5 in a fresh
> session. **Phase 5 is DESIGN-ONLY — it produces an interaction design + a follow-up build
> plan and PAUSES for an architect design review before any UI is built.**

## What Phase 4 delivered (committed, green)

An estimator can now **override any computed estimate value**, and every override + milestone
is **recorded** for an audit trail — *as a data + engine + audit layer*. There is no UI to set
an override yet (that is the Phase 5 glass box); Phase 4 is the foundation it reads/writes.

An override is an **input layer, never a destructive edit**: the engine uses `overrideValue` in
place of the computed value but **always carries the computed value alongside** so Phase 5 can
show both.

### Schema (applied live + in the source of truth)
- **New append-only `estimate_overrides` table** (Table 13 in `supabase_schema.sql`; migration
  record at `supabase_migration_estimate_overrides.sql`). Columns: `id, project_id, field,
  computed_value, override_value, reason, created_by, created_at`. One immutable row per override
  EVENT; the LATEST row per `(project_id, field)` wins; `override_value IS NULL` = a REVERT
  tombstone; an `override_value` of `0` is a REAL override (INV-3).
- RLS: tenant-scoped SELECT + INSERT (inline `(SELECT tenant_id FROM users WHERE id = auth.uid())`
  form), **NO UPDATE/DELETE policy** → immutable to clients. Mirrors classification_history /
  estimate_snapshots. Applied to live DB `nefvkrhbbkiqnpeabyqz`; `get_advisors` shows **no new**
  WARN (still the 2 deferred cost_code_map/rate_card UPDATE policies + leaked-password).
  `supabase_schema.sql` (15 tables) provably matches live.

### Code
- **`src/types/index.ts`** — `EstimateOverrideRecord` (audit row) + `EstimateOverrideMap`
  (resolved field→value).
- **`src/lib/calculations.ts`** — `OVERRIDABLE_SUMMARY_FIELDS` (the 9 overridable keys: subtotal,
  7 modifiers, totalEstimatedCost) + `computeTakeoffSummary` gains an optional trailing
  `overrides?: EstimateOverrideMap`. Effective value = `override ?? computed` (presence by
  `hasOwnProperty`, so an explicit 0 is honored — INV-3). A direct `totalEstimatedCost` override
  wins; otherwise total = sum of EFFECTIVE components (INV-4 holds). Overriding the subtotal does
  **not** recompute modifiers (no compounding — AGENTS.md). Returns an optional
  `summary.overrides` companion `{ computedValue, overrideValue }` per overridden field — present
  ONLY when ≥1 override. **With no overrides arg the engine is byte-identical to before** (golden
  McKenna still ties to $0.00).
- **`src/lib/overrides.ts`** (NEW, pure) — `reduceLatestActiveOverrides(records)` → active
  field→value map (latest-per-field by `createdAt`; null override = drop; 0 kept).
- **`src/lib/db.ts`** — `recordEstimateOverride(...)` (append-only INSERT, stamps `created_by`
  from session, **THROWS on error** — financial intent, NOT fire-and-forget) + `getEstimateOverrides(projectId)`
  (full trail, newest first) + `mapOverrideFromRow`. **No update/delete path** (immutability).
- **`src/hooks/useEstimateOverrides.ts`** (NEW) — loads the trail at mount, exposes
  `{ activeOverrides, overrideRecords, refresh }`. Read-only here; Phase 5's setter UI calls
  `db.recordEstimateOverride` then `refresh()`.
- **`src/app/projects/[projectId]/page.tsx`** — threads `activeOverrides` into the
  `computeTakeoffSummary` call (so a persisted override applies on reload); computes
  `isNewEstimate = !projectEstimate` for the first-save milestone.
- **Audit milestone snapshots** (reuse `createEstimateSnapshot`, fire-and-forget `.catch(()=>{})`):
  - `useExportHandlers.ts` — a `'milestone'` snapshot after a successful **workbook** and
    **Procore** export (the version sent out).
  - `useEstimatePersistence.ts` — a one-time `'milestone'` "Estimate created" snapshot on the
    FIRST successful save of a brand-new estimate (guarded by a ref + `isNewEstimate`).
  - (The `pre_import` snapshot from Phase 3 still fires before every import.)

### Tests / status
- New: `src/lib/__tests__/overrides.test.ts` (6 — reduce), `calculationsOverrides.test.ts` (7 —
  engine apply incl. inert, markup, 0, total, no-compounding, multi), `estimateOverridesDb.test.ts`
  (8 — append insert/throws, read/map, immutability guard, round-trip).
- `npm run test` → **351 passed + 1 todo** (was 330+1; the 1 todo is INV-7 / Phase 5). `tsc
  --noEmit` clean. **McKenna golden harness ran with the fixture present and STILL ties STEP 4 to
  $0.00** — regression gate held. Phase 3 import behavior unchanged.

## Decisions made this phase (architect-approved)
- **Override scope = "Any line, total = sum"** (terminal substitution; total directly overridable;
  computed always retained; no compounding).
- **Milestone snapshots = "Export + first save"** (plus the existing pre_import). NOT every
  auto-save (would flood the table).
- **Storage = dedicated append-only `estimate_overrides` table** (a real audit trail, over a JSONB
  blob).

## ⚠️ REQUIRED Phase 5 task — export must apply overrides (INV-1)
The export path does **not** yet apply overrides: `exporter.ts` recomputes summary modifiers via
`computeTakeoffSummary` **without** passing `overrides`, and `generateExcelWorkbook` writes modifier
**formulas** (`F*$I$subtotal`) that recompute in-sheet. The SAVED `project_estimates` totals *do*
reflect overrides (auto-save persists the effective `takeoffSummary`). **In Phase 4 this can never
diverge** because there is no setter UI — `activeOverrides` is always `{}` through the app, so
on-screen == saved == exported. **But the moment Phase 5 ships the setter, the export path MUST
apply overrides** (thread `activeOverrides` into `generateExcelPayload` / `generateProcoreBudget` /
`generateExcelWorkbook`, writing override VALUES instead of the recomputing formula for an
overridden modifier) or saved/on-screen totals will diverge from the exported workbook — a direct
INV-1 ("on-screen == saved == exported") violation. Treat this as a first-class Phase 5 build item,
not an afterthought.

## Where Phase 5 starts — Visual Trust UI (glass box), DESIGN ONLY
Per the plan's **Phase 5**. Read the plan + this handoff, then the estimate UI
(`src/app/projects/[projectId]/page.tsx`, `src/components/workspace/EstimateTable.tsx`,
`src/hooks/useTakeoffWorkbook.tsx`) and `validateExportReadiness` in `src/lib/exporter.ts`.

- **Three surfaces** (5a click-to-trace, 5b reconciliation view, 5c provenance & override flags) —
  each largely a *view* over data the engine already returns.
- **The override data layer is ready for the glass box:** `summary.overrides[field] =
  { computedValue, overrideValue }` exposes BOTH numbers for an "⚑ overridden" flag; the setter is
  `db.recordEstimateOverride(projectId, field, computedValue, overrideValue, reason)` followed by
  `useEstimateOverrides().refresh()`; revert = record with `overrideValue: null`; the audit log is
  `overrideRecords` (full trail, newest first). `OVERRIDABLE_SUMMARY_FIELDS` is the clickable set.
- `ProcessedTakeoffRow.needsReview` (Phase 3) is a natural companion — a needsReview row is exactly
  what the override surface should let an estimator resolve and record.
- **DESIGN ONLY:** produce an interaction design + a follow-up build plan, then **PAUSE for an
  architect design review before building any UI** (and fold in the export-applies-override task above).

## Carried-forward backlog (NOT Phase 5 scope unless pulled in) — `docs/backlog-math-trust.md`
B-1 CI-safe synthetic template fixture; B-2 born-in-app GC/Site-Ops golden; B-3 rounding-default
decision + Phase 5 visibility (relates to 5b); B-4 inline-recoverable unmapped import rows (relates
to 5c). Do not let them evaporate across sessions.

**Stop after Phase 4 — do not begin Phase 5 in this session.**
