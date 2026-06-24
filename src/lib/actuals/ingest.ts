/**
 * Actuals Cost-History — ingestion helpers (pure; no DB, no React).
 *
 * The bridge between dropped CSV files and the Phase 3 ingestion UI:
 *   - {@link classifyActualsCsv} routes a dropped file to one of the six export
 *     shapes by its header signature, so a user can drop all files at once and
 *     the UI can show the routing (a misread is visible, never silent).
 *   - {@link extractEmbeddedProjectToken} pulls the embedded `25-117` /
 *     "Orchard Path III" project token off the parsed export (the subcontractor
 *     commitments rows are the only export that carries it).
 *   - {@link suggestProjectMatch} picks the best existing project to attach a
 *     snapshot to from that token (number-in-name → exact name → containment).
 *
 * Kept pure and DB-decoupled (a structural `{ id, name }` stands in for the full
 * `Project`) so it is unit-testable against the real fixtures without a database.
 */

import Papa from "papaparse";
import type { RawActualsExport } from "./types";

/** Which of the six Procore export shapes a dropped CSV is. */
export type ActualsExportKind =
  | "budget"
  | "changeEventSummary"
  | "changeEventDetail"
  | "potentialChangeOrders"
  | "primeContractChangeOrders"
  | "subcontractorCommitments";

/**
 * Classify a CSV by its header row alone (BOM-tolerant; quoted headers handled
 * by PapaParse). Returns `null` when no signature matches — the caller surfaces
 * such files as "unrecognized" rather than guessing. The checks run in
 * disambiguation order: each export's most distinctive column(s) first, so an
 * ambiguous shared column (e.g. `Budget Code`, present on both budget and
 * change-event detail) never decides the match.
 */
export function classifyActualsCsv(csvText: string): ActualsExportKind | null {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    preview: 1,
    skipEmptyLines: true,
  });
  // `.trim()` also strips a leading BOM (U+FEFF is in the ECMAScript whitespace
  // set), so a BOM-prefixed first header column still matches by name.
  const fields = new Set((parsed.meta.fields ?? []).map((f) => f.trim()));
  const has = (name: string): boolean => fields.has(name);

  // Budget Detail — the only export with the cost-code tier columns.
  if (has("Cost Code Tier 1") && has("Budget Code")) return "budget";
  // Change-event DETAIL — the only export with a per-line `Event #` + `Latest Cost`.
  if (has("Event #") && has("Latest Cost")) return "changeEventDetail";
  // Change-event SUMMARY — carries the Scope/Type/Reason classification trio.
  if (has("Scope") && has("Type") && has("Reason")) return "changeEventSummary";
  // Subcontractor Commitments — the only export with the embedded project token.
  if (has("Project Number") && has("Contract Company")) {
    return "subcontractorCommitments";
  }
  // Potential Change Orders — `PCCO` / `Change Reason` are unique to it.
  if (has("PCCO") || has("Change Reason")) return "potentialChangeOrders";
  // Prime Contract Change Orders — `Designated Reviewer` / `PCO` are unique to it.
  if (has("Designated Reviewer") || has("PCO")) return "primeContractChangeOrders";

  return null;
}

/** The embedded project token carried on the subcontractor commitments export. */
export interface EmbeddedProjectToken {
  /** Project number, e.g. `"25-117"`. */
  projectNumber: string;
  /** Project name, e.g. `"Orchard Path III"`. */
  projectName: string;
}

/**
 * Pull the embedded project token (number + name) from a parsed raw export. The
 * subcontractor commitments rows are the only export that carries it; returns the
 * first row that has either field, or `null` when no commitments were uploaded /
 * none carry a token.
 */
export function extractEmbeddedProjectToken(
  raw: RawActualsExport,
): EmbeddedProjectToken | null {
  for (const c of raw.subcontractorCommitments) {
    const projectNumber = c.projectNumber.trim();
    const projectName = c.projectName.trim();
    if (projectNumber !== "" || projectName !== "") {
      return { projectNumber, projectName };
    }
  }
  return null;
}

/** A minimal project shape — keeps this module decoupled from the DB `Project`. */
export interface ProjectLike {
  id: string;
  name: string;
}

/** A suggested project to attach a snapshot to, and how it was matched. */
export interface ProjectMatchCandidate {
  projectId: string;
  projectName: string;
  /** Which signal produced the match (strongest first). */
  matchedOn: "number" | "name";
}

/** Lowercase + collapse internal whitespace for tolerant comparison. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Suggest the best existing project for an embedded token. Order of confidence:
 *   1. the project NUMBER token appears in a project name (explicit job code);
 *   2. the project NAME equals an existing name (normalized);
 *   3. one name contains the other (normalized).
 * Returns `null` when there's no token or nothing matches — the UI then leaves the
 * picker unset for a deliberate human choice (never auto-attaches on a guess).
 */
export function suggestProjectMatch(
  token: EmbeddedProjectToken | null,
  projects: ProjectLike[],
): ProjectMatchCandidate | null {
  if (!token) return null;

  const num = token.projectNumber.trim().toLowerCase();
  if (num !== "") {
    for (const p of projects) {
      if (normalizeName(p.name).includes(num)) {
        return { projectId: p.id, projectName: p.name, matchedOn: "number" };
      }
    }
  }

  const name = normalizeName(token.projectName);
  if (name !== "") {
    for (const p of projects) {
      if (normalizeName(p.name) === name) {
        return { projectId: p.id, projectName: p.name, matchedOn: "name" };
      }
    }
    for (const p of projects) {
      const pn = normalizeName(p.name);
      if (pn !== "" && (pn.includes(name) || name.includes(pn))) {
        return { projectId: p.id, projectName: p.name, matchedOn: "name" };
      }
    }
  }

  return null;
}
