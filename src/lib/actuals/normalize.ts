/**
 * Actuals Cost-History — the normalization engine (pure; no DB, no UI).
 *
 * Given a parsed {@link RawActualsExport}, this:
 *   1. Joins change-event detail ↔ summary by canonical event id.
 *   2. Classifies each event into a {@link NormalizationBucket}.
 *   3. Nets out genuinely net-zero Internal reclasses (and flags non-net-zero ones).
 *   4. Dedups events sharing a cost-side fingerprint (e.g. the 97/98 pair).
 *   5. Computes per `code+costType`: totalActual (= EAC) and normalizedActual
 *      (EAC minus the normalized-out change-event contributions).
 *   6. Splits Fee/GL burden from direct cost.
 *   7. Reports every ambiguity as a diagnostic — nothing is silently dropped.
 *
 * The budget export's EAC is the authority for totalActual; the change-event
 * detail is used only to subtract classified contributions and to identify the
 * burden split. This keeps cost overruns not captured by a CO inside the
 * normalized number, per the plan's locked top-down definition.
 */

import { classifyChangeEvent } from "./classify";
import { buildGrainKey, round2 } from "./currency";
import type {
  RawActualsExport,
  NormalizedActuals,
  ClassifiedChangeEvent,
  CodeActual,
  CodeChangeContribution,
  ChangeEventDetailRow,
  ChangeEventSummaryRow,
  ActualsDiagnostics,
  UnclassifiedEventFlag,
} from "./types";

/** Tolerance (in dollars) for the net-zero Internal-reclass test. */
const NET_ZERO_EPS = 0.01;

/** The two Procore burden codes — Fee and General Liability Insurance markup. */
export const FEE_CODE = "60-604000.000";
export const GL_INSURANCE_CODE = "60-602020.000";
const BURDEN_CODES = new Set([FEE_CODE, GL_INSURANCE_CODE]);

/** True for the Fee / GL insurance burden codes (kept separable from direct cost). */
export function isBurdenCode(costCode: string): boolean {
  return BURDEN_CODES.has(costCode);
}

/**
 * A stable, dollar-aware fingerprint of an event's detail lines plus its
 * classification. Two events with the same fingerprint are duplicates (e.g.
 * events 97 & 98, both −$41,476.26 on Thermal Insulation); same-title events
 * with different amounts (79 & 72 "Additional Build Wrap") fingerprint apart.
 */
function eventFingerprint(ev: {
  title: string;
  scope: string;
  type: string;
  reason: string;
  lines: ChangeEventDetailRow[];
}): string {
  const lineSig = ev.lines
    .map((l) => `${l.costCode}|${l.costType}|${round2(l.latestCost).toFixed(2)}`)
    .sort()
    .join(";");
  return [ev.title.trim(), ev.scope, ev.type, ev.reason, lineSig].join("##");
}

/**
 * Compute total + normalized actuals per code+type from a raw export bundle.
 */
export function computeNormalizedActuals(raw: RawActualsExport): NormalizedActuals {
  // --- index detail lines by canonical event id -----------------------------
  const detailByEvent = new Map<string, ChangeEventDetailRow[]>();
  for (const line of raw.changeEventDetail) {
    const list = detailByEvent.get(line.eventId);
    if (list) list.push(line);
    else detailByEvent.set(line.eventId, [line]);
  }

  // --- index summary rows by canonical event id -----------------------------
  const summaryByEvent = new Map<string, ChangeEventSummaryRow>();
  for (const s of raw.changeEventSummary) summaryByEvent.set(s.eventId, s);

  const diagnostics: ActualsDiagnostics = {
    unjoinedDetailEventIds: [],
    summaryOnlyEventIds: [],
    duplicateEventGroups: [],
    unattributedDetailLineCount: 0,
    internalNonZeroEventIds: [],
    unclassifiedEvents: [],
  };

  // --- build the ordered, classified event list -----------------------------
  // Summary file order first (the classification authority), then any
  // detail-only events appended so nothing is dropped.
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const s of raw.changeEventSummary) {
    if (!seenIds.has(s.eventId)) {
      seenIds.add(s.eventId);
      orderedIds.push(s.eventId);
    }
  }
  for (const line of raw.changeEventDetail) {
    if (!seenIds.has(line.eventId)) {
      seenIds.add(line.eventId);
      orderedIds.push(line.eventId);
    }
  }

  const events: ClassifiedChangeEvent[] = [];
  const fingerprintFirst = new Map<string, string>(); // fingerprint -> kept eventId
  const duplicateGroups = new Map<string, string[]>(); // kept eventId -> suppressed[]

  for (const eventId of orderedIds) {
    const summary = summaryByEvent.get(eventId);
    const lines = detailByEvent.get(eventId) ?? [];

    if (!summary) diagnostics.unjoinedDetailEventIds.push(eventId);
    if (summary && lines.length === 0) diagnostics.summaryOnlyEventIds.push(eventId);

    const scope = summary?.scope ?? "Unclassified";
    const type = summary?.type ?? "Unclassified";
    const reason = summary?.reason ?? "Unclassified";
    const title = summary?.title ?? lines[0]?.eventTitle ?? "";
    const status = summary?.status ?? "";

    const netLatestCost = round2(lines.reduce((sum, l) => sum + l.latestCost, 0));

    // Base disposition, then refine the net-zero Internal-reclass test.
    let { bucket, isNormalizedOut } = classifyChangeEvent(scope, type, reason);
    if (bucket === "internal_reclass" && Math.abs(netLatestCost) >= NET_ZERO_EPS) {
      // Internal-reason but NOT a net-zero shuffle — keep it (real cost) + flag.
      bucket = "internal_nonzero";
      isNormalizedOut = false;
      diagnostics.internalNonZeroEventIds.push(eventId);
    }

    // Count blank-code lines that cannot be attributed to any code.
    for (const l of lines) if (l.costCode === "") diagnostics.unattributedDetailLineCount++;

    if (bucket === "unclassified") {
      const flag: UnclassifiedEventFlag = {
        eventId,
        title,
        scope,
        type,
        reason,
        netLatestCost,
      };
      diagnostics.unclassifiedEvents.push(flag);
    }

    // Duplicate detection by cost-side fingerprint.
    const fp = eventFingerprint({ title, scope, type, reason, lines });
    let isDuplicate = false;
    let duplicateOf: string | undefined;
    const keptId = fingerprintFirst.get(fp);
    if (keptId !== undefined && lines.length > 0) {
      isDuplicate = true;
      duplicateOf = keptId;
      const group = duplicateGroups.get(keptId) ?? [];
      group.push(eventId);
      duplicateGroups.set(keptId, group);
    } else if (lines.length > 0) {
      fingerprintFirst.set(fp, eventId);
    }

    events.push({
      eventId,
      title,
      scope,
      type,
      reason,
      status,
      bucket,
      isNormalizedOut,
      lines,
      netLatestCost,
      isDuplicate,
      duplicateOf,
    });
  }

  for (const [keptEventId, suppressedEventIds] of duplicateGroups) {
    diagnostics.duplicateEventGroups.push({ keptEventId, suppressedEventIds });
  }

  // --- seed per-code actuals from the budget export (EAC is the authority) ---
  const codeMap = new Map<string, CodeActual>();
  for (const b of raw.budget) {
    const key = b.budgetCode;
    const existing = codeMap.get(key);
    if (existing) {
      // Defensive: a repeated grain key accumulates rather than overwrites.
      existing.totalActual = round2(existing.totalActual + b.estimatedCostAtCompletion);
      existing.normalizedActual = existing.totalActual;
      existing.originalBudget = round2(existing.originalBudget + b.originalBudget);
    } else {
      codeMap.set(key, {
        budgetCode: key,
        costCode: b.costCode,
        costType: b.costType,
        description: b.budgetCodeDescription,
        originalBudget: round2(b.originalBudget),
        totalActual: round2(b.estimatedCostAtCompletion),
        normalizedActual: round2(b.estimatedCostAtCompletion),
        isBurden: isBurdenCode(b.costCode),
        normalizedOutContributions: [],
      });
    }
  }

  // --- subtract normalized-out contributions per code -----------------------
  for (const ev of events) {
    if (!ev.isNormalizedOut || ev.isDuplicate) continue;
    for (const line of ev.lines) {
      if (line.costCode === "") continue; // unattributed — already counted
      if (line.latestCost === 0) continue;
      const key = buildGrainKey(line.costCode, line.costType);
      const contribution: CodeChangeContribution = {
        eventId: ev.eventId,
        bucket: ev.bucket,
        amount: round2(line.latestCost),
      };
      let target = codeMap.get(key);
      if (!target) {
        // A normalized-out cost on a code with no budget line: surface it as a
        // zero-total synthetic code so the books still balance (never dropped).
        target = {
          budgetCode: key,
          costCode: line.costCode,
          costType: line.costType,
          description: "",
          originalBudget: 0,
          totalActual: 0,
          normalizedActual: 0,
          isBurden: isBurdenCode(line.costCode),
          normalizedOutContributions: [],
        };
        codeMap.set(key, target);
      }
      target.normalizedOutContributions.push(contribution);
      target.normalizedActual = round2(target.normalizedActual - line.latestCost);
    }
  }

  // --- roll up grand totals --------------------------------------------------
  const codeActuals = Array.from(codeMap.values());
  let grandTotalActual = 0;
  let grandNormalizedActual = 0;
  let burdenTotalActual = 0;
  for (const c of codeActuals) {
    grandTotalActual += c.totalActual;
    grandNormalizedActual += c.normalizedActual;
    if (c.isBurden) burdenTotalActual += c.totalActual;
  }
  grandTotalActual = round2(grandTotalActual);
  grandNormalizedActual = round2(grandNormalizedActual);
  burdenTotalActual = round2(burdenTotalActual);

  return {
    codeActuals,
    events,
    grandTotalActual,
    grandNormalizedActual,
    burdenTotalActual,
    directTotalActual: round2(grandTotalActual - burdenTotalActual),
    diagnostics,
  };
}
