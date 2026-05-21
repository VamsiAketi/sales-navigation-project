import type {
  Project,
  ProjectContextFile,
  ProjectDataObject,
  ProjectDocument,
  ProjectIssueStatus,
  ProjectMaintenanceRequest,
  ProjectView,
  ProjectViewWidget,
  ProjectWorkspace,
} from "@paperclipai/shared";
import { api } from "./client";

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function projectPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/projects/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${companyId}/projects`),
  get: (id: string, companyId?: string) => api.get<Project>(projectPath(id, companyId)),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${companyId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Project>(projectPath(id, companyId), data),
  listWorkspaces: (projectId: string, companyId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, companyId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, companyId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  removeWorkspace: (projectId: string, workspaceId: string, companyId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart",
    companyId?: string,
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: unknown }>(
      projectPath(
        projectId,
        companyId,
        `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${encodeURIComponent(action)}`,
      ),
      {},
    ),
  remove: (id: string, companyId?: string) => api.delete<Project>(projectPath(id, companyId)),
  listIssueStatuses: (projectId: string, companyId?: string) =>
    api.get<ProjectIssueStatus[]>(projectPath(projectId, companyId, "/issue-statuses")),
  createIssueStatus: (projectId: string, data: Record<string, unknown>, companyId?: string) =>
    api.post<ProjectIssueStatus>(projectPath(projectId, companyId, "/issue-statuses"), data),
  updateIssueStatus: (projectId: string, statusId: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<ProjectIssueStatus>(projectPath(projectId, companyId, `/issue-statuses/${encodeURIComponent(statusId)}`), data),
  reorderIssueStatuses: (projectId: string, orderedIds: string[], companyId?: string) =>
    api.post<ProjectIssueStatus[]>(projectPath(projectId, companyId, "/issue-statuses/reorder"), { orderedIds }),
  deleteIssueStatus: (projectId: string, statusId: string, companyId?: string) =>
    api.delete<ProjectIssueStatus>(projectPath(projectId, companyId, `/issue-statuses/${encodeURIComponent(statusId)}`)),
  getContext: (
    projectId: string,
    companyId?: string,
  ) =>
    api.get<{
      projectId: string;
      dataSchemaName: string | null;
      summary: ProjectDocument | null;
      workflowSummary: ProjectDocument | null;
      documents: ProjectDocument[];
      maintenanceRequests: ProjectMaintenanceRequest[];
      workflowStatuses: ProjectIssueStatus[];
    }>(projectPath(projectId, companyId, "/context")),
  triggerContextSync: (projectId: string, companyId?: string) =>
    api.post<{ requestId: string; status: string; queued: boolean }>(projectPath(projectId, companyId, "/context/sync"), {}),
  listContextFiles: (projectId: string, companyId?: string) =>
    api.get<ProjectContextFile[]>(projectPath(projectId, companyId, "/context-files")),
  addContextFile: (projectId: string, data: { assetId: string; title?: string }, companyId?: string) =>
    api.post<ProjectContextFile>(projectPath(projectId, companyId, "/context-files"), data),
  updateContextFileStatus: (
    projectId: string,
    fileId: string,
    data: { status: "pending" | "processing" | "complete" | "failed" | "skipped"; extractedText?: string | null; extractionError?: string | null },
    companyId?: string,
  ) =>
    api.patch<ProjectContextFile>(projectPath(projectId, companyId, `/context-files/${encodeURIComponent(fileId)}/status`), data),
  deleteContextFile: (projectId: string, fileId: string, companyId?: string) =>
    api.delete<ProjectContextFile>(projectPath(projectId, companyId, `/context-files/${encodeURIComponent(fileId)}`)),
  upsertProjectDocument: (
    projectId: string,
    key: string,
    data: { title?: string | null; format: "markdown"; body: string; changeSummary?: string | null; baseRevisionId?: string | null },
    companyId?: string,
  ) => api.put(projectPath(projectId, companyId, `/documents/${encodeURIComponent(key)}`), data),
  listProjectDocumentRevisions: (projectId: string, key: string, companyId?: string) =>
    api.get<
      Array<{
        id: string;
        projectId: string;
        key: string;
        revisionNumber: number;
        title: string | null;
        changeSummary: string | null;
        createdAt: string;
      }>
    >(projectPath(projectId, companyId, `/documents/${encodeURIComponent(key)}/revisions`)),
  listMaintenanceRequests: (projectId: string, companyId?: string) =>
    api.get<ProjectMaintenanceRequest[]>(projectPath(projectId, companyId, "/maintenance-requests")),
  createMaintenanceRequest: (
    projectId: string,
    data: { type: "context_summary" | "dashboards" | "workflow"; description: string; contextRef?: Record<string, unknown> | null; idempotencyKey?: string },
    companyId?: string,
  ) => api.post<{ requestId: string; runId: string | null; queued: boolean }>(projectPath(projectId, companyId, "/maintenance-requests"), data),
  listDataObjects: (projectId: string, companyId?: string) =>
    api.get<ProjectDataObject[]>(projectPath(projectId, companyId, "/data/objects")),
  listViews: (projectId: string, companyId?: string) =>
    api.get<ProjectView[]>(projectPath(projectId, companyId, "/views")),
  createView: (projectId: string, data: { name: string; description?: string | null; layout?: Record<string, unknown> | null }, companyId?: string) =>
    api.post<ProjectView>(projectPath(projectId, companyId, "/views"), data),
  listViewWidgets: (projectId: string, viewId: string, companyId?: string) =>
    api.get<ProjectViewWidget[]>(projectPath(projectId, companyId, `/views/${encodeURIComponent(viewId)}/widgets`)),
  getViewWidgetData: (projectId: string, viewId: string, companyId?: string) =>
    api.get<{
      viewId: string;
      widgets: Array<{
        widgetId: string;
        type: "kpi" | "table" | "chart" | "markdown";
        title: string | null;
        data: { rows: Record<string, unknown>[]; limit: number; offset: number } | null;
        error: string | null;
      }>;
    }>(projectPath(projectId, companyId, `/views/${encodeURIComponent(viewId)}/widgets/data`)),
  createViewWidget: (
    projectId: string,
    viewId: string,
    data: {
      title?: string | null;
      type: "kpi" | "table" | "chart" | "markdown";
      position?: number;
      queryRef?: Record<string, unknown> | null;
      config?: Record<string, unknown> | null;
      layout?: Record<string, unknown> | null;
    },
    companyId?: string,
  ) =>
    api.post<ProjectViewWidget>(projectPath(projectId, companyId, `/views/${encodeURIComponent(viewId)}/widgets`), data),
};
