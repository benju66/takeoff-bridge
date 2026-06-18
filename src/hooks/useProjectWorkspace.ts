"use client";

import { useState, useEffect } from "react";
import { Project, ProjectEstimate } from "@/types/db";
import { getProject, getProjectEstimate, getSectionLines, saveProject } from "@/lib/db";
import { getMonthsBetween } from "@/lib/calculations";
import { deriveRemovedCodesFromLines } from "@/lib/sectionLines/project";

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
}

const NO_REMOVED_CODES: { gc: string[]; siteOps: string[] } = { gc: [], siteOps: [] };

export function useProjectWorkspace(projectId: string): UseProjectWorkspaceReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [projectEstimate, setProjectEstimate] = useState<Omit<ProjectEstimate, "items"> | null>(null);
  const [persistedRemovedCodes, setPersistedRemovedCodes] = useState<{ gc: string[]; siteOps: string[] }>(NO_REMOVED_CODES);
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
      setError(null);
    });

    (async () => {
      try {
        // The section-lines read is FAIL-SOFT (B4): the table is non-authoritative until
        // B6, so a read failure must never block the project load — it just falls back to
        // the full catalog (no removals).
        const [meta, estimate, sectionLines] = await Promise.all([
          getProject(projectId),
          getProjectEstimate(projectId),
          getSectionLines(projectId).catch(() => []),
        ]);
        if (!cancelled) {
          setProject(meta);
          setProjectEstimate(estimate);
          // Removal only applies to app-born projects (D4): an imported project's
          // persisted lines are the frozen `imported_step23_lines` whose codes need not
          // match the catalog, so deriving removed-codes from them is meaningless. Skip it.
          setPersistedRemovedCodes(
            meta?.isImported ? NO_REMOVED_CODES : deriveRemovedCodesFromLines(sectionLines)
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
  };
}
