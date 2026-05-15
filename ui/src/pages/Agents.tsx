import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "../components/StatusBadge";
import { azureAgentStatusDot, azureAgentStatusDotDefault } from "../lib/azure-agents-page";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Bot, Plus, List, GitBranch, SlidersHorizontal } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  hermes_local: "Hermes",
  openclaw_gateway: "OpenClaw Gateway",
  process: "Process",
  http: "HTTP",
};

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

type FilterTab = "all" | "active" | "paused" | "error";

function matchesFilter(status: string, tab: FilterTab, showTerminated: boolean): boolean {
  if (status === "terminated") return showTerminated;
  if (tab === "all") return true;
  if (tab === "active") return status === "active" || status === "running" || status === "idle";
  if (tab === "paused") return status === "paused";
  if (tab === "error") return status === "error";
  return true;
}

function filterAgents(agents: Agent[], tab: FilterTab, showTerminated: boolean): Agent[] {
  return agents
    .filter((a) => matchesFilter(a.status, tab, showTerminated))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function filterOrgTree(nodes: OrgNode[], tab: FilterTab, showTerminated: boolean): OrgNode[] {
  return nodes
    .reduce<OrgNode[]>((acc, node) => {
      const filteredReports = filterOrgTree(node.reports, tab, showTerminated);
      const isHumanNode = node.nodeType === "human";
      if (isHumanNode) {
        // Agents page should only render agent nodes; promote nested agent reports.
        acc.push(...filteredReports);
        return acc;
      }
      if (matchesFilter(node.status, tab, showTerminated) || filteredReports.length > 0) {
        acc.push({ ...node, reports: filteredReports });
      }
      return acc;
    }, [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function Agents() {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();
  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const tab: FilterTab = (pathSegment === "all" || pathSegment === "active" || pathSegment === "paused" || pathSegment === "error") ? pathSegment : "all";
  const [view, setView] = useState<"list" | "org">("org");
  const forceListView = isMobile;
  const effectiveView: "list" | "org" = forceListView ? "list" : view;
  const [showTerminated, setShowTerminated] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: agents, isLoading, error } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadAgents = sidebarBadges?.canReadAgents ?? true;
  const canEditAgents = sidebarBadges?.canEditAgents ?? true;

  const { data: orgTree } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId && effectiveView === "org",
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  // Map agentId -> first live run + live run count
  const liveRunByAgent = useMemo(() => {
    const map = new Map<string, { runId: string; liveCount: number }>();
    for (const r of runs ?? []) {
      if (r.status !== "running" && r.status !== "queued") continue;
      const existing = map.get(r.agentId);
      if (existing) {
        existing.liveCount += 1;
        continue;
      }
      map.set(r.agentId, { runId: r.id, liveCount: 1 });
    }
    return map;
  }, [runs]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Agents" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a company to view agents." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }
  if (!canReadAgents) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
        <div className="font-medium text-foreground">You do not have permission to view Agents.</div>
        <div className="mt-2">
          Ask a company admin for the <code>agents.read</code> permission.
        </div>
      </div>
    );
  }

  const filtered = filterAgents(agents ?? [], tab, showTerminated);
  const filteredOrg = filterOrgTree(orgTree ?? [], tab, showTerminated);

  return (
    <div className="space-y-4 font-sans">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => navigate(`/agents/${v}`)} className="w-full sm:w-auto">
          <PageTabBar
            variant="azure"
            items={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "error", label: "Error" },
            ]}
            value={tab}
            onValueChange={(v) => navigate(`/agents/${v}`)}
          />
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {/* Filters */}
          <div className="relative">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[13px] font-normal transition-colors",
                "border-[#8a8886] bg-background text-[#323130] hover:bg-[#f3f2f1] dark:border-white/20 dark:text-foreground dark:hover:bg-white/[0.06]",
                (filtersOpen || showTerminated) && "border-[#0078d4] bg-[#deecf9] text-[#0078d4] dark:border-[#4cc2ff] dark:bg-[#0078d4]/15 dark:text-[#4cc2ff]",
              )}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {showTerminated && (
                <span className="ml-0.5 rounded-sm bg-[#0078d4] px-1.5 py-px text-[10px] font-semibold text-white dark:bg-[#4cc2ff] dark:text-[#201f1e]">
                  1
                </span>
              )}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-sm border border-[#edebe9] bg-popover p-1 shadow-lg dark:border-white/10">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-[#323130] transition-colors hover:bg-[#f3f2f1] dark:text-foreground dark:hover:bg-white/[0.06]"
                  onClick={() => setShowTerminated(!showTerminated)}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-[#8a8886] dark:border-white/30",
                      showTerminated && "border-[#0078d4] bg-[#0078d4] dark:border-[#4cc2ff] dark:bg-[#4cc2ff]",
                    )}
                  >
                    {showTerminated && (
                      <span className="text-[10px] leading-none text-white dark:text-[#201f1e]">&#10003;</span>
                    )}
                  </span>
                  Show terminated
                </button>
              </div>
            )}
          </div>
          {/* View toggle */}
          {!forceListView && (
            <div className="flex items-center overflow-hidden rounded-sm border border-[#8a8886] dark:border-white/20">
              <button
                type="button"
                className={cn(
                  "p-2 transition-colors",
                  effectiveView === "list"
                    ? "bg-[#edebe9] text-[#201f1e] dark:bg-white/[0.12] dark:text-foreground"
                    : "text-[#605e5c] hover:bg-[#f3f2f1] dark:text-muted-foreground dark:hover:bg-white/[0.06]",
                )}
                onClick={() => setView("list")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  "border-l border-[#edebe9] p-2 transition-colors dark:border-white/10",
                  effectiveView === "org"
                    ? "bg-[#edebe9] text-[#201f1e] dark:bg-white/[0.12] dark:text-foreground"
                    : "text-[#605e5c] hover:bg-[#f3f2f1] dark:text-muted-foreground dark:hover:bg-white/[0.06]",
                )}
                onClick={() => setView("org")}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {canEditAgents ? (
            <Button
              size="sm"
              className="h-9 rounded-sm border-0 bg-[#0078d4] px-3 text-[13px] font-normal text-white shadow-none hover:bg-[#106ebe] dark:bg-[#0078d4] dark:hover:bg-[#106ebe]"
              onClick={openNewAgent}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Agent
            </Button>
          ) : null}
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-[12px] text-[#605e5c] dark:text-muted-foreground">
          {filtered.length} agent{filtered.length !== 1 ? "s" : ""}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {agents && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          message="Create your first agent to get started."
          action={canEditAgents ? "New Agent" : undefined}
          onAction={canEditAgents ? openNewAgent : undefined}
        />
      )}

      {/* List view */}
      {effectiveView === "list" && filtered.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-[#edebe9] dark:border-white/10">
          {filtered.map((agent) => {
            return (
              <EntityRow
                key={agent.id}
                variant="azure"
                title={agent.name}
                subtitle={`${roleLabels[agent.role] ?? agent.role}${agent.title ? ` - ${agent.title}` : ""}`}
                to={agentUrl(agent)}
                leading={
                  <span className="relative flex h-2.5 w-2.5">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full ${azureAgentStatusDot[agent.status] ?? azureAgentStatusDotDefault}`}
                    />
                  </span>
                }
                trailing={
                  <div className="flex items-center gap-3">
                    <span className="sm:hidden">
                      {liveRunByAgent.has(agent.id) ? (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      ) : (
                        <StatusBadge variant="azure" status={agent.status} />
                      )}
                    </span>
                    <div className="hidden sm:flex items-center gap-3">
                      {liveRunByAgent.has(agent.id) && (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      )}
                      <span className="w-14 text-right font-[ui-monospace] text-[12px] text-[#605e5c] dark:text-muted-foreground">
                        {adapterLabels[agent.adapterType] ?? agent.adapterType}
                      </span>
                      <span className="w-16 text-right text-[12px] text-[#605e5c] dark:text-muted-foreground">
                        {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
                      </span>
                      <span className="flex w-20 justify-end">
                        <StatusBadge variant="azure" status={agent.status} />
                      </span>
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {effectiveView === "list" && agents && agents.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filter.
        </p>
      )}

      {/* Org chart view */}
      {effectiveView === "org" && filteredOrg.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-[#edebe9] py-0 dark:border-white/10">
          {filteredOrg.map((node) => (
            <OrgTreeNode key={node.id} node={node} depth={0} agentMap={agentMap} liveRunByAgent={liveRunByAgent} />
          ))}
        </div>
      )}

      {effectiveView === "org" && orgTree && orgTree.length > 0 && filteredOrg.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filter.
        </p>
      )}

      {effectiveView === "org" && orgTree && orgTree.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No organizational hierarchy defined.
        </p>
      )}
    </div>
  );
}

function OrgTreeNode({
  node,
  depth,
  agentMap,
  liveRunByAgent,
}: {
  node: OrgNode;
  depth: number;
  agentMap: Map<string, Agent>;
  liveRunByAgent: Map<string, { runId: string; liveCount: number }>;
}) {
  const agent = agentMap.get(node.id);

  const statusColor = azureAgentStatusDot[node.status] ?? azureAgentStatusDotDefault;

  return (
    <div style={{ paddingLeft: depth * 24 }}>
      <Link
        to={agent ? agentUrl(agent) : `/agents/${node.id}`}
        className="flex w-full items-center gap-3 border-b border-[#edebe9] px-3 py-2.5 text-left text-[13px] text-inherit no-underline transition-colors hover:bg-[#f3f2f1] dark:border-white/10 dark:hover:bg-white/[0.06]"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={`absolute inline-flex h-full w-full rounded-full ${statusColor}`} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-[#201f1e] dark:text-foreground">{node.name}</span>
          <span className="ml-2 text-[12px] text-[#605e5c] dark:text-muted-foreground">
            {roleLabels[node.role] ?? node.role}
            {agent?.title ? ` - ${agent.title}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="sm:hidden">
            {liveRunByAgent.has(node.id) ? (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            ) : (
              <StatusBadge variant="azure" status={node.status} />
            )}
          </span>
          <div className="hidden sm:flex items-center gap-3">
            {liveRunByAgent.has(node.id) && (
              <LiveRunIndicator
                agentRef={agent ? agentRouteRef(agent) : node.id}
                runId={liveRunByAgent.get(node.id)!.runId}
                liveCount={liveRunByAgent.get(node.id)!.liveCount}
              />
            )}
            {agent && (
              <>
                <span className="w-14 text-right font-[ui-monospace] text-[12px] text-[#605e5c] dark:text-muted-foreground">
                  {adapterLabels[agent.adapterType] ?? agent.adapterType}
                </span>
                <span className="w-16 text-right text-[12px] text-[#605e5c] dark:text-muted-foreground">
                  {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
                </span>
              </>
            )}
            <span className="flex w-20 justify-end">
              <StatusBadge variant="azure" status={node.status} />
            </span>
          </div>
        </div>
      </Link>
      {node.reports && node.reports.length > 0 && (
        <div className="ml-4 border-l border-[#edebe9] dark:border-white/10">
          {node.reports.map((child) => (
            <OrgTreeNode key={child.id} node={child} depth={depth + 1} agentMap={agentMap} liveRunByAgent={liveRunByAgent} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveRunIndicator({
  agentRef,
  runId,
  liveCount,
}: {
  agentRef: string;
  runId: string;
  liveCount: number;
}) {
  return (
    <Link
      to={`/agents/${agentRef}/runs/${runId}`}
      className="flex items-center gap-1.5 rounded-sm border border-[#deecf9] bg-[#deecf9] px-2 py-0.5 text-[11px] font-semibold text-[#0078d4] no-underline transition-colors hover:bg-[#c7e0f4] dark:border-[#0078d4]/35 dark:bg-[#0078d4]/18 dark:text-[#4cc2ff] dark:hover:bg-[#0078d4]/28"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-[#0078d4] opacity-40 dark:bg-[#4cc2ff]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0078d4] dark:bg-[#4cc2ff]" />
      </span>
      <span>
        Live{liveCount > 1 ? ` (${liveCount})` : ""}
      </span>
    </Link>
  );
}
