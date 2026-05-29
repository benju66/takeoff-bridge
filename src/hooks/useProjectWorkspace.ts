"use client";

import { useState, useEffect } from "react";
import { Project } from "@/types/db";
import { getProject, saveProject } from "@/lib/db";
import { getMonthsBetween } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// useProjectWorkspace — Project metadata loading, saving, and param changes
// ---------------------------------------------------------------------------

export interface UseProjectWorkspaceReturn {
  project: Project | null;
  isLoaded: boolean;
  projectDurationMonths: number;
  handleProjectParamChange: (field: keyof Project, value: string | number) => void;
}

export function useProjectWorkspace(projectId: string): UseProjectWorkspaceReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load project metadata on mount
  useEffect(() => {
    if (!projectId) return;
    const meta = getProject(projectId);
    Promise.resolve().then(() => {
      setProject(meta);
      setIsLoaded(true);
    });
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
    saveProject(updated);
  };

  return {
    project,
    isLoaded,
    projectDurationMonths,
    handleProjectParamChange,
  };
}
