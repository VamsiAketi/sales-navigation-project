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
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { Download, Network, Upload } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
}

// ── Layout algorithm ────────────────────────────────────────────────────

function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;
    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

function layoutForest(roots: OrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];
  let x = PADDING;
  const y = PADDING;
  const result: LayoutNode[] = [];
  for (const root of roots) {
    result.push(layoutTree(root, x, y));
    x += subtreeWidth(root) + GAP_X;
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

// ── Tree manipulation helpers ───────────────────────────────────────────

/** Collect all descendant IDs of a given node (not including itself). */
function collectDescendants(nodes: OrgNode[], nodeId: string): Set<string> {
  const result = new Set<string>();
  function findAndCollect(nodes: OrgNode[]) {
    for (const n of nodes) {
      if (n.id === nodeId) {
        // Collect all descendants
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

/** Move nodeId to report to newParentId. Removes it from its current location and appends under newParentId. */
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
    // Make it a root node
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

// ── Status colors ───────────────────────────────────────────────────────

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

// ── Shared card content ─────────────────────────────────────────────────

function CardContent({
  node,
  agent,
}: {
  node: { id: string; name: string; role: string; status: string };
  agent: Agent | undefined;
}) {
  const dotColor = statusDotColor[node.status] ?? defaultDotColor;
  return (
    <div className="flex items-center px-4 py-3 gap-3">
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
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
          {agent?.title ?? roleLabel(node.role)}
        </span>
        {agent && (
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
  /** true = this card is a valid drop target (another card is being dragged over it) */
  isDropTarget: boolean;
  /** true = this card can't accept a drop (self or descendant of dragged node) */
  isInvalidTarget: boolean;
  onNavigate: () => void;
}

function OrgCard({ node, agent, isDropTarget, isInvalidTarget, onNavigate }: OrgCardProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
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
        "absolute bg-card rounded-lg shadow-sm select-none transition-[box-shadow,border-color,opacity,outline] duration-150",
        "border",
        isDragging
          ? "opacity-25 cursor-grabbing border-border"
          : isDropTarget
            ? "border-primary ring-2 ring-primary/40 shadow-lg cursor-grab"
            : isInvalidTarget
              ? "border-border opacity-60 cursor-not-allowed"
              : "border-border hover:shadow-md hover:border-foreground/20 cursor-grab",
      ].join(" ")}
      style={{ left: node.x, top: node.y, width: CARD_W, minHeight: CARD_H }}
      onClick={onNavigate}
      {...listeners}
      {...attributes}
    >
      <CardContent node={node} agent={agent} />
    </div>
  );
}

// ── Root drop zone (appears while dragging to detach a node) ────────────

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

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    setBreadcrumbs([{ label: "Hybrid Org Chart" }]);
  }, [setBreadcrumbs]);

  // ── Local tree for optimistic updates ──────────────────────────────────
  const [localOrgTree, setLocalOrgTree] = useState<OrgNode[] | null>(null);
  useEffect(() => {
    if (orgTree) setLocalOrgTree(orgTree);
  }, [orgTree]);
  const effectiveTree = localOrgTree ?? orgTree ?? [];

  // ── Reorg mutation ──────────────────────────────────────────────────────
  const reorgMutation = useMutation({
    mutationFn: ({ agentId, reportsTo }: { agentId: string; reportsTo: string | null }) =>
      agentsApi.update(agentId, { reportsTo }, selectedCompanyId ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId!) });
    },
    onError: () => {
      setLocalOrgTree(orgTree ?? null);
    },
  });

  // ── Drag state ──────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Compute descendants of the currently-dragged node (invalid drop targets)
  const invalidTargets = useMemo<Set<string>>(() => {
    if (!activeId) return new Set();
    const descendants = collectDescendants(effectiveTree, activeId);
    descendants.add(activeId); // can't drop onto self
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

      // Ignore drop onto self or own descendant
      if (newParentId !== null && invalidTargets.has(newParentId)) return;

      // Optimistic update
      const newTree = moveNodeToParent(effectiveTree, draggedId, newParentId);
      setLocalOrgTree(newTree);

      reorgMutation.mutate({ agentId: draggedId, reportsTo: newParentId });
    },
    [invalidTargets, effectiveTree, reorgMutation],
  );

  // ── Layout ──────────────────────────────────────────────────────────────
  const layout = useMemo(() => layoutForest(effectiveTree), [effectiveTree]);
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

  // ── Pan & zoom ──────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;
    const container = containerRef.current;
    const scaleX = (container.clientWidth - 40) / bounds.width;
    const scaleY = (container.clientHeight - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (container.clientWidth - chartW) / 2, y: (container.clientHeight - chartH) / 2 });
  }, [allNodes, bounds]);

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
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);
      const scale = newZoom / zoom;
      setPan({ x: mouseX - scale * (mouseX - pan.x), y: mouseY - scale * (mouseY - pan.y) });
      setZoom(newZoom);
    },
    [zoom, pan],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }
  if (isLoading) return <PageSkeleton variant="org-chart" />;
  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  const activeNode = activeId ? allNodes.find((n) => n.id === activeId) : null;
  const activeAgent = activeNode ? agentMap.get(activeNode.id) : undefined;

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
          {/* Root drop zone — shown while dragging */}
          {activeId && <RootDropZone isOver={overId === ROOT_DROP_ZONE_ID} />}

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

          {/* SVG edges */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: "100%", height: "100%" }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {edges.map(({ parent, child }) => {
                const x1 = parent.x + CARD_W / 2;
                const y1 = parent.y + CARD_H;
                const x2 = child.x + CARD_W / 2;
                const y2 = child.y;
                const midY = (y1 + y2) / 2;
                return (
                  <path
                    key={`${parent.id}-${child.id}`}
                    d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </g>
          </svg>

          {/* Cards */}
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
              return (
                <OrgCard
                  key={node.id}
                  node={node}
                  agent={agent}
                  isDropTarget={isDropTarget}
                  isInvalidTarget={!!activeId && invalid}
                  onNavigate={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
                />
              );
            })}
          </div>
        </div>

        {/* Ghost card following the cursor */}
        <DragOverlay dropAnimation={null}>
          {activeNode ? (
            <div
              className="bg-card border border-primary rounded-lg shadow-2xl opacity-90 pointer-events-none"
              style={{ width: CARD_W, minHeight: CARD_H }}
            >
              <CardContent node={activeNode} agent={activeAgent} />
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
