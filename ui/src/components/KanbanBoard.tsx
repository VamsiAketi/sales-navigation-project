import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "@/lib/router";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove } from "@dnd-kit/sortable";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { cn } from "../lib/utils";
import { NEW_ISSUE_BADGE_CLASS } from "../lib/focus-created-issue";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";

/* ── Avatar helpers ─────────────────────────────────────────────────────────── */
/** Derive a unique HSL background colour from a name string.
 *  Hue spans the full 360° wheel; saturation and lightness are fixed so
 *  every colour is vivid and readable with white text. */
function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

export function nameToInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Coloured circle avatar with initials — used on cards and in the filter strip.
 *  Background colour is derived dynamically from the name so every person
 *  gets their own consistent, unique hue. */
export function AssigneeAvatar({
  name,
  isAgent = false,
  size = "sm",
  active = false,
}: {
  name: string;
  isAgent?: boolean;
  size?: "sm" | "md";
  active?: boolean;
}) {
  const bgColor = isAgent ? "#7c3aed" : nameToColor(name);
  const dim     = size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]";
  const ring    = active ? "ring-2 ring-white ring-offset-1 ring-offset-background" : "";
  return (
    <span className={`relative inline-flex shrink-0 select-none ${dim}`}>
      <span
        title={`${name} (${isAgent ? "AI Agent" : "Human"})`}
        style={{ backgroundColor: bgColor }}
        className={`inline-flex h-full w-full items-center justify-center rounded-full font-semibold text-white ${ring}`}
      >
        {nameToInitials(name)}
      </span>
      {/* AI Agent indicator badge — only shown for agents */}
      {isAgent && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-background bg-yellow-400 shadow-sm shadow-yellow-300
            ${size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"}`}
          title="AI Agent"
        >
          {/* Bot icon */}
          <svg viewBox="0 0 12 12" className={`fill-gray-900 ${size === "md" ? "h-2 w-2" : "h-1.5 w-1.5"}`}>
            {/* head */}
            <rect x="2" y="3.5" width="8" height="5.5" rx="1.5" />
            {/* antenna */}
            <rect x="5.5" y="1" width="1" height="2.5" rx="0.5" />
            <circle cx="6" cy="1" r="0.8" />
            {/* eyes */}
            <circle cx="4.2" cy="6" r="0.9" fill="white" />
            <circle cx="7.8" cy="6" r="0.9" fill="white" />
            {/* mouth */}
            <rect x="4" y="7.5" width="4" height="0.8" rx="0.4" fill="white" />
          </svg>
        </span>
      )}
    </span>
  );
}

/* ── Per-status accent colours ───────────────────────────────────────────────── */
type Accent = { dot: string; colBg: string; cardBorder: string };

/** Build accent tokens from any hex color (works for built-in and custom statuses) */
function buildAccent(hex: string): Accent {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return buildAccent("#94a3b8");
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return {
    dot:        hex.startsWith("#") ? hex : `#${hex}`,
    colBg:      `rgba(${r},${g},${b},0.07)`,
    cardBorder: `rgba(${r},${g},${b},0.38)`,
  };
}

const STATUS_ACCENT: Record<string, Accent> = {
  backlog:     buildAccent("#94a3b8"),
  todo:        buildAccent("#60a5fa"),
  in_progress: buildAccent("#a78bfa"),
  in_review:   buildAccent("#fb923c"),
  blocked:     buildAccent("#f87171"),
  done:        buildAccent("#34d399"),
  cancelled:   buildAccent("#6b7280"),
};

/** Resolve accent: custom color wins → hardcoded map → neutral gray fallback */
function getAccent(status: string, overrideColor?: string): Accent {
  if (overrideColor) return buildAccent(overrideColor);
  return STATUS_ACCENT[status] ?? buildAccent("#94a3b8");
}

const boardStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Agent {
  id: string;
  name: string;
}

interface Member {
  id: string;
  name: string;
}

interface KanbanBoardProps {
  issues: Issue[];
  agents?: Agent[];
  members?: Member[];
  liveIssueIds?: Set<string>;
  issueLinkState?: unknown;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
  projectStatuses?: ProjectIssueStatus[];
  /** Briefly emphasize this card (e.g. after creating a task). */
  highlightIssueId?: string | null;
  /** Show a "New" pill for this issue (longer than highlight ring). */
  newBadgeIssueId?: string | null;
}

type IssueModalLinkState = {
  issueModal?: boolean;
  backgroundLocation?: unknown;
};

function getSortKey(issue: Issue): number {
  if (issue.kanbanPosition !== null && issue.kanbanPosition !== undefined) {
    return issue.kanbanPosition;
  }
  return new Date(issue.createdAt).getTime() / 1e10;
}

function computePosition(before: Issue | null, after: Issue | null): number {
  const prev = before ? getSortKey(before) : 0;
  const next = after ? getSortKey(after) : prev + 2;
  if (before === null) return next - 1;
  if (after === null) return prev + 1;
  return (prev + next) / 2;
}

// pointerWithin narrows to the column the cursor is inside (O(columns)),
// then closestCenter runs only on that subset instead of every card on the board.
const kanbanCollision: CollisionDetection = (args) => {
  const withinColumn = pointerWithin(args);
  if (withinColumn.length > 0) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) =>
        withinColumn.some((w) => w.id === c.id)
      ),
    });
  }
  return closestCenter(args);
};

/* ── Card content — pure presentational, no dnd-kit hooks ─────────────────── */
const KanbanCardContent = memo(function KanbanCardContent({
  issue,
  agentName,
  memberName,
  isLive,
  accentDot,
  showNewBadge,
}: {
  issue: Issue;
  agentName: string | null;
  memberName: string | null;
  isLive: boolean;
  accentDot: string;
  showNewBadge?: boolean;
}) {
  return (
    <>
      {/* Top row: ticket ID badge + AI active pill */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
        <span
          className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono font-extrabold shrink-0 tracking-tight"
          style={{
            backgroundColor: accentDot,
            color: "#ffffff",
            textShadow: "0 1px 2px rgba(0,0,0,0.35)",
            boxShadow: `0 0 0 2px ${accentDot}40, 0 1px 3px rgba(0,0,0,0.15)`,
          }}
        >
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
            AI active
          </span>
        )}
        {showNewBadge ? (
          <span className={NEW_ISSUE_BADGE_CLASS} aria-label="Newly created task">
            New
          </span>
        ) : null}
      </div>

      {/* Title */}
      <p className="text-sm font-semibold leading-snug line-clamp-2 mb-3 text-foreground">{issue.title}</p>

      {/* Labels — use label.color as text so it's theme-independent */}
      {(issue.labels ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {(issue.labels ?? []).slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide border"
              style={{
                borderColor: `${label.color}70`,
                color: label.color,
                backgroundColor: `${label.color}20`,
              }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </span>
          ))}
          {(issue.labels ?? []).length > 2 && (
            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-muted/60 text-muted-foreground border border-border/40">
              +{(issue.labels ?? []).length - 2}
            </span>
          )}
        </div>
      )}

      {/* Footer: priority + assignee avatar */}
      <div
        className="flex items-center justify-between gap-2 pt-2 mt-1"
        style={{ borderTop: `1px solid ${accentDot}22` }}
      >
        <PriorityIcon priority={issue.priority} />
        {agentName ? (
          <AssigneeAvatar name={agentName} isAgent />
        ) : memberName ? (
          <AssigneeAvatar name={memberName} />
        ) : issue.assigneeAgentId ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {issue.assigneeAgentId.slice(0, 6)}
          </span>
        ) : issue.assigneeUserId ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {issue.assigneeUserId.slice(0, 6)}
          </span>
        ) : null}
      </div>
    </>
  );
});

/* ── Card wrapper ──────────────────────────────────────────────────────────────
 * Uses useDraggable instead of useSortable.
 *
 * useSortable = useDraggable + useDroppable + SortableContext subscription.
 * The SortableContext subscription is the culprit: it recomputes displacement
 * transforms for every card in the column on every pointermove event, causing
 * all cards to re-render at 60 fps during a drag — regardless of React.memo.
 *
 * useDraggable carries none of that. Non-active cards only re-render when the
 * drag starts or ends (isDragging flips). Zero re-renders during movement.
 * ─────────────────────────────────────────────────────────────────────────── */
function KanbanCard({
  issue,
  agentName,
  memberName,
  isLive,
  isOverlay,
  issueLinkState,
  modalLinkState,
  statusColorMap,
  highlight,
  showNewBadge,
}: {
  issue: Issue;
  agentName: string | null;
  memberName: string | null;
  isLive: boolean;
  isOverlay?: boolean;
  issueLinkState?: unknown;
  modalLinkState?: IssueModalLinkState;
  statusColorMap?: Map<string, string>;
  highlight?: boolean;
  showNewBadge?: boolean;
}) {
  const data = useMemo(() => ({ issue }), [issue]);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: issue.id, data });

  const style = {
    transform: CSS.Translate.toString(transform),
    visibility: isDragging && !isOverlay ? ("hidden" as const) : undefined,
    willChange: isOverlay ? "transform" : undefined,
  };

  const accent = getAccent(issue.status, statusColorMap?.get(issue.status));

  return (
    <div
      id={isOverlay ? undefined : `issue-surface-${issue.id}`}
      ref={setNodeRef}
      style={{
        ...style,
        borderColor: accent.cardBorder,
        background: `linear-gradient(145deg, ${accent.dot}08 0%, transparent 55%)`,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "kanban-card group rounded-2xl border-2 bg-card p-3 cursor-grab active:cursor-grabbing shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 dark:bg-card/80",
        highlight &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md z-[2] motion-safe:animate-[kanban-new-card_1.2s_ease-out_1]",
      )}
    >
      <Link
        to={`/issues/${issue.identifier ?? issue.id}`}
        state={modalLinkState ? { ...(issueLinkState as Record<string, unknown> | undefined), ...modalLinkState } : issueLinkState}
        className="block no-underline text-inherit"
      >
        <KanbanCardContent
          issue={issue}
          agentName={agentName}
          memberName={memberName}
          isLive={isLive}
          accentDot={accent.dot}
          showNewBadge={showNewBadge}
        />
      </Link>
    </div>
  );
}

/* ── Column ─────────────────────────────────────────────────────────────────── */
const KanbanColumn = memo(function KanbanColumn({
  status,
  columnLabel,
  columnColor,
  issues,
  agentMap,
  memberMap,
  liveIssueIds,
  issueLinkState,
  modalLinkState,
  statusColorMap,
  highlightIssueId,
  newBadgeIssueId,
}: {
  status: string;
  columnLabel?: string;
  columnColor?: string;
  issues: Issue[];
  agentMap: Map<string, string>;
  memberMap: Map<string, string>;
  liveIssueIds?: Set<string>;
  issueLinkState?: unknown;
  modalLinkState?: IssueModalLinkState;
  statusColorMap?: Map<string, string>;
  highlightIssueId?: string | null;
  newBadgeIssueId?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  // columnColor (from projectStatuses) always wins; then hardcoded map; then neutral fallback
  const accent = getAccent(status, columnColor);
  const dotColor = accent.dot;

  return (
    <div
      className="flex min-w-[272px] w-[272px] shrink-0 flex-col rounded-2xl"
      style={{
        border: `2px solid ${dotColor}45`,
        boxShadow: `0 0 0 1px ${dotColor}18, 0 4px 16px ${dotColor}12`,
      }}
    >
      {/* Sticky status header */}
      <div className="sticky top-0 z-20 shrink-0 rounded-t-2xl shadow-[0_10px_28px_-12px_rgba(0,0,0,0.55)] dark:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.85)]">
        <div
          className="h-1 w-full shrink-0 rounded-t-2xl"
          style={{ backgroundColor: dotColor }}
        />
        <div
          className="flex items-center gap-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur-md"
          style={{
            borderBottomColor: `${dotColor}40`,
            backgroundImage: `linear-gradient(135deg, ${dotColor}20 0%, ${dotColor}0a 100%)`,
          }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-widest shrink-0"
            style={{
              backgroundColor: dotColor,
              color: "#ffffff",
              textShadow: "0 1px 2px rgba(0,0,0,0.25)",
              boxShadow: `0 2px 6px ${dotColor}50`,
            }}
          >
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" />
            {columnLabel ?? statusLabel(status)}
          </span>

          <span className="flex-1" />

          <span
            className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums"
            style={{
              backgroundColor: `${dotColor}22`,
              color: dotColor,
              border: `1.5px solid ${dotColor}55`,
            }}
          >
            {issues.length}
          </span>
        </div>
      </div>

      {/* Drop zone / card list */}
      <div
        ref={setNodeRef}
        className={`kanban-col-${status} min-h-[4rem] overflow-x-hidden rounded-b-2xl px-2 pt-2 pb-3 space-y-2 transition-colors duration-150 ${
          isOver ? "bg-accent/30" : ""
        }`}
        style={{
          backgroundColor: isOver ? undefined : accent.colBg,
        }}
      >
        {issues.map((issue) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            agentName={agentMap.get(issue.assigneeAgentId ?? "") ?? null}
            memberName={
              issue.assigneeUserId === "local-board"
                ? "Board"
                : (memberMap.get(issue.assigneeUserId ?? "") ?? null)
            }
            isLive={liveIssueIds?.has(issue.id) ?? false}
            issueLinkState={issueLinkState}
            modalLinkState={modalLinkState}
            statusColorMap={statusColorMap}
            highlight={highlightIssueId === issue.id}
            showNewBadge={newBadgeIssueId === issue.id}
          />
        ))}
      </div>
    </div>
  );
});

/* ── Board ───────────────────────────────────────────────────────────────────── */
export function KanbanBoard({
  issues,
  agents,
  members,
  liveIssueIds,
  issueLinkState,
  onUpdateIssue,
  projectStatuses,
  highlightIssueId = null,
  newBadgeIssueId = null,
}: KanbanBoardProps) {
  const location = useLocation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const modalLinkState = useMemo<IssueModalLinkState>(() => ({
    issueModal: true,
    backgroundLocation: location,
  }), [location]);

  // optimisticMoves: issueId → targetStatus applied immediately on drop so the
  // card never flashes back into the source column while the network request
  // is in-flight. Cleared once the real `issues` prop reflects the change.
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, string>>({});

  useEffect(() => {
    setOptimisticMoves((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const issue = issues.find((i) => i.id === id);
        if (issue && issue.status === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [issues]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } })
  );

  const agentMap = useMemo(
    () => new Map((agents ?? []).map((a) => [a.id, a.name])),
    [agents]
  );

  const memberMap = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m.name])),
    [members]
  );

  const activeColumns = useMemo<string[]>(() => {
    if (projectStatuses && projectStatuses.length > 0) {
      return projectStatuses
        .filter((s) => s.isActive)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.value);
    }
    return boardStatuses;
  }, [projectStatuses]);

  /** Maps status value → custom hex color from projectStatuses (if set) */
  const statusColorMap = useMemo(
    () =>
      new Map(
        (projectStatuses ?? [])
          .filter((s) => s.color)
          .map((s) => [s.value, s.color as string])
      ),
    [projectStatuses]
  );

  const columnIssues = useMemo(() => {
    const grouped: Record<string, Issue[]> = {};
    for (const status of activeColumns) grouped[status] = [];
    for (const issue of issues) {
      // Apply optimistic move so the card appears in the target column
      // instantly, before the server response arrives.
      const effectiveStatus = optimisticMoves[issue.id] ?? issue.status;
      if (!grouped[effectiveStatus]) grouped[effectiveStatus] = [];
      grouped[effectiveStatus].push(issue);
    }
    for (const status of Object.keys(grouped)) {
      grouped[status].sort((a, b) => getSortKey(a) - getSortKey(b));
    }
    return grouped;
  }, [issues, activeColumns, optimisticMoves]);

  const activeIssue = useMemo(
    () => (activeId ? (issues.find((i) => i.id === activeId) ?? null) : null),
    [activeId, issues]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = active.id as string;
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) return;

      let targetStatus: string | null = null;
      let targetIssue: Issue | null = null;

      if (activeColumns.includes(over.id as string)) {
        targetStatus = over.id as string;
      } else {
        targetIssue = issues.find((i) => i.id === over.id) ?? null;
        if (targetIssue) targetStatus = targetIssue.status;
      }

      if (!targetStatus) return;

      if (targetStatus !== issue.status) {
        // Optimistically move the card now so it never flashes back in the
        // source column while the async onUpdateIssue round-trip completes.
        setOptimisticMoves((prev) => ({ ...prev, [issueId]: targetStatus! }));
        const col = columnIssues[targetStatus] ?? [];
        const newPosition = computePosition(col[col.length - 1] ?? null, null);
        onUpdateIssue(issueId, { status: targetStatus, kanbanPosition: newPosition });
      } else if (targetIssue && targetIssue.id !== issueId) {
        const col = columnIssues[issue.status] ?? [];
        const oldIdx = col.findIndex((i) => i.id === issueId);
        const newIdx = col.findIndex((i) => i.id === targetIssue!.id);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
        const reordered = arrayMove(col, oldIdx, newIdx);
        const pos = reordered.findIndex((i) => i.id === issueId);
        const before = pos > 0 ? reordered[pos - 1] : null;
        const after = pos < reordered.length - 1 ? reordered[pos + 1] : null;
        onUpdateIssue(issueId, { kanbanPosition: computePosition(before, after) });
      }
    },
    [issues, activeColumns, columnIssues, onUpdateIssue]
  );

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="-mx-2 flex items-start gap-4 overflow-x-auto px-2 pb-4">
        {activeColumns.map((status) => {
          const ps = projectStatuses?.find((s) => s.value === status);
          return (
            <KanbanColumn
              key={status}
              status={status}
              columnLabel={ps?.name}
              columnColor={ps?.color}
              issues={columnIssues[status] ?? []}
              agentMap={agentMap}
              memberMap={memberMap}
              liveIssueIds={liveIssueIds}
              issueLinkState={issueLinkState}
              modalLinkState={modalLinkState}
              statusColorMap={statusColorMap}
              highlightIssueId={highlightIssueId}
              newBadgeIssueId={newBadgeIssueId}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <KanbanCard
            issue={activeIssue}
            agentName={agentMap.get(activeIssue.assigneeAgentId ?? "") ?? null}
            memberName={
              activeIssue.assigneeUserId === "local-board"
                ? "Board"
                : (memberMap.get(activeIssue.assigneeUserId ?? "") ?? null)
            }
            isLive={liveIssueIds?.has(activeIssue.id) ?? false}
            issueLinkState={issueLinkState}
            modalLinkState={modalLinkState}
            statusColorMap={statusColorMap}
            showNewBadge={newBadgeIssueId === activeIssue.id}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
