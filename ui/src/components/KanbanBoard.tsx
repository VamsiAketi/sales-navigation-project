import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Identity } from "./Identity";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";

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
  /** When provided, use these as the board columns instead of the default hardcoded list */
  projectStatuses?: ProjectIssueStatus[];
}

/** Compute a kanbanPosition value that places `item` between `before` and `after`. */
function computePosition(before: Issue | null, after: Issue | null): number {
  const prev = before?.kanbanPosition ?? 0;
  const next = after?.kanbanPosition ?? prev + 2;
  if (before === null) return next - 1;
  if (after === null) return prev + 1;
  return (prev + next) / 2;
}

/* ── Droppable Column ── */

function KanbanColumn({
  status,
  columnLabel,
  columnColor,
  issues,
  agents,
  members,
  liveIssueIds,
  issueLinkState,
}: {
  status: string;
  columnLabel?: string;
  columnColor?: string;
  issues: Issue[];
  agents?: Agent[];
  members?: Member[];
  liveIssueIds?: Set<string>;
  issueLinkState?: unknown;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        {columnColor ? (
          <span className="relative inline-flex h-4 w-4 rounded-full border-2 shrink-0" style={{ borderColor: columnColor, color: columnColor }}>
            {status === "done" && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />}
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
        className={`flex-1 min-h-[120px] rounded-md p-1 space-y-1 transition-colors ${
          isOver ? "bg-accent/40" : "bg-muted/20"
        }`}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <KanbanCard
              key={issue.id}
              issue={issue}
              agents={agents}
              members={members}
              isLive={liveIssueIds?.has(issue.id)}
              issueLinkState={issueLinkState}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

/* ── Draggable Card ── */

function KanbanCard({
  issue,
  agents,
  members,
  isLive,
  isOverlay,
  issueLinkState,
}: {
  issue: Issue;
  agents?: Agent[];
  members?: Member[];
  isLive?: boolean;
  isOverlay?: boolean;
  issueLinkState?: unknown;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const resolvedAgentName = issue.assigneeAgentId
    ? (agents?.find((a) => a.id === issue.assigneeAgentId)?.name ?? null)
    : null;

  const resolvedUserName = issue.assigneeUserId
    ? (members?.find((m) => m.id === issue.assigneeUserId)?.name ??
       (issue.assigneeUserId === "local-board" ? "Board" : null))
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-md border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-shadow ${
        isDragging && !isOverlay ? "opacity-30" : ""
      } ${isOverlay ? "shadow-lg ring-1 ring-primary/20" : "hover:shadow-sm"}`}
    >
      <Link
        to={`/issues/${issue.identifier ?? issue.id}`}
        state={issueLinkState}
        className="block no-underline text-inherit"
        onClick={(e) => {
          // Prevent navigation during drag
          if (isDragging) e.preventDefault();
        }}
      >
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
        <div className="flex items-center gap-2">
          <PriorityIcon priority={issue.priority} />
          {/* Agent assignee */}
          {resolvedAgentName ? (
            <Identity name={resolvedAgentName} size="xs" />
          ) : issue.assigneeAgentId ? (
            <span className="text-xs text-muted-foreground font-mono">
              {issue.assigneeAgentId.slice(0, 8)}
            </span>
          ) : resolvedUserName ? (
            /* Human assignee */
            <Identity name={resolvedUserName} size="xs" />
          ) : issue.assigneeUserId ? (
            <span className="text-xs text-muted-foreground font-mono">
              {issue.assigneeUserId.slice(0, 8)}
            </span>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

/* ── Main Board ── */

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Use project-specific statuses when available, otherwise fall back to defaults
  const activeColumns: string[] = useMemo(() => {
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
    for (const status of activeColumns) {
      grouped[status] = [];
    }
    for (const issue of issues) {
      if (grouped[issue.status]) {
        grouped[issue.status].push(issue);
      } else {
        // Issues with inactive/unknown statuses go into an "other" bucket keyed by their value
        if (!grouped[issue.status]) grouped[issue.status] = [];
        grouped[issue.status]!.push(issue);
      }
    }
    // Sort each column by kanbanPosition (fall back to createdAt for unpositioned issues)
    for (const status of Object.keys(grouped)) {
      grouped[status].sort((a, b) => {
        const ap = a.kanbanPosition ?? new Date(a.createdAt).getTime() / 1e10;
        const bp = b.kanbanPosition ?? new Date(b.createdAt).getTime() / 1e10;
        return ap - bp;
      });
    }
    return grouped;
  }, [issues, activeColumns]);

  const activeIssue = useMemo(
    () => (activeId ? issues.find((i) => i.id === activeId) : null),
    [activeId, issues]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const issueId = active.id as string;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;

    // Determine target status: the "over" could be a column id (status string)
    // or another card's id. Find which column the "over" belongs to.
    let targetStatus: string | null = null;
    let targetIssue: Issue | null = null;

    if (activeColumns.includes(over.id as string)) {
      targetStatus = over.id as string;
    } else {
      targetIssue = issues.find((i) => i.id === over.id) ?? null;
      if (targetIssue) {
        targetStatus = targetIssue.status;
      }
    }

    if (!targetStatus) return;

    const isStatusChange = targetStatus !== issue.status;

    if (isStatusChange) {
      // Cross-column move: update status and place at the end of the target column
      const targetColumn = columnIssues[targetStatus] ?? [];
      const lastInTarget = targetColumn[targetColumn.length - 1] ?? null;
      const newPosition = computePosition(lastInTarget, null);
      onUpdateIssue(issueId, { status: targetStatus, kanbanPosition: newPosition });
    } else if (targetIssue && targetIssue.id !== issueId) {
      // Within-column reorder: compute new fractional position
      const column = columnIssues[issue.status] ?? [];
      const oldIndex = column.findIndex((i) => i.id === issueId);
      const newIndex = column.findIndex((i) => i.id === targetIssue!.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(column, oldIndex, newIndex);
      const insertedIndex = reordered.findIndex((i) => i.id === issueId);
      const before = insertedIndex > 0 ? reordered[insertedIndex - 1] : null;
      const after = insertedIndex < reordered.length - 1 ? reordered[insertedIndex + 1] : null;
      const newPosition = computePosition(before ?? null, after ?? null);
      onUpdateIssue(issueId, { kanbanPosition: newPosition });
    }
  }

  function handleDragOver(_event: DragOverEvent) {
    // Could be used for visual feedback; keeping simple for now
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
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
              agents={agents}
              members={members}
              liveIssueIds={liveIssueIds}
              issueLinkState={issueLinkState}
            />
          );
        })}
      </div>
      <DragOverlay>
        {activeIssue ? (
          <KanbanCard issue={activeIssue} agents={agents} members={members} issueLinkState={issueLinkState} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
