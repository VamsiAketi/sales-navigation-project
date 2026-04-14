import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { mergeIssueModalLocationState } from "../lib/issueDetailBreadcrumb";
import { NEW_ISSUE_BADGE_CLASS } from "../lib/focus-created-issue";
import { isProjectIssueWorkflowTransitionAllowed, type Issue, type ProjectIssueStatus } from "@paperclipai/shared";

/* ── Avatar helpers ─────────────────────────────────────────────────────────── */
/** Derive a unique HSL background colour from a name string.
 *  Hue spans the full 360° wheel; saturation and lightness are fixed so
 *  every colour is vivid and readable with white text. */
function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 48%, 44%)`;
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
  const bgColor = isAgent ? "#4f46e5" : nameToColor(name);
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
          className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-background bg-primary/90 shadow-sm
            ${size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"}`}
          title="AI Agent"
        >
          {/* Bot icon */}
          <svg viewBox="0 0 12 12" className={`fill-primary-foreground ${size === "md" ? "h-2 w-2" : "h-1.5 w-1.5"}`}>
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
    colBg:      `rgba(${r},${g},${b},0.025)`,
    cardBorder: `rgba(${r},${g},${b},0.16)`,
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

function columnAcceptsIssueDrop(
  dragged: Issue,
  columnStatus: string,
  projectStatuses: ProjectIssueStatus[] | undefined,
): boolean {
  if (dragged.status === columnStatus) return true;
  const fromMeta = projectStatuses?.find((s) => s.value === dragged.status);
  return isProjectIssueWorkflowTransitionAllowed(dragged.status, columnStatus, fromMeta);
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
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground"
          style={{
            borderColor: `${accentDot}70`,
            backgroundColor: `${accentDot}14`,
          }}
        >
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        {isLive && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Active
          </span>
        )}
        {showNewBadge ? (
          <span className={NEW_ISSUE_BADGE_CLASS} aria-label="Newly created task">
            New
          </span>
        ) : null}
      </div>

      {/* Title */}
      <p className="mb-3 line-clamp-2 wrap-anywhere text-[15px] font-medium leading-snug text-foreground">
        {issue.title}
      </p>

      {/* Labels */}
      {(issue.labels ?? []).length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {(issue.labels ?? []).slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-black"
              style={{
                borderColor: `${label.color}55`,
                backgroundColor: `${label.color}14`,
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
            <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              +{(issue.labels ?? []).length - 2}
            </span>
          )}
        </div>
      )}

      {/* Footer: priority + assignee avatar */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
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
        background: "hsl(var(--card))",
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "kanban-card group rounded-md border border-border/60 bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_20px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(15,23,42,0.10),0_12px_28px_rgba(15,23,42,0.08)] cursor-grab active:cursor-grabbing dark:border-border/50 dark:bg-card",
        highlight &&
          "z-2 ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md motion-safe:animate-[kanban-new-card_1.2s_ease-out_1]",
      )}
    >
      <Link
        to={`/issues/${issue.identifier ?? issue.id}`}
        state={issueLinkState}
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
  statusColorMap,
  highlightIssueId,
  newBadgeIssueId,
  dropDisabled,
}: {
  status: string;
  columnLabel?: string;
  columnColor?: string;
  issues: Issue[];
  agentMap: Map<string, string>;
  memberMap: Map<string, string>;
  liveIssueIds?: Set<string>;
  issueLinkState?: unknown;
  statusColorMap?: Map<string, string>;
  highlightIssueId?: string | null;
  newBadgeIssueId?: string | null;
  dropDisabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: dropDisabled });
  // columnColor (from projectStatuses) always wins; then hardcoded map; then neutral fallback
  const accent = getAccent(status, columnColor);
  const dotColor = accent.dot;

  return (
    <div
      className="flex w-[252px] min-w-[252px] shrink-0 flex-col rounded-lg border border-border/70 bg-card/80"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      {/* Drop zone / card list */}
      <div
        ref={setNodeRef}
        className={`kanban-col-${status} flex-1 min-h-16 space-y-2 overflow-x-hidden rounded-b-lg bg-muted/30 px-2 pb-2.5 pt-2 transition-colors duration-150 dark:bg-muted/20 ${
          isOver ? "bg-accent/30" : ""
        }`}
        style={{
          backgroundColor: isOver ? undefined : undefined,
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
  const cardLinkState = useMemo(
    () => mergeIssueModalLocationState(issueLinkState, location),
    [issueLinkState, location],
  );

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
        if (!columnAcceptsIssueDrop(issue, targetStatus, projectStatuses)) {
          return;
        }
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
    [issues, activeColumns, columnIssues, onUpdateIssue, projectStatuses]
  );

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<HTMLDivElement>(null);

  const onCardsScroll = useCallback(() => {
    if (headerScrollRef.current && cardsScrollRef.current) {
      headerScrollRef.current.scrollLeft = cardsScrollRef.current.scrollLeft;
    }
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
    {/* Single wrapper so ancestor space-y-* gaps don't bleed between
        the sticky header div and the cards div (DndContext adds no DOM node) */}
    <div>
      {/* ── Sticky header row ─────────────────────────────────────────────────────
          Lives outside the overflow-x-auto card container so sticky top-0 works
          against the page scroll. bg-background ensures no bleed between the two
          sibling divs. JS scroll-sync keeps columns aligned horizontally.       */}
      <div className="sticky top-[52px] z-50 -mx-2 mb-0 overflow-hidden bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80" style={{ willChange: "transform" }}>
        <div
          ref={headerScrollRef}
          className="flex gap-4 overflow-x-hidden px-2 pb-1"
        >
          {activeColumns.map((status) => {
            const ps = projectStatuses?.find((s) => s.value === status);
            const accent = getAccent(status, ps?.color);
            const dotColor = accent.dot;
            return (
              <div
                key={status}
                className="w-[252px] min-w-[252px] shrink-0 rounded-t-lg border border-border/70 border-b-0 bg-card/80"
                style={{
                  boxShadow: `0 1px 3px ${dotColor}10`,
                }}
              >
                <div
                  className="h-0.5 w-full rounded-t-lg"
                  style={{ backgroundColor: dotColor }}
                />
                <div
                  className="flex items-center gap-2 border-b px-2.5 py-2"
                  style={{
                    borderBottomColor: "hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                >
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground"
                    style={{
                      boxShadow: `inset 0 0 0 1px ${dotColor}26`,
                    }}
                  >
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor, boxShadow: `0 0 0 1px ${dotColor}40` }} />
                    {ps?.name ?? statusLabel(status)}
                  </span>
                  <span className="flex-1" />
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-muted/50 px-1.5 text-[10px] font-bold tabular-nums text-foreground"
                    style={{
                      boxShadow: `inset 0 0 0 1px ${dotColor}22`,
                    }}
                  >
                    {(columnIssues[status] ?? []).length}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Card rows — horizontally scrollable, page scrolls vertically ───────── */}
      {/* relative + z-0 creates a stacking context below the sticky header (z-50)
          so no card can ever paint on top of the sticky status row              */}
      <div
        ref={cardsScrollRef}
        className="-mx-2 relative z-0 flex min-h-[calc(100dvh-16rem)] items-stretch gap-4 overflow-x-auto overscroll-x-none px-2 pb-4 [scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/70 [&::-webkit-scrollbar-thumb:hover]:bg-border"
        onScroll={onCardsScroll}
      >
        {activeColumns.map((status) => {
          const ps = projectStatuses?.find((s) => s.value === status);
          const dropDisabled =
            activeIssue != null && !columnAcceptsIssueDrop(activeIssue, status, projectStatuses);
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
              issueLinkState={cardLinkState}
              statusColorMap={statusColorMap}
              highlightIssueId={highlightIssueId}
              newBadgeIssueId={newBadgeIssueId}
              dropDisabled={dropDisabled}
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
            issueLinkState={cardLinkState}
            statusColorMap={statusColorMap}
            showNewBadge={newBadgeIssueId === activeIssue.id}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
