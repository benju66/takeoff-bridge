"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Project, ProjectEstimate } from "@/types/db";
import { getProject, getProjectEstimate, saveProject } from "@/lib/db";
import { getMonthsBetween } from "@/lib/calculations";

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
  /** Applies SEVERAL project fields atomically: one functional setProject +
   *  ONE saveProject. Round-trip Phase 5+ uses this — looping the per-field
   *  handler would let each call's stale `project` spread overwrite the
   *  previous field, and the racing saves could persist partial snapshots.
   *  Stable identity (no `project` capture). */
  applyProjectFields: (fields: Partial<Project>) => void;
}

export function useProjectWorkspace(projectId: string): UseProjectWorkspaceReturn {
  const [project, setProject] = useState<Project | null>(null);
  // Latest project for applyProjectFields' merge base (see below)
  const projectRef = useRef<Project | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const [projectEstimate, setProjectEstimate] = useState<Omit<ProjectEstimate, "items"> | null>(null);
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
      setError(null);
    });

    (async () => {
      try {
        const [meta, estimate] = await Promise.all([
          getProject(projectId),
          getProjectEstimate(projectId),
        ]);
        if (!cancelled) {
          setProject(meta);
          setProjectEstimate(estimate);
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

  // Atomic multi-field mutation. The ref (not the render closure) is the
  // merge base AND is advanced synchronously, so several calls in one tick
  // chain instead of overwriting each other; each call issues ONE save of
  // its full merged snapshot. (A setState-updater side effect would double-
  // save under StrictMode; a closure base would lose all but the last call.)
  const applyProjectFields = useCallback((fields: Partial<Project>) => {
    const prev = projectRef.current;
    if (!prev) return;
    const updated = { ...prev, ...fields };
    projectRef.current = updated;
    setProject(updated);
    saveProject(updated).catch((err) => {
      console.error('Failed to save project parameters:', err);
      setError(err instanceof Error ? err.message : 'Failed to save project');
    });
  }, []);

  // Project parameter mutation handler (single field — UI inputs)
  const handleProjectParamChange = (field: keyof Project, value: string | number) => {
    if (!project) return;
    applyProjectFields({ [field]: value });
  };

  return {
    project,
    projectEstimate,
    isLoaded,
    error,
    projectDurationMonths,
    handleProjectParamChange,
    applyProjectFields,
  };
}
