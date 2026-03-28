import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import type { ProjectIssueStatus } from "@paperclipai/shared";

export function useProjectIssueStatuses(projectId: string | null | undefined): ProjectIssueStatus[] {
  const { selectedCompanyId } = useCompany();
  const { data } = useQuery({
    queryKey: queryKeys.projects.issueStatuses(projectId ?? ""),
    queryFn: () => projectsApi.listIssueStatuses(projectId!, selectedCompanyId ?? undefined),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  return data ?? [];
}
