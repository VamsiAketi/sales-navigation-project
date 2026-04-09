import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
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
import { GripVertical, Plus, Trash2, Eye, EyeOff, UserCheck, X, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { projectsApi } from "../api/projects";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { cn } from "@/lib/utils";
import {
  isBoardPinnedHiddenProjectIssueStatusValue,
  isFixedNameProjectIssueStatusValue,
  isMandatoryProjectIssueStatusValue,
  type ProjectIssueStatus,
} from "@paperclipai/shared";

const HUMAN_APPROVAL_COLOR = "#f59e0b";

/* ── Swatch color palette ───────────────────────────────────────────────────── */
// null = "no color" (renders as strikethrough circle)
const PALETTE: (string | null)[][] = [
  [null,      "#ffffff", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#0f172a"],
  ["#ede9fe", "#fce7f3", "#ffe4e6", "#ffedd5", "#fef9c3", "#d1fae5", "#ccfbf1", "#e0f2fe", "#dbeafe", "#f0f9ff"],
  ["#ddd6fe", "#fbcfe8", "#fda4af", "#fed7aa", "#fde68a", "#a7f3d0", "#99f6e4", "#bae6fd", "#bfdbfe", "#c7d2fe"],
  ["#a78bfa", "#f472b6", "#fb7185", "#fb923c", "#fbbf24", "#34d399", "#2dd4bf", "#38bdf8", "#60a5fa", "#818cf8"],
  ["#7c3aed", "#db2777", "#e11d48", "#ea580c", "#d97706", "#059669", "#0d9488", "#0284c7", "#2563eb", "#4f46e5"],
];

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger swatch */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change color"
        className="inline-flex h-6 w-6 rounded-full border-2 shrink-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-transform hover:scale-110"
        style={{ borderColor: value, backgroundColor: value + "55" }}
      />

      {/* Palette popover */}
      {open && (
        <div className="absolute left-0 top-8 z-50 rounded-xl border border-border bg-popover p-2.5 shadow-xl w-[236px]">
          <div className="space-y-1">
            {PALETTE.map((row, ri) => (
              <div key={ri} className="flex gap-1">
                {row.map((color, ci) =>
                  color === null ? (
                    /* "No color" / strikethrough circle */
                    <button
                      key={ci}
                      type="button"
                      onClick={() => { onChange("#94a3b8"); setOpen(false); }}
                      title="Default"
                      className="h-[20px] w-[20px] rounded-full border border-border flex items-center justify-center hover:scale-110 transition-transform"
                    >
                      <svg viewBox="0 0 20 20" className="h-full w-full">
                        <circle cx="10" cy="10" r="9" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                        <line x1="4" y1="16" x2="16" y2="4" stroke="#94a3b8" strokeWidth="1.5" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => { onChange(color); setOpen(false); }}
                      title={color}
                      className="h-[20px] w-[20px] rounded-full transition-transform hover:scale-110 focus:outline-none"
                      style={{
                        backgroundColor: color,
                        border: value === color ? "2.5px solid #3b82f6" : color === "#ffffff" ? "1px solid #e2e8f0" : "none",
                        boxShadow: value === color ? "0 0 0 1px #3b82f6" : undefined,
                      }}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ApproverUser {
  id: string;
  name: string;
  email: string;
}

interface Props {
  projectId: string;
  statuses: ProjectIssueStatus[];
}

/* ── Approver picker for Human Approval rows ── */

function ApproverPicker({
  approverUserIds,
  onAddApprover,
  onRemoveApprover,
  allUsers,
}: {
  approverUserIds: string[];
  onAddApprover: (userId: string) => void;
  onRemoveApprover: (userId: string) => void;
  allUsers: ApproverUser[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const approverSet = new Set(approverUserIds);
  const approvers = allUsers.filter((u) => approverSet.has(u.id));
  const lowerSearch = search.toLowerCase();
  const available = allUsers.filter(
    (u) => !approverSet.has(u.id) &&
      (search === "" || u.name.toLowerCase().includes(lowerSearch) || u.email.toLowerCase().includes(lowerSearch))
  );

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {approvers.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/30 px-2 py-0.5 text-xs text-foreground"
        >
          {u.name}
          <button
            type="button"
            onClick={() => onRemoveApprover(u.id)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            aria-label={`Remove ${u.name}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/80 bg-transparent px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {approvers.length === 0 ? "Add approver" : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <input
            autoFocus
            placeholder="Search members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background mb-1.5 outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {available.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                {allUsers.length === 0 ? "No members found" : "No more members to add"}
              </p>
            )}
            {available.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onAddApprover(u.id); setSearch(""); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors"
              >
                <div className="font-medium">{u.name}</div>
                <div className="text-muted-foreground truncate">{u.email}</div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── Single row ── */

function StatusRow({
  status,
  onRename,
  onColorChange,
  onToggleActive,
  onDelete,
  onUpdateApprovers,
  allUsers,
}: {
  status: ProjectIssueStatus;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onUpdateApprovers: (id: string, approverUserIds: string[]) => void;
  allUsers: ApproverUser[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id });
  const [localName, setLocalName] = useState(status.name);
  const [localColor, setLocalColor] = useState(status.color);
  const deleteDisabled = isMandatoryProjectIssueStatusValue(status.value);
  const nameLocked = isFixedNameProjectIssueStatusValue(status.value);

  useEffect(() => {
    if (!nameLocked) setLocalName(status.name);
  }, [status.name, status.id, nameLocked]);

  const style = { transform: CSS.Transform.toString(transform), transition };

  if (status.isHumanApproval) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "space-y-3 rounded-lg border border-border/80 bg-card pl-1 pr-3 py-2.5 shadow-xs transition-[box-shadow,opacity,border-color] sm:pl-2",
          "border-l-[3px] border-l-amber-500/85 dark:border-l-amber-500/70",
          isDragging ? "opacity-50 shadow-md ring-2 ring-ring/25" : "hover:border-border hover:bg-muted/15",
        )}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="-ml-0.5 flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/35 bg-amber-500/10 dark:bg-amber-500/15"
            title="Human approval"
          >
            <UserCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          </div>

          <Input
            value={nameLocked ? status.name : localName}
            readOnly={nameLocked}
            disabled={nameLocked}
            title={nameLocked ? "Backlog and Done display names cannot be changed" : undefined}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              if (nameLocked) return;
              if (localName.trim() && localName.trim() !== status.name) onRename(status.id, localName.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={cn(
              "h-8 min-w-0 flex-1 border-border/80 text-sm focus-visible:ring-1",
              nameLocked ? "cursor-not-allowed bg-muted/40 text-muted-foreground" : "bg-background/50",
            )}
          />

          <span className="hidden w-30 shrink-0 text-right font-mono text-[11px] text-muted-foreground sm:block">
            {status.value}
          </span>

          <div className="flex shrink-0 items-center gap-0.5 border-l border-border/50 pl-2 sm:pl-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => onToggleActive(status.id, !status.isActive)}
              title={status.isActive ? "Hide from Board" : "Show on Board"}
            >
              {status.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-60" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={deleteDisabled}
              onClick={() => onDelete(status.id)}
              title={
                deleteDisabled
                  ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
                  : "Delete status"
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-10">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Approvers</span>
          <ApproverPicker
            approverUserIds={status.approverUserIds ?? []}
            allUsers={allUsers}
            onAddApprover={(userId) =>
              onUpdateApprovers(status.id, [...(status.approverUserIds ?? []), userId])
            }
            onRemoveApprover={(userId) =>
              onUpdateApprovers(status.id, (status.approverUserIds ?? []).filter((id) => id !== userId))
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2 py-2 shadow-xs transition-[box-shadow,opacity,border-color] sm:gap-3 sm:px-3 sm:py-2.5",
        isDragging ? "opacity-50 shadow-md ring-2 ring-ring/25" : "hover:border-border hover:bg-muted/15",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <ColorSwatchPicker
        value={localColor}
        onChange={(color) => {
          setLocalColor(color);
          onColorChange(status.id, color);
        }}
      />

      <Input
        value={nameLocked ? status.name : localName}
        readOnly={nameLocked}
        disabled={nameLocked}
        title={nameLocked ? "Backlog and Done display names cannot be changed" : undefined}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => {
          if (nameLocked) return;
          if (localName.trim() && localName.trim() !== status.name) onRename(status.id, localName.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "h-8 min-w-0 flex-1 border-border/80 text-sm focus-visible:ring-1",
          nameLocked ? "cursor-not-allowed bg-muted/40 text-muted-foreground" : "bg-background/50",
        )}
      />

      <span
        className="hidden w-30 shrink-0 truncate text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:block"
        title={status.value}
      >
        {status.value}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-border/50 pl-2 sm:pl-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => onToggleActive(status.id, !status.isActive)}
          title={status.isActive ? "Hide from Board" : "Show on Board"}
        >
          {status.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-60" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={deleteDisabled}
          onClick={() => onDelete(status.id)}
          title={
            deleteDisabled
              ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
              : "Delete status"
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Backlog: pinned first, never on the board — no drag handle, visibility toggle disabled. */
function BacklogWorkflowStatusRow({
  status,
  onRename,
  onColorChange,
  onDelete,
}: {
  status: ProjectIssueStatus;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const [localName, setLocalName] = useState(status.name);
  const [localColor, setLocalColor] = useState(status.color);
  const deleteDisabled = isMandatoryProjectIssueStatusValue(status.value);
  const nameLocked = isFixedNameProjectIssueStatusValue(status.value);

  useEffect(() => {
    if (!nameLocked) setLocalName(status.name);
  }, [status.name, status.id, nameLocked]);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2 py-2 shadow-xs transition-[box-shadow,opacity,border-color] sm:gap-3 sm:px-3 sm:py-2.5",
        "border-dashed border-muted-foreground/25 bg-muted/10",
      )}
    >
      <div
        className="flex h-8 w-7 shrink-0 items-center justify-center text-muted-foreground"
        title="Backlog stays first and is not shown on the board"
      >
        <Pin className="h-3.5 w-3.5" aria-hidden />
      </div>

      <ColorSwatchPicker
        value={localColor}
        onChange={(color) => {
          setLocalColor(color);
          onColorChange(status.id, color);
        }}
      />

      <Input
        value={nameLocked ? status.name : localName}
        readOnly={nameLocked}
        disabled={nameLocked}
        title={nameLocked ? "Backlog and Done display names cannot be changed" : undefined}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => {
          if (nameLocked) return;
          if (localName.trim() && localName.trim() !== status.name) onRename(status.id, localName.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "h-8 min-w-0 flex-1 border-border/80 text-sm focus-visible:ring-1",
          nameLocked ? "cursor-not-allowed bg-muted/40 text-muted-foreground" : "bg-background/50",
        )}
      />

      <span
        className="hidden w-30 shrink-0 truncate text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:block"
        title={status.value}
      >
        {status.value}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 border-l border-border/50 pl-2 sm:pl-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-8 w-8 text-muted-foreground"
          disabled
          title="Backlog is always hidden from the board"
        >
          <EyeOff className="h-3.5 w-3.5 opacity-60" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={deleteDisabled}
          onClick={() => onDelete(status.id)}
          title={
            deleteDisabled
              ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
              : "Delete status"
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ── Main component ── */

export function ProjectIssueStatusSettings({ projectId, statuses }: Props) {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? undefined;

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(companyId!),
    queryFn: () => accessApi.listMembers(companyId!),
    enabled: !!companyId,
  });

  const allUsers = useMemo<ApproverUser[]>(
    () => (members ?? [])
      .filter((m) => m.principalType === "user" && m.status === "active" && m.user)
      .map((m) => ({ id: m.user!.id, name: m.user!.name, email: m.user!.email })),
    [members],
  );

  const backlogStatus = useMemo(
    () => statuses.find((s) => isBoardPinnedHiddenProjectIssueStatusValue(s.value)),
    [statuses],
  );

  // Local order for draggable rows (backlog is pinned above and omitted here)
  const [orderedNonBacklogIds, setOrderedNonBacklogIds] = useState<string[]>(() =>
    statuses.filter((s) => !isBoardPinnedHiddenProjectIssueStatusValue(s.value)).map((s) => s.id),
  );

  useEffect(() => {
    setOrderedNonBacklogIds(
      statuses.filter((s) => !isBoardPinnedHiddenProjectIssueStatusValue(s.value)).map((s) => s.id),
    );
  }, [statuses]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.issueStatuses(projectId) });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      projectsApi.updateIssueStatus(projectId, id, data, companyId),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) =>
      projectsApi.reorderIssueStatuses(projectId, ids, companyId),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.deleteIssueStatus(projectId, id, companyId),
    onSuccess: invalidate,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      projectsApi.createIssueStatus(projectId, data, companyId),
    onSuccess: invalidate,
  });

  // New status form state
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [showAddForm, setShowAddForm] = useState(false);
  const [valueError, setValueError] = useState("");

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedNonBacklogIds.indexOf(active.id as string);
    const newIndex = orderedNonBacklogIds.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(orderedNonBacklogIds, oldIndex, newIndex);
    setOrderedNonBacklogIds(next);
    if (!backlogStatus) return;
    reorderMutation.mutate([backlogStatus.id, ...next]);
  }

  const sortedDraggableStatuses = orderedNonBacklogIds
    .map((id) => statuses.find((s) => s.id === id))
    .filter((s): s is ProjectIssueStatus => !!s);

  function handleAddStatus() {
    const trimmedName = newName.trim();
    const trimmedValue = newValue.trim();
    if (!trimmedName) return;
    if (!trimmedValue || !/^[a-z0-9_]+$/.test(trimmedValue)) {
      setValueError("Value must be lowercase letters, numbers, and underscores only.");
      return;
    }
    setValueError("");
    createMutation.mutate(
      { name: trimmedName, value: trimmedValue, color: newColor },
      {
        onSuccess: () => {
          setNewName("");
          setNewValue("");
          setNewColor("#6b7280");
          setShowAddForm(false);
        },
      },
    );
  }

  function handleAddHumanApprovalStep() {
    // Generate a unique value key by counting existing approval steps
    const existingApprovalCount = statuses.filter((s) => s.isHumanApproval).length;
    const suffix = existingApprovalCount > 0 ? `_${existingApprovalCount + 1}` : "";
    createMutation.mutate({
      name: "Human Approval",
      value: `human_approval${suffix}`,
      color: HUMAN_APPROVAL_COLOR,
      isHumanApproval: true,
    });
  }

  // Auto-derive value from name
  function handleNameChange(name: string) {
    setNewName(name);
    setNewValue(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
    );
    setValueError("");
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
      <header className="border-b border-border/60 bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Task statuses</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Define the workflow states issues move through. Drag handles to reorder. Backlog stays first and is only on the list view, not the board. Deactivate other states to hide them from the board without deleting or losing history.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shadow-xs"
              onClick={handleAddHumanApprovalStep}
              disabled={createMutation.isPending}
            >
              <UserCheck className="h-3.5 w-3.5" />
              Add approval step
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shadow-xs"
              onClick={() => setShowAddForm((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add status
            </Button>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-5 py-4 sm:px-6">
      {showAddForm && (
        <div className="rounded-lg border border-border/80 bg-muted/10 p-4 space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">New status</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
            <Input
              placeholder="Display name"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="h-9 min-w-0 flex-1 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleAddStatus()}
            />
            <Input
              placeholder="value_key"
              value={newValue}
              onChange={(e) => { setNewValue(e.target.value); setValueError(""); }}
              className="h-9 w-full shrink-0 font-mono text-xs sm:w-36"
              onKeyDown={(e) => e.key === "Enter" && handleAddStatus()}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Internal key: lowercase letters, numbers, and underscores only. Used in API and automation.
          </p>
          {valueError ? <p className="text-xs text-destructive">{valueError}</p> : null}
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="h-8" onClick={handleAddStatus} disabled={createMutation.isPending}>
              Create status
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {backlogStatus ? (
          <BacklogWorkflowStatusRow
            status={backlogStatus}
            onRename={(id, name) => updateMutation.mutate({ id, data: { name } })}
            onColorChange={(id, color) => updateMutation.mutate({ id, data: { color } })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ) : null}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedNonBacklogIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {sortedDraggableStatuses.map((s) => (
                <StatusRow
                  key={s.id}
                  status={s}
                  onRename={(id, name) => updateMutation.mutate({ id, data: { name } })}
                  onColorChange={(id, color) => updateMutation.mutate({ id, data: { color } })}
                  onToggleActive={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onUpdateApprovers={(id, approverUserIds) =>
                    updateMutation.mutate({ id, data: { approverUserIds } })
                  }
                  allUsers={allUsers}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      </div>
    </section>
  );
}
