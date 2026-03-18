import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { ArrowDownUp, ChevronDown, ChevronRight, GripVertical, Network, User } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";
import { useOrgChartViewMemory } from "../hooks/useOrgChartViewMemory";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
// More breathing room so hierarchy reads clearly.
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

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode, isExpanded: (id: string) => boolean): number {
  const expanded = isExpanded(node.id);
  if (!expanded || node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c, isExpanded), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
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

/** Layout all root nodes side by side. */
function layoutForest(roots: OrgNode[], isExpanded: (id: string) => boolean): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r, isExpanded), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root, isExpanded);
    result.push(layoutTree(root, x, y, isExpanded));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
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

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
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

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { memory, expandedSet, setExpandedNodeIds, toggleExpanded, setViewport } = useOrgChartViewMemory(
    selectedCompanyId
  );

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Org Chart" }]);
  }, [setBreadcrumbs]);

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
    walk(orgTree ?? [], null);
    return { nodeById, parentById };
  }, [orgTree]);

  const defaultExpandedIds = useMemo(() => {
    // Default: expand roots and their direct reports (depth <= 1).
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
    // If user has no stored expansion state for this company yet, seed defaults.
    if (!orgTree || orgTree.length === 0) return;
    if (memory.expandedNodeIds.length > 0) return;
    setExpandedNodeIds(defaultExpandedIds);
  }, [orgTree, memory.expandedNodeIds.length, defaultExpandedIds, setExpandedNodeIds]);

  const isExpanded = useCallback((id: string) => expandedSet.has(id), [expandedSet]);

  // Layout computation
  const layout = useMemo(() => layoutForest(orgTree ?? [], isExpanded), [orgTree, isExpanded]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState(() => memory.viewport?.pan ?? { x: 0, y: 0 });
  const [zoom, setZoom] = useState(() => memory.viewport?.zoom ?? 1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Center the chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;

    // If we have a stored viewport, prefer it over fit-to-screen.
    if (memory.viewport) return;

    const container = containerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // Fit chart to container
    const scaleX = (containerW - 40) / bounds.width;
    const scaleY = (containerH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;

    setZoom(fitZoom);
    setPan({
      x: (containerW - chartW) / 2,
      y: (containerH - chartH) / 2,
    });
  }, [allNodes, bounds, memory.viewport]);

  useEffect(() => {
    // Persist viewport. This keeps the org chart stable when navigating away/back.
    setViewport({ pan, zoom });
  }, [pan, zoom, setViewport]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    // Let trackpad pinch (ctrlKey wheel) be handled by the native non-passive listener below.
    if ((e as unknown as { ctrlKey?: boolean }).ctrlKey) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  // Trackpad pinch zoom on macOS shows up as a wheel event with ctrlKey=true and
  // will zoom the browser unless we intercept it with a non-passive listener.
  // React's synthetic onWheel is not reliable for preventDefault here.
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
      const prevZoom = zoom;
      const nextZoom = Math.min(Math.max(prevZoom * factor, 0.2), 2);
      const scale = nextZoom / prevZoom;
      setPan((prev) => ({
        x: mouseX - scale * (mouseX - prev.x),
        y: mouseY - scale * (mouseY - prev.y),
      }));
      setZoom(nextZoom);
    };

    window.addEventListener("wheel", onWheelNative, { passive: false });
    return () => window.removeEventListener("wheel", onWheelNative as any);
  }, [zoom]);

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
    [allNodes, zoom]
  );

  const expandAncestors = useCallback(
    (nodeId: string) => {
      const ids: string[] = [];
      let cur: string | null = nodeId;
      while (cur) {
        ids.push(cur);
        cur = orgIndex.parentById.get(cur) ?? null;
      }
      // Ensure the full chain is expanded so the node becomes visible.
      const next = new Set(expandedSet);
      for (const id of ids) next.add(id);
      setExpandedNodeIds(Array.from(next));
    },
    [orgIndex.parentById, expandedSet, setExpandedNodeIds]
  );

  // Search UI state
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

  // Reorder modal
  const [reorderManagerId, setReorderManagerId] = useState<string | null>(null);
  const reorderManager = reorderManagerId ? orgIndex.nodeById.get(reorderManagerId) ?? null : null;
  const initialChildIds = useMemo(() => {
    if (!reorderManager) return [];
    return reorderManager.reports.map((c) => c.id);
  }, [reorderManager]);
  const [childIdsDraft, setChildIdsDraft] = useState<string[]>([]);

  useEffect(() => {
    if (!reorderManagerId) return;
    setChildIdsDraft(initialChildIds);
  }, [reorderManagerId, initialChildIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setChildIdsDraft((items) => {
        const oldIndex = items.indexOf(String(active.id));
        const newIndex = items.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return items;
        return arrayMove(items, oldIndex, newIndex);
      });
    },
    []
  );

  const saveChildOrder = useCallback(async () => {
    if (!selectedCompanyId || !reorderManagerId) return;
    await agentsApi.updateChildOrder(selectedCompanyId, reorderManagerId, childIdsDraft);
    await queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId) });
    setReorderManagerId(null);
  }, [selectedCompanyId, reorderManagerId, childIdsDraft, queryClient]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[calc(100vh-4rem)] overflow-hidden relative bg-muted/20 border border-border rounded-lg"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Search */}
      <div className="absolute top-3 left-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)]">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              // let clicks register
              window.setTimeout(() => setSearchOpen(false), 150);
            }}
            placeholder="Search agents…"
            className="w-full h-9 px-3 rounded-md bg-background border border-border text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute mt-2 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
              {searchResults.map((a) => (
                <button
                  key={a.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSearchOpen(false);
                    setSearch("");
                    expandAncestors(a.id);
                    // Defer focus so layout can re-compute with expanded ancestors.
                    window.setTimeout(() => focusNode(a.id), 0);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <AgentIcon icon={a.icon} className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium truncate">{a.name}</span>
                    {a.title && <span className="text-xs text-muted-foreground truncate">· {a.title}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
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
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
          onClick={() => {
            if (!containerRef.current) return;
            const cW = containerRef.current.clientWidth;
            const cH = containerRef.current.clientHeight;
            const scaleX = (cW - 40) / bounds.width;
            const scaleY = (cH - 40) / bounds.height;
            const fitZoom = Math.min(scaleX, scaleY, 1);
            const chartW = bounds.width * fitZoom;
            const chartH = bounds.height * fitZoom;
            setZoom(fitZoom);
            setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
          }}
          title="Fit to screen"
          aria-label="Fit chart to screen"
        >
          Fit
        </button>
      </div>

      {/* SVG layer for edges */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
        }}
      >
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

      {/* Card layer */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {allNodes.map((node) => {
          const isAgentNode = (node.nodeType ?? "agent") === "agent";
          const agent = agentMap.get(node.id);
          const dotColor = statusDotColor[node.status] ?? defaultDotColor;
          const hasReports = node.directReportCount > 0;
          const expanded = isExpanded(node.id);

          return (
            <div
              key={node.id}
              data-org-card
              className="absolute bg-card/95 backdrop-blur border border-border/80 rounded-2xl shadow-sm hover:shadow-md hover:border-foreground/20 transition-[box-shadow,border-color] duration-150 cursor-pointer select-none"
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              onClick={() => {
                if (!isAgentNode) return;
                navigate(agent ? agentUrl(agent) : `/agents/${node.id}`);
              }}
            >
              <div className="flex items-center px-4 py-3 gap-3">
                {/* Agent icon + status dot */}
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
                {/* Name + role + adapter type */}
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground leading-tight">
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

              {/* Expand / collapse controls */}
              {hasReports && (
                <div className="px-4 pb-3 -mt-1">
                  <div className="flex items-center justify-between gap-2">
                    {expanded ? (
                      <button
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleExpanded(node.id, false);
                        }}
                        title="Collapse direct reports"
                        aria-label="Collapse direct reports"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleExpanded(node.id, true);
                        }}
                        title="Expand direct reports"
                        aria-label="Expand direct reports"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                        <span className="tabular-nums">+ {node.directReportCount}</span>
                      </button>
                    )}

                    {isAgentNode && (
                      <button
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setReorderManagerId(node.id);
                        }}
                        title="Reorder direct reports"
                        aria-label="Reorder direct reports"
                      >
                        <ArrowDownUp className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(reorderManagerId)} onOpenChange={(open) => (!open ? setReorderManagerId(null) : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reorder direct reports</DialogTitle>
          </DialogHeader>

          <div className="mt-2 text-sm text-muted-foreground">
            Drag to reorder. This only changes the sequence of this manager’s direct reports.
          </div>

          <div className="mt-4">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={childIdsDraft} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {childIdsDraft.map((id) => (
                    <SortableReportRow
                      key={id}
                      id={id}
                      label={orgIndex.nodeById.get(id)?.name ?? agentMap.get(id)?.name ?? "Unknown"}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-accent/50 transition-colors"
              onClick={() => setReorderManagerId(null)}
            >
              Cancel
            </button>
            <button
              className="h-9 px-3 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 transition-colors"
              onClick={() => void saveChildOrder()}
              disabled={!reorderManagerId || childIdsDraft.length === 0}
            >
              Save order
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableReportRow({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
    >
      <button
        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent/50 text-muted-foreground"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        type="button"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium truncate">{label}</span>
    </div>
  );
}

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
