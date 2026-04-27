import { useEffect, useMemo, useCallback } from "react";
import { issueRollsUpToGoal, isGoalActiveIssueStatus } from "../lib/goal-rollup";
import { useLocation, useSearchParams } from "@/lib/router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { EmptyState } from "../components/EmptyState";
import { IssuesList } from "../components/IssuesList";
import { CircleDot } from "lucide-react";

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialSearch = searchParams.get("q") ?? "";
  const participantAgentId = searchParams.get("participantAgentId") ?? undefined;
  const goalIdFilter = searchParams.get("goalId") ?? undefined;
  const activeGoalTasksOnly = searchParams.get("active") === "1";
  const handleSearchChange = useCallback((search: string) => {
    const trimmedSearch = search.trim();
    const currentSearch = new URLSearchParams(window.location.search).get("q") ?? "";
    if (currentSearch === trimmedSearch) return;

    const url = new URL(window.location.href);
    if (trimmedSearch) {
      url.searchParams.set("q", trimmedSearch);
    } else {
      url.searchParams.delete("q");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectStatusQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: queryKeys.projects.issueStatuses(project.id),
      queryFn: () => projectsApi.listIssueStatuses(project.id, selectedCompanyId!),
      enabled: !!selectedCompanyId,
      staleTime: 60_000,
    })),
  });

  const globalProjectStatuses = useMemo(() => {
    const byValue = new Map<string, ProjectIssueStatus>();
    for (const query of projectStatusQueries) {
      for (const status of query.data ?? []) {
        if (!status.isActive) continue;
        if (!byValue.has(status.value)) {
          byValue.set(status.value, status);
        }
      }
    }
    return Array.from(byValue.values());
  }, [projectStatusQueries]);

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        "Tasks",
        `${location.pathname}${location.search}${location.hash}`,
        "issues",
      ),
    [location.pathname, location.search, location.hash],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Tasks" }]);
  }, [setBreadcrumbs]);

  const { data: issuesRaw, isLoading, error } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "participant-agent", participantAgentId ?? "__all__"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { participantAgentId }),
    enabled: !!selectedCompanyId,
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const canReadTasks = sidebarBadges?.canReadTasks ?? true;
  const canCreateTasks = sidebarBadges?.canCreateTasks ?? true;

  const issues = useMemo(() => {
    let list = issuesRaw ?? [];
    if (!goalIdFilter) return list;
    if (!projects) return [];
    const projectById = new Map(projects.map((p) => [p.id, p]));
    list = list.filter((i) => issueRollsUpToGoal(i, goalIdFilter, projectById));
    // Match dashboard goal card "Tasks" count (non-cancelled)
    list = list.filter((i) => i.status !== "cancelled");
    if (activeGoalTasksOnly) {
      list = list.filter((i) => isGoalActiveIssueStatus(i.status));
    }
    return list;
  }, [issuesRaw, projects, goalIdFilter, activeGoalTasksOnly]);

  const goalFilterWaiting = !!(goalIdFilter && projectsLoading);
  const issuesListLoading = isLoading || goalFilterWaiting;

  const issuesQueryKey = [
    ...queryKeys.issues.list(selectedCompanyId!),
    "participant-agent",
    participantAgentId ?? "__all__",
  ];

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel any in-flight refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: issuesQueryKey });
      // Snapshot the current cache value for rollback on error
      const previousIssues = queryClient.getQueryData<Issue[]>(issuesQueryKey);
      // Optimistically apply the change to the cached issue list
      queryClient.setQueryData<Issue[]>(issuesQueryKey, (old) =>
        old?.map((issue) =>
          issue.id === id ? { ...issue, ...(data as Partial<Issue>) } : issue
        ) ?? []
      );
      return { previousIssues };
    },
    onError: (_err, _vars, context) => {
      // Roll back to the snapshot if the mutation fails
      if (context?.previousIssues) {
        queryClient.setQueryData(issuesQueryKey, context.previousIssues);
      }
    },
    onSettled: () => {
      // Always re-sync with the server after a mutation
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={CircleDot} message="Select a company to view issues." />;
  }
  if (!canReadTasks) {
    return <EmptyState icon={CircleDot} message="You do not have permission to view tasks." />;
  }

  return (
    <IssuesList
      forceListView
      issues={issues ?? []}
      isLoading={issuesListLoading}
      error={error as Error | null}
      agents={agents}
      projects={projects}
      liveIssueIds={liveIssueIds}
      viewStateKey="paperclip:issues-view"
      issueLinkState={issueLinkState}
      initialAssignees={searchParams.get("assignee") ? [searchParams.get("assignee")!] : undefined}
      initialSearch={initialSearch}
      onSearchChange={handleSearchChange}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      canCreateTask={canCreateTasks}
      searchFilters={participantAgentId ? { participantAgentId } : undefined}
      filterStatusOptions={globalProjectStatuses}
    />
  );
}
