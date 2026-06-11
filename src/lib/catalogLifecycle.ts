/**
 * catalogLifecycle.ts — pure lifecycle rules for custom GC/Site-Ops codes
 * (Catalog Manager, Phase 1). A code's row is NEVER deleted. It transitions:
 *
 *   active → retired  (leaves every picker; still labels its old lines)
 *   active → merged   (redirects to a winner; every stored bid shows the
 *                      winner at render time — no payload is ever rewritten)
 *
 * Locked decisions (architect, 2026-06-11): merge/retire are redirects +
 * tombstones; a merge target may be any ACTIVE def — custom or built-in. This
 * module is the single source of those rules; the DB trigger (Phase 2) and the
 * db.ts write surface enforce the SAME rules so no client bug can corrupt
 * lifecycle state. Pure: no DB, no I/O, and — by construction — no dollars.
 * Codes are labels and resolver targets only; nothing here moves a total.
 */

/** A custom code's lifecycle state. Absent on a def === 'active' (every legacy
 *  row and built-in degrades unchanged). */
export type CatalogLifecycleStatus = "active" | "retired" | "merged";

/** The minimal shape these rules operate on — both `Step23LineDef` and
 *  `CustomStep23LineDef` satisfy it structurally. */
export interface LifecycleDef {
  code: string;
  status?: CatalogLifecycleStatus;
  /** Winning code when `status === 'merged'`; null/absent otherwise. */
  mergedInto?: string | null;
}

/** A def with no explicit status is active. */
export function statusOf(def: LifecycleDef): CatalogLifecycleStatus {
  return def.status ?? "active";
}

export function isActive(def: LifecycleDef): boolean {
  return statusOf(def) === "active";
}

/**
 * Validates a proposed lifecycle transition, returning a human-readable error
 * string or null when the transition is legal. Mirrored by the Phase 2 DB
 * trigger so the same rule guards both the browser and the row:
 *  - only an ACTIVE code may transition (no un-retire, no re-merge);
 *  - the only legal targets are 'retired' and 'merged';
 *  - a retired code carries no merge target;
 *  - a merged code requires a winner that is not itself and is itself ACTIVE
 *    (custom or built-in) — `isActiveWinner` is supplied by the caller, which
 *    knows the built-in code set and the live custom rows.
 */
export function transitionError(
  def: LifecycleDef,
  next: CatalogLifecycleStatus,
  winner: string | null | undefined,
  isActiveWinner: (code: string) => boolean
): string | null {
  const from = statusOf(def);
  if (from !== "active") {
    return `Code ${def.code} is ${from}; only active codes can be retired or merged.`;
  }
  if (next === "retired") {
    if (winner && winner.trim()) return "A retired code carries no merge target.";
    return null;
  }
  if (next === "merged") {
    const w = (winner ?? "").trim();
    if (!w) return "A merged code requires a winning code.";
    if (w === def.code) return "A code cannot be merged into itself.";
    if (!isActiveWinner(w)) return `Merge target ${w} must be an active GC/Site-Ops code.`;
    return null;
  }
  return `Cannot transition ${def.code} to "${next}".`;
}

/**
 * Chain-collapse rule: when `mergedCode` is merged into `winner`, every def
 * ALREADY merged into `mergedCode` must be re-pointed to `winner` so redirects
 * are always exactly one hop. Returns the codes whose `mergedInto` the caller
 * must update to `winner` (Phase 2's `mergeCustomStep23LineDef` sweep). Pure:
 * no mutation. The runtime resolver still carries a hop guard
 * (`resolveMergeTarget`) as a backstop against any redirect that slips through.
 */
export function redirectsToRepoint(
  defs: readonly LifecycleDef[],
  mergedCode: string
): string[] {
  return defs
    .filter((d) => statusOf(d) === "merged" && (d.mergedInto ?? "") === mergedCode)
    .map((d) => d.code);
}

/**
 * Follows a def's merge redirect to its winning def at render time, with a hop
 * guard so a corrupt cycle can never loop. Returns:
 *  - the def itself when it is active or retired (retired lines keep their own
 *    label — history intact);
 *  - the winning def when merged (one hop after chain-collapse, but the guard
 *    tolerates accidental chains);
 *  - null when a merged def names no winner (corrupt — resolve nothing);
 *  - the merged def itself when its named winner is unknown to `byCode` (keep
 *    labeling rather than vanish — an edge the Phase 2 trigger prevents).
 */
export function resolveMergeTarget<T extends LifecycleDef>(
  def: T | null,
  byCode: ReadonlyMap<string, T>,
  maxHops = 16
): T | null {
  let current = def;
  let hops = 0;
  while (current && statusOf(current) === "merged") {
    if (hops++ >= maxHops) break; // hop guard — never loop on a cycle
    const winner = (current.mergedInto ?? "").trim();
    if (!winner) return null; // merged with no target = corrupt
    const next = byCode.get(winner);
    if (!next) return current; // target unknown — keep labeling under the merged code
    current = next;
  }
  return current;
}
