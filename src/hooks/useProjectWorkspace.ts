"use client";

import { useState, useEffect } from "react";
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
}

export function useProjectWorkspace(projectId: string): UseProjectWorkspaceReturn {
  const [project, setProject] = useState<Project | null>(null);
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
  };
}
