import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import { projectsApi } from "../api/projects";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { ProjectStatusPicker } from "../components/ProjectStatusPicker";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { projectLinkedToGoal } from "../lib/goal-rollup";
import { cn, formatDate, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Archive, ArrowUpDown, ChevronDown, ChevronRight, Check, Hexagon, Plus, Search } from "lucide-react";

type ProjectListSortField = "name" | "status" | "created";
type ProjectColumnKey = "name" | "status" | "goals" | "createdBy" | "created";

const PROJECT_STATUS_ORDER = ["backlog", "planned", "in_progress", "completed", "cancelled"];

const DEFAULT_PROJECT_COLUMN_WIDTH_WEIGHTS: Record<ProjectColumnKey, number> = {
  name: 300,
  status: 140,
  goals: 240,
  createdBy: 130,
  created: 130,
};

const PROJECT_COLUMN_MIN_WIDTHS: Record<ProjectColumnKey, number> = {
  name: 180,
  status: 110,
  goals: 140,
  createdBy: 110,
  created: 100,
};

const PROJECT_COLUMN_WIDTH_TOTAL = Object.values(DEFAULT_PROJECT_COLUMN_WIDTH_WEIGHTS).reduce(
  (sum, value) => sum + value,
  0,
);

const PROJECT_LIST_FIXED_GAPS_PX = 36;

function defaultProjectColumnWidthsFromAvailableWidth(
  availableWidth: number,
): Record<ProjectColumnKey, number> {
  const usableWidth = Math.max(320, availableWidth - PROJECT_LIST_FIXED_GAPS_PX);
  const result = {} as Record<ProjectColumnKey, number>;
  (Object.keys(DEFAULT_PROJECT_COLUMN_WIDTH_WEIGHTS) as ProjectColumnKey[]).forEach((column) => {
    const ratio = DEFAULT_PROJECT_COLUMN_WIDTH_WEIGHTS[column] / PROJECT_COLUMN_WIDTH_TOTAL;
    result[column] = Math.max(PROJECT_COLUMN_MIN_WIDTHS[column], Math.round(usableWidth * ratio));
  });
  return result;
}

function getInitialDefaultProjectColumnWidths(): Record<ProjectColumnKey, number> {
  if (typeof window === "undefined") return { ...DEFAULT_PROJECT_COLUMN_WIDTH_WEIGHTS };
  return defaultProjectColumnWidthsFromAvailableWidth(window.innerWidth * 0.72);
}

function projectGoalRefs(project: Project): { id: string; title: string }[] {
  if (project.goals.length > 0) return project.goals;
  if (project.goalIds.length > 0) return project.goalIds.map((id) => ({ id, title: id.slice(0, 8) }));
  if (project.goalId) return [{ id: project.goalId, title: project.goalId.slice(0, 8) }];
  return [];
}

function sortProjects(
  list: Project[],
  sortField: ProjectListSortField,
  sortDir: "asc" | "desc",
): Project[] {
  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...list];
  sorted.sort((a, b) => {
    if (sortField === "name") return dir * a.name.localeCompare(b.name);
    if (sortField === "status") {
      return dir * (PROJECT_STATUS_ORDER.indexOf(a.status) - PROJECT_STATUS_ORDER.indexOf(b.status));
    }
    return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });
  return sorted;
}

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [searchParams] = useSearchParams();
  const goalIdFilter = searchParams.get("goalId") ?? undefined;
  const [projectSearch, setProjectSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [goalFilters, setGoalFilters] = useState<string[]>([]);
  const [createdByFilters, setCreatedByFilters] = useState<string[]>([]);
  const [sortField, setSortField] = useState<ProjectListSortField>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnWidths, setColumnWidths] = useState<Record<ProjectColumnKey, number>>(
    () => getInitialDefaultProjectColumnWidths(),
  );
  const [didCalibrateDefaultWidths, setDidCalibrateDefaultWidths] = useState(false);
  const listHeaderRef = useRef<HTMLDivElement | null>(null);
  const hasUserResizedColumnsRef = useRef(false);
  const resizeSessionRef = useRef<{
    column: ProjectColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const updateProjectStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      projectsApi.update(id, { status }, selectedCompanyId ?? undefined),
    onSuccess: (_data, variables) => {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(variables.id) });
    },
    onError: (err: Error) => {
      pushToast({
        title: "Could not update project status",
        body: err.message,
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projects = useMemo(() => {
    let list = (allProjects ?? []).filter((p) => !p.archivedAt);
    if (goalIdFilter) {
      list = list.filter((p) => projectLinkedToGoal(p, goalIdFilter));
    }
    return list;
  }, [allProjects, goalIdFilter]);

  const archivedProjects = useMemo(() => {
    let list = (allProjects ?? []).filter((p) => !!p.archivedAt);
    if (goalIdFilter) {
      list = list.filter((p) => projectLinkedToGoal(p, goalIdFilter));
    }
    return list;
  }, [allProjects, goalIdFilter]);

  const memberNameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      const user = member.user;
      if (user?.id) {
        map.set(user.id, user.name?.trim() || user.email || "User");
      }
    }
    return map;
  }, [members]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agents]);

  const getCreatedByLabel = useCallback(
    (project: Project): string => {
      if (project.name === "AI-Admin Project") {
        return "Board";
      }
      if (project.createdByUserId) {
        if (project.createdByUserId === "board") return "Board";
        return memberNameByUserId.get(project.createdByUserId) ?? "Board";
      }
      if (project.createdByAgentId) {
        return agentNameById.get(project.createdByAgentId) ?? "Agent";
      }
      return "Board";
    },
    [agentNameById, memberNameByUserId],
  );

  const goalFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of allProjects ?? []) {
      for (const goal of projectGoalRefs(project)) {
        if (!byId.has(goal.id)) byId.set(goal.id, goal.title);
      }
    }
    return Array.from(byId.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allProjects]);

  const createdByFilterOptions = useMemo(() => {
    const values = new Set<string>();
    for (const project of allProjects ?? []) {
      values.add(getCreatedByLabel(project));
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [allProjects, getCreatedByLabel]);

  const applyProjectFilters = useCallback(
    (list: Project[]) => {
      const query = projectSearch.trim().toLowerCase();
      return list.filter((project) => {
        if (statusFilters.length > 0 && !statusFilters.includes(project.status)) return false;
        const goals = projectGoalRefs(project);
        if (goalFilters.length > 0 && !goals.some((goal) => goalFilters.includes(goal.id))) return false;
        if (createdByFilters.length > 0 && !createdByFilters.includes(getCreatedByLabel(project))) return false;
        if (!query) return true;
        return (
          project.name.toLowerCase().includes(query) ||
          (project.description ?? "").toLowerCase().includes(query) ||
          goals.some((goal) => goal.title.toLowerCase().includes(query))
        );
      });
    },
    [createdByFilters, getCreatedByLabel, goalFilters, projectSearch, statusFilters],
  );

  const visibleProjects = useMemo(
    () => sortProjects(applyProjectFilters(projects), sortField, sortDir),
    [applyProjectFilters, projects, sortDir, sortField],
  );
  const visibleArchivedProjects = useMemo(
    () => sortProjects(applyProjectFilters(archivedProjects), sortField, sortDir),
    [applyProjectFilters, archivedProjects, sortDir, sortField],
  );

  const stopColumnResize = useCallback(() => {
    resizeSessionRef.current = null;
    window.removeEventListener("mousemove", onColumnResizeMove);
    window.removeEventListener("mouseup", stopColumnResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onColumnResizeMove = useCallback((event: MouseEvent) => {
    const session = resizeSessionRef.current;
    if (!session) return;
    const delta = event.clientX - session.startX;
    const next = Math.max(PROJECT_COLUMN_MIN_WIDTHS[session.column], Math.round(session.startWidth + delta));
    setColumnWidths((prev) => {
      if (prev[session.column] === next) return prev;
      return { ...prev, [session.column]: next };
    });
  }, []);

  useEffect(() => {
    resizeSessionRef.current = null;
    window.removeEventListener("mousemove", onColumnResizeMove);
    window.removeEventListener("mouseup", stopColumnResize);
  }, [onColumnResizeMove, stopColumnResize]);

  const startColumnResize = useCallback(
    (column: ProjectColumnKey, event: ReactMouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      hasUserResizedColumnsRef.current = true;
      resizeSessionRef.current = {
        column,
        startX: event.clientX,
        startWidth: columnWidths[column],
      };
      window.addEventListener("mousemove", onColumnResizeMove);
      window.addEventListener("mouseup", stopColumnResize);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths, onColumnResizeMove, stopColumnResize],
  );

  useEffect(() => {
    if (didCalibrateDefaultWidths) return;
    if (hasUserResizedColumnsRef.current) return;
    const headerWidth = listHeaderRef.current?.clientWidth ?? 0;
    if (headerWidth <= 0) return;
    setColumnWidths(defaultProjectColumnWidthsFromAvailableWidth(headerWidth));
    setDidCalibrateDefaultWidths(true);
  }, [didCalibrateDefaultWidths, isLoading, visibleProjects.length]);

  const projectGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `${columnWidths.name}px ${columnWidths.status}px ${columnWidths.goals}px ${columnWidths.createdBy}px ${columnWidths.created}px`,
    }),
    [columnWidths],
  );

  const renderColumnResizer = useCallback(
    (column: ProjectColumnKey, label: string) => (
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none"
        onMouseDown={(event) => startColumnResize(column, event)}
      >
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
      </span>
    ),
    [startColumnResize],
  );

  const activeFilterCount =
    statusFilters.length + goalFilters.length + createdByFilters.length + (projectSearch.trim() ? 1 : 0);

  const applySort = (field: ProjectListSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDir("asc");
  };

  const resetFiltersAndSort = () => {
    setProjectSearch("");
    setStatusFilters([]);
    setGoalFilters([]);
    setCreatedByFilters([]);
    setSortField("created");
    setSortDir("asc");
  };

  const renderGoals = (
    project: Project,
    tone: "default" | "archived" = "default",
  ) => {
    const linkedGoals = projectGoalRefs(project);
    if (linkedGoals.length === 0) {
      return <span className="text-xs text-muted-foreground">No goals</span>;
    }
    const availableWidth = Math.max(PROJECT_COLUMN_MIN_WIDTHS.goals, columnWidths.goals) - 8;
    const gapPx = 4;
    const estimateChipWidth = (title: string) => Math.min(176, Math.max(56, 26 + title.length * 6));
    const estimateCounterWidth = (count: number) => Math.max(20, 12 + String(count).length * 6);

    let showSecondGoal = false;
    if (linkedGoals.length > 1) {
      const secondGoalWidth = estimateChipWidth(linkedGoals[1]!.title);
      const counterAfterSecond =
        linkedGoals.length > 2 ? estimateCounterWidth(linkedGoals.length - 2) + gapPx : 0;
      const remainingForFirst = availableWidth - gapPx - secondGoalWidth - counterAfterSecond;
      showSecondGoal = remainingForFirst >= 72;
    }

    const visible = showSecondGoal ? linkedGoals.slice(0, 2) : linkedGoals.slice(0, 1);
    const hiddenCount = Math.max(0, linkedGoals.length - visible.length);
    const counterWidth = hiddenCount > 0 ? estimateCounterWidth(hiddenCount) : 0;
    const secondWidthEstimate = visible.length > 1 ? estimateChipWidth(visible[1]!.title) : 0;
    const firstChipMaxWidth = Math.max(
      56,
      availableWidth
        - (visible.length > 1 ? gapPx + secondWidthEstimate : 0)
        - (hiddenCount > 0 ? gapPx + counterWidth : 0),
    );
    const secondChipMaxWidth = Math.max(
      56,
      availableWidth
        - firstChipMaxWidth
        - (hiddenCount > 0 ? gapPx + counterWidth : 0)
        - (visible.length > 1 ? gapPx : 0),
    );
    const chipClass =
      tone === "archived"
        ? "inline-flex shrink-0 min-w-0 items-center truncate rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
        : "inline-flex shrink-0 min-w-0 items-center truncate rounded-full border border-border px-2 py-0.5 text-xs";
    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {visible.map((goal, index) => (
          <span
            key={goal.id}
            className={chipClass}
            title={goal.title}
            style={{ maxWidth: `${index === 0 ? firstChipMaxWidth : secondChipMaxWidth}px` }}
          >
            <span className="truncate">{goal.title}</span>
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">+{hiddenCount}</span>
        ) : null}
      </span>
    );
  };

  const mobileGoalsSummary = useCallback((project: Project): string => {
    const linkedGoals = projectGoalRefs(project);
    if (linkedGoals.length === 0) return "No goals";
    if (linkedGoals.length === 1) return linkedGoals[0]!.title;
    return `${linkedGoals.length} goals`;
  }, []);

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-0">
      <div className="-mx-4 border-b border-border/80 bg-background/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/80 md:sticky md:top-0 md:z-60 md:-mx-6 md:px-6">
        <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap scrollbar-auto-hide">
          <div className="relative w-44 shrink-0 sm:w-56 md:w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search projects..."
              className="h-9 pl-7 text-sm"
              aria-label="Search projects"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3 text-xs">
                <span>Status</span>
                {statusFilters.length > 0 ? (
                  <span className="text-[10px] font-medium">{statusFilters.length}</span>
                ) : null}
                <ChevronDown className="hidden h-3.5 w-3.5 md:block" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2">
              <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                {PROJECT_STATUS_ORDER.map((status) => (
                  <label
                    key={status}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={statusFilters.includes(status)}
                      onCheckedChange={() => {
                        setStatusFilters((prev) =>
                          prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
                        );
                      }}
                    />
                    <span className="capitalize">{status.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3 text-xs">
                <span>Goals</span>
                {goalFilters.length > 0 ? (
                  <span className="text-[10px] font-medium">{goalFilters.length}</span>
                ) : null}
                <ChevronDown className="hidden h-3.5 w-3.5 md:block" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                {goalFilterOptions.length === 0 ? (
                  <span className="block px-2 py-1.5 text-xs text-muted-foreground">No goals found.</span>
                ) : (
                  goalFilterOptions.map((goal) => (
                    <label
                      key={goal.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={goalFilters.includes(goal.id)}
                        onCheckedChange={() => {
                          setGoalFilters((prev) =>
                            prev.includes(goal.id)
                              ? prev.filter((id) => id !== goal.id)
                              : [...prev, goal.id],
                          );
                        }}
                      />
                      <span className="truncate">{goal.title}</span>
                    </label>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3 text-xs">
                <span>Created by</span>
                {createdByFilters.length > 0 ? (
                  <span className="text-[10px] font-medium">{createdByFilters.length}</span>
                ) : null}
                <ChevronDown className="hidden h-3.5 w-3.5 md:block" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2">
              <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border/80 bg-muted/15 p-1.5">
                {createdByFilterOptions.length === 0 ? (
                  <span className="block px-2 py-1.5 text-xs text-muted-foreground">No creators found.</span>
                ) : (
                  createdByFilterOptions.map((creator) => (
                    <label
                      key={creator}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={createdByFilters.includes(creator)}
                        onCheckedChange={() => {
                          setCreatedByFilters((prev) =>
                            prev.includes(creator)
                              ? prev.filter((value) => value !== creator)
                              : [...prev, creator],
                          );
                        }}
                      />
                      <span className="truncate">{creator}</span>
                    </label>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-3 text-xs">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span>Sort</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-0">
              <div className="p-2 space-y-0.5">
                {([
                  ["name", "Name"],
                  ["status", "Status"],
                  ["created", "Created date"],
                ] as const).map(([field, label]) => (
                  <button
                    key={field}
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm",
                      sortField === field ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50",
                    )}
                    onClick={() => applySort(field)}
                  >
                    <span>{label}</span>
                    {sortField === field ? (
                      <span className="text-xs text-muted-foreground">{sortDir === "asc" ? "↑" : "↓"}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {(activeFilterCount > 0 || sortField !== "created" || sortDir !== "asc") ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={resetFiltersAndSort}
            >
              Clear filters
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="h-9 shrink-0 px-3 md:ml-auto" onClick={openNewProject}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span>Add Project</span>
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && visibleProjects.length === 0 && visibleArchivedProjects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message={activeFilterCount > 0 ? "No projects match the current filters." : "No projects yet."}
          action={activeFilterCount > 0 ? undefined : "Add Project"}
          onAction={activeFilterCount > 0 ? undefined : openNewProject}
        />
      )}

      {visibleProjects.length > 0 && (
        <>
          <div
            ref={listHeaderRef}
            className="sticky top-[3.25rem] z-50 hidden border-b border-border bg-background/95 px-2 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/90 md:grid md:items-center md:gap-3"
            style={projectGridStyle}
          >
            <span className="relative truncate">
              <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("name")}>
                Name {sortField === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </button>
              {renderColumnResizer("name", "Resize Name column")}
            </span>
            <span className="relative truncate">
              <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("status")}>
                Status {sortField === "status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </button>
              {renderColumnResizer("status", "Resize Status column")}
            </span>
            <span className="relative truncate">
              Goals
              {renderColumnResizer("goals", "Resize Goals column")}
            </span>
            <span className="relative truncate">
              Created by
              {renderColumnResizer("createdBy", "Resize Created by column")}
            </span>
            <span className="relative truncate">
              <button type="button" className="w-full truncate text-left hover:text-foreground" onClick={() => applySort("created")}>
                Created date {sortField === "created" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </button>
              {renderColumnResizer("created", "Resize Created date column")}
            </span>
          </div>
          <div className="border border-border">
            {visibleProjects.map((project) => (
              <Link
                key={project.id}
                to={projectUrl(project)}
                className="block border-b border-border px-2 py-2.5 text-sm no-underline text-inherit transition-colors hover:bg-accent/50 last:border-b-0 md:grid md:items-center md:gap-3 md:py-2"
                style={projectGridStyle}
              >
                <span className="min-w-0 md:hidden">
                  <span className="block truncate pr-2" title={project.name}>
                    {project.name}
                  </span>
                  <span className="mt-1 inline-flex max-w-full items-center gap-x-1 text-xs text-muted-foreground">
                    <span className="truncate capitalize">{project.status.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground/80" aria-hidden>
                      ·
                    </span>
                    <span className="truncate">{mobileGoalsSummary(project)}</span>
                    <span className="text-muted-foreground/80" aria-hidden>
                      ·
                    </span>
                    <span className="truncate">{getCreatedByLabel(project)}</span>
                    <span className="text-muted-foreground/80" aria-hidden>
                      ·
                    </span>
                    <span>{formatDate(project.createdAt)}</span>
                  </span>
                </span>
                <span className="hidden min-w-0 truncate pr-2 md:block" title={project.name}>
                  {project.name}
                </span>
                <span
                  className="hidden min-w-0 md:block"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <ProjectStatusPicker
                    status={project.status}
                    disabled={
                      updateProjectStatus.isPending &&
                      updateProjectStatus.variables?.id === project.id
                    }
                    onChange={(status) => {
                      if (status !== project.status) {
                        updateProjectStatus.mutate({ id: project.id, status });
                      }
                    }}
                  />
                </span>
                <span className="hidden min-w-0 md:block">{renderGoals(project)}</span>
                <span className="hidden truncate text-xs text-muted-foreground md:block" title={getCreatedByLabel(project)}>
                  {getCreatedByLabel(project)}
                </span>
                <span className="hidden text-xs text-muted-foreground md:block">{formatDate(project.createdAt)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {visibleArchivedProjects.length > 0 && (
        <div className="space-y-2">
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setShowArchived((v) => !v)}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${showArchived ? "rotate-90" : ""}`}
            />
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">
              Archived Projects
            </span>
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {visibleArchivedProjects.length}
            </span>
          </button>

          {showArchived && (
            <div className="border border-border opacity-70">
              {visibleArchivedProjects.map((project) => (
                <Link
                  key={project.id}
                  to={projectUrl(project)}
                  className="block border-b border-border px-2 py-2.5 text-sm no-underline text-inherit transition-colors hover:bg-accent/50 last:border-b-0 md:grid md:items-center md:gap-3 md:py-2"
                  style={projectGridStyle}
                >
                  <span className="min-w-0 md:hidden">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                      <span className="truncate pr-2" title={project.name}>
                        {project.name}
                      </span>
                      <span className="shrink-0 rounded-full border border-amber-300/60 bg-amber-50/60 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-400">
                        Archived
                      </span>
                    </span>
                    <span className="mt-1 inline-flex max-w-full items-center gap-x-1 text-xs text-muted-foreground">
                      <span className="truncate capitalize">{project.status.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground/80" aria-hidden>
                        ·
                      </span>
                      <span className="truncate">{mobileGoalsSummary(project)}</span>
                      <span className="text-muted-foreground/80" aria-hidden>
                        ·
                      </span>
                      <span className="truncate">{getCreatedByLabel(project)}</span>
                      <span className="text-muted-foreground/80" aria-hidden>
                        ·
                      </span>
                      <span>{formatDate(project.createdAt)}</span>
                    </span>
                  </span>
                  <span className="hidden min-w-0 items-center gap-2 md:inline-flex">
                    <span className="truncate pr-2" title={project.name}>
                      {project.name}
                    </span>
                    <span className="shrink-0 rounded-full border border-amber-300/60 bg-amber-50/60 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-400">
                      Archived
                    </span>
                  </span>
                  <span
                    className="hidden min-w-0 md:block"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <ProjectStatusPicker
                      status={project.status}
                      disabled={
                        updateProjectStatus.isPending &&
                        updateProjectStatus.variables?.id === project.id
                      }
                      onChange={(status) => {
                        if (status !== project.status) {
                          updateProjectStatus.mutate({ id: project.id, status });
                        }
                      }}
                    />
                  </span>
                  <span className="hidden min-w-0 md:block">{renderGoals(project, "archived")}</span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block" title={getCreatedByLabel(project)}>
                    {getCreatedByLabel(project)}
                  </span>
                  <span className="hidden text-xs text-muted-foreground md:block">{formatDate(project.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
