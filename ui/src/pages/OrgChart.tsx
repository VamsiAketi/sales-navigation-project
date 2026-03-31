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
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { useOrgChartViewMemory } from "../hooks/useOrgChartViewMemory";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { ChevronDown, ChevronRight, Download, Network, Upload, User } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

// Layout constants — extra spacing so hierarchy reads clearly (matches pre–drag-drop polish)
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 56;
const GAP_Y = 120;
const PADDING = 80;

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

// ── Status / adapter labels ─────────────────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  openclaw_gateway: "OpenClaw Gateway",
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
  return (
    <div className="flex items-center px-4 py-3 gap-3">
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          {isAgentNode ? (
            <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
          ) : (
            <User className="h-4.5 w-4.5 text-foreground/70" />
          )}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
          style={{ backgroundColor: dotColor }}
        />
      </div>
      <div className="flex flex-col items-start min-w-0 flex-1">
        <span className="text-sm font-semibold text-foreground leading-tight truncate w-full">
          {node.name}
        </span>
        <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
          {isAgentNode ? agent?.title ?? roleLabel(node.role) : node.role}
        </span>
        {isAgentNode && agent && (
          <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
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
    disabled: !isAgentNode,
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
        "absolute bg-card/95 backdrop-blur border border-border/80 rounded-2xl shadow-sm select-none transition-[box-shadow,border-color,opacity,outline] duration-150",
        isDragging
          ? "opacity-25 cursor-grabbing border-border/80"
          : isDropTarget
            ? "border-primary ring-2 ring-primary/40 shadow-lg cursor-grab"
            : isInvalidTarget
              ? "border-border/60 opacity-60 cursor-not-allowed"
              : isAgentNode
                ? "hover:shadow-md hover:border-foreground/20 cursor-grab"
                : "hover:shadow-md hover:border-foreground/20 cursor-default",
      ].join(" ")}
      style={{ left: node.x, top: node.y, width: CARD_W, minHeight: CARD_H }}
      onClick={onNavigate}
      {...(isAgentNode ? listeners : {})}
      {...(isAgentNode ? attributes : {})}
    >
      <CardContent node={node} agent={agent} isAgentNode={isAgentNode} />

      {hasReports && (
        <div className="px-4 pb-3 -mt-1">
          <div className="flex items-center justify-between gap-2">
            {isExpanded ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleExpand(false);
                }}
                title="Collapse direct reports"
                aria-label="Collapse direct reports"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleExpand(true);
                }}
                title="Expand direct reports"
                aria-label="Expand direct reports"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="tabular-nums">+ {node.directReportCount}</span>
              </button>
            )}
          </div>
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
        "absolute top-2 left-1/2 -translate-x-1/2 z-20",
        "flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium transition-colors duration-150",
        isOver
          ? "bg-primary text-primary-foreground border-primary shadow-lg"
          : "bg-background/90 text-muted-foreground border-border backdrop-blur-sm",
      ].join(" ")}
    >
      <span>{isOver ? "Release to make top-level" : "Drop here to remove manager"}</span>
    </div>
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
    mutationFn: ({ agentId, reportsTo }: { agentId: string; reportsTo: string | null }) =>
      agentsApi.update(agentId, { reportsTo }, companyId),
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

      if (newParentId !== null && invalidTargets.has(newParentId)) return;

      const newTree = moveNodeToParent(effectiveTree, draggedId, newParentId);
      setLocalOrgTree(newTree);

      reorgMutation.mutate({ agentId: draggedId, reportsTo: newParentId });
    },
    [invalidTargets, effectiveTree, reorgMutation],
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
    <div className="flex flex-col h-full">
      <div className="mb-2 flex items-center justify-start gap-2 shrink-0">
        <Link to="/company/import">
          <Button variant="outline" size="sm">
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import company
          </Button>
        </Link>
        <Link to="/company/export">
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export company
          </Button>
        </Link>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={containerRef}
          className="w-full flex-1 min-h-0 overflow-hidden relative bg-muted/20 border border-border rounded-lg"
          style={{ cursor: isPanning ? "grabbing" : "default" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {activeId && <RootDropZone isOver={overId === ROOT_DROP_ZONE_ID} />}

          <div className="absolute top-3 left-3 z-10 w-[320px] max-w-[calc(100%-8rem)]">
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
                className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute mt-2 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden z-20">
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

          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
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
              +
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
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
              &minus;
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
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
              Fit
            </button>
          </div>

          <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {edges.map(({ parent, child }) => {
                const x1 = parent.x + CARD_W / 2;
                const y1 = parent.y + CARD_H;
                const x2 = child.x + CARD_W / 2;
                const y2 = child.y;
                const dy = Math.max(40, Math.min(140, (y2 - y1) / 2));

                return (
                  <path
                    key={`${parent.id}-${child.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    className="text-foreground/45"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeDasharray="2 10"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          </svg>

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
              className="bg-card/95 backdrop-blur border border-primary rounded-2xl shadow-2xl opacity-90 pointer-events-none"
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
