import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, useLocation, Navigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isAiAdminProject, isUuidLike, type BudgetPolicySummary } from "@paperclipai/shared";
import { budgetsApi } from "../api/budgets";
import { projectsApi } from "../api/projects";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { ProjectProperties, type ProjectConfigFieldKey, type ProjectFieldSaveState } from "../components/ProjectProperties";
import { InlineEditor } from "../components/InlineEditor";
import { BudgetPolicyCard } from "../components/BudgetPolicyCard";
import { IssuesList } from "../components/IssuesList";
import { useProjectIssueStatuses } from "../hooks/useProjectIssueStatuses";
import { ProjectIssueStatusSettings } from "../components/ProjectIssueStatusSettings";
import { ProjectNotificationSettings } from "../components/ProjectNotificationSettings";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { projectStatusSwatchClass } from "../lib/status-colors";
import { projectRouteRef, cn } from "../lib/utils";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { PluginSlotMount, PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { ProjectAccessControlPanel } from "../components/ProjectAccessControlPanel";
import { ProjectContextPanel } from "../components/ProjectContextPanel";

/* ── Top-level tab types ── */

type ProjectBaseTab =
  | "backlog"
  | "overview"
  | "list"
  | "data"
  | "dashboards"
  | "configuration"
  | "access"
  | "workflow"
  | "budget"
  | "archive";
type ProjectPluginTab = `plugin:${string}`;
type ProjectTab = ProjectBaseTab | ProjectPluginTab;

function isProjectPluginTab(value: string | null): value is ProjectPluginTab {
  return typeof value === "string" && value.startsWith("plugin:");
}

function isLegacyProjectContextTabPath(pathname: string, projectRef: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const projectsIdx = segments.indexOf("projects");
  if (projectsIdx === -1) return false;
  return segments[projectsIdx + 1] === projectRef && segments[projectsIdx + 2] === "context";
}

function resolveProjectTab(pathname: string, projectId: string): ProjectTab | null {
  const segments = pathname.split("/").filter(Boolean);
  const projectsIdx = segments.indexOf("projects");
  if (projectsIdx === -1 || segments[projectsIdx + 1] !== projectId) return null;
  const tab = segments[projectsIdx + 2];
  if (tab === "backlog") return "backlog";
  if (tab === "overview" || tab === "context") return "overview";
  if (tab === "configuration") return "configuration";
  if (tab === "data") return "data";
  if (tab === "dashboards") return "dashboards";
  if (tab === "access") return "access";
  if (tab === "workflow") return "workflow";
  if (tab === "budget") return "budget";
  if (tab === "archive") return "archive";
  if (tab === "issues") return "list";
  return null;
}


/* ── List (issues) tab content ── */

function ProjectBacklogList({ projectId, companyId, issueLinkState }: { projectId: string; companyId: string; issueLinkState?: unknown }) {
  const queryClient = useQueryClient();
  const { statuses: projectStatuses } = useProjectIssueStatuses(projectId);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.listByProject(companyId, projectId),
    queryFn: () => issuesApi.list(companyId, { projectId }),
    enabled: !!companyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error as Error | null}
      agents={agents}
      liveIssueIds={liveIssueIds}
      projectId={projectId}
      viewStateKey={`paperclip:project-backlog:${projectId}`}
      issueLinkState={issueLinkState}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      projectStatuses={projectStatuses.length > 0 ? projectStatuses : undefined}
      forceListView
      fixedStatusFilter={["backlog"]}
      hideStatusFilter
    />
  );
}

function ProjectArchiveList({
  projectId,
  companyId,
  retentionDays,
  issueLinkState,
}: {
  projectId: string;
  companyId: string;
  retentionDays: number;
  issueLinkState?: unknown;
}) {
  const queryClient = useQueryClient();
  const { statuses: projectStatuses } = useProjectIssueStatuses(projectId);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.listByProject(companyId, projectId),
    queryFn: () => issuesApi.list(companyId, { projectId }),
    enabled: !!companyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error as Error | null}
      agents={agents}
      liveIssueIds={liveIssueIds}
      projectId={projectId}
      viewStateKey={`paperclip:project-archive:${projectId}`}
      issueLinkState={issueLinkState}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      projectStatuses={projectStatuses.length > 0 ? projectStatuses : undefined}
      forceListView
      hideStatusFilter
      pastBoardClosedRetentionDays={retentionDays}
    />
  );
}

function ProjectIssuesList({
  projectId,
  companyId,
  issueLinkState,
  boardClosedRetentionDays,
}: {
  projectId: string;
  companyId: string;
  issueLinkState?: unknown;
  boardClosedRetentionDays: number;
}) {
  const queryClient = useQueryClient();
  const { statuses: projectStatuses, isLoading: statusesLoading } = useProjectIssueStatuses(projectId);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.listByProject(companyId, projectId),
    queryFn: () => issuesApi.list(companyId, { projectId }),
    enabled: !!companyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error as Error | null}
      agents={agents}
      liveIssueIds={liveIssueIds}
      projectId={projectId}
      viewStateKey={`paperclip:project-view:${projectId}`}
      issueLinkState={issueLinkState}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      projectStatuses={projectStatuses.length > 0 ? projectStatuses : undefined}
      statusesLoading={statusesLoading}
      boardClosedRetentionDays={boardClosedRetentionDays}
    />
  );
}

/* ── Main project page ── */

export function ProjectDetail() {
  const { companyPrefix, projectId, filter } = useParams<{
    companyPrefix?: string;
    projectId: string;
    filter?: string;
  }>();
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { closePanel } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [fieldSaveStates, setFieldSaveStates] = useState<Partial<Record<ProjectConfigFieldKey, ProjectFieldSaveState>>>({});
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  const fieldSaveRequestIds = useRef<Partial<Record<ProjectConfigFieldKey, number>>>({});
  const fieldSaveTimers = useRef<Partial<Record<ProjectConfigFieldKey, ReturnType<typeof setTimeout>>>>({});
  const routeProjectRef = projectId ?? "";
  const routeCompanyId = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix)?.id ?? null;
  }, [companies, companyPrefix]);
  const lookupCompanyId = routeCompanyId ?? selectedCompanyId ?? undefined;
  const canFetchProject = routeProjectRef.length > 0 && (isUuidLike(routeProjectRef) || Boolean(lookupCompanyId));
  const activeRouteTab = routeProjectRef ? resolveProjectTab(location.pathname, routeProjectRef) : null;
  const pluginTabFromSearch = useMemo(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    return isProjectPluginTab(tab) ? tab : null;
  }, [location.search]);
  const activeTab = activeRouteTab ?? pluginTabFromSearch;

  const projectPathForTab = useCallback((projectRef: string, tab: ProjectTab | null) => {
    if (isProjectPluginTab(tab)) {
      return `/projects/${projectRef}?tab=${encodeURIComponent(tab)}`;
    }
    if (tab === "backlog") return `/projects/${projectRef}/backlog`;
    if (tab === "overview") return `/projects/${projectRef}/overview`;
    if (tab === "configuration") return `/projects/${projectRef}/configuration`;
    if (tab === "data") return `/projects/${projectRef}/data`;
    if (tab === "dashboards") return `/projects/${projectRef}/dashboards`;
    if (tab === "access") return `/projects/${projectRef}/access`;
    if (tab === "workflow") return `/projects/${projectRef}/workflow`;
    if (tab === "budget") return `/projects/${projectRef}/budget`;
    if (tab === "archive") return `/projects/${projectRef}/archive`;
    if (tab === "list") {
      if (filter) return `/projects/${projectRef}/issues/${filter}`;
      return `/projects/${projectRef}/issues`;
    }
    return `/projects/${projectRef}`;
  }, [filter]);

  const syncRouteToProject = useCallback((nextProject: { id: string; urlKey?: string | null; name?: string | null }) => {
    const nextProjectRef = projectRouteRef(nextProject);
    if (!nextProjectRef || nextProjectRef === routeProjectRef) return;
    navigate(projectPathForTab(nextProjectRef, activeTab), { replace: true });
  }, [activeTab, navigate, projectPathForTab, routeProjectRef]);

  const { data: project, isLoading, error } = useQuery({
    queryKey: [...queryKeys.projects.detail(routeProjectRef), lookupCompanyId ?? null],
    queryFn: () => projectsApi.get(routeProjectRef, lookupCompanyId),
    enabled: canFetchProject,
  });
  const canonicalProjectRef = project ? projectRouteRef(project) : routeProjectRef;
  const projectLookupRef = project?.id ?? routeProjectRef;
  const resolvedCompanyId = project?.companyId ?? selectedCompanyId;
  const { statuses: configStatuses } = useProjectIssueStatuses(project?.id ?? null);
  const {
    slots: pluginDetailSlots,
    isLoading: pluginDetailSlotsLoading,
  } = usePluginSlots({
    slotTypes: ["detailTab"],
    entityType: "project",
    companyId: resolvedCompanyId,
    enabled: !!resolvedCompanyId,
  });
  const pluginTabItems = useMemo(
    () => pluginDetailSlots.map((slot) => ({
      value: `plugin:${slot.pluginKey}:${slot.id}` as ProjectPluginTab,
      label: slot.displayName,
      slot,
    })),
    [pluginDetailSlots],
  );
  const activePluginTab = pluginTabItems.find((item) => item.value === activeTab) ?? null;
  const isAiAdminProjectLocked = useMemo(
    () => (project ? isAiAdminProject(project) : false),
    [project],
  );

  useEffect(() => {
    if (!project?.companyId || project.companyId === selectedCompanyId) return;
    setSelectedCompanyId(project.companyId, { source: "route_sync" });
  }, [project?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(routeProjectRef) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectLookupRef) });
    if (resolvedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(resolvedCompanyId) });
    }
  };

  const updateProject = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      projectsApi.update(projectLookupRef, data, resolvedCompanyId ?? lookupCompanyId),
    onSuccess: (updatedProject) => {
      invalidateProject();
      syncRouteToProject(updatedProject);
    },
  });

  const archiveProject = useMutation({
    mutationFn: (archived: boolean) =>
      projectsApi.update(
        projectLookupRef,
        { archivedAt: archived ? new Date().toISOString() : null },
        resolvedCompanyId ?? lookupCompanyId,
      ),
    onSuccess: (updatedProject, archived) => {
      invalidateProject();
      const name = updatedProject?.name ?? project?.name ?? "Project";
      if (archived) {
        pushToast({ title: `"${name}" has been archived`, tone: "success" });
        navigate("/dashboard");
      } else {
        pushToast({ title: `"${name}" has been unarchived`, tone: "success" });
      }
    },
    onError: (_, archived) => {
      pushToast({
        title: archived ? "Failed to archive project" : "Failed to unarchive project",
        tone: "error",
      });
    },
  });

  const { data: budgetOverview } = useQuery({
    queryKey: queryKeys.budgets.overview(resolvedCompanyId ?? "__none__"),
    queryFn: () => budgetsApi.overview(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Projects", href: "/projects" },
      { label: project?.name ?? routeProjectRef ?? "Project" },
    ]);
  }, [setBreadcrumbs, project, routeProjectRef]);

  useEffect(() => {
    if (!project) return;
    if (routeProjectRef === canonicalProjectRef) return;
    navigate(projectPathForTab(canonicalProjectRef, activeTab), { replace: true });
  }, [project, routeProjectRef, canonicalProjectRef, activeTab, navigate, projectPathForTab]);

  useEffect(() => {
    closePanel();
    return () => closePanel();
  }, [closePanel]);

  useEffect(() => {
    if (activeTab !== "configuration") setNotificationSettingsOpen(false);
  }, [activeTab]);

  useEffect(() => {
    return () => {
      Object.values(fieldSaveTimers.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const setFieldState = useCallback((field: ProjectConfigFieldKey, state: ProjectFieldSaveState) => {
    setFieldSaveStates((current) => ({ ...current, [field]: state }));
  }, []);

  const scheduleFieldReset = useCallback((field: ProjectConfigFieldKey, delayMs: number) => {
    const existing = fieldSaveTimers.current[field];
    if (existing) clearTimeout(existing);
    fieldSaveTimers.current[field] = setTimeout(() => {
      setFieldSaveStates((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
      delete fieldSaveTimers.current[field];
    }, delayMs);
  }, []);

  const updateProjectField = useCallback(async (field: ProjectConfigFieldKey, data: Record<string, unknown>) => {
    const requestId = (fieldSaveRequestIds.current[field] ?? 0) + 1;
    fieldSaveRequestIds.current[field] = requestId;
    setFieldState(field, "saving");
    try {
      const updatedProject = await projectsApi.update(projectLookupRef, data, resolvedCompanyId ?? lookupCompanyId);
      invalidateProject();
      syncRouteToProject(updatedProject);
      if (fieldSaveRequestIds.current[field] !== requestId) return;
      setFieldState(field, "saved");
      scheduleFieldReset(field, 1800);
    } catch (error) {
      if (fieldSaveRequestIds.current[field] !== requestId) return;
      setFieldState(field, "error");
      scheduleFieldReset(field, 3000);
      throw error;
    }
  }, [invalidateProject, lookupCompanyId, projectLookupRef, resolvedCompanyId, scheduleFieldReset, setFieldState, syncRouteToProject]);

  const projectBudgetSummary = useMemo(() => {
    const matched = budgetOverview?.policies.find(
      (policy) => policy.scopeType === "project" && policy.scopeId === (project?.id ?? routeProjectRef),
    );
    if (matched) return matched;
    return {
      policyId: "",
      companyId: resolvedCompanyId ?? "",
      scopeType: "project",
      scopeId: project?.id ?? routeProjectRef,
      scopeName: project?.name ?? "Project",
      metric: "billed_cents",
      windowKind: "lifetime",
      amount: 0,
      observedAmount: 0,
      remainingAmount: 0,
      utilizationPercent: 0,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: false,
      status: "ok",
      paused: Boolean(project?.pausedAt),
      pauseReason: project?.pauseReason ?? null,
      windowStart: new Date(),
      windowEnd: new Date(),
    } satisfies BudgetPolicySummary;
  }, [budgetOverview?.policies, project, resolvedCompanyId, routeProjectRef]);

  const budgetMutation = useMutation({
    mutationFn: (amount: number) =>
      budgetsApi.upsertPolicy(resolvedCompanyId!, {
        scopeType: "project",
        scopeId: project?.id ?? routeProjectRef,
        amount,
        windowKind: "lifetime",
      }),
    onSuccess: () => {
      if (!resolvedCompanyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.overview(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(routeProjectRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectLookupRef) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(resolvedCompanyId) });
    },
  });

  if (routeProjectRef && isLegacyProjectContextTabPath(location.pathname, routeProjectRef)) {
    return <Navigate to={`/projects/${canonicalProjectRef ?? routeProjectRef}/overview`} replace />;
  }

  if (pluginTabFromSearch && !pluginDetailSlotsLoading && !activePluginTab) {
    return <Navigate to={`/projects/${canonicalProjectRef}/issues`} replace />;
  }

  // Redirect bare /projects/:id to cached tab or default /issues
  if (routeProjectRef && activeTab === null) {
    let cachedTab: string | null = null;
    if (project?.id) {
      try { cachedTab = localStorage.getItem(`paperclip:project-tab:${project.id}`); } catch {}
    }
    if (cachedTab === "backlog") {
      return <Navigate to={`/projects/${canonicalProjectRef}/backlog`} replace />;
    }
    if (cachedTab === "overview") {
      return <Navigate to={`/projects/${canonicalProjectRef}/overview`} replace />;
    }
    if (cachedTab === "configuration") {
      return <Navigate to={`/projects/${canonicalProjectRef}/configuration`} replace />;
    }
    if (cachedTab === "context") {
      return <Navigate to={`/projects/${canonicalProjectRef}/overview`} replace />;
    }
    if (cachedTab === "data") {
      return <Navigate to={`/projects/${canonicalProjectRef}/data`} replace />;
    }
    if (cachedTab === "dashboards") {
      return <Navigate to={`/projects/${canonicalProjectRef}/dashboards`} replace />;
    }
    if (
      cachedTab === "access" &&
      (companies.find((c) => c.id === project?.companyId)?.projectAccessMode ?? "open") === "restricted"
    ) {
      return <Navigate to={`/projects/${canonicalProjectRef}/access`} replace />;
    }
    if (cachedTab === "workflow") {
      return <Navigate to={`/projects/${canonicalProjectRef}/workflow`} replace />;
    }
    if (cachedTab === "budget") {
      return <Navigate to={`/projects/${canonicalProjectRef}/budget`} replace />;
    }
    if (cachedTab === "shelf" || cachedTab === "archive") {
      return <Navigate to={`/projects/${canonicalProjectRef}/archive`} replace />;
    }
    if (isProjectPluginTab(cachedTab)) {
      return <Navigate to={`/projects/${canonicalProjectRef}?tab=${encodeURIComponent(cachedTab)}`} replace />;
    }
    return <Navigate to={`/projects/${canonicalProjectRef}/issues`} replace />;
  }

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!project) return null;
  const isProjectIamEnabled =
    (companies.find((c) => c.id === project.companyId)?.projectAccessMode ?? "open") === "restricted";

  const handleTabChange = (tab: ProjectTab) => {
    // Cache the active tab per project
    if (project?.id) {
      try { localStorage.setItem(`paperclip:project-tab:${project.id}`, tab); } catch {}
    }
    if (isProjectPluginTab(tab)) {
      navigate(`/projects/${canonicalProjectRef}?tab=${encodeURIComponent(tab)}`);
      return;
    }
    if (tab === "backlog") {
      navigate(`/projects/${canonicalProjectRef}/backlog`);
    } else if (tab === "overview") {
      navigate(`/projects/${canonicalProjectRef}/overview`);
    } else if (tab === "budget") {
      navigate(`/projects/${canonicalProjectRef}/budget`);
    } else if (tab === "configuration") {
      navigate(`/projects/${canonicalProjectRef}/configuration`);
    } else if (tab === "data") {
      navigate(`/projects/${canonicalProjectRef}/data`);
    } else if (tab === "dashboards") {
      navigate(`/projects/${canonicalProjectRef}/dashboards`);
    } else if (tab === "access" && isProjectIamEnabled) {
      navigate(`/projects/${canonicalProjectRef}/access`);
    } else if (tab === "workflow") {
      navigate(`/projects/${canonicalProjectRef}/workflow`);
    } else if (tab === "archive") {
      navigate(`/projects/${canonicalProjectRef}/archive`);
    } else {
      navigate(`/projects/${canonicalProjectRef}/issues`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pt-4">
        <div
          className={cn(
            "h-7 w-7 shrink-0 rounded-md border border-border",
            projectStatusSwatchClass(project.status),
          )}
          title={`Project status: ${project.status.replace(/_/g, " ")}`}
          role="img"
          aria-label={`Project status: ${project.status.replace(/_/g, " ")}`}
        />
        <div className="min-w-0 space-y-1.5">
          <InlineEditor
            value={project.name}
            onSave={(name) => updateProject.mutate({ name })}
            as="h2"
            className="text-xl font-bold"
            showEditButton
          />
          {project.pauseReason === "budget" ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-red-200">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              Paused by budget hard stop
            </div>
          ) : null}
        </div>
      </div>

      <PluginSlotOutlet
        slotTypes={["toolbarButton", "contextMenuItem"]}
        entityType="project"
        context={{
          companyId: resolvedCompanyId ?? null,
          companyPrefix: companyPrefix ?? null,
          projectId: project.id,
          projectRef: canonicalProjectRef,
          entityId: project.id,
          entityType: "project",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
        missingBehavior="placeholder"
      />

      <PluginLauncherOutlet
        placementZones={["toolbarButton"]}
        entityType="project"
        context={{
          companyId: resolvedCompanyId ?? null,
          companyPrefix: companyPrefix ?? null,
          projectId: project.id,
          projectRef: canonicalProjectRef,
          entityId: project.id,
          entityType: "project",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
      />

      <Tabs value={activeTab ?? "list"} onValueChange={(value) => handleTabChange(value as ProjectTab)}>
        <PageTabBar
          items={[
            { value: "overview", label: "Overview" },
            { value: "dashboards", label: "Dashboards" },
            { value: "backlog", label: "Backlog" },
            { value: "list", label: "Tasks" },
            { value: "configuration", label: "Configuration" },
            ...(isProjectIamEnabled ? [{ value: "access" as const, label: "Access Control" }] : []),
            { value: "workflow", label: "Workflow" },
            { value: "budget", label: "Budget" },
            ...pluginTabItems.map((item) => ({
              value: item.value,
              label: item.label,
            })),
            { value: "data", label: "Data" },
            { value: "archive" as const, label: "Archive" },
          ]}
          align="start"
          value={activeTab ?? "list"}
          onValueChange={(value) => handleTabChange(value as ProjectTab)}
        />
      </Tabs>

      {activeTab === "backlog" && project?.id && resolvedCompanyId && (
        <ProjectBacklogList
          projectId={project.id}
          companyId={resolvedCompanyId}
          issueLinkState={createIssueDetailLocationState(project.name, `/projects/${canonicalProjectRef}/backlog`)}
        />
      )}

      {activeTab === "overview" && project?.id && resolvedCompanyId && (
        <div className="max-w-5xl pb-2">
          <ProjectContextPanel
            projectId={project.id}
            companyId={resolvedCompanyId}
            mode="context"
            lockWorkflowMaintenance={isAiAdminProjectLocked}
          />
        </div>
      )}

      {activeTab === "list" && project?.id && resolvedCompanyId && (
        <ProjectIssuesList
          projectId={project.id}
          companyId={resolvedCompanyId}
          boardClosedRetentionDays={project.boardClosedRetentionDays}
          issueLinkState={createIssueDetailLocationState(project.name, `/projects/${canonicalProjectRef}/issues`)}
        />
      )}

      {activeTab === "archive" && project?.id && resolvedCompanyId && (
        <ProjectArchiveList
          projectId={project.id}
          companyId={resolvedCompanyId}
          retentionDays={project.boardClosedRetentionDays}
          issueLinkState={createIssueDetailLocationState(project.name, `/projects/${canonicalProjectRef}/archive`)}
        />
      )}

      {activeTab === "access" && isProjectIamEnabled && resolvedCompanyId && project?.id ? (
        <div className="max-w-4xl pb-2">
          <ProjectAccessControlPanel
            companyId={resolvedCompanyId}
            projectId={project.id}
            projectAccessMode={isProjectIamEnabled ? "restricted" : "open"}
          />
        </div>
      ) : null}

      {activeTab === "configuration" && (
        <div className="max-w-3xl space-y-6 pb-2">
          <ProjectProperties
            project={project}
            onUpdate={isAiAdminProjectLocked ? undefined : (data) => updateProject.mutate(data)}
            onFieldUpdate={isAiAdminProjectLocked ? undefined : updateProjectField}
            getFieldSaveState={(field) => fieldSaveStates[field] ?? "idle"}
            onArchive={isAiAdminProjectLocked ? undefined : (archived) => archiveProject.mutate(archived)}
            archivePending={archiveProject.isPending}
            aboveSecrets={
              project?.id && !isAiAdminProjectLocked ? (
                <>
                  <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="min-w-0 text-sm leading-snug text-muted-foreground sm:max-w-md">
                      Choose which task events trigger alerts. Open the dialog to edit rules, channels, and recipients.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full shrink-0 sm:w-auto"
                      onClick={() => setNotificationSettingsOpen(true)}
                    >
                      Configure notifications
                    </Button>
                  </div>
                  <Dialog open={notificationSettingsOpen} onOpenChange={setNotificationSettingsOpen}>
                    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Task notifications</DialogTitle>
                        <DialogDescription>
                          Choose which task events trigger alerts for this project. Team members can still manage their own preferences in{" "}
                          <span className="text-foreground/90">Account → Notifications</span>. In-app alerts are sent when a rule matches. Email is sent only when email is enabled here, company email delivery is configured, and the recipient has email notifications turned on.
                        </DialogDescription>
                      </DialogHeader>
                      <ProjectNotificationSettings
                        project={project}
                        issueStatuses={configStatuses}
                        onSave={(data) => updateProjectField("notification_config", data)}
                        saveState={fieldSaveStates.notification_config ?? "idle"}
                        embeddedInModal
                      />
                    </DialogContent>
                  </Dialog>
                </>
              ) : undefined
            }
          />
        </div>
      )}


      {activeTab === "data" && project?.id && resolvedCompanyId && (
        <div className="max-w-5xl pb-2">
          <ProjectContextPanel projectId={project.id} companyId={resolvedCompanyId} mode="data" />
        </div>
      )}

      {activeTab === "dashboards" && project?.id && resolvedCompanyId && (
        <div className="max-w-5xl pb-2">
          <ProjectContextPanel projectId={project.id} companyId={resolvedCompanyId} mode="dashboards" />
        </div>
      )}

      {activeTab === "workflow" && project?.id && (
        <div className="max-w-5xl space-y-6 pb-2">
          {isAiAdminProjectLocked ? (
            <p className="text-sm text-muted-foreground">
              The AI-Admin Project uses a fixed workflow for agent-creation and coordination tasks. Workflow stages cannot be edited.
            </p>
          ) : null}
          <ProjectIssueStatusSettings
            projectId={project.id}
            statuses={configStatuses}
            readOnly={isAiAdminProjectLocked}
          />
        </div>
      )}

      {activeTab === "budget" && resolvedCompanyId ? (
        <div className="max-w-3xl">
          <BudgetPolicyCard
            summary={projectBudgetSummary}
            variant="plain"
            isSaving={budgetMutation.isPending}
            onSave={(amount) => budgetMutation.mutate(amount)}
          />
        </div>
      ) : null}

      {activePluginTab && (
        <PluginSlotMount
          slot={activePluginTab.slot}
          context={{
            companyId: resolvedCompanyId,
            companyPrefix: companyPrefix ?? null,
            projectId: project.id,
            projectRef: canonicalProjectRef,
            entityId: project.id,
            entityType: "project",
          }}
          missingBehavior="placeholder"
        />
      )}
    </div>
  );
}
