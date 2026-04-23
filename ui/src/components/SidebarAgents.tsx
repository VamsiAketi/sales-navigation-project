import { useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronRight, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { heartbeatsApi } from "../api/heartbeats";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { useAgentOrder } from "../hooks/useAgentOrder";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import {
  sidebarNavCollapsibleGroupClass,
  sidebarNavSubItemTextClass,
} from "./SidebarSection";
import { azureSidebarIcon } from "../lib/sidebar-icon-tints";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Agent } from "@paperclipai/shared";

interface AgentTreeNodeProps {
  agent: Agent;
  depth: number;
  childrenMap: Map<string, Agent[]>;
  liveCountByAgent: Map<string, number>;
  activeAgentId: string | null;
  activeTab: string | null;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
}

function AgentTreeNode({
  agent,
  depth,
  childrenMap,
  liveCountByAgent,
  activeAgentId,
  activeTab,
  isMobile,
  setSidebarOpen,
}: AgentTreeNodeProps) {
  const [open, setOpen] = useState(true);
  const children = childrenMap.get(agent.id) ?? [];
  const hasChildren = children.length > 0;
  const runCount = liveCountByAgent.get(agent.id) ?? 0;
  const isActive = activeAgentId === agentRouteRef(agent);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex items-center gap-1 pr-3 py-1.5 rounded transition-colors",
          isActive ? "bg-accent text-foreground" : "hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        {hasChildren ? (
          <CollapsibleTrigger className="flex items-center justify-center shrink-0 h-4 w-4 text-muted-foreground/60 hover:text-foreground transition-colors">
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        ) : (
          <span className="shrink-0 h-4 w-4" />
        )}
        <NavLink
          to={activeTab ? `${agentUrl(agent)}/${activeTab}` : agentUrl(agent)}
          onClick={() => {
            if (isMobile) setSidebarOpen(false);
          }}
          className={cn(
            "group/nav flex items-center gap-2 flex-1 min-w-0 outline-none transition-colors",
            sidebarNavSubItemTextClass,
            isActive ? "text-foreground" : "text-foreground/80 hover:text-foreground",
          )}
        >
          <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1 truncate leading-snug">{agent.name}</span>
          {(agent.pauseReason === "budget" || runCount > 0) && (
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              {agent.pauseReason === "budget" && (
                <BudgetSidebarMarker title="Agent paused by budget" />
              )}
              {runCount > 0 && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                  <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {runCount} live
                  </span>
                </>
              )}
            </span>
          )}
        </NavLink>
      </div>
      {hasChildren && (
        <CollapsibleContent>
          <div
            className="flex flex-col gap-0.5 border-l-2 border-border ml-[19px]"
          >
            {children.map((child) => (
              <AgentTreeNode
                key={child.id}
                agent={child}
                depth={depth + 1}
                childrenMap={childrenMap}
                liveCountByAgent={liveCountByAgent}
                activeAgentId={activeAgentId}
                activeTab={activeTab}
                isMobile={isMobile}
                setSidebarOpen={setSidebarOpen}
              />
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { isMobile, setSidebarOpen, sidebarCompact } = useSidebar();
  const location = useLocation();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadAgents = sidebarBadges?.canReadAgents ?? true;
  const canEditAgents = sidebarBadges?.canEditAgents ?? true;

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const visibleAgents = useMemo(() => {
    return (agents ?? []).filter((a: Agent) => a.status !== "terminated");
  }, [agents]);

  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedAgents } = useAgentOrder({
    agents: visibleAgents,
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const { rootAgents, childrenMap } = useMemo(() => {
    const agentIds = new Set(orderedAgents.map((a) => a.id));
    const childrenMap = new Map<string, Agent[]>();
    const rootAgents: Agent[] = [];

    for (const agent of orderedAgents) {
      const parentId = agent.reportsTo;
      if (!parentId || !agentIds.has(parentId)) {
        rootAgents.push(agent);
      } else {
        const siblings = childrenMap.get(parentId) ?? [];
        siblings.push(agent);
        childrenMap.set(parentId, siblings);
      }
    }

    return { rootAgents, childrenMap };
  }, [orderedAgents]);

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)(?:\/([^/]+))?/);
  const activeAgentId = agentMatch?.[1] ?? null;
  const activeTab = agentMatch?.[2] ?? null;
  const agentsSectionActive = /^\/(?:[^/]+\/)?agents(?:\/|$)/.test(location.pathname);

  if (sidebarCompact || !canReadAgents) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-stretch gap-0">
          <CollapsibleTrigger className="flex w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/40 hover:bg-black/[0.04] hover:text-muted-foreground/80 dark:hover:bg-white/[0.06]">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
          <div
            className={cn(
              "group/nav flex flex-1 items-center transition-[background-color,color,border-color] duration-100 outline-none",
              sidebarNavCollapsibleGroupClass,
              "mx-0 gap-2.5 border-l-[3px] border-transparent py-2 pl-2 pr-2.5",
              agentsSectionActive
                ? "border-l-[var(--sidebar-active-bar)] bg-[var(--sidebar-active-bg)] text-foreground"
                : "text-sidebar-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
            )}
          >
            <Link
              to="/agents"
              className="flex min-w-0 flex-1 items-center gap-2.5"
              onClick={() => {
                if (isMobile) setSidebarOpen(false);
              }}
            >
              <Bot
                className={cn(
                  "h-4 w-4 shrink-0",
                  agentsSectionActive ? "text-[var(--sidebar-active-bar)]" : azureSidebarIcon.agents,
                )}
              />
              <span className="flex-1 truncate">Agents</span>
            </Link>
            {canEditAgents ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openNewAgent();
                }}
                className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                aria-label="New agent"
              >
                <Plus className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {rootAgents.map((agent) => (
            <AgentTreeNode
              key={agent.id}
              agent={agent}
              depth={0}
              childrenMap={childrenMap}
              liveCountByAgent={liveCountByAgent}
              activeAgentId={activeAgentId}
              activeTab={activeTab}
              isMobile={isMobile}
              setSidebarOpen={setSidebarOpen}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
