import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
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
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";

/* ── Avatar helpers ─────────────────────────────────────────────────────────── */
const AVATAR_PALETTE = [
  "bg-orange-500", "bg-blue-500",   "bg-emerald-500", "bg-violet-500",
  "bg-pink-500",   "bg-teal-500",   "bg-red-500",     "bg-indigo-500",
  "bg-amber-500",  "bg-cyan-500",   "bg-lime-500",    "bg-rose-500",
];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

export function nameToInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Coloured circle avatar with initials — used on cards and in the filter strip. */
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
  const bg    = isAgent ? "bg-violet-600" : nameToColor(name);
  const dim   = size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]";
  const ring  = active ? "ring-2 ring-white ring-offset-1 ring-offset-background" : "";
  return (
    <span
      title={name}
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white select-none shrink-0 ${bg} ${dim} ${ring}`}
    >
      {nameToInitials(name)}
    </span>
  );
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
}: {
  issue: Issue;
  agentName: string | null;
  memberName: string | null;
  isLive: boolean;
}) {
  return (
    <>
      <div className="flex items-start gap-1.5 mb-1.5">
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        {isLive && (
          <span className="relative flex h-2 w-2 shrink-0 mt-0.5">
            <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
        )}
      </div>
      <p className="text-sm leading-snug line-clamp-2 mb-2">{issue.title}</p>
      {(issue.labels ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mb-2">
          {(issue.labels ?? []).slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: label.color,
                color: pickTextColorForPillBg(label.color, 0.12),
                backgroundColor: `${label.color}1f`,
              }}
            >
              {label.name}
            </span>
          ))}
          {(issue.labels ?? []).length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{(issue.labels ?? []).length - 2}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <PriorityIcon priority={issue.priority} />
        {/* Assignee avatar — bottom-right of card */}
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
}: {
  issue: Issue;
  agentName: string | null;
  memberName: string | null;
  isLive: boolean;
  isOverlay?: boolean;
  issueLinkState?: unknown;
}) {
  const data = useMemo(() => ({ issue }), [issue]);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: issue.id, data });

  const style = {
    transform: CSS.Translate.toString(transform),
    visibility: isDragging && !isOverlay ? ("hidden" as const) : undefined,
    willChange: isOverlay ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="rounded-md border bg-card p-2.5 cursor-grab active:cursor-grabbing hover:shadow-sm"
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
}: {
  status: string;
  columnLabel?: string;
  columnColor?: string;
  issues: Issue[];
  agentMap: Map<string, string>;
  memberMap: Map<string, string>;
  liveIssueIds?: Set<string>;
  issueLinkState?: unknown;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="sticky top-12 md:top-0 z-10 flex items-center gap-2 px-2 py-2 mb-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 border-b border-border/50">
        {columnColor ? (
          <span
            className="relative inline-flex h-4 w-4 rounded-full border-2 shrink-0"
            style={{ borderColor: columnColor, color: columnColor }}
          >
            {status === "done" && (
              <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />
            )}
          </span>
        ) : (
          <StatusIcon status={status} />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {columnLabel ?? statusLabel(status)}
        </span>
        <span className="text-xs text-muted-foreground/60 ml-auto tabular-nums">
          {issues.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-md p-1 space-y-1 ${
          isOver ? "bg-accent/40" : "bg-muted/20"
        }`}
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
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
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
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2">
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
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
