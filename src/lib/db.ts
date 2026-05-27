import { Project, ProjectEstimate } from "@/types/db";

const PROJECTS_KEY = "takeoff_projects";
const ESTIMATE_PREFIX = "takeoff_estimate_";

/**
 * Returns true if running in a client browser environment.
 */
function isClient(): boolean {
  return typeof window !== "undefined";
}

/**
 * Retrieves all saved projects from local storage.
 */
export function getProjects(): Project[] {
  if (!isClient()) return [];
  const saved = localStorage.getItem(PROJECTS_KEY);
  if (!saved) return [];
  try {
    return JSON.parse(saved) as Project[];
  } catch (e) {
    console.error("Failed to parse projects from local storage", e);
    return [];
  }
}

/**
 * Retrieves a single project by its unique ID.
 */
export function getProject(projectId: string): Project | null {
  const projects = getProjects();
  return projects.find((p) => p.id === projectId) || null;
}

/**
 * Saves or updates a project record in local storage.
 */
export function saveProject(project: Project): void {
  if (!isClient()) return;
  const projects = getProjects();
  const existingIndex = projects.findIndex((p) => p.id === project.id);
  
  if (existingIndex > -1) {
    projects[existingIndex] = project;
  } else {
    projects.push(project);
  }
  
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

/**
 * Retrieves the estimate corresponding to a project.
 */
export function getProjectEstimate(projectId: string): ProjectEstimate | null {
  if (!isClient()) return null;
  const key = `${ESTIMATE_PREFIX}${projectId}`;
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as ProjectEstimate;
  } catch (e) {
    console.error(`Failed to parse estimate for project ${projectId} from local storage`, e);
    return null;
  }
}

/**
 * Saves or updates a project estimate record in local storage.
 */
export function saveProjectEstimate(estimate: ProjectEstimate): void {
  if (!isClient()) return;
  const key = `${ESTIMATE_PREFIX}${estimate.projectId}`;
  localStorage.setItem(key, JSON.stringify(estimate));
}

/**
 * Cleanly removes the project from takeoff_projects, erases its estimate and items,
 * and clears custom key settings to prevent browser database bloating.
 */
export function deleteProjectData(projectId: string): void {
  if (!isClient()) return;
  
  // 1. Remove from "takeoff_projects" array
  const projects = getProjects();
  const filtered = projects.filter((p) => p.id !== projectId);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(filtered));

  // 2. Erase the estimate block (and any estimate items row arrays)
  localStorage.removeItem(`${ESTIMATE_PREFIX}${projectId}`);
  localStorage.removeItem(`takeoff_estimate_items_${projectId}`);

  // 3. Clear custom key settings (like user registry)
  localStorage.removeItem(`takeoff_user_registry_${projectId}`);
}

