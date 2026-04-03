import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
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
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn, formatCents, formatTokens } from "../lib/utils";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle, ArrowRight, GripVertical } from "lucide-react";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, CostByAgent, CostByProject, Goal, GoalStatus, Issue, Project } from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";

// ── Goals section ──────────────────────────────────────────────────────────

const GOAL_STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; badgeCls: string; barCls: string }> = {
  active:    { label: "Active",    color: "#3b82f6", badgeCls: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",   barCls: "bg-blue-500" },
  achieved:  { label: "Achieved",  color: "#22c55e", badgeCls: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300", barCls: "bg-green-500" },
  planned:   { label: "Planned",   color: "#f59e0b", badgeCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300", barCls: "bg-amber-500" },
  cancelled: { label: "Cancelled", color: "#6b7280", badgeCls: "bg-muted text-muted-foreground",                                       barCls: "bg-muted-foreground/50" },
};

function GoalCard({ goal, projectCount, totalIssues, inProgress, done, blocked }: {
  goal: Goal;
  projectCount: number;
  totalIssues: number;
  inProgress: number;
  done: number;
  blocked: number;
}) {
  const cfg = GOAL_STATUS_CONFIG[goal.status] ?? GOAL_STATUS_CONFIG.planned;
  const progress = totalIssues > 0 ? Math.round((done / totalIssues) * 100) : 0;

  return (
    <div
      className="group relative rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
      style={{ borderTopWidth: 2, borderTopColor: cfg.color }}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="font-semibold text-sm leading-snug line-clamp-2 flex-1 min-w-0">{goal.title}</p>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize whitespace-nowrap", cfg.badgeCls)}>
            {cfg.label}
          </span>
        </div>

        {/* Level badge */}
        <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
          {goal.level}
        </span>

        {/* Stats grid */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-muted/50 px-2 py-2">
            <p className="text-lg font-bold tabular-nums leading-none">{projectCount}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Projects</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2 py-2">
            <p className="text-lg font-bold tabular-nums leading-none">{totalIssues}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Tasks</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2 py-2">
            <p className={cn("text-lg font-bold tabular-nums leading-none", inProgress > 0 ? "text-yellow-600 dark:text-yellow-400" : "")}>{inProgress}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Active</p>
          </div>
        </div>

        {/* Progress bar */}
        {totalIssues > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>{done} done{blocked > 0 ? ` · ${blocked} blocked` : ""}</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", cfg.barCls)} style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground/60">No tasks linked yet</p>
        )}
      </div>
    </div>
  );
}

function GoalsSection({ goals, projects, issues }: { goals: Goal[]; projects: Project[]; issues: Issue[] }) {
  const metrics = useMemo(() => goals.map((goal) => {
    const linked = projects.filter((p) => p.goalIds.includes(goal.id));
    const pids = new Set(linked.map((p) => p.id));
    const gi = issues.filter((i) => i.projectId && pids.has(i.projectId));
    return {
      goal,
      projectCount: linked.length,
      totalIssues: gi.length,
      inProgress: gi.filter((i) => i.status === "in_progress").length,
      done: gi.filter((i) => i.status === "done").length,
      blocked: gi.filter((i) => i.status === "blocked").length,
    };
  }), [goals, projects, issues]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Goals</h3>
        <Link
          to="/goals"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {goals.length === 0 ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">No goals defined yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {metrics.map((m) => <GoalCard key={m.goal.id} {...m} />)}
        </div>
      )}
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
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          {byAgent.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No cost events yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {byAgent.slice(0, 6).map((row) => (
                <div key={row.agentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <Identity name={row.agentName ?? row.agentId} size="sm" className="min-w-0" />
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium tabular-nums">{formatCents(row.costCents)}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {formatTokens(row.inputTokens + row.cachedInputTokens + row.outputTokens)} tok
                    </div>
                  </div>
                </div>
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
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          {byProject.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No project-attributed run costs yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {byProject.slice(0, 6).map((row, i) => (
                <div key={row.projectId ?? `unattributed-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm truncate">{row.projectName ?? row.projectId ?? "Unattributed"}</span>
                  <span className="text-sm font-medium tabular-nums shrink-0">{formatCents(row.costCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Draggable sections ─────────────────────────────────────────────────────

const SECTION_IDS = ["goals", "metrics", "charts", "costs"] as const;
type SectionId = (typeof SECTION_IDS)[number];
const STORAGE_KEY = "dashboard:section-order";

function loadSectionOrder(): SectionId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((id): id is SectionId => SECTION_IDS.includes(id as SectionId))) {
        const missing = SECTION_IDS.filter((id) => !parsed.includes(id));
        return [...(parsed as SectionId[]), ...missing];
      }
    }
  } catch {}
  return [...SECTION_IDS];
}

function DraggableSection({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative", isDragging ? "z-50 opacity-50" : "")}
    >
      <button
        {...attributes}
        {...listeners}
        className="absolute -top-1 right-0 flex h-6 w-6 cursor-grab items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing text-muted-foreground hover:text-foreground hover:bg-muted"
        title="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
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
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(loadSectionOrder);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSectionOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(active.id as SectionId), prev.indexOf(over.id as SectionId));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
    setBreadcrumbs([{ label: "Dashboard" }]);
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
              if (id === "goals") return (
                <DraggableSection key="goals" id="goals">
                  <GoalsSection goals={goals ?? []} projects={projects ?? []} issues={issues ?? []} />
                </DraggableSection>
              );
              if (id === "metrics") return data ? (
                <DraggableSection key="metrics" id="metrics">
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
                    <MetricCard
                      icon={Bot}
                      value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
                      label="Agents Enabled"
                      to="/agents"
                      description={<span>{data.agents.running} running{", "}{data.agents.paused} paused{", "}{data.agents.error} errors</span>}
                    />
                    <MetricCard
                      icon={CircleDot}
                      value={data.tasks.inProgress}
                      label="Tasks In Progress"
                      to="/issues"
                      description={<span>{data.tasks.open} open{", "}{data.tasks.blocked} blocked</span>}
                    />
                    <MetricCard
                      icon={DollarSign}
                      value={formatCents(data.costs.monthSpendCents)}
                      label="Month Spend"
                      to="/costs"
                      description={<span>{data.costs.monthBudgetCents > 0 ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} budget` : "Unlimited budget"}</span>}
                    />
                    <MetricCard
                      icon={ShieldCheck}
                      value={data.pendingApprovals + data.budgets.pendingApprovals}
                      label="Pending Approvals"
                      to="/approvals"
                      description={<span>{data.budgets.pendingApprovals > 0 ? `${data.budgets.pendingApprovals} budget overrides awaiting board review` : "Awaiting board review"}</span>}
                    />
                  </div>
                </DraggableSection>
              ) : null;
              if (id === "charts") return (
                <DraggableSection key="charts" id="charts">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <ChartCard title="Run Activity" subtitle="Last 14 days">
                      <RunActivityChart runs={runs ?? []} />
                    </ChartCard>
                    <ChartCard title="Issues by Priority" subtitle="Last 14 days">
                      <PriorityChart issues={issues ?? []} />
                    </ChartCard>
                    <ChartCard title="Issues by Status" subtitle="Last 14 days">
                      <IssueStatusChart issues={issues ?? []} />
                    </ChartCard>
                    <ChartCard title="Success Rate" subtitle="Last 14 days">
                      <SuccessRateChart runs={runs ?? []} />
                    </ChartCard>
                  </div>
                </DraggableSection>
              );
              if (id === "costs") return (
                <DraggableSection key="costs" id="costs">
                  <CostBreakdownSection byAgent={costData?.byAgent ?? []} byProject={costData?.byProject ?? []} />
                </DraggableSection>
              );
              return null;
            })}
          </div>
        </SortableContext>
      </DndContext>

      <PluginSlotOutlet
        slotTypes={["dashboardWidget"]}
        context={{ companyId: selectedCompanyId }}
        className="grid gap-4 md:grid-cols-2"
        itemClassName="rounded-lg border bg-card p-4 shadow-sm"
      />
    </div>
  );
}
