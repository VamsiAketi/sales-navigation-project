import type { Project, ProjectWorkspace, ProjectIssueStatus } from "@paperclipai/shared";
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
};
