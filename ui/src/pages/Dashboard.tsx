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
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle, ArrowRight, Target, Wallet } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "../context/ToastContext";

// ── Goals section ──────────────────────────────────────────────────────────

const GOAL_STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; badgeCls: string; barCls: string }> = {
  active:    { label: "Active",    color: "#10b981", badgeCls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300", barCls: "bg-emerald-500" },
  achieved:  { label: "Achieved",  color: "#22c55e", badgeCls: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300", barCls: "bg-green-500" },
  planned:   { label: "Planned",   color: "#f59e0b", badgeCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300", barCls: "bg-amber-500" },
  cancelled: { label: "Cancelled", color: "#6b7280", badgeCls: "bg-muted text-muted-foreground", barCls: "bg-muted-foreground/50" },
};

function goalStatusMenuLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function GoalCard({ goal, companyId }: { goal: Goal; companyId: string }) {
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

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden",
        DASHBOARD_TILE_SURFACE,
        "p-4 transition-colors hover:bg-accent/20",
      )}
    >
      <Link
        to={`/goals/${goal.id}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open goal: ${goal.title}`}
      />
      <div
        className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/35 pointer-events-none"
        aria-hidden
      >
        <Target className="h-5 w-5 text-rose-600 dark:text-rose-400" />
      </div>
      <div className="relative z-[1] min-w-0 flex-1 pointer-events-none">
        <p className="text-sm font-semibold leading-snug text-foreground line-clamp-1">{goal.title}</p>
        <p className="text-xs text-muted-foreground capitalize">{goal.level}</p>
      </div>
      <div className="relative z-[2] shrink-0 pointer-events-auto">
        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={updateGoalStatus.isPending}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize whitespace-nowrap cursor-pointer hover:opacity-90 transition-opacity disabled:pointer-events-none disabled:opacity-50",
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
  );
}

function GoalsSection({ companyId, goals }: { companyId: string; goals: Goal[] }) {
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
        <GoalCard key={goal.id} companyId={companyId} goal={goal} />
      ))}
    </div>
  );
}

// ── Cost breakdown section ─────────────────────────────────────────────────

function CostBreakdownSection({ byAgent, byProject }: { byAgent: CostByAgent[]; byProject: CostByProject[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* By agent */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">By Agent</h3>
          <Link to="/costs" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className={cn(DASHBOARD_TILE_SURFACE, "overflow-hidden")}>
          {byAgent.length === 0 ? (
            <Link
              to="/costs"
              className="block px-4 py-4 no-underline text-inherit transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  className="flex items-center justify-between gap-3 px-4 py-2.5 no-underline text-inherit transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">By Project</h3>
          <Link to="/costs" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className={cn(DASHBOARD_TILE_SURFACE, "overflow-hidden")}>
          {byProject.length === 0 ? (
            <Link
              to="/costs"
              className="block px-4 py-4 no-underline text-inherit transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  className="flex items-center justify-between gap-3 px-4 py-2.5 no-underline text-inherit transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
  if (r === "owner") return import.meta.env.DEV ? "Local Owner" : "Owner";
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
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">Month to date · {monthLabel}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      <div className="min-w-0 flex-1 space-y-3">
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
    enabled: !!selectedCompanyId,
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Command Center" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
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
    enabled: !!selectedCompanyId,
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

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Command Center</h1>
        {boardRoleLabel ? (
          <p className="text-sm text-muted-foreground sm:pt-0.5">{boardRoleLabel}</p>
        ) : null}
      </header>

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
          <div className="space-y-6">
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
                    <GoalsSection companyId={selectedCompanyId} goals={dashboardGoals} />
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
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <ChartCard
                        title="Execution volume"
                        subtitle="Last 14 days"
                        to="/activity"
                        drillLabel="Open activity log"
                      >
                        <RunActivityChart runs={runs ?? []} />
                      </ChartCard>
                      <ChartCard title="Tasks by priority" subtitle="Last 14 days" to="/issues" drillLabel="Open issues">
                        <PriorityChart issues={issues ?? []} />
                      </ChartCard>
                      <ChartCard
                        title="Task status"
                        subtitle="Last 14 days"
                        caption="Where work stands"
                        to="/issues"
                        drillLabel="Open issues"
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
                    <div className={data ? "border-t border-border/60 pt-5" : ""}>
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
