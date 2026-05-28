import { useCallback, useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react";
import {
  SALES_NAV_LEVEL_LABELS,
  type SalesNavContactLevel,
  type SalesNavGraph,
  type SalesNavWarmPath,
} from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import {
  salesNavIsMiddleRowConnectionEdge,
  salesNavMiddleRowConnectionIds,
} from "@/lib/sales-navigation/graph-connections";
import { layoutRelationshipGraph } from "@/lib/sales-navigation/graph-layout";
import {
  readSalesNavAccountLayout,
  writeSalesNavAccountLayout,
} from "@/lib/sales-navigation/node-layout-storage";
import { SalesNavContactAvatar } from "@/components/sales-navigation/SalesNavContactAvatar";
import { SalesNavStatusBadge } from "@/components/sales-navigation/sales-nav-status";
import { isSalesNavInternalConnector } from "@/lib/sales-navigation/internal-connectors";
import {
  SALES_NAV_AVATAR_PREFETCH_LEVEL_ORDER,
  salesNavDisplayName,
  salesNavLinkedInAvatarSrc,
  salesNavResolveLinkedInUrl,
} from "@/lib/sales-navigation/linkedin-avatar";

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

function edgeStroke(
  edgeType: string,
  strength: number,
  onPath: boolean,
  connectionHighlight: boolean,
  edgeSelected: boolean,
): { stroke: string; width: number; dash: string } {
  if (edgeSelected) return { stroke: "rgb(14 165 233)", width: 3, dash: "" };
  if (connectionHighlight) return { stroke: "rgb(14 165 233)", width: 2.25, dash: "" };
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
  const { selectedCompanyId } = useCompany();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const hasCustomLayoutRef = useRef(false);
  const pendingAutoFitRef = useRef(false);
  const nodeOffsetsRef = useRef(nodeOffsets);
  nodeOffsetsRef.current = nodeOffsets;

  const clampZoom = useCallback((value: number) => Math.max(0.5, Math.min(2.5, value)), []);

  const persistAccountView = useCallback(
    (offsets: Record<string, { x: number; y: number }>) => {
      if (!selectedCompanyId || !hasCustomLayoutRef.current) return;
      const viewport = viewportRef.current;
      writeSalesNavAccountLayout(selectedCompanyId, accountId, {
        offsets,
        zoom,
        scrollLeft: viewport?.scrollLeft ?? 0,
        scrollTop: viewport?.scrollTop ?? 0,
      });
    },
    [selectedCompanyId, accountId, zoom],
  );

  useEffect(() => {
    if (!selectedCompanyId) {
      hasCustomLayoutRef.current = false;
      pendingAutoFitRef.current = false;
      setNodeOffsets({});
      setZoom(1);
      return;
    }

    const contactIds = new Set(
      graph.contacts.filter((contact) => contact.accountId === accountId).map((contact) => contact.id),
    );
    const stored = readSalesNavAccountLayout(selectedCompanyId, accountId, contactIds);
    hasCustomLayoutRef.current = stored.hasCustomLayout;

    if (stored.hasCustomLayout) {
      pendingAutoFitRef.current = false;
      setNodeOffsets(stored.offsets);
      setZoom(stored.zoom != null ? clampZoom(stored.zoom) : 1);
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollLeft = stored.scrollLeft ?? 0;
        viewport.scrollTop = stored.scrollTop ?? 0;
      });
      return;
    }

    pendingAutoFitRef.current = true;
    setNodeOffsets({});
    setZoom(1);
    requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    });
    // Only re-run when switching company/account tabs — not when graph data updates in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- graph.contacts read at tab switch time
  }, [selectedCompanyId, accountId, clampZoom]);

  useEffect(() => {
    setSelectedEdgeId(null);
  }, [accountId]);

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

  const middleRowConnectionIds = useMemo(
    () =>
      selectedEdgeId ? new Set<string>() : salesNavMiddleRowConnectionIds(graph, accountId, selectedContactId),
    [graph, accountId, selectedContactId, selectedEdgeId],
  );

  const layout = useMemo(
    () => layoutRelationshipGraph(graph, accountId, pathContactIds),
    [graph, accountId, pathContactIds],
  );
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const selectedEdgeEndpointIds = useMemo(() => {
    if (!selectedEdgeId) return new Set<string>();
    const match =
      layout.edges.find(({ edge }) => edge.id === selectedEdgeId)?.edge ??
      graph.edges.find((edge) => edge.id === selectedEdgeId);
    if (!match) return new Set<string>();
    return new Set([match.fromContactId, match.toContactId]);
  }, [selectedEdgeId, layout.edges, graph.edges]);

  const contentSize = useMemo(() => {
    const pad = 32;
    let width = layout.width + pad;
    let height = layout.height + pad;
    for (const node of layout.nodes) {
      const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
      width = Math.max(width, node.x + offset.x + node.width + pad);
      height = Math.max(height, node.y + offset.y + node.height + pad);
    }
    return { width, height };
  }, [layout, nodeOffsets]);

  const scaledWidth = contentSize.width * zoom;
  const scaledHeight = contentSize.height * zoom;

  const baseCanvasSize = useMemo(() => {
    const pad = 32;
    return { width: layout.width + pad, height: layout.height + pad };
  }, [layout.width, layout.height]);

  useEffect(() => {
    if (!pendingAutoFitRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;

    pendingAutoFitRef.current = false;
    const horizontal = viewport.clientWidth / baseCanvasSize.width;
    const vertical = viewport.clientHeight / baseCanvasSize.height;
    setZoom(clampZoom(Number(Math.min(horizontal, vertical).toFixed(2))));
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }, [accountId, baseCanvasSize.width, baseCanvasSize.height, clampZoom, layout.width, layout.height]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    const ordered = graph.contacts
      .filter((contact) => contact.accountId === accountId)
      .sort(
        (a, b) =>
          SALES_NAV_AVATAR_PREFETCH_LEVEL_ORDER[a.level] - SALES_NAV_AVATAR_PREFETCH_LEVEL_ORDER[b.level] ||
          a.name.localeCompare(b.name),
      );

    for (const contact of ordered) {
      const profileUrl = salesNavResolveLinkedInUrl(contact.name, contact.linkedinUrl);
      if (!profileUrl) continue;
      const src = salesNavLinkedInAvatarSrc(selectedCompanyId, profileUrl);
      if (!src) continue;
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = src;
    }
  }, [graph.contacts, accountId, selectedCompanyId]);

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
    const { moved, nodeId, startX, startY, baseOffsetX, baseOffsetY } = drag;
    drag.active = false;
    drag.pointerId = null;
    drag.nodeId = null;
    drag.moved = false;
    if (moved && nodeId && selectedCompanyId) {
      const dx = (event.clientX - startX) / zoom;
      const dy = (event.clientY - startY) / zoom;
      setNodeOffsets((prev) => {
        const next = {
          ...prev,
          [nodeId]: { x: baseOffsetX + dx, y: baseOffsetY + dy },
        };
        hasCustomLayoutRef.current = true;
        const viewport = viewportRef.current;
        writeSalesNavAccountLayout(selectedCompanyId, accountId, {
          offsets: next,
          zoom,
          scrollLeft: viewport?.scrollLeft ?? 0,
          scrollTop: viewport?.scrollTop ?? 0,
        });
        return next;
      });
    }
  };

  const handleNodeClick = (contactId: string) => {
    if (nodeDragRef.current.moved) return;
    setSelectedEdgeId(null);
    onSelectContact(contactId);
  };

  const zoomIn = () => {
    setZoom((z) => {
      const next = clampZoom(Number((z + 0.1).toFixed(2)));
      queueMicrotask(() => persistAccountView(nodeOffsetsRef.current));
      return next;
    });
  };
  const zoomOut = () => {
    setZoom((z) => {
      const next = clampZoom(Number((z - 0.1).toFixed(2)));
      queueMicrotask(() => persistAccountView(nodeOffsetsRef.current));
      return next;
    });
  };
  const zoomReset = () => {
    setZoom(1);
    queueMicrotask(() => persistAccountView(nodeOffsetsRef.current));
  };
  const zoomFit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const horizontal = viewport.clientWidth / contentSize.width;
    const vertical = viewport.clientHeight / contentSize.height;
    setZoom(clampZoom(Number(Math.min(horizontal, vertical).toFixed(2))));
    queueMicrotask(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollLeft = 0;
        viewportRef.current.scrollTop = 0;
      }
      persistAccountView(nodeOffsetsRef.current);
    });
  };

  const scrollPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewportScroll = useCallback(() => {
    if (!hasCustomLayoutRef.current) return;
    if (scrollPersistTimerRef.current) clearTimeout(scrollPersistTimerRef.current);
    scrollPersistTimerRef.current = setTimeout(() => {
      persistAccountView(nodeOffsetsRef.current);
    }, 200);
  }, [persistAccountView]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={viewportRef}
          onScroll={onViewportScroll}
          className={cn(
            "min-h-0 flex-1 overscroll-contain rounded-xl border border-border/80 bg-background",
            "overflow-x-auto overflow-y-auto",
            "[scrollbar-gutter:stable] [scrollbar-width:thin]",
            "[scrollbar-color:hsl(var(--border)/0.85)_transparent]",
            "[&::-webkit-scrollbar]:w-2.5",
            "[&::-webkit-scrollbar]:h-2.5",
            "[&::-webkit-scrollbar-track]:bg-muted/30",
            "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            "[&::-webkit-scrollbar-thumb:hover]:bg-border/80",
          )}
        >
          <div
            className="relative shrink-0"
            style={{ width: scaledWidth, height: scaledHeight, minWidth: scaledWidth, minHeight: scaledHeight }}
          >
        <svg
          width={scaledWidth}
          height={scaledHeight}
          viewBox={`0 0 ${contentSize.width} ${contentSize.height}`}
          className="block select-none overflow-visible"
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
            const middleRowConnection = middleRowConnectionIds.has(node.id);
            const selectedEdgeEndpoint = selectedEdgeEndpointIds.has(node.id);
            const isFinalTarget = node.level === "decision_maker";
            const isInternalConnector = isSalesNavInternalConnector(
              salesNavDisplayName(node.contact.name, node.contact.linkedinUrl),
              node.contact.linkedinUrl,
            );
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
                    (middleRowConnection || selectedEdgeEndpoint) &&
                      !selected &&
                      "border-sky-500 bg-sky-500/10 shadow-[0_0_0_1px_hsl(var(--background)),0_0_0_2px_rgba(14,165,233,0.45)]",
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
                      {!isInternalConnector ? (
                        <>
                          <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
                            {node.contact.relationshipStrength}%
                          </span>
                          <SalesNavStatusBadge status={node.contact.status} className="px-1.5 py-0.5 text-[8px] leading-tight" />
                        </>
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
          <g>
            {layout.edges.map(({ edge, onPath }) => {
              const from = nodePosition(edge.fromContactId);
              const to = nodePosition(edge.toContactId);
              if (!from || !to) return null;
              const edgeSelected = selectedEdgeId === edge.id;
              const edgeDimmed = selectedEdgeId !== null && !edgeSelected;
              const connectionHighlight =
                !selectedEdgeId &&
                salesNavIsMiddleRowConnectionEdge(
                  edge.fromContactId,
                  edge.toContactId,
                  selectedContactId,
                  middleRowConnectionIds,
                );
              const { x1, y1, x2, y2 } = climbEdgeAnchors(from, to);
              const midX = (x1 + x2) / 2;
              const midY = Math.min(y1, y2) - 12;
              const curve = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
              const style = edgeStroke(edge.type, edge.strength, onPath, connectionHighlight, edgeSelected);
              return (
                <g key={edge.id}>
                  <path
                    d={curve}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    style={{ pointerEvents: "stroke" }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
                    }}
                    aria-label={`Connection: ${edge.label ?? edge.type}`}
                  />
                  <path
                    d={`M ${x1} ${y1 - 1.5} Q ${midX} ${midY - 1.5} ${x2} ${y2 - 1.5}`}
                    fill="none"
                    stroke="rgb(195 207 255 / 0.55)"
                    strokeWidth={0.85}
                    opacity={edgeDimmed ? 0.2 : 0.85}
                    className="pointer-events-none"
                  />
                  <path
                    d={curve}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash || undefined}
                    className={cn(
                      "pointer-events-none",
                      (onPath || connectionHighlight || edgeSelected) &&
                        "motion-safe:animate-[dash_1.6s_linear_infinite]",
                    )}
                    opacity={edgeDimmed ? 0.2 : edgeSelected ? 1 : connectionHighlight ? 1 : onPath ? 0.95 : 0.8}
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
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex w-11 flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-sm [&_button]:pointer-events-auto">
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

      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
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
