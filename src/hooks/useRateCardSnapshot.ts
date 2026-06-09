"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { snapshotRateCard } from "@/lib/rateResolver";

// ---------------------------------------------------------------------------
// useRateCardSnapshot — per-project point-in-time rate freeze (Rate-card Phase B)
//
// Settled design (plan §5.3 / §5.5): an estimate captures the company rate card
// in effect when it is first saved; calc then reads that frozen snapshot, NOT
// the live card. Card edits (Phase C /rates editor) therefore apply to FUTURE
// projects only. Resolution chain (composed in the calc hooks):
//   rate = projectOverride ?? projectSnapshot ?? companyCard ?? constants
//
// Lifecycle:
//   - load: init from the loaded estimate's rate_card_snapshot (frozen already).
//   - new project (empty snapshot): calc falls through to the live card while
//     editing; freezeRateCardSnapshot() captures the card at first save.
//   - frozen: freeze is idempotent — returns the existing snapshot unchanged.
// ---------------------------------------------------------------------------

export interface UseRateCardSnapshotReturn {
  /** The effective per-project snapshot (`{}` until frozen). Fed to the calc hooks. */
  rateCardSnapshot: Record<string, number>;
  /**
   * Returns the snapshot to persist on this save and promotes it to state.
   * Idempotent: once frozen (non-empty) it returns the same object; on a new
   * project it captures the currently-primed card. If the card is not primed
   * yet it returns `{}` and a later save freezes it.
   */
  freezeRateCardSnapshot: () => Record<string, number>;
}

export function useRateCardSnapshot(
  isLoaded: boolean,
  initialSnapshot?: Record<string, number>
): UseRateCardSnapshotReturn {
  const [rateCardSnapshot, setRateCardSnapshot] = useState<Record<string, number>>({});

  // One-time DB sync (mirrors the calc hooks): apply the loaded snapshot once
  // estimate data arrives. Only a non-empty snapshot freezes the project; an
  // empty one leaves calc reading the live card until first save.
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (isLoaded && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (initialSnapshot && Object.keys(initialSnapshot).length > 0) {
        setRateCardSnapshot(initialSnapshot);
      }
    }
  }, [isLoaded, initialSnapshot]);

  // Reset on project change (isLoaded goes false during navigation) so a new
  // project never inherits the previous project's frozen snapshot.
  useEffect(() => {
    if (!isLoaded) {
      hasInitializedRef.current = false;
      setRateCardSnapshot({});
    }
  }, [isLoaded]);

  // Stable ref so the freeze closure always reads the latest snapshot without
  // re-creating itself on every change.
  const snapshotRef = useRef(rateCardSnapshot);
  useEffect(() => { snapshotRef.current = rateCardSnapshot; }, [rateCardSnapshot]);

  const freezeRateCardSnapshot = useCallback((): Record<string, number> => {
    const current = snapshotRef.current;
    if (Object.keys(current).length > 0) return current; // already frozen — idempotent
    const card = snapshotRateCard();
    if (card && Object.keys(card).length > 0) {
      setRateCardSnapshot(card);
      return card;
    }
    return {}; // card not primed yet — persist empty; a later save freezes it
  }, []);

  return { rateCardSnapshot, freezeRateCardSnapshot };
}
