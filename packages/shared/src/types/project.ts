import type { ProjectStatus } from "../constants.js";

export interface ProjectGoalRef {
  id: string;
  title: string;
}

export interface ProjectWorkspace {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  companyId: string;
  urlKey: string;
  /** @deprecated Use goalIds / goals instead */
  goalId: string | null;
  goalIds: string[];
  goals: ProjectGoalRef[];
  name: string;
  description: string | null;
  status: ProjectStatus;
  leadAgentId: string | null;
  targetDate: string | null;
  color: string | null;
  /**
   * Maps env var name → company secret **name** (the name from Company settings).
   * Agents on this project get those env vars with values resolved from the vault.
   */
  envConfig: Record<string, string> | null;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
