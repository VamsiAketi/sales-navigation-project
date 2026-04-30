import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { goalsApi } from "../api/goals";
import { costsApi } from "../api/costs";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { authApi } from "../api/auth";
import {
  DASHBOARD_SECTION_IDS,
  loadDashboardSectionOrder,
  saveDashboardSectionOrder,
  type DashboardSectionId,
} from "../lib/dashboard-layout-storage";
import { DASHBOARD_TILE_SURFACE } from "../lib/dashboard-tile-styles";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn, formatCents, formatTokens, agentUrl, projectUrl } from "../lib/utils";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle, ArrowRight, Wallet } from "lucide-react";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  GOAL_STATUSES,
  type Agent,
  type CostByAgent,
  type CostByProject,
  type DashboardSummary,
  type Goal,
  type GoalStatus,
  type Issue,
  type Project,
} from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";
import { issueRollsUpToGoal, isGoalActiveIssueStatus, projectLinkedToGoal } from "../lib/goal-rollup";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "../context/ToastContext";

// ── Goals section ──────────────────────────────────────────────────────────

const GOAL_STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; badgeCls: string; barCls: string }> = {
  active:    { label: "Active",    color: "#0ea5e9", badgeCls: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200", barCls: "bg-sky-500" },
  achieved:  { label: "Achieved",  color: "#22c55e", badgeCls: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300", barCls: "bg-green-500" },
  planned:   { label: "Planned",   color: "#f59e0b", badgeCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300", barCls: "bg-amber-500" },
  cancelled: { label: "Cancelled", color: "#6b7280", badgeCls: "bg-muted text-muted-foreground", barCls: "bg-muted-foreground/50" },
};

function computeGoalDashboardStats(goalId: string, issues: Issue[], projects: Project[]) {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectCount = projects.filter((p) => !p.archivedAt && projectLinkedToGoal(p, goalId)).length;
  const goalIssues = issues.filter((i) => issueRollsUpToGoal(i, goalId, projectById));
  const nonCancelled = goalIssues.filter((i) => i.status !== "cancelled");
  const taskCount = nonCancelled.length;
  const doneCount = goalIssues.filter((i) => i.status === "done").length;
  const blockedCount = goalIssues.filter((i) => i.status === "blocked").length;
  const activeTaskCount = goalIssues.filter((i) => isGoalActiveIssueStatus(i.status)).length;
  const progressPercent =
    nonCancelled.length === 0 ? 0 : Math.round((doneCount / nonCancelled.length) * 100);
  return { projectCount, taskCount, activeTaskCount, doneCount, blockedCount, progressPercent };
}

function goalStatusMenuLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function GoalCard({
  goal,
  companyId,
  stats,
}: {
  goal: Goal;
  companyId: string;
  stats: ReturnType<typeof computeGoalDashboardStats>;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [statusOpen, setStatusOpen] = useState(false);
  const cfg = GOAL_STATUS_CONFIG[goal.status] ?? GOAL_STATUS_CONFIG.planned;

  const updateGoalStatus = useMutation({
    mutationFn: (status: GoalStatus) => goalsApi.update(goal.id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.detail(goal.id) });
    },
    onError: (err: Error) => {
      pushToast({
        title: "Could not update goal status",
        body: err.message,
        tone: "error",
      });
    },
  });

  const goalQs = `goalId=${encodeURIComponent(goal.id)}`;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden",
        DASHBOARD_TILE_SURFACE,
        "transition-colors hover:bg-accent/15",
      )}
    >
      {/* Header */}
      <div className="relative z-[1] flex items-start justify-between gap-3 p-4 pb-3">
        <Link
          to={`/goals/${goal.id}`}
          className={cn(
            "min-w-0 space-y-2 rounded-md text-left no-underline outline-none transition-opacity hover:opacity-90",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <h3 className="text-lg font-bold leading-tight tracking-tight text-foreground line-clamp-2 pr-1">
            {goal.title}
          </h3>
          <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
            {goal.level}
          </span>
        </Link>
        <div className="relative z-[2] shrink-0">
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={updateGoalStatus.isPending}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-sm transition-opacity hover:opacity-95 disabled:pointer-events-none disabled:opacity-50",
                  cfg.badgeCls,
                )}
              >
                {cfg.label}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              {GOAL_STATUSES.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  className={cn("w-full justify-start text-xs", s === goal.status && "bg-accent")}
                  onClick={() => {
                    if (s !== goal.status) updateGoalStatus.mutate(s);
                    setStatusOpen(false);
                  }}
                >
                  {goalStatusMenuLabel(s)}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary metrics — each cell links to the filtered Projects / Tasks view */}
      <div className="relative z-[1] grid grid-cols-3 border-y border-border/60 bg-muted/45 px-1 py-2 dark:bg-muted/25">
        <Link
          to={`/projects?${goalQs}`}
          className={cn(
            "flex flex-col items-center justify-center rounded-md px-1 py-2 text-inherit no-underline outline-none transition-colors",
            "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          aria-label={`View ${stats.projectCount} project${stats.projectCount === 1 ? "" : "s"} for this goal`}
        >
          <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{stats.projectCount}</p>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">Projects</p>
        </Link>
        <Link
          to={`/issues?${goalQs}`}
          className={cn(
            "flex flex-col items-center justify-center rounded-md border-x border-border/50 px-1 py-2 text-inherit no-underline outline-none transition-colors",
            "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          aria-label={`View ${stats.taskCount} task${stats.taskCount === 1 ? "" : "s"} for this goal`}
        >
          <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{stats.taskCount}</p>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">Tasks</p>
        </Link>
        <Link
          to={`/issues?${goalQs}&active=1`}
          className={cn(
            "flex flex-col items-center justify-center rounded-md px-1 py-2 text-inherit no-underline outline-none transition-colors",
            "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          aria-label={`View ${stats.activeTaskCount} active task${stats.activeTaskCount === 1 ? "" : "s"} for this goal`}
        >
          <p className="text-2xl font-semibold tabular-nums leading-none text-amber-600 dark:text-amber-400">
            {stats.activeTaskCount}
          </p>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">Active</p>
        </Link>
      </div>

      {/* Progress */}
      <div className="relative z-[1] space-y-2 p-4 pt-3">
        <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {stats.doneCount} done{stats.blockedCount > 0 ? ` · ${stats.blockedCount} blocked` : ""}
          </span>
          <span className="tabular-nums font-medium text-foreground">{stats.progressPercent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-[width]", cfg.barCls)}
            style={{ width: `${Math.min(100, Math.max(0, stats.progressPercent))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function GoalsSection({
  companyId,
  goals,
  issues,
  projects,
}: {
  companyId: string;
  goals: Goal[];
  issues: Issue[];
  projects: Project[];
}) {
  const statsByGoalId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeGoalDashboardStats>>();
    for (const g of goals) {
      map.set(g.id, computeGoalDashboardStats(g.id, issues, projects));
    }
    return map;
  }, [goals, issues, projects]);

  return goals.length === 0 ? (
    <Link
      to="/goals"
      className={cn(
        DASHBOARD_TILE_SURFACE,
        "block p-4 no-underline text-inherit transition-colors hover:bg-accent/30 hover:border-border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <p className="text-sm text-muted-foreground">No goals defined yet.</p>
      <p className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Go to goals <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </p>
    </Link>
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {goals.map((goal) => (
        <GoalCard key={goal.id} companyId={companyId} goal={goal} stats={statsByGoalId.get(goal.id)!} />
      ))}
    </div>
  );
}

// ── Cost breakdown section ─────────────────────────────────────────────────

function CostBreakdownSection({ byAgent, byProject }: { byAgent: CostByAgent[]; byProject: CostByProject[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {/* By agent */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">By Agent</h3>
          <Link to="/costs" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className={cn(DASHBOARD_TILE_SURFACE, "overflow-hidden")}>
          {byAgent.length === 0 ? (
            <Link
              to="/costs"
              className="block px-4 py-3 no-underline text-inherit transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <p className="text-sm text-muted-foreground">No cost events yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Open costs</p>
            </Link>
          ) : (
            <div className="divide-y divide-border">
              {byAgent.slice(0, 6).map((row) => (
                <Link
                  key={row.agentId}
                  to={agentUrl({ id: row.agentId, name: row.agentName })}
                  className="flex items-center justify-between gap-3 px-4 py-2 no-underline text-inherit transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Identity name={row.agentName ?? row.agentId} size="sm" className="min-w-0" />
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium tabular-nums">{formatCents(row.costCents)}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {formatTokens(row.inputTokens + row.cachedInputTokens + row.outputTokens)} tok
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* By project */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">By Project</h3>
          <Link to="/costs" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className={cn(DASHBOARD_TILE_SURFACE, "overflow-hidden")}>
          {byProject.length === 0 ? (
            <Link
              to="/costs"
              className="block px-4 py-3 no-underline text-inherit transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <p className="text-sm text-muted-foreground">No project-attributed run costs yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">Open costs</p>
            </Link>
          ) : (
            <div className="divide-y divide-border">
              {byProject.slice(0, 6).map((row, i) => (
                <Link
                  key={row.projectId ?? `unattributed-${i}`}
                  to={
                    row.projectId
                      ? projectUrl({ id: row.projectId, name: row.projectName })
                      : "/costs"
                  }
                  className="flex items-center justify-between gap-3 px-4 py-2 no-underline text-inherit transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="text-sm truncate">{row.projectName ?? row.projectId ?? "Unattributed"}</span>
                  <span className="text-sm font-medium tabular-nums shrink-0">{formatCents(row.costCents)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBoardRoleLabel(role: string | null | undefined): string {
  const raw = (role ?? "member").trim();
  if (!raw) return "Member";
  const r = raw.toLowerCase();
  if (r === "owner") return "Owner";
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function CostsMtdSection({ data }: { data: DashboardSummary }) {
  const monthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, []);
  const budgetHeadline =
    data.costs.monthBudgetCents > 0 ? formatCents(data.costs.monthBudgetCents) : "Not set";
  const budgetSub =
    data.costs.monthBudgetCents > 0
      ? `${data.costs.monthUtilizationPercent}% utilized`
      : "Set budgets on the Costs page";
  const noSpend = data.costs.monthSpendCents === 0;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">Month to date · {monthLabel}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          to="/costs"
          className={cn(
            DASHBOARD_TILE_SURFACE,
            "relative flex gap-3 p-4 no-underline text-inherit outline-none transition-colors hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40"
            aria-hidden
          >
            <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatCents(data.costs.monthSpendCents)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Inference and usage in this period</p>
          </div>
        </Link>
        <Link
          to="/costs"
          className={cn(
            DASHBOARD_TILE_SURFACE,
            "relative flex gap-3 p-4 no-underline text-inherit outline-none transition-colors hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-950/40" aria-hidden>
            <Wallet className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{budgetHeadline}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{budgetSub}</p>
          </div>
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        {noSpend
          ? "No usage spend recorded this month yet."
          : "Totals include inference and governed spend for this company."}{" "}
        <Link to="/costs" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
          Open Costs
        </Link>{" "}
        for per-teammate breakdown.
      </p>
    </div>
  );
}

// ── Draggable sections ─────────────────────────────────────────────────────

function SectionDragHandle(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="mt-0.5 flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted active:cursor-grabbing"
      title="Drag to reorder section"
      {...props}
    >
      <span className="grid grid-cols-2 gap-px" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="h-0.5 w-0.5 rounded-full bg-muted-foreground/65" />
        ))}
      </span>
    </button>
  );
}

function DraggableSection({
  id,
  title,
  headerRight,
  children,
}: {
  id: string;
  /** Section heading (e.g. GOALS). Omit for untitled bands (metrics, charts). */
  title?: string | null;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const showHeaderRow = Boolean(title) || Boolean(headerRight);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex gap-1.5", isDragging ? "z-50 opacity-50" : "")}
    >
      <SectionDragHandle {...attributes} {...listeners} />
      <div className="min-w-0 flex-1 space-y-2">
        {showHeaderRow ? (
          <div className="flex items-center justify-between gap-2">
            {title ? (
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
            ) : (
              <span className="sr-only">Dashboard section</span>
            )}
            {headerRight}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [sectionOrder, setSectionOrder] = useState<DashboardSectionId[]>(() => [...DASHBOARD_SECTION_IDS]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data: session, status: sessionStatus } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    staleTime: 60_000,
  });
  const sessionResolved = sessionStatus !== "pending";
  const layoutUserId = session?.user?.id ?? null;
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadCommandCenter = sidebarBadges?.canReadCommandCenter ?? true;
  const dashboardEnabled = Boolean(selectedCompanyId) && canReadCommandCenter;

  useEffect(() => {
    if (!selectedCompanyId || !sessionResolved) return;
    setSectionOrder(loadDashboardSectionOrder(layoutUserId, selectedCompanyId));
  }, [layoutUserId, selectedCompanyId, sessionResolved]);

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedCompanyId) return;
    setSectionOrder((prev) => {
      const next = arrayMove(
        prev,
        prev.indexOf(active.id as DashboardSectionId),
        prev.indexOf(over.id as DashboardSectionId),
      );
      saveDashboardSectionOrder(layoutUserId, selectedCompanyId, next);
      return next;
    });
  }

  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Command Center" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: dashboardEnabled,
  });

  const { data: costData } = useQuery({
    queryKey: queryKeys.costs(selectedCompanyId!, undefined, undefined),
    queryFn: async () => {
      const [byAgent, byProject] = await Promise.all([
        costsApi.byAgent(selectedCompanyId!),
        costsApi.byProject(selectedCompanyId!),
      ]);
      return { byAgent, byProject };
    },
    enabled: dashboardEnabled,
  });

  const recentIssues = issues ? getRecentIssues(issues) : [];
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 10), [activity]);
  const dashboardGoals = useMemo(
    () => (goals ?? []).filter((g) => g.status !== "cancelled"),
    [goals],
  );

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter((t) => t !== timer);
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      if (member.principalType === "user" && member.user) {
        map.set(member.user.id, member.user.name);
      }
    }
    return map;
  }, [members]);

  const boardRoleLabel = useMemo(() => {
    const uid = session?.user?.id;
    if (!uid || !members) return null;
    const me = members.find((m) => m.principalType === "user" && m.user?.id === uid);
    if (!me) return null;
    return formatBoardRoleLabel(me.membershipRole);
  }, [session?.user?.id, members]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to AI-Harness. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (!canReadCommandCenter) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
        <div className="font-medium text-foreground">You do not have permission to view Command Center.</div>
        <div className="mt-2">
          Ask a company admin for the <code>command_center.read</code> permission.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  return (
    <div className="space-y-4">
      {boardRoleLabel ? (
        <header className="flex justify-end">
          <p className="text-sm text-muted-foreground">{boardRoleLabel}</p>
        </header>
      ) : null}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              You have no agents.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            Create one here
          </button>
        </div>
      )}

      {data?.budgets.activeIncidents ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-[linear-gradient(180deg,rgba(255,80,80,0.12),rgba(255,255,255,0.02))] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>
              <p className="text-sm font-medium text-red-50">
                {data.budgets.activeIncidents} active budget incident{data.budgets.activeIncidents === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-red-100/70">
                {data.budgets.pausedAgents} agents paused · {data.budgets.pausedProjects} projects paused · {data.budgets.pendingApprovals} pending budget approvals
              </p>
            </div>
          </div>
          <Link to="/costs" className="text-sm underline underline-offset-2 text-red-100">
            Open budgets
          </Link>
        </div>
      ) : null}

      <DndContext sensors={sensors} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {sectionOrder.map((id) => {
              if (id === "goals") {
                return (
                  <DraggableSection
                    key="goals"
                    id="goals"
                    title="Goals"
                    headerRight={
                      <Link
                        to="/goals"
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        View all <ArrowRight className="h-3 w-3" aria-hidden />
                      </Link>
                    }
                  >
                    <GoalsSection
                      companyId={selectedCompanyId}
                      goals={dashboardGoals}
                      issues={issues ?? []}
                      projects={projects ?? []}
                    />
                  </DraggableSection>
                );
              }
              if (id === "metrics") {
                return data ? (
                  <DraggableSection key="metrics" id="metrics">
                    <div className="grid grid-cols-2 gap-1 sm:gap-2 xl:grid-cols-4">
                      <MetricCard
                        icon={Bot}
                        iconTint="violet"
                        value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
                        label="AI teammates"
                        to="/agents"
                        description={
                          <span>
                            {data.agents.running} running{", "}
                            {data.agents.paused} paused{", "}
                            {data.agents.error} errors
                          </span>
                        }
                      />
                      <MetricCard
                        icon={CircleDot}
                        iconTint="sky"
                        value={data.tasks.inProgress}
                        label="Tasks in motion"
                        to="/issues"
                        description={
                          <span>
                            {data.tasks.open} open{", "}
                            {data.tasks.blocked} blocked
                          </span>
                        }
                      />
                      <MetricCard
                        icon={DollarSign}
                        iconTint="emerald"
                        value={formatCents(data.costs.monthSpendCents)}
                        label="Month spend"
                        to="/costs"
                        description={
                          <span>
                            {data.costs.monthBudgetCents > 0
                              ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} budget`
                              : "Unlimited budget"}
                          </span>
                        }
                      />
                      <MetricCard
                        icon={ShieldCheck}
                        iconTint="purple"
                        value={data.pendingApprovals + data.budgets.pendingApprovals}
                        label="Governance queue"
                        to="/approvals"
                        description={<span>Awaiting owner review</span>}
                      />
                    </div>
                  </DraggableSection>
                ) : null;
              }
              if (id === "charts") {
                return (
                  <DraggableSection key="charts" id="charts">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <ChartCard
                        title="Execution volume"
                        subtitle="Last 14 days"
                        to="/activity"
                        drillLabel="Open activity log"
                      >
                        <RunActivityChart runs={runs ?? []} />
                      </ChartCard>
                      <ChartCard title="Tasks by priority" subtitle="Last 14 days" to="/issues" drillLabel="Open tasks">
                        <PriorityChart issues={issues ?? []} />
                      </ChartCard>
                      <ChartCard
                        title="Task status"
                        subtitle="Last 14 days"
                        caption="Where work stands"
                        to="/issues"
                        drillLabel="Open tasks"
                      >
                        <IssueStatusChart issues={issues ?? []} />
                      </ChartCard>
                      <ChartCard
                        title="Run success rate"
                        subtitle="Last 14 days"
                        caption="Quality of execution"
                        to="/agents/all"
                        drillLabel="View agents & runs"
                      >
                        <SuccessRateChart runs={runs ?? []} />
                      </ChartCard>
                    </div>
                  </DraggableSection>
                );
              }
              if (id === "costs") {
                return (
                  <DraggableSection key="costs" id="costs" title="Costs">
                    {data ? <CostsMtdSection data={data} /> : null}
                    <div className={data ? "border-t border-border/60 pt-4" : ""}>
                      <CostBreakdownSection byAgent={costData?.byAgent ?? []} byProject={costData?.byProject ?? []} />
                    </div>
                  </DraggableSection>
                );
              }
              return null;
            })}
          </div>
        </SortableContext>
      </DndContext>

      <PluginSlotOutlet
        slotTypes={["dashboardWidget"]}
        context={{ companyId: selectedCompanyId }}
        className="grid gap-4 md:grid-cols-2"
        itemClassName={cn(DASHBOARD_TILE_SURFACE, "p-4")}
      />
    </div>
  );
}
