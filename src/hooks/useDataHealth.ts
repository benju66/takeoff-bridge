"use client";

import { useEffect, useState } from "react";
import {
  getProjects,
  getEstimateTotalsByProject,
  getLineItemHealthFacts,
  getBidPriceHistory,
  getImportedStep23History,
  getCustomStep23LineDefs,
  getCatalogAdditions,
} from "@/lib/db";
import { step23Observations, type Step23HistorySource } from "@/lib/step23Normalization";
import { primeCatalogAdditionOverlays } from "@/lib/catalogAdditionOverlays";
import {
  computeDataHealth,
  type DataHealthFinding,
  type LineItemHealthFact,
} from "@/lib/dataHealth";
import type { Project, CustomStep23LineDef, CatalogAddition } from "@/types/db";
import type { PriceObservation } from "@/lib/priceHistory";

/**
 * useDataHealth — the ONE loader for both Data Health surfaces (fidelity
 * Phase 4): the /data-health company dashboard and the per-project workspace
 * strip. Fetches every audit input through db.ts in parallel, primes the
 * catalog-additions overlay (so the engine's getCatalogItems() chokepoint
 * read covers in-app additions), and runs the pure engine once.
 *
 * FAIL-SOFT per source (the /rates idiom): one outage degrades that source to
 * empty and the rest of the audit still runs — but unlike a price report, an
 * AUDIT that silently skips a category would lie, so every failed source's
 * name is surfaced for the page's honesty banner.
 */
export interface DataHealthState {
  findings: DataHealthFinding[];
  /** Names of sources that failed to load — findings from them are absent. */
  failedSources: string[];
  isLoading: boolean;
}

export function useDataHealth(): DataHealthState {
  const [state, setState] = useState<DataHealthState>({
    findings: [],
    failedSources: [],
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const failed: string[] = [];
      const soft = async <T,>(label: string, fallback: T, fetcher: () => Promise<T>): Promise<T> => {
        try {
          return await fetcher();
        } catch (err) {
          console.error(`Data Health source failed (${label}):`, err);
          failed.push(label);
          return fallback;
        }
      };

      const [projects, estimateTotals, lineItems, step4Obs, step23Sources, customDefs, additions] =
        await Promise.all([
          soft("projects", [] as Project[], getProjects),
          soft("estimate totals", new Map<string, number>(), getEstimateTotalsByProject),
          soft("line items", [] as LineItemHealthFact[], getLineItemHealthFacts),
          soft("bid price history", [] as PriceObservation[], getBidPriceHistory),
          soft("imported STEP 2/3 detail", [] as Step23HistorySource[], getImportedStep23History),
          soft("custom GC/Site-Ops codes", [] as CustomStep23LineDef[], getCustomStep23LineDefs),
          soft("catalog additions", [] as CatalogAddition[], getCatalogAdditions),
        ]);
      if (cancelled) return;

      // Prime only on a SUCCESSFUL fetch: priming [] clears every overlay, so
      // a failed fetch must not wipe a prime another page already installed.
      if (!failed.includes("catalog additions")) {
        primeCatalogAdditionOverlays(additions);
      }

      setState({
        findings: computeDataHealth({
          projects,
          estimateTotals,
          lineItems,
          step4Observations: step4Obs,
          step23Observations: step23Observations(step23Sources, customDefs),
          customDefs,
          additions,
        }),
        failedSources: failed,
        isLoading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
