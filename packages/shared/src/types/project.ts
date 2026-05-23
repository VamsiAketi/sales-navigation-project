import type {
  PauseReason,
  ProjectIssueStatusAllowedActors,
  ProjectStatus,
  ProjectContextFileExtractionStatus,
  ProjectContextSnapshotKind,
  ProjectMaintenanceRequestType,
  ProjectMaintenanceRequestStatus,
  ProjectMaintenanceRiskClass,
  ProjectDataObjectKind,
  ProjectViewWidgetType,
  ProjectChangeSource,
} from "../constants.js";
import type {
  ProjectExecutionWorkspacePolicy,
  ProjectWorkspaceRuntimeConfig,
  WorkspaceRuntimeService,
} from "./workspace-runtime.js";

export type ProjectWorkspaceSourceType = "local_path" | "git_repo" | "remote_managed" | "non_git_path";
export type ProjectWorkspaceVisibility = "default" | "advanced";

export interface ProjectGoalRef {
  id: string;
  title: string;
}

/** Minimal project fields for nav/breadcrumb lookups (no workspaces or goals). */
export interface ProjectNavItem {
  id: string;
  companyId: string;
  name: string;
  urlKey: string;
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
  runtimeConfig: ProjectWorkspaceRuntimeConfig | null;
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
  isHumanApproval: boolean;
  approverUserIds: string[];
  allowedActors: ProjectIssueStatusAllowedActors;
  description?: string | null;
  agentInstructions?: string | null;
  agentCapabilityTags?: string[];
  defaultAssigneeUserId: string | null;
  defaultAssigneeAgentId: string | null;
  /** Status `value` keys allowed as the next stage; empty = any transition allowed by global rules. */
  allowedNextStatusValues: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDocument {
  id: string;
  companyId: string;
  projectId: string;
  documentId: string;
  key: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectContextFile {
  id: string;
  companyId: string;
  projectId: string;
  assetId: string;
  title: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  extractionStatus: ProjectContextFileExtractionStatus;
  extractedText: string | null;
  extractionError: string | null;
  uploadedByUserId: string | null;
  uploadedByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectContextSnapshot {
  id: string;
  companyId: string;
  projectId: string;
  kind: ProjectContextSnapshotKind;
  body: string;
  contentHash: string;
  revisionNumber: number;
  changeSource: ProjectChangeSource;
  sourceContentHash: string | null;
  changeSummary: string | null;
  generatedByAgentId: string | null;
  generatedByRunId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface ProjectMaintenanceRequest {
  id: string;
  companyId: string;
  projectId: string;
  type: ProjectMaintenanceRequestType;
  description: string;
  contextRef: Record<string, unknown> | null;
  status: ProjectMaintenanceRequestStatus;
  changeRiskClass: ProjectMaintenanceRiskClass;
  riskReasons: string[];
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  requestedByUserId: string | null;
  heartbeatRunId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
  changeSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDataObject {
  id: string;
  companyId: string;
  projectId: string;
  kind: ProjectDataObjectKind;
  name: string;
  normalizedName: string;
  schemaName: string | null;
  definition: Record<string, unknown>;
  latestRevisionNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectView {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  normalizedName: string;
  description: string | null;
  layout: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectViewWidget {
  id: string;
  companyId: string;
  projectId: string;
  projectViewId: string;
  title: string | null;
  normalizedTitle: string | null;
  type: ProjectViewWidgetType;
  position: number;
  queryRef: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  layout: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectNotificationEventType =
  | "issue.status_changed"
  | "issue.comment_added"
  | "issue.comment_mentioned"
  | "issue.assigned";
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
  notificationConfig?: ProjectNotificationConfig | null;
  dataSchemaName?: string | null;
  /** Short uppercase key used as the prefix for issue identifiers in this project (e.g. "AIH"). */
  issuePrefix?: string | null;
  /**
   * Done/Cancelled tasks remain on the board only for this many full days after close.
   * Older closed tasks are listed under the project Archive tab. Minimum 1; default 7.
   */
  boardClosedRetentionDays: number;
  /**
   * When true, heartbeat runs for issues in this project receive all decrypted project secrets
   * in adapter env (keys derived from secret names); explicit bindings on the agent win on clashes.
   */
  exposeProjectSecretsOnIssueRuns: boolean;
  codebase: ProjectCodebase;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
  /**
   * Derived creator metadata from the earliest "project.created" activity event.
   * Optional because legacy records may not have a matching activity row.
   */
  createdByUserId?: string | null;
  createdByAgentId?: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
