import type { PauseReason, ProjectStatus } from "../constants.js";
import type { ProjectExecutionWorkspacePolicy, WorkspaceRuntimeService } from "./workspace-runtime.js";

export type ProjectWorkspaceSourceType = "local_path" | "git_repo" | "remote_managed" | "non_git_path";
export type ProjectWorkspaceVisibility = "default" | "advanced";

export interface ProjectGoalRef {
  id: string;
  title: string;
}

export interface ProjectWorkspace {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  sourceType: ProjectWorkspaceSourceType;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  defaultRef: string | null;
  visibility: ProjectWorkspaceVisibility;
  setupCommand: string | null;
  cleanupCommand: string | null;
  remoteProvider: string | null;
  remoteWorkspaceRef: string | null;
  sharedWorkspaceKey: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
  runtimeServices?: WorkspaceRuntimeService[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectCodebaseOrigin = "local_folder" | "managed_checkout";

export interface ProjectCodebase {
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  defaultRef: string | null;
  repoName: string | null;
  localFolder: string | null;
  managedFolder: string;
  effectiveLocalFolder: string;
  origin: ProjectCodebaseOrigin;
}

export interface ProjectIssueStatus {
  id: string;
  projectId: string;
  companyId: string;
  name: string;
  value: string;
  color: string;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectNotificationEventType = "issue.status_changed" | "issue.comment_added" | "issue.assigned";
export type ProjectNotificationChannel = "email";
export type ProjectNotificationRecipientRole = "issue_assignee_user" | "issue_creator_user";

export interface ProjectNotificationRule {
  enabled?: boolean;
  channels?: ProjectNotificationChannel[];
  notifyRoles?: ProjectNotificationRecipientRole[];
  onlyIfActorIsAgent?: boolean;
  statuses?: string[];
}

export interface ProjectNotificationConfig {
  enabled?: boolean;
  defaultChannels?: ProjectNotificationChannel[];
  rules?: Partial<Record<ProjectNotificationEventType, ProjectNotificationRule>>;
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
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  executionWorkspacePolicy: ProjectExecutionWorkspacePolicy | null;
  /**
   * Project-level env mapping: env var name -> company secret name.
   * The runtime resolves secret names to concrete secret values when agents run project issues.
   */
  envConfig: Record<string, string> | null;
  notificationConfig?: ProjectNotificationConfig | null;
  codebase: ProjectCodebase;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
