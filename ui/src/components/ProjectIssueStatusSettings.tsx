import { useState, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { GripVertical, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { ColorPickerPopover } from "./ColorPickerPopover";
import type { ProjectIssueStatus } from "@paperclipai/shared";

interface Props {
  projectId: string;
  statuses: ProjectIssueStatus[];
}

/* ── Single row ── */

function StatusRow({
  status,
  onRename,
  onColorChange,
  onToggleActive,
  onDelete,
}: {
  status: ProjectIssueStatus;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id });
  const [localName, setLocalName] = useState(status.name);

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 ${isDragging ? "opacity-40" : ""}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0">
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Color picker */}
      <ColorPickerPopover
        value={status.color ?? "#6b7280"}
        onChange={(color) => onColorChange(status.id, color)}
      >
        <span
          className="inline-flex h-5 w-5 rounded-full border-2 cursor-pointer hover:ring-2 hover:ring-foreground/30 transition-[box-shadow]"
          style={{ borderColor: status.color ?? "#6b7280", backgroundColor: (status.color ?? "#6b7280") + "40" }}
          title="Change color"
        />
      </ColorPickerPopover>

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

  // Local ordered list for optimistic reordering
  const [orderedIds, setOrderedIds] = useState<string[]>(() => statuses.map((s) => s.id));

  // Keep orderedIds in sync when external data changes (e.g. after creation/deletion)
  const statusIdKey = useMemo(() => statuses.map((s) => s.id).join(","), [statuses]);
  useEffect(() => {
    setOrderedIds(statuses.map((s) => s.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusIdKey]);

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
        <Button size="sm" variant="outline" onClick={() => setShowAddForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Status
        </Button>
      </div>

      {showAddForm && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ColorPickerPopover value={newColor} onChange={setNewColor}>
              <span
                className="inline-flex h-6 w-6 rounded-full border-2 cursor-pointer hover:ring-2 hover:ring-foreground/30 transition-[box-shadow]"
                style={{ borderColor: newColor, backgroundColor: newColor + "40" }}
                title="Pick color"
              />
            </ColorPickerPopover>
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
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
