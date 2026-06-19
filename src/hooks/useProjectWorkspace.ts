"use client";

import { useState, useEffect } from "react";
import { Project, ProjectEstimate, EstimateSectionLine } from "@/types/db";
import { getProject, getProjectEstimate, getSectionLines, saveProject } from "@/lib/db";
import { getMonthsBetween } from "@/lib/calculations";
import { deriveRemovedCodesFromLines, deriveOneOffsFromLines } from "@/lib/sectionLines/project";
import { sectionLinesToBlobs } from "@/lib/sectionLines/synthesize";

// ---------------------------------------------------------------------------
// useProjectWorkspace — Project metadata loading, saving, and param changes
// ---------------------------------------------------------------------------

export interface UseProjectWorkspaceReturn {
  project: Project | null;
  projectEstimate: Omit<ProjectEstimate, "items"> | null;
  isLoaded: boolean;
  error: string | null;
  projectDurationMonths: number;
  handleProjectParamChange: (field: keyof Project, value: string | number) => void;
  /**
   * GC/Site-Ops Addressability Phase B4 (D2): the catalog codes REMOVED on this project,
   * derived from the persisted `estimate_section_lines` at load (catalog − present). The
   * page threads these into the calc hooks as `initialRemovedCodes` — APP-BORN ONLY (the
   * caller passes `undefined` for imported projects, D4). Referentially stable (stored in
   * state) so the hooks' one-time apply fires exactly once.
   */
  persistedRemovedCodes: { gc: string[]; siteOps: string[] };
  /**
   * GC/Site-Ops Addressability Phase B5 (D1): the persisted ONE-OFF lines on this project,
   * reconstructed from the `source: 'manual'` `estimate_section_lines` at load. The page
   * threads these into the calc hooks as `initialOneOffLines` — APP-BORN ONLY (empty for
   * imported projects, D4). Referentially stable (state) so the hooks' one-time apply fires once.
   */
  persistedOneOffLines: { gc: EstimateSectionLine[]; siteOps: EstimateSectionLine[] };
}

const NO_REMOVED_CODES: { gc: string[]; siteOps: string[] } = { gc: [], siteOps: [] };
const NO_ONE_OFFS: { gc: EstimateSectionLine[]; siteOps: EstimateSectionLine[] } = { gc: [], siteOps: [] };

export function useProjectWorkspace(projectId: string): UseProjectWorkspaceReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [projectEstimate, setProjectEstimate] = useState<Omit<ProjectEstimate, "items"> | null>(null);
  const [persistedRemovedCodes, setPersistedRemovedCodes] = useState<{ gc: string[]; siteOps: string[] }>(NO_REMOVED_CODES);
  const [persistedOneOffLines, setPersistedOneOffLines] = useState<{ gc: EstimateSectionLine[]; siteOps: EstimateSectionLine[] }>(NO_ONE_OFFS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load project metadata on mount
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    // Reset state for the new project (handles client-side navigation)
    Promise.resolve().then(() => {
      setIsLoaded(false);
      setProjectEstimate(null);
      setPersistedRemovedCodes(NO_REMOVED_CODES);
      setPersistedOneOffLines(NO_ONE_OFFS);
      setError(null);
    });

    (async () => {
      try {
        // Phase B6: the section-lines read is now AUTHORITATIVE — the table is the SOLE
        // store for Step 2/3 inputs (the four legacy blob columns were retired). A read
        // failure must surface as a load error (no more fail-soft fallback), so it joins
        // the Promise.all and propagates to the catch below.
        const [meta, estimate, sectionLines] = await Promise.all([
          getProject(projectId),
          getProjectEstimate(projectId),
          getSectionLines(projectId),
        ]);
        if (!cancelled) {
          setProject(meta);
          // Phase B6: reconstruct the Step 2/3 input blob records FROM the authoritative
          // section lines (the exact inverse of synthesis) and overlay them onto the
          // estimate, so the page + calc hooks consume the same blob-shaped initial state
          // they always did — with zero hook changes. APP-BORN ONLY: an imported project's
          // section lines are frozen lumpSum constants, never round-tripped through the
          // catalog inverse (D4); its hooks' output is unused (imported rides the frozen path).
          setProjectEstimate(
            estimate && !meta?.isImported
              ? { ...estimate, ...sectionLinesToBlobs(sectionLines) }
              : estimate
          );
          // Removal only applies to app-born projects (D4): an imported project's
          // persisted lines are the frozen `imported_step23_lines` whose codes need not
          // match the catalog, so deriving removed-codes from them is meaningless. Skip it.
          setPersistedRemovedCodes(
            meta?.isImported ? NO_REMOVED_CODES : deriveRemovedCodesFromLines(sectionLines)
          );
          // Phase B5 (D1): reconstruct one-off lines from the persisted `source: 'manual'`
          // rows (app-born only — imported lines are the frozen detail, D4).
          setPersistedOneOffLines(
            meta?.isImported ? NO_ONE_OFFS : deriveOneOffsFromLines(sectionLines)
          );
          setIsLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load project');
          setIsLoaded(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  // Dynamic duration calculation
  const projectDurationMonths = project
    ? getMonthsBetween(project.expectedStart || "", project.expectedFinish || "")
    : 0;

  // Project parameter mutation handler
  const handleProjectParamChange = (field: keyof Project, value: string | number) => {
    if (!project) return;
    const updated = { ...project, [field]: value };
    setProject(updated);
    saveProject(updated).catch((err) => {
      console.error('Failed to save project parameter:', err);
      setError(err instanceof Error ? err.message : 'Failed to save project');
    });
  };

  return {
    project,
    projectEstimate,
    isLoaded,
    error,
    projectDurationMonths,
    handleProjectParamChange,
    persistedRemovedCodes,
    persistedOneOffLines,
  };
}
