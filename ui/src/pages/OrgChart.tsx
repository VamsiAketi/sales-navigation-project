import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { agentsApi, type OrgNode } from "../api/agents";
import { accessApi } from "../api/access";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { useOrgChartViewMemory } from "../hooks/useOrgChartViewMemory";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { ChevronDown, ChevronRight, Download, Maximize2, Minus, Network, Plus, Upload, User, ZoomIn, ZoomOut } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

// Layout constants
const CARD_W = 224;
const CARD_H = 128;
const GAP_X = 72;
const GAP_Y = 160;
const PADDING = 96;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  nodeType: "agent" | "human";
  x: number;
  y: number;
  children: LayoutNode[];
  directReportCount: number;
}

// ── Layout algorithm (respects expand/collapse) ─────────────────────────

function subtreeWidth(node: OrgNode, isExpanded: (id: string) => boolean): number {
  const expanded = isExpanded(node.id);
  if (!expanded || node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c, isExpanded), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

function layoutTree(node: OrgNode, x: number, y: number, isExpanded: (id: string) => boolean): LayoutNode {
  const expanded = isExpanded(node.id);
  const totalW = subtreeWidth(node, isExpanded);
  const layoutChildren: LayoutNode[] = [];

  if (expanded && node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c, isExpanded), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child, isExpanded);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y, isExpanded));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    nodeType: node.nodeType ?? "agent",
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
    directReportCount: node.reports.length,
  };
}

function layoutForest(roots: OrgNode[], isExpanded: (id: string) => boolean): LayoutNode[] {
  if (roots.length === 0) return [];

  let x = PADDING;
  const y = PADDING;
  const result: LayoutNode[] = [];
  for (const root of roots) {
    result.push(layoutTree(root, x, y, isExpanded));
    x += subtreeWidth(root, isExpanded) + GAP_X;
  }
  return result;
}

function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

// ── Tree manipulation helpers (for drag reorg) ─────────────────────────

function collectDescendants(nodes: OrgNode[], nodeId: string): Set<string> {
  const result = new Set<string>();
  function findAndCollect(nodes: OrgNode[]) {
    for (const n of nodes) {
      if (n.id === nodeId) {
        function collectAll(node: OrgNode) {
          for (const r of node.reports) {
            result.add(r.id);
            collectAll(r);
          }
        }
        collectAll(n);
        return true;
      }
      if (findAndCollect(n.reports)) return true;
    }
    return false;
  }
  findAndCollect(nodes);
  return result;
}

function moveNodeToParent(nodes: OrgNode[], nodeId: string, newParentId: string | null): OrgNode[] {
  let extracted: OrgNode | null = null;

  function extract(nodes: OrgNode[]): OrgNode[] {
    return nodes.reduce<OrgNode[]>((acc, n) => {
      if (n.id === nodeId) {
        extracted = { ...n };
        return acc;
      }
      return [...acc, { ...n, reports: extract(n.reports) }];
    }, []);
  }

  const withoutNode = extract(nodes);
  if (!extracted) return nodes;
  const node = extracted as OrgNode;

  if (newParentId === null) {
    return [...withoutNode, node];
  }

  function insert(nodes: OrgNode[]): OrgNode[] {
    return nodes.map((n) => {
      if (n.id === newParentId) return { ...n, reports: [...n.reports, node] };
      return { ...n, reports: insert(n.reports) };
    });
  }

  return insert(withoutNode);
}

function reorderIds(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return ids;
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function reorderChildrenForParent(
  nodes: OrgNode[],
  parentId: string | null,
  draggedId: string,
  targetId: string,
): OrgNode[] {
  if (parentId === null) {
    const order = reorderIds(nodes.map((n) => n.id), draggedId, targetId);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }

  function walk(items: OrgNode[]): OrgNode[] {
    return items.map((item) => {
      if (item.id === parentId) {
        const order = reorderIds(item.reports.map((r) => r.id), draggedId, targetId);
        const byId = new Map(item.reports.map((r) => [r.id, r]));
        return { ...item, reports: order.map((id) => byId.get(id)!).filter(Boolean) };
      }
      return { ...item, reports: walk(item.reports) };
    });
  }

  return walk(nodes);
}

function childIdsForParent(nodes: OrgNode[], parentId: string | null): string[] {
  if (parentId === null) return nodes.map((node) => node.id);
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === parentId) return node.reports.map((child) => child.id);
    stack.push(...node.reports);
  }
  return [];
}

// ── Status / adapter labels ─────────────────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  openclaw_gateway: "OpenClaw",
  process: "Process",
  http: "HTTP",
};

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Type accent config ──────────────────────────────────────────────────

const nodeAccent = {
  human: {
    iconBg: "bg-blue-50 dark:bg-blue-950/40",
    iconColor: "text-blue-500 dark:text-blue-400",
    badgeBg: "bg-blue-50 dark:bg-blue-950/40",
    badgeText: "text-blue-600 dark:text-blue-400",
    borderTop: "#3b82f6",
    label: "Human",
  },
  agent: {
    iconBg: "bg-violet-50 dark:bg-violet-950/40",
    iconColor: "text-violet-500 dark:text-violet-400",
    badgeBg: "bg-violet-50 dark:bg-violet-950/40",
    badgeText: "text-violet-600 dark:text-violet-400",
    borderTop: "#8b5cf6",
    label: "AI Agent",
  },
};

// ── Card body (shared with drag overlay) ───────────────────────────────

function CardContent({
  node,
  agent,
  isAgentNode,
}: {
  node: { id: string; name: string; role: string; status: string };
  agent: Agent | undefined;
  isAgentNode: boolean;
}) {
  const dotColor = statusDotColor[node.status] ?? defaultDotColor;
  const accent = isAgentNode ? nodeAccent.agent : nodeAccent.human;
  const budgetLabel = agent?.budgetMonthlyCents
    ? `$${Math.round(agent.budgetMonthlyCents / 100).toLocaleString()}/mo`
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Top accent bar */}
      <div
        className="h-0.5 w-full rounded-t-2xl shrink-0"
        style={{ backgroundColor: accent.borderTop }}
      />

      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2.5 flex-1">
        {/* Avatar */}
        <div className="relative shrink-0 mt-0.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent.iconBg}`}>
            {isAgentNode ? (
              <AgentIcon icon={agent?.icon} className={`h-5 w-5 ${accent.iconColor}`} />
            ) : (
              <User className={`h-5 w-5 ${accent.iconColor}`} />
            )}
          </div>
          <span
            className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-card shadow-sm"
            style={{ backgroundColor: dotColor }}
          />
        </div>

        {/* Text block */}
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className="text-[13px] font-semibold text-foreground leading-tight truncate">
            {node.name}
          </span>
          <span className="text-[11px] text-muted-foreground leading-snug truncate">
            {isAgentNode ? (agent?.title ?? roleLabel(node.role)) : node.role}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-1.5 px-3.5 pb-3 flex-wrap">
        <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${accent.badgeBg} ${accent.badgeText}`}>
          {accent.label}
        </span>
        {budgetLabel && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60 font-mono">
            {budgetLabel}
          </span>
        )}
        {isAgentNode && agent && (
          <span className="ml-auto text-[9px] text-muted-foreground/40 font-mono uppercase tracking-wide">
            {adapterLabels[agent.adapterType] ?? agent.adapterType}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Draggable + droppable card ──────────────────────────────────────────

interface OrgCardProps {
  node: LayoutNode;
  agent: Agent | undefined;
  isDropTarget: boolean;
  isInvalidTarget: boolean;
  isExpanded: boolean;
  hasReports: boolean;
  onToggleExpand: (expand: boolean) => void;
  onNavigate: () => void;
}

function OrgCard({
  node,
  agent,
  isDropTarget,
  isInvalidTarget,
  isExpanded,
  hasReports,
  onToggleExpand,
  onNavigate,
}: OrgCardProps) {
  const isAgentNode = node.nodeType === "agent";

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    disabled: false,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: node.id,
    disabled: isInvalidTarget,
  });

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div
      ref={setRef}
      data-org-card
      className={[
        "absolute bg-card border rounded-2xl select-none transition-all duration-150",
        isDragging
          ? "opacity-20 cursor-grabbing shadow-sm"
          : isDropTarget
            ? "border-primary ring-2 ring-primary/30 shadow-xl cursor-grab"
            : isInvalidTarget
              ? "opacity-50 cursor-not-allowed shadow-sm border-border/50"
              : "shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 cursor-grab border-border/70 hover:border-border",
      ].join(" ")}
      style={{ left: node.x, top: node.y, width: CARD_W, minHeight: CARD_H }}
      onClick={onNavigate}
      {...listeners}
      {...attributes}
    >
      <CardContent node={node} agent={agent} isAgentNode={isAgentNode} />

      {hasReports && (
        <div className="px-3.5 pb-2.5 -mt-1.5">
          {isExpanded ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleExpand(false);
              }}
              aria-label="Collapse direct reports"
            >
              <ChevronDown className="h-3 w-3" />
              <span>Collapse</span>
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/80 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleExpand(true);
              }}
              aria-label="Expand direct reports"
            >
              <ChevronRight className="h-3 w-3" />
              <span className="tabular-nums">+{node.directReportCount} reports</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ROOT_DROP_ZONE_ID = "__root__";

function RootDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={[
        "absolute top-3 left-1/2 -translate-x-1/2 z-20",
        "flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium transition-all duration-150",
        isOver
          ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105"
          : "bg-background/90 text-muted-foreground border-border/60 backdrop-blur-sm shadow-sm",
      ].join(" ")}
    >
      <span>{isOver ? "Release to make top-level" : "Drop here to remove manager"}</span>
    </div>
  );
}

// ── Dot-grid background ─────────────────────────────────────────────────

function DotGrid() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="org-dotgrid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="fill-foreground/[0.07]" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#org-dotgrid)" />
    </svg>
  );
}

// ── Main component (keyed per company so view memory + pan/zoom stay consistent) ──

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }
  return <OrgChartImpl key={selectedCompanyId} companyId={selectedCompanyId} />;
}

function OrgChartImpl({ companyId }: { companyId: string }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { memory, expandedSet, setExpandedNodeIds, toggleExpanded, setViewport } = useOrgChartViewMemory(companyId);

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(companyId),
    queryFn: () => agentsApi.org(companyId),
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(companyId),
    queryFn: () => accessApi.listMembers(companyId),
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Hybrid Org Chart" }]);
  }, [setBreadcrumbs]);

  const [localOrgTree, setLocalOrgTree] = useState<OrgNode[] | null>(null);
  useEffect(() => {
    if (orgTree) setLocalOrgTree(orgTree);
  }, [orgTree]);
  const effectiveTree = localOrgTree ?? orgTree ?? [];

  const orgIndex = useMemo(() => {
    const nodeById = new Map<string, OrgNode>();
    const parentById = new Map<string, string | null>();
    function walk(nodes: OrgNode[], parentId: string | null) {
      for (const n of nodes) {
        nodeById.set(n.id, n);
        parentById.set(n.id, parentId);
        if (n.reports.length > 0) walk(n.reports, n.id);
      }
    }
    walk(effectiveTree, null);
    return { nodeById, parentById };
  }, [effectiveTree]);

  const defaultExpandedIds = useMemo(() => {
    const ids: string[] = [];
    function walk(nodes: OrgNode[], depth: number) {
      for (const n of nodes) {
        if (depth <= 1) ids.push(n.id);
        if (n.reports.length > 0) walk(n.reports, depth + 1);
      }
    }
    walk(orgTree ?? [], 0);
    return ids;
  }, [orgTree]);

  useEffect(() => {
    if (!orgTree || orgTree.length === 0) return;
    if (memory.expandedNodeIds.length > 0) return;
    setExpandedNodeIds(defaultExpandedIds);
  }, [orgTree, memory.expandedNodeIds.length, defaultExpandedIds, setExpandedNodeIds]);

  const isExpanded = useCallback((id: string) => expandedSet.has(id), [expandedSet]);

  const reorgMutation = useMutation({
    mutationFn: async ({
      nodeId,
      nodeType,
      parentId,
    }: {
      nodeId: string;
      nodeType: "agent" | "human";
      parentId: string | null;
    }) => {
      const agentMembershipByAgentId = new Map(
        (members ?? [])
          .filter((member) => member.principalType === "agent")
          .map((member) => [member.principalId, member.id]),
      );
      const parentNode = parentId ? (orgIndex.nodeById.get(parentId) ?? null) : null;
      const parentMembershipId = !parentNode
        ? null
        : parentNode.nodeType === "human"
          ? parentNode.id
          : (agentMembershipByAgentId.get(parentNode.id) ?? null);

      if (nodeType === "human") {
        await accessApi.updateMemberOrgConfig(companyId, nodeId, {
          reportsToMembershipId: parentMembershipId,
        });
        return;
      }

      const agentReportsTo = parentNode?.nodeType === "agent" ? parentNode.id : null;
      const agentMembershipId = agentMembershipByAgentId.get(nodeId) ?? null;
      await Promise.all([
        agentsApi.update(nodeId, { reportsTo: agentReportsTo }, companyId),
        agentMembershipId
          ? accessApi.updateMemberOrgConfig(companyId, agentMembershipId, {
              reportsToMembershipId: parentMembershipId,
            })
          : Promise.resolve(),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.access.members(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
    onError: () => {
      setLocalOrgTree(orgTree ?? null);
    },
  });
  const childOrderMutation = useMutation({
    mutationFn: ({ managerId, childIds }: { managerId: string | null; childIds: string[] }) =>
      agentsApi.updateChildOrder(companyId, managerId, childIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
    },
    onError: () => {
      setLocalOrgTree(orgTree ?? null);
    },
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const invalidTargets = useMemo<Set<string>>(() => {
    if (!activeId) return new Set();
    const descendants = collectDescendants(effectiveTree, activeId);
    descendants.add(activeId);
    return descendants;
  }, [activeId, effectiveTree]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  }, []);

  const handleDragOver = useCallback(({ over }: DragOverEvent) => {
    setOverId((over?.id as string) ?? null);
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const draggedId = active.id as string;
      const targetId = over?.id as string | undefined;

      setActiveId(null);
      setOverId(null);

      if (!targetId) return;

      const newParentId = targetId === ROOT_DROP_ZONE_ID ? null : targetId;
      const draggedParentId = orgIndex.parentById.get(draggedId) ?? null;
      const targetParentId =
        targetId === ROOT_DROP_ZONE_ID ? null : (orgIndex.parentById.get(targetId) ?? null);
      const draggedNode = orgIndex.nodeById.get(draggedId);

      if (newParentId !== null && invalidTargets.has(newParentId)) return;

      if (
        targetId !== ROOT_DROP_ZONE_ID &&
        draggedParentId === targetParentId &&
        draggedId !== targetId
      ) {
        const reordered = reorderChildrenForParent(
          effectiveTree,
          draggedParentId,
          draggedId,
          targetId,
        );
        setLocalOrgTree(reordered);
        const orderedChildIds = childIdsForParent(reordered, draggedParentId);
        if (orderedChildIds.length > 0) {
          childOrderMutation.mutate({
            managerId: draggedParentId,
            childIds: orderedChildIds,
          });
        }
        return;
      }

      const newTree = moveNodeToParent(effectiveTree, draggedId, newParentId);
      setLocalOrgTree(newTree);

      if (draggedNode) {
        reorgMutation.mutate({
          nodeId: draggedId,
          nodeType: draggedNode.nodeType ?? "agent",
          parentId: newParentId,
        }, {
          onSuccess: () => {
            const newParentChildIds = childIdsForParent(newTree, newParentId);
            if (newParentChildIds.length > 0) {
              childOrderMutation.mutate({
                managerId: newParentId,
                childIds: newParentChildIds,
              });
            }
            if (draggedParentId !== newParentId) {
              const oldParentChildIds = childIdsForParent(newTree, draggedParentId);
              if (oldParentChildIds.length > 0) {
                childOrderMutation.mutate({
                  managerId: draggedParentId,
                  childIds: oldParentChildIds,
                });
              }
            }
          },
        });
      }
    },
    [
      invalidTargets,
      effectiveTree,
      reorgMutation,
      childOrderMutation,
      orgIndex.parentById,
      orgIndex.nodeById,
    ],
  );

  const layout = useMemo(() => layoutForest(effectiveTree, isExpanded), [effectiveTree, isExpanded]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Stats for header
  const humanCount = useMemo(() => allNodes.filter((n) => n.nodeType === "human").length, [allNodes]);
  const agentCount = useMemo(() => allNodes.filter((n) => n.nodeType === "agent").length, [allNodes]);
  const liveCount = useMemo(
    () => allNodes.filter((n) => n.status === "running" || n.status === "active").length,
    [allNodes],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;

    if (memory.viewport) return;

    const container = containerRef.current;
    const scaleX = (container.clientWidth - 40) / bounds.width;
    const scaleY = (container.clientHeight - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({
      x: (container.clientWidth - chartW) / 2,
      y: (container.clientHeight - chartH) / 2,
    });
  }, [allNodes, bounds, memory.viewport]);

  useEffect(() => {
    setViewport({ pan, zoom });
  }, [pan, zoom, setViewport]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const n = allNodes.find((x) => x.id === nodeId);
      const container = containerRef.current;
      if (!n || !container) return;

      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      const nodeCenterX = n.x + CARD_W / 2;
      const nodeCenterY = n.y + CARD_H / 2;
      setPan({
        x: cx - nodeCenterX * zoom,
        y: cy - nodeCenterY * zoom,
      });
    },
    [allNodes, zoom],
  );

  const expandAncestors = useCallback(
    (nodeId: string) => {
      const ids: string[] = [];
      let cur: string | null = nodeId;
      while (cur) {
        ids.push(cur);
        cur = orgIndex.parentById.get(cur) ?? null;
      }
      const next = new Set(expandedSet);
      for (const id of ids) next.add(id);
      setExpandedNodeIds(Array.from(next));
    },
    [orgIndex.parentById, expandedSet, setExpandedNodeIds],
  );

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !(agents ?? []).length) return [];
    return (agents ?? [])
      .filter((a) => a.status !== "terminated")
      .filter((a) => a.name.toLowerCase().includes(q) || (a.title ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, agents]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-org-card]")) return;
      setIsPanning(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    },
    [isPanning],
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.06 : 0.94;
      const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);
      const scale = newZoom / zoom;
      setPan({ x: mouseX - scale * (mouseX - pan.x), y: mouseY - scale * (mouseY - pan.y) });
      setZoom(newZoom);
    },
    [zoom, pan],
  );

  useEffect(() => {
    const onWheelNative = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const container = containerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      if (!target || !container.contains(target)) return;

      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      setZoom((prevZoom) => {
        const nextZoom = Math.min(Math.max(prevZoom * factor, 0.2), 2);
        const scale = nextZoom / prevZoom;
        setPan((prev) => ({
          x: mouseX - scale * (mouseX - prev.x),
          y: mouseY - scale * (mouseY - prev.y),
        }));
        return nextZoom;
      });
    };

    window.addEventListener("wheel", onWheelNative, { passive: false });
    return () => window.removeEventListener("wheel", onWheelNative as EventListener);
  }, []);

  if (isLoading) return <PageSkeleton variant="org-chart" />;
  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  const activeNode = activeId ? allNodes.find((n) => n.id === activeId) : null;
  const activeAgent = activeNode ? agentMap.get(activeNode.id) : undefined;
  const activeIsAgent = activeNode ? activeNode.nodeType === "agent" : true;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link to="/company/import">
            <Button variant="outline" size="sm">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import
            </Button>
          </Link>
          <Link to="/company/export">
            <Button variant="outline" size="sm">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          </Link>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 px-2.5 py-1 rounded-full">
            <User className="h-3 w-3" />
            {humanCount} {humanCount === 1 ? "Human" : "Humans"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50 px-2.5 py-1 rounded-full">
            <Network className="h-3 w-3" />
            {agentCount} {agentCount === 1 ? "AI Agent" : "AI Agents"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 px-2.5 py-1 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {liveCount} Live
          </span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={containerRef}
          className="w-full flex-1 min-h-0 overflow-hidden relative bg-muted/10 dark:bg-muted/5 border border-border/60 rounded-xl"
          style={{ cursor: isPanning ? "grabbing" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <DotGrid />

          {activeId && <RootDropZone isOver={overId === ROOT_DROP_ZONE_ID} />}

          {/* Search */}
          <div className="absolute top-3 left-3 z-10 w-[280px] max-w-[calc(100%-8rem)]">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchOpen(false), 150);
                }}
                placeholder="Search agents…"
                className="w-full h-8 pl-3 pr-3 rounded-lg bg-background/90 backdrop-blur border border-border/60 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute mt-1.5 w-full rounded-lg border border-border bg-background shadow-lg overflow-hidden z-20">
                  {searchResults.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearchOpen(false);
                        setSearch("");
                        expandAncestors(a.id);
                        window.setTimeout(() => focusNode(a.id), 0);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <AgentIcon icon={a.icon} className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium truncate">{a.name}</span>
                        {a.title && (
                          <span className="text-xs text-muted-foreground truncate">· {a.title}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 bg-background/90 backdrop-blur border border-border/60 rounded-xl p-1 shadow-sm">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => {
                const newZoom = Math.min(zoom * 1.2, 2);
                const container = containerRef.current;
                if (container) {
                  const cx = container.clientWidth / 2;
                  const cy = container.clientHeight / 2;
                  const scale = newZoom / zoom;
                  setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
                }
                setZoom(newZoom);
              }}
              aria-label="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => {
                const newZoom = Math.max(zoom * 0.8, 0.2);
                const container = containerRef.current;
                if (container) {
                  const cx = container.clientWidth / 2;
                  const cy = container.clientHeight / 2;
                  const scale = newZoom / zoom;
                  setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
                }
                setZoom(newZoom);
              }}
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="h-px bg-border/60 mx-1" />
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => {
                if (!containerRef.current) return;
                const cW = containerRef.current.clientWidth;
                const cH = containerRef.current.clientHeight;
                const fitZoom = Math.min((cW - 40) / bounds.width, (cH - 40) / bounds.height, 1);
                setZoom(fitZoom);
                setPan({
                  x: (cW - bounds.width * fitZoom) / 2,
                  y: (cH - bounds.height * fitZoom) / 2,
                });
              }}
              title="Fit to screen"
              aria-label="Fit chart to screen"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <div className="text-[9px] text-muted-foreground/50 text-center tabular-nums pb-0.5">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Connector lines */}
          <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
            <defs>
              <marker id="org-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" className="fill-foreground/20" />
              </marker>
            </defs>
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {edges.map(({ parent, child }) => {
                const x1 = parent.x + CARD_W / 2;
                const y1 = parent.y + CARD_H;
                const x2 = child.x + CARD_W / 2;
                const y2 = child.y;
                const dy = Math.max(48, Math.min(120, (y2 - y1) * 0.45));

                return (
                  <path
                    key={`${parent.id}-${child.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    className="text-foreground/20 dark:text-foreground/15"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          </svg>

          {/* Cards layer */}
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {allNodes.map((node) => {
              const agent = agentMap.get(node.id);
              const invalid = activeId !== null && invalidTargets.has(node.id);
              const isDropTarget = !invalid && overId === node.id && activeId !== null;
              const expanded = isExpanded(node.id);
              const hasReports = node.directReportCount > 0;

              return (
                <OrgCard
                  key={node.id}
                  node={node}
                  agent={agent}
                  isDropTarget={isDropTarget}
                  isInvalidTarget={!!activeId && invalid}
                  isExpanded={expanded}
                  hasReports={hasReports}
                  onToggleExpand={(expand) => toggleExpanded(node.id, expand)}
                  onNavigate={() => {
                    if (node.nodeType !== "agent") return;
                    navigate(agent ? agentUrl(agent) : `/agents/${node.id}`);
                  }}
                />
              );
            })}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeNode ? (
            <div
              className="bg-card border border-primary rounded-2xl shadow-2xl opacity-95 pointer-events-none"
              style={{ width: CARD_W, minHeight: CARD_H }}
            >
              <CardContent node={activeNode} agent={activeAgent} isAgentNode={activeIsAgent} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

const roleLabels: Record<string, string> = AGENT_ROLE_LABELS;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
