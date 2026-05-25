import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import type { ProjectIssueStatus } from "@paperclipai/shared";

export function useProjectIssueStatuses(projectId: string | null | undefined): {
  statuses: ProjectIssueStatus[];
  isLoading: boolean;
} {
  const { selectedCompanyId } = useCompany();
  const enabled = !!projectId;
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.projects.issueStatuses(projectId ?? ""),
    queryFn: () => projectsApi.listIssueStatuses(projectId!, selectedCompanyId ?? undefined),
    enabled,
    staleTime: 60_000,
  });
  return { statuses: data ?? [], isLoading: enabled && isLoading };
}
