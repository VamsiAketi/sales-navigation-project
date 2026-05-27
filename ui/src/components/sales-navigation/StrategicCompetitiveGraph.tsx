import { useCallback, useMemo, useRef, useState, type PointerEventHandler } from "react";
import {
  SALES_NAV_LEVEL_LABELS,
  type SalesNavContactLevel,
  type SalesNavGraph,
  type SalesNavWarmPath,
} from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { layoutRelationshipGraph } from "@/lib/sales-navigation/graph-layout";
import { SalesNavContactAvatar } from "@/components/sales-navigation/SalesNavContactAvatar";
import { SalesNavStatusBadge } from "@/components/sales-navigation/sales-nav-status";
import { salesNavDisplayName } from "@/lib/sales-navigation/linkedin-avatar";

const LEVEL_DOT: Record<SalesNavContactLevel, string> = {
  warm_intro: "bg-emerald-500",
  internal_champion: "bg-sky-500",
  influencer: "bg-amber-500",
  technical_evaluator: "bg-muted-foreground",
  decision_maker: "bg-violet-500",
  procurement: "bg-orange-500",
};

const ROLE_BADGE_CLASS: Record<SalesNavContactLevel, string> = {
  warm_intro: "border-emerald-500/35 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100",
  internal_champion: "border-sky-500/35 bg-sky-500/15 text-sky-950 dark:text-sky-100",
  influencer: "border-amber-500/35 bg-amber-500/15 text-amber-950 dark:text-amber-100",
  technical_evaluator: "border-border/60 bg-muted/50 text-foreground",
  decision_maker: "border-violet-500/35 bg-violet-500/15 text-violet-950 dark:text-violet-100",
  procurement: "border-orange-500/35 bg-orange-500/15 text-orange-950 dark:text-orange-100",
};

function isMutualConnectionTitle(title: string | null | undefined): boolean {
  return (title ?? "").trim().toLowerCase() === "mutual connection";
}

function edgeStroke(edgeType: string, strength: number, onPath: boolean): { stroke: string; width: number; dash: string } {
  if (onPath) return { stroke: "rgb(106 138 255 / 0.75)", width: 1.25, dash: "" };
  if (edgeType === "blocked") return { stroke: "rgb(156 175 255 / 0.55)", width: 1, dash: "" };
  if (edgeType === "indirect" || edgeType === "weak") return { stroke: "rgb(175 190 255 / 0.5)", width: 1, dash: "" };
  if (edgeType === "strong" || strength >= 70) return { stroke: "rgb(132 156 255 / 0.7)", width: 1.15, dash: "" };
  return { stroke: "rgb(154 174 255 / 0.65)", width: 1.05, dash: "" };
}

type NodeBox = { x: number; y: number; width: number; height: number };

/** Connect at card edges so arrowheads stay visible between nodes. */
function climbEdgeAnchors(from: NodeBox, to: NodeBox): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = from.x + from.width / 2;
  const x2 = to.x + to.width / 2;
  if (from.y > to.y) {
    return { x1, y1: from.y, x2, y2: to.y + to.height };
  }
  if (from.y < to.y) {
    return { x1, y1: from.y + from.height, x2, y2: to.y };
  }
  if (from.x < to.x) {
    return { x1: from.x + from.width, y1: from.y + from.height / 2, x2: to.x, y2: to.y + to.height / 2 };
  }
  return { x1: from.x, y1: from.y + from.height / 2, x2: to.x + to.width, y2: to.y + to.height / 2 };
}

export function StrategicCompetitiveGraph({
  graph,
  accountId,
  accountName,
  selectedContactId,
  recommendedContactId,
  highlightedPath,
  onSelectContact,
  compact: _compact = false,
}: {
  graph: SalesNavGraph;
  accountId: string;
  accountName: string;
  selectedContactId: string | null;
  recommendedContactId: string | null;
  highlightedPath: SalesNavWarmPath | null;
  onSelectContact: (contactId: string) => void;
  compact?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDragRef = useRef<{
    active: boolean;
    moved: boolean;
    nodeId: string | null;
    pointerId: number | null;
    startX: number;
    startY: number;
    baseOffsetX: number;
    baseOffsetY: number;
  }>({
    active: false,
    moved: false,
    nodeId: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    baseOffsetX: 0,
    baseOffsetY: 0,
  });

  const pathContactIds = useMemo(
    () => new Set(highlightedPath?.steps.map((s) => s.contactId) ?? []),
    [highlightedPath],
  );

  const layout = useMemo(
    () => layoutRelationshipGraph(graph, accountId, pathContactIds),
    [graph, accountId, pathContactIds],
  );
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const nodePosition = (nodeId: string) => {
    const base = nodeById.get(nodeId);
    if (!base) return null;
    const offset = nodeOffsets[nodeId] ?? { x: 0, y: 0 };
    return { x: base.x + offset.x, y: base.y + offset.y, width: base.width, height: base.height };
  };

  const onNodePointerDown = (nodeId: string): PointerEventHandler<HTMLButtonElement> => (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const baseOffset = nodeOffsets[nodeId] ?? { x: 0, y: 0 };
    nodeDragRef.current = {
      active: true,
      moved: false,
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseOffsetX: baseOffset.x,
      baseOffsetY: baseOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onNodePointerMove: PointerEventHandler<HTMLButtonElement> = (event) => {
    const drag = nodeDragRef.current;
    if (!drag.active || drag.nodeId === null) return;
    event.stopPropagation();
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }
    setNodeOffsets((prev) => ({
      ...prev,
      [drag.nodeId!]: { x: drag.baseOffsetX + dx, y: drag.baseOffsetY + dy },
    }));
  };

  const onNodePointerUp: PointerEventHandler<HTMLButtonElement> = (event) => {
    const drag = nodeDragRef.current;
    if (drag.pointerId !== null && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    drag.active = false;
    drag.pointerId = null;
    drag.nodeId = null;
  };

  const handleNodeClick = (contactId: string) => {
    if (nodeDragRef.current.moved) return;
    onSelectContact(contactId);
  };

  const clampZoom = useCallback((value: number) => Math.max(0.5, Math.min(2.5, value)), []);

  const zoomIn = () => setZoom((z) => clampZoom(Number((z + 0.1).toFixed(2))));
  const zoomOut = () => setZoom((z) => clampZoom(Number((z - 0.1).toFixed(2))));
  const zoomReset = () => setZoom(1);
  const zoomFit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const horizontal = viewport.clientWidth / layout.width;
    const vertical = viewport.clientHeight / layout.height;
    setZoom(clampZoom(Number(Math.min(horizontal, vertical).toFixed(2))));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="min-h-0 h-full overflow-auto rounded-xl border border-border/80 bg-background"
        >
        <svg
          width={layout.width * zoom}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="min-w-full select-none overflow-visible"
          role="img"
          aria-label={`Relationship graph for ${accountName}`}
        >
          <defs>
            <filter id="node-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const pos = nodePosition(node.id);
            if (!pos) return null;
            const selected = node.id === selectedContactId;
            const recommended = node.id === recommendedContactId;
            const onPath = pathContactIds.has(node.id);
            const isFinalTarget = node.level === "decision_maker";
            const isPankaj = salesNavDisplayName(node.contact.name, node.contact.linkedinUrl).toLowerCase() === "pankaj srivastava";
            return (
              <foreignObject
                key={node.id}
                x={pos.x}
                y={pos.y}
                width={node.width}
                height={node.height}
                className="overflow-visible"
              >
                <button
                  type="button"
                  data-touch-target="compact"
                  onClick={() => handleNodeClick(node.id)}
                  onPointerDown={onNodePointerDown(node.id)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={onNodePointerUp}
                  onPointerCancel={onNodePointerUp}
                  className={cn(
                    "flex h-full w-full flex-col justify-between gap-1 rounded-lg border px-2 py-2 text-left shadow-sm transition-all",
                    "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    onPath ? "border-primary bg-card" : "border-border/80 bg-card",
                    isFinalTarget && "border-violet-500/70 shadow-[0_0_0_1px_hsl(var(--background)),0_0_0_2px_rgba(139,92,246,0.55)]",
                    selected && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                    recommended && !selected && "shadow-[0_0_12px_hsl(var(--primary)/0.35)]",
                  )}
                  style={recommended ? { filter: "url(#node-glow)" } : undefined}
                >
                  <div className="flex min-h-0 items-start gap-2.5">
                    <SalesNavContactAvatar
                      name={node.contact.name}
                      linkedinUrl={node.contact.linkedinUrl}
                      level={node.level}
                      size="lg"
                      showLevelRing
                      className="!size-12 shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", LEVEL_DOT[node.level])} />
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-snug"
                          title={salesNavDisplayName(node.contact.name, node.contact.linkedinUrl)}
                        >
                          {salesNavDisplayName(node.contact.name, node.contact.linkedinUrl)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "inline-flex w-fit max-w-full rounded-md border px-1.5 py-0.5 text-[9px] font-semibold leading-tight",
                          ROLE_BADGE_CLASS[node.level],
                        )}
                      >
                        {SALES_NAV_LEVEL_LABELS[node.level]}
                      </span>
                      {node.contact.title && !isMutualConnectionTitle(node.contact.title) ? (
                        <span
                          className="line-clamp-2 text-[10px] font-medium leading-snug text-muted-foreground"
                          title={node.contact.title}
                        >
                          {node.contact.title}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-1 border-t border-border/50 pt-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
                        {node.contact.relationshipStrength}%
                      </span>
                      {!isPankaj ? (
                        <SalesNavStatusBadge status={node.contact.status} className="px-1.5 py-0.5 text-[8px] leading-tight" />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isFinalTarget ? (
                        <span className="rounded bg-red-600 px-1 text-[8px] font-bold uppercase text-white">
                          Target
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </foreignObject>
            );
          })}

          {/* Edges on top of nodes so arrowheads stay visible */}
          <g className="pointer-events-none">
            {layout.edges.map(({ edge, onPath }) => {
              const from = nodePosition(edge.fromContactId);
              const to = nodePosition(edge.toContactId);
              if (!from || !to) return null;
              const { x1, y1, x2, y2 } = climbEdgeAnchors(from, to);
              const style = edgeStroke(edge.type, edge.strength, onPath);
              const midX = (x1 + x2) / 2;
              const midY = Math.min(y1, y2) - 12;
              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1 - 1.5} Q ${midX} ${midY - 1.5} ${x2} ${y2 - 1.5}`}
                    fill="none"
                    stroke="rgb(195 207 255 / 0.55)"
                    strokeWidth={0.85}
                    opacity={0.85}
                  />
                  <path
                    d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash || undefined}
                    className={cn(onPath && "motion-safe:animate-[dash_1.6s_linear_infinite]")}
                    opacity={onPath ? 0.95 : 0.8}
                  />
                </g>
              );
            })}
          </g>

          <text
            x={layout.width / 2}
            y={18}
            textAnchor="middle"
            className="fill-foreground"
            style={{ fontSize: 16, fontWeight: 700 }}
          >
            {accountName}
          </text>
        </svg>
        </div>
        <div className="absolute left-3 top-3 z-20 flex w-11 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm">
          <button
            type="button"
            className="h-10 text-lg text-foreground transition-colors hover:bg-muted"
            onClick={zoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="h-10 text-xl text-foreground transition-colors hover:bg-muted"
            onClick={zoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            className="h-10 text-base text-foreground transition-colors hover:bg-muted"
            onClick={zoomFit}
            aria-label="Fit graph"
            title="Fit graph"
          >
            ↗
          </button>
          <button
            type="button"
            className="h-9 border-t border-border text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
            onClick={zoomReset}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-emerald-500" /> Strong relationship
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-amber-500" /> Medium
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 border border-dashed border-muted-foreground" /> Indirect / weak
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" /> AI recommended path
        </span>
      </div>

      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
      `}</style>
    </div>
  );
}
