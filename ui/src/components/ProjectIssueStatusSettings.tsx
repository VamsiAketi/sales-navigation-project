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
import { GripVertical, Plus, Trash2, Eye, EyeOff, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { projectsApi } from "../api/projects";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import type { ProjectIssueStatus } from "@paperclipai/shared";

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
          className="inline-flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5"
        >
          {u.name}
          <button
            type="button"
            onClick={() => onRemoveApprover(u.id)}
            className="hover:text-destructive transition-colors"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 border border-dashed border-amber-300 dark:border-amber-700 rounded-full px-2 py-0.5 transition-colors"
          >
            <Plus className="h-2.5 w-2.5" />
            {approvers.length === 0 && "Add approver"}
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

  const style = { transform: CSS.Transform.toString(transform), transition };

  if (status.isHumanApproval) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 space-y-2 ${isDragging ? "opacity-40" : ""}`}
      >
        <div className="flex items-center gap-2">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0">
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 flex items-center justify-center shrink-0">
            <UserCheck className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          </div>

          <Input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => {
              if (localName.trim() && localName.trim() !== status.name) onRename(status.id, localName.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="h-7 flex-1 text-sm bg-transparent border-amber-200 dark:border-amber-800 focus-visible:ring-amber-400"
          />

          <button
            onClick={() => onToggleActive(status.id, !status.isActive)}
            title={status.isActive ? "Deactivate" : "Activate"}
            className={`shrink-0 transition-colors ${status.isActive ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
          >
            {status.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>

          <button
            onClick={() => onDelete(status.id)}
            title="Delete status"
            className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 pl-8">
          <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">Approvers:</span>
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
      className={`flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 ${isDragging ? "opacity-40" : ""}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0">
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Color swatch picker */}
      <ColorSwatchPicker
        value={localColor}
        onChange={(color) => {
          setLocalColor(color);
          onColorChange(status.id, color);
        }}
      />

      {/* Name */}
      <Input
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => {
          if (localName.trim() && localName.trim() !== status.name) onRename(status.id, localName.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-7 flex-1 text-sm"
      />

      {/* Value badge (read-only) */}
      <span className="hidden sm:inline text-xs font-mono text-muted-foreground/60 shrink-0">{status.value}</span>

      {/* Active toggle */}
      <button
        onClick={() => onToggleActive(status.id, !status.isActive)}
        title={status.isActive ? "Deactivate" : "Activate"}
        className={`shrink-0 transition-colors ${status.isActive ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
      >
        {status.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>

      {/* Delete */}
      <button
        onClick={() => onDelete(status.id)}
        title="Delete status"
        className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>
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

  // Local ordered list for optimistic reordering
  const [orderedIds, setOrderedIds] = useState<string[]>(() => statuses.map((s) => s.id));

  // Keep orderedIds in sync when external data changes (e.g. after creation/deletion)
  useEffect(() => {
    setOrderedIds(statuses.map((s) => s.id));
  }, [statuses.map((s) => s.id).join(",")]);

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
    const oldIndex = orderedIds.indexOf(active.id as string);
    const newIndex = orderedIds.indexOf(over.id as string);
    const next = arrayMove(orderedIds, oldIndex, newIndex);
    setOrderedIds(next);
    reorderMutation.mutate(next);
  }

  const sortedStatuses = orderedIds
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Task Statuses</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drag to reorder. Deactivate to hide without deleting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddHumanApprovalStep}
            disabled={createMutation.isPending}
            className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/50"
          >
            <UserCheck className="h-3.5 w-3.5 mr-1" />
            Add Approval Step
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Status
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
            <Input
              placeholder="Status name"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleAddStatus()}
            />
            <Input
              placeholder="value_key"
              value={newValue}
              onChange={(e) => { setNewValue(e.target.value); setValueError(""); }}
              className="h-8 text-xs font-mono w-32 shrink-0"
              onKeyDown={(e) => e.key === "Enter" && handleAddStatus()}
            />
          </div>
          {valueError && <p className="text-xs text-destructive">{valueError}</p>}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddStatus} disabled={createMutation.isPending}>
              Create
            </Button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {sortedStatuses.map((s) => (
              <StatusRow
                key={s.id}
                status={s}
                onRename={(id, name) => updateMutation.mutate({ id, data: { name } })}
                onColorChange={(id, color) => updateMutation.mutate({ id, data: { color } })}
                onToggleActive={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                onDelete={(id) => deleteMutation.mutate(id)}
                onUpdateApprovers={(id, approverUserIds) => updateMutation.mutate({ id, data: { approverUserIds } })}
                allUsers={allUsers}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
