import type { ProjectSecret, SecretProvider } from "@paperclipai/shared";
import { api } from "./client";

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

export const projectSecretsApi = {
  list: (projectId: string, companyId?: string) =>
    api.get<ProjectSecret[]>(
      withCompanyScope(`/projects/${encodeURIComponent(projectId)}/project-secrets`, companyId),
    ),
  create: (
    projectId: string,
    data: {
      name: string;
      value: string;
      provider?: SecretProvider;
      description?: string | null;
      externalRef?: string | null;
    },
    companyId?: string,
  ) =>
    api.post<ProjectSecret>(
      withCompanyScope(`/projects/${encodeURIComponent(projectId)}/project-secrets`, companyId),
      data,
    ),
  rotate: (secretId: string, data: { value: string; externalRef?: string | null }, companyId?: string) =>
    api.post<ProjectSecret>(withCompanyScope(`/project-secrets/${encodeURIComponent(secretId)}/rotate`, companyId), data),
  update: (
    secretId: string,
    data: { name?: string; description?: string | null; externalRef?: string | null },
    companyId?: string,
  ) => api.patch<ProjectSecret>(withCompanyScope(`/project-secrets/${encodeURIComponent(secretId)}`, companyId), data),
  remove: (secretId: string, companyId?: string) =>
    api.delete<{ ok: true }>(withCompanyScope(`/project-secrets/${encodeURIComponent(secretId)}`, companyId)),
};
