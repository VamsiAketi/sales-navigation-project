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
import {
  GripVertical,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  UserCheck,
  X,
  Pin,
  Lock,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { projectsApi } from "../api/projects";
import { ProjectWorkflowMap } from "./ProjectWorkflowMap";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { cn } from "@/lib/utils";
import {
  isBoardPinnedHiddenProjectIssueStatusValue,
  isFixedNameProjectIssueStatusValue,
  isMandatoryProjectIssueStatusValue,
  PROJECT_ISSUE_STATUS_ALLOWED_ACTORS,
  type ProjectIssueStatus,
} from "@paperclipai/shared";

const HUMAN_APPROVAL_COLOR = "#f59e0b";

const ALLOWED_ACTOR_LABELS: Record<(typeof PROJECT_ISSUE_STATUS_ALLOWED_ACTORS)[number], string> = {
  human_and_agent: "Human & AI",
  human_only: "Human only",
  agent_only: "AI only",
};

const SELECT_NONE = "__none__";

function transitionSummaryLine(status: ProjectIssueStatus, allStatuses: ProjectIssueStatus[]): string | null {
  const others = allStatuses.filter((s) => s.value !== status.value);
  if (others.length === 0) return null;
  const selected = status.allowedNextStatusValues ?? [];
  if (selected.length === 0) return "Any next stage";
  if (selected.length === 1) {
    const s = allStatuses.find((x) => x.value === selected[0]);
    return `Next: ${s?.name ?? selected[0]}`;
  }
  return `Next: ${selected.length} stages`;
}

function assignmentSummaryLine(
  status: ProjectIssueStatus,
  allUsers: ApproverUser[],
  agents: Array<{ id: string; name: string }>,
): string {
  const actor = ALLOWED_ACTOR_LABELS[status.allowedActors];
  const parts: string[] = [actor];
  if (status.defaultAssigneeUserId) {
    parts.push(allUsers.find((u) => u.id === status.defaultAssigneeUserId)?.name ?? "Human default");
  }
  if (status.defaultAssigneeAgentId) {
    parts.push(agents.find((a) => a.id === status.defaultAssigneeAgentId)?.name ?? "AI default");
  }
  return parts.join(" · ");
}

function normalWorkflowSummaryStrip(
  status: ProjectIssueStatus,
  allStatuses: ProjectIssueStatus[],
  allUsers: ApproverUser[],
  agents: Array<{ id: string; name: string }>,
): string {
  const t = transitionSummaryLine(status, allStatuses);
  const a = assignmentSummaryLine(status, allUsers, agents);
  return t ? `${t} · ${a}` : a;
}

/** Outline chevron control — explicit toggle so controlled open/close is reliable (not only expand). */
function WorkflowDetailsDisclosureButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className="h-9 w-9 shrink-0 shadow-xs"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Collapse workflow details" : "Expand workflow details"}
    >
      <ChevronDown
        className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
        aria-hidden
      />
    </Button>
  );
}

function humanApprovalWorkflowSummaryStrip(
  status: ProjectIssueStatus,
  allStatuses: ProjectIssueStatus[],
  allUsers: ApproverUser[],
): string {
  const ids = status.approverUserIds ?? [];
  const n = ids.length;
  let approverPart: string;
  if (n === 0) approverPart = "Add approvers (required)";
  else if (n === 1) approverPart = `Approver: ${allUsers.find((u) => u.id === ids[0])?.name ?? "1 member"}`;
  else approverPart = `${n} approvers`;
  const t = transitionSummaryLine(status, allStatuses);
  return t ? `${approverPart} · ${t}` : approverPart;
}

function HumanApprovalAssignmentNote() {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 dark:bg-muted/20">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background shadow-xs">
        <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 space-y-0.5 pt-0.5">
        <p className="text-sm font-medium text-foreground">Human-only assignment</p>
        <p className="text-sm leading-snug text-muted-foreground">
          Approval stages always use human assignees only. This policy is fixed and cannot be changed.
        </p>
      </div>
    </div>
  );
}

function AllowedNextTransitionsEditor({
  status,
  allStatuses,
  disabled,
  onWorkflowPatch,
  compactIntro = false,
}: {
  status: ProjectIssueStatus;
  allStatuses: ProjectIssueStatus[];
  disabled?: boolean;
  onWorkflowPatch: (id: string, patch: Record<string, unknown>) => void;
  /** Omit long explanatory copy (caller shows a single shared intro). */
  compactIntro?: boolean;
}) {
  const others = useMemo(
    () =>
      allStatuses
        .filter((s) => s.value !== status.value)
        .sort((a, b) => a.position - b.position),
    [allStatuses, status.value],
  );
  if (others.length === 0) return null;
  const selected = new Set(status.allowedNextStatusValues ?? []);
  const isRestricted = selected.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Outgoing transitions</h3>
          {!compactIntro ? (
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              {isRestricted
                ? "Tasks leaving this stage may only enter the destinations you select below."
                : "No restriction: any transition that passes other workflow rules is allowed. Select stages below to limit next steps."}
            </p>
          ) : null}
        </div>
        {isRestricted ? (
          <Badge
            variant="outline"
            className="h-7 shrink-0 border-amber-500/40 bg-amber-500/[0.07] px-2.5 text-xs font-medium text-amber-950 dark:text-amber-50"
          >
            Restricted
          </Badge>
        ) : null}
      </div>
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        role="group"
        aria-label="Allowed next workflow stages"
      >
        {others.map((s) => {
          const on = selected.has(s.value);
          return (
            <Tooltip key={s.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(s.value);
                    else next.add(s.value);
                    onWorkflowPatch(status.id, { allowedNextStatusValues: Array.from(next) });
                  }}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
                    on
                      ? "border-primary/40 bg-primary/8 text-foreground shadow-xs"
                      : "border-border/70 bg-card text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-xs">
                {s.value}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowActorDefaults({
  status,
  allUsers,
  agents,
  onPatch,
  disabled,
  compactIntro = false,
}: {
  status: ProjectIssueStatus;
  allUsers: ApproverUser[];
  agents: Array<{ id: string; name: string; status: string }>;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  compactIntro?: boolean;
}) {
  const actors = status.allowedActors;
  const allowUserDefault = actors !== "agent_only";
  const allowAgentDefault = actors !== "human_only";

  const humanSelectValue = status.defaultAssigneeUserId ?? SELECT_NONE;
  const agentSelectValue = status.defaultAssigneeAgentId ?? SELECT_NONE;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Assignment</h3>
        {!compactIntro ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Control who may own tasks in this stage and optional default assignees when a task enters it.
          </p>
        ) : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`wf-actors-${status.id}`} className="text-sm font-medium">
            Who can be assigned
          </Label>
          <Select
            value={actors}
            disabled={disabled}
            onValueChange={(next) => {
              const v = next as ProjectIssueStatus["allowedActors"];
              const patch: Record<string, unknown> = { allowedActors: v };
              if (v === "human_only") patch.defaultAssigneeAgentId = null;
              if (v === "agent_only") patch.defaultAssigneeUserId = null;
              onPatch(patch);
            }}
          >
            <SelectTrigger id={`wf-actors-${status.id}`} className="h-10 w-full shadow-xs" size="default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_ISSUE_STATUS_ALLOWED_ACTORS.map((v) => (
                <SelectItem key={v} value={v}>
                  {ALLOWED_ACTOR_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {allowUserDefault ? (
          <div className="space-y-2">
            <Label htmlFor={`wf-def-human-${status.id}`} className="text-sm font-medium">
              Default human assignee
            </Label>
            <Select
              value={humanSelectValue}
              disabled={disabled}
              onValueChange={(v) =>
                onPatch({
                  defaultAssigneeUserId: v === SELECT_NONE ? null : v,
                  defaultAssigneeAgentId: null,
                })
              }
            >
              <SelectTrigger id={`wf-def-human-${status.id}`} className="h-10 w-full shadow-xs" size="default">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NONE}>None</SelectItem>
                {allUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {allowAgentDefault ? (
          <div className="space-y-2">
            <Label htmlFor={`wf-def-agent-${status.id}`} className="text-sm font-medium">
              Default AI assignee
            </Label>
            <Select
              value={agentSelectValue}
              disabled={disabled}
              onValueChange={(v) =>
                onPatch({
                  defaultAssigneeAgentId: v === SELECT_NONE ? null : v,
                  defaultAssigneeUserId: null,
                })
              }
            >
              <SelectTrigger id={`wf-def-agent-${status.id}`} className="h-10 w-full shadow-xs" size="default">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NONE}>None</SelectItem>
                {agents
                  .filter((a) => a.status !== "terminated")
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
  minimumApprovers = 0,
}: {
  approverUserIds: string[];
  onAddApprover: (userId: string) => void;
  onRemoveApprover: (userId: string) => void;
  allUsers: ApproverUser[];
  /** When set, the last N approvers cannot be removed (e.g. 1 = at least one required). */
  minimumApprovers?: number;
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
    <div className="flex flex-wrap items-center gap-2">
      {approvers.map((u) => {
        const removeLocked = approverUserIds.length <= minimumApprovers;
        return (
          <span
            key={u.id}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 text-sm font-medium text-foreground shadow-xs"
          >
            {u.name}
            <button
              type="button"
              disabled={removeLocked}
              title={
                removeLocked
                  ? "At least one approver is required for human approval stages"
                  : `Remove ${u.name}`
              }
              onClick={() => {
                if (removeLocked) return;
                onRemoveApprover(u.id);
              }}
              className={cn(
                "rounded-md p-1 text-muted-foreground transition-colors",
                removeLocked
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-muted hover:text-destructive",
              )}
              aria-label={`Remove ${u.name}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border/80 bg-transparent px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4 shrink-0 opacity-70" />
            {approvers.length === 0 ? "Add approver" : "Add"}
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
  allStatuses,
  onRename,
  onColorChange,
  onToggleActive,
  onDelete,
  onUpdateApprovers,
  allUsers,
  agents,
  onWorkflowPatch,
  workflowDisabled,
}: {
  status: ProjectIssueStatus;
  allStatuses: ProjectIssueStatus[];
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onUpdateApprovers: (id: string, approverUserIds: string[]) => void;
  allUsers: ApproverUser[];
  agents: Array<{ id: string; name: string; status: string }>;
  onWorkflowPatch: (id: string, patch: Record<string, unknown>) => void;
  workflowDisabled?: boolean;
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
  const hasTransitionTargets = useMemo(
    () => allStatuses.some((s) => s.value !== status.value),
    [allStatuses, status.value],
  );
  const [workflowOpen, setWorkflowOpen] = useState(false);

  if (status.isHumanApproval) {
    const summaryStrip = humanApprovalWorkflowSummaryStrip(status, allStatuses, allUsers);
    return (
      <div ref={setNodeRef} style={style}>
        <Collapsible open={workflowOpen} onOpenChange={setWorkflowOpen}>
          <Card
            className={cn(
              "gap-0 overflow-hidden py-0 shadow-sm transition-[opacity,box-shadow]",
              "border-l-[3px] border-l-amber-500/50 dark:border-l-amber-500/40",
              isDragging && "opacity-60 ring-2 ring-ring/25",
            )}
          >
            <div className="border-b border-border/60 bg-muted/30 dark:bg-muted/15">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  {...attributes}
                  {...listeners}
                  className="flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground active:cursor-grabbing"
                  aria-label="Drag to reorder"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
                <WorkflowDetailsDisclosureButton
                  open={workflowOpen}
                  onToggle={() => setWorkflowOpen((o) => !o)}
                />
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 dark:bg-amber-500/15"
                  title="Human approval"
                >
                  <UserCheck className="h-4 w-4 text-amber-800 dark:text-amber-300" />
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
                    "h-9 min-w-0 flex-1 border-input bg-background text-sm shadow-xs",
                    nameLocked && "cursor-not-allowed bg-muted/50 text-muted-foreground",
                  )}
                />
                <Badge
                  variant="outline"
                  className="hidden h-8 max-w-34 shrink-0 truncate border-border/60 font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
                  title={status.value}
                >
                  {status.value}
                </Badge>
                <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => onToggleActive(status.id, !status.isActive)}
                    title={status.isActive ? "Hide from Board" : "Show on Board"}
                  >
                    {status.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 opacity-60" />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    disabled={deleteDisabled}
                    onClick={() => onDelete(status.id)}
                    title={
                      deleteDisabled
                        ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
                        : "Delete status"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {!workflowOpen ? (
                <div className="border-t border-border/40 bg-muted/10 px-4 py-2.5 text-sm text-muted-foreground dark:bg-muted/5">
                  <p className="truncate" title={summaryStrip}>
                    {summaryStrip}
                  </p>
                </div>
              ) : null}
            </div>
            <CollapsibleContent>
              <CardContent className="space-y-6 px-4 py-5 sm:px-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Configure who may approve and, if needed, which stages tasks may enter after this step.
                </p>
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">
                    Approvers
                    <span className="ml-1 font-normal text-destructive">*</span>
                  </Label>
                  <ApproverPicker
                    approverUserIds={status.approverUserIds ?? []}
                    allUsers={allUsers}
                    minimumApprovers={1}
                    onAddApprover={(userId) =>
                      onUpdateApprovers(status.id, [...(status.approverUserIds ?? []), userId])
                    }
                    onRemoveApprover={(userId) =>
                      onUpdateApprovers(status.id, (status.approverUserIds ?? []).filter((id) => id !== userId))
                    }
                  />
                </div>
                <Separator className="bg-border/60" />
                <HumanApprovalAssignmentNote />
                {hasTransitionTargets ? (
                  <>
                    <Separator className="bg-border/60" />
                    <AllowedNextTransitionsEditor
                      status={status}
                      allStatuses={allStatuses}
                      disabled={workflowDisabled}
                      onWorkflowPatch={onWorkflowPatch}
                      compactIntro
                    />
                  </>
                ) : null}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    );
  }

  const summaryStrip = normalWorkflowSummaryStrip(status, allStatuses, allUsers, agents);

  return (
    <div ref={setNodeRef} style={style}>
      <Collapsible open={workflowOpen} onOpenChange={setWorkflowOpen}>
        <Card
          className={cn(
            "gap-0 overflow-hidden py-0 shadow-sm transition-[opacity,box-shadow]",
            isDragging && "opacity-60 ring-2 ring-ring/25",
          )}
        >
          <div className="border-b border-border/60 bg-muted/30 dark:bg-muted/15">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                {...attributes}
                {...listeners}
                className="flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground active:cursor-grabbing"
                aria-label="Drag to reorder"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <WorkflowDetailsDisclosureButton
                open={workflowOpen}
                onToggle={() => setWorkflowOpen((o) => !o)}
              />
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
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className={cn(
                  "h-9 min-w-0 flex-1 border-input bg-background text-sm shadow-xs",
                  nameLocked && "cursor-not-allowed bg-muted/50 text-muted-foreground",
                )}
              />
              <Badge
                variant="outline"
                className="hidden h-8 max-w-34 shrink-0 truncate border-border/60 font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
                title={status.value}
              >
                {status.value}
              </Badge>
              <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={() => onToggleActive(status.id, !status.isActive)}
                  title={status.isActive ? "Hide from Board" : "Show on Board"}
                >
                  {status.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 opacity-60" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  disabled={deleteDisabled}
                  onClick={() => onDelete(status.id)}
                  title={
                    deleteDisabled
                      ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
                      : "Delete status"
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!workflowOpen ? (
              <div className="border-t border-border/40 bg-muted/10 px-4 py-2.5 text-sm text-muted-foreground dark:bg-muted/5">
                <p className="truncate" title={summaryStrip}>
                  {summaryStrip}
                </p>
              </div>
            ) : null}
          </div>
          <CollapsibleContent>
            <CardContent className="space-y-6 px-4 py-5 sm:px-5">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Choose allowed next stages and who may own tasks while they are in this stage.
              </p>
              {hasTransitionTargets ? (
                <>
                  <AllowedNextTransitionsEditor
                    status={status}
                    allStatuses={allStatuses}
                    disabled={workflowDisabled}
                    onWorkflowPatch={onWorkflowPatch}
                    compactIntro
                  />
                  <Separator className="bg-border/60" />
                </>
              ) : null}
              <WorkflowActorDefaults
                status={status}
                allUsers={allUsers}
                agents={agents}
                disabled={workflowDisabled}
                onPatch={(patch) => onWorkflowPatch(status.id, patch)}
                compactIntro
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

/** Backlog: pinned first, never on the board — no drag handle, visibility toggle disabled. */
function BacklogWorkflowStatusRow({
  status,
  allStatuses,
  onRename,
  onColorChange,
  onDelete,
  allUsers,
  agents,
  onWorkflowPatch,
  workflowDisabled,
}: {
  status: ProjectIssueStatus;
  allStatuses: ProjectIssueStatus[];
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  allUsers: ApproverUser[];
  agents: Array<{ id: string; name: string; status: string }>;
  onWorkflowPatch: (id: string, patch: Record<string, unknown>) => void;
  workflowDisabled?: boolean;
}) {
  const [localName, setLocalName] = useState(status.name);
  const [localColor, setLocalColor] = useState(status.color);
  const deleteDisabled = isMandatoryProjectIssueStatusValue(status.value);
  const nameLocked = isFixedNameProjectIssueStatusValue(status.value);

  useEffect(() => {
    if (!nameLocked) setLocalName(status.name);
  }, [status.name, status.id, nameLocked]);

  const hasTransitionTargets = useMemo(
    () => allStatuses.some((s) => s.value !== status.value),
    [allStatuses, status.value],
  );
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const summaryStrip = normalWorkflowSummaryStrip(status, allStatuses, allUsers, agents);

  return (
    <Collapsible open={workflowOpen} onOpenChange={setWorkflowOpen}>
      <Card
        className={cn(
          "gap-0 overflow-hidden border-l-2 border-l-primary/25 bg-muted/20 py-0 shadow-sm dark:bg-muted/10",
        )}
      >
        <div className="border-b border-border/60 bg-muted/40 dark:bg-muted/25">
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground"
              title="Backlog stays first and is not shown on the board"
            >
              <Pin className="h-4 w-4" aria-hidden />
            </div>
            <WorkflowDetailsDisclosureButton
              open={workflowOpen}
              onToggle={() => setWorkflowOpen((o) => !o)}
            />
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
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className={cn(
                "h-9 min-w-0 flex-1 border-input bg-background text-sm shadow-xs",
                nameLocked && "cursor-not-allowed bg-muted/50 text-muted-foreground",
              )}
            />
            <Badge
              variant="outline"
              className="hidden h-8 max-w-34 shrink-0 truncate border-border/60 font-mono text-[11px] font-normal text-muted-foreground sm:inline-flex"
              title={status.value}
            >
              {status.value}
            </Badge>
            <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-3">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-9 w-9 text-muted-foreground"
                disabled
                title="Backlog is always hidden from the board"
              >
                <EyeOff className="h-4 w-4 opacity-60" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                disabled={deleteDisabled}
                onClick={() => onDelete(status.id)}
                title={
                  deleteDisabled
                    ? "Backlog, Todo, Done, and Cancelled are required — cannot be deleted"
                    : "Delete status"
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {!workflowOpen ? (
            <div className="border-t border-border/40 bg-muted/10 px-4 py-2.5 text-sm text-muted-foreground dark:bg-muted/5">
              <p className="truncate" title={summaryStrip}>
                {summaryStrip}
              </p>
            </div>
          ) : null}
        </div>
        <CollapsibleContent>
          <CardContent className="space-y-6 px-4 py-5 sm:px-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Choose allowed next stages and who may own tasks while they are in backlog.
            </p>
            {hasTransitionTargets ? (
              <>
                <AllowedNextTransitionsEditor
                  status={status}
                  allStatuses={allStatuses}
                  disabled={workflowDisabled}
                  onWorkflowPatch={onWorkflowPatch}
                  compactIntro
                />
                <Separator className="bg-border/60" />
              </>
            ) : null}
            <WorkflowActorDefaults
              status={status}
              allUsers={allUsers}
              agents={agents}
              disabled={workflowDisabled}
              onPatch={(patch) => onWorkflowPatch(status.id, patch)}
              compactIntro
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ── Main component ── */

export function ProjectIssueStatusSettings({ projectId, statuses }: Props) {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const companyId = selectedCompanyId ?? undefined;

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(companyId!),
    queryFn: () => accessApi.listMembers(companyId!),
    enabled: !!companyId,
  });

  const { data: agentsList } = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });

  const workflowAgents = useMemo(
    () => (agentsList ?? []).filter((a) => a.status !== "terminated"),
    [agentsList],
  );

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
  const [addApprovalDialogOpen, setAddApprovalDialogOpen] = useState(false);
  const [approvalSearch, setApprovalSearch] = useState("");
  const [approvalSelectedIds, setApprovalSelectedIds] = useState<string[]>([]);

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

  const approvalDialogUsersFiltered = useMemo(() => {
    const q = approvalSearch.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [allUsers, approvalSearch]);

  function toggleApprovalUserPick(userId: string) {
    setApprovalSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  }

  function submitAddHumanApprovalStep() {
    if (approvalSelectedIds.length < 1) return;
    const existingApprovalCount = statuses.filter((s) => s.isHumanApproval).length;
    const suffix = existingApprovalCount > 0 ? `_${existingApprovalCount + 1}` : "";
    createMutation.mutate(
      {
        name: "Human Approval",
        value: `human_approval${suffix}`,
        color: HUMAN_APPROVAL_COLOR,
        isHumanApproval: true,
        allowedActors: "human_only",
        approverUserIds: approvalSelectedIds,
        defaultAssigneeAgentId: null,
      },
      {
        onSuccess: () => {
          setAddApprovalDialogOpen(false);
          setApprovalSelectedIds([]);
          setApprovalSearch("");
        },
        onError: () => {
          pushToast({
            title: "Could not add approval step",
            body: "Choose at least one active member, then try again.",
            tone: "error",
          });
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
    <TooltipProvider delayDuration={300}>
    <Dialog
      open={addApprovalDialogOpen}
      onOpenChange={(open) => {
        setAddApprovalDialogOpen(open);
        if (!open) {
          setApprovalSelectedIds([]);
          setApprovalSearch("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add human approval step</DialogTitle>
          <DialogDescription>
            Approval stages are human-only. Select one or more people who may approve work in this stage.
          </DialogDescription>
        </DialogHeader>
        {allUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add active members to this company before creating an approval step.
          </p>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Search members…"
              value={approvalSearch}
              onChange={(e) => setApprovalSearch(e.target.value)}
              className="h-9 text-sm"
              autoComplete="off"
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border/60 p-1">
              {approvalDialogUsersFiltered.map((u) => {
                const checked = approvalSelectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleApprovalUserPick(u.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-sm transition-colors",
                      checked ? "bg-primary/10" : "hover:bg-muted/60",
                    )}
                  >
                    <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    </span>
                  </button>
                );
              })}
              {approvalDialogUsersFiltered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matching members.</p>
              ) : null}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setAddApprovalDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              createMutation.isPending || allUsers.length === 0 || approvalSelectedIds.length < 1
            }
            onClick={submitAddHumanApprovalStep}
          >
            {createMutation.isPending ? "Adding…" : "Add step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Card className="gap-0 overflow-hidden border-border/60 py-0 shadow-sm">
      <CardHeader className="space-y-4 border-b border-border/60 bg-muted/15 pb-6 pt-6 dark:bg-muted/10 sm:space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-lg tracking-tight">Task statuses</CardTitle>
          <CardDescription className="max-w-2xl text-pretty leading-relaxed">
            Configure stages, who may be assigned, and optional transition rules. Reorder with the handle; Backlog stays first and is list-only; hide a stage from the board without losing history. Use the chevron button on each stage to expand or collapse transitions and assignment; collapsed stages show a short summary below the title row.
          </CardDescription>
        </div>
        <CardAction className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-2"
            onClick={() => {
              setApprovalSelectedIds([]);
              setApprovalSearch("");
              setAddApprovalDialogOpen(true);
            }}
            disabled={createMutation.isPending}
          >
            <UserCheck className="h-4 w-4" />
            Add approval step
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-9 gap-2"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            Add status
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4 py-6">
      <ProjectWorkflowMap statuses={statuses} />
      {showAddForm && (
        <div className="rounded-lg border border-border/60 bg-muted/15 p-4 space-y-3 dark:bg-muted/10">
          <p className="text-xs font-semibold text-foreground">New status</p>
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

      <div className="space-y-3">
        {backlogStatus ? (
          <BacklogWorkflowStatusRow
            status={backlogStatus}
            allStatuses={statuses}
            onRename={(id, name) => updateMutation.mutate({ id, data: { name } })}
            onColorChange={(id, color) => updateMutation.mutate({ id, data: { color } })}
            onDelete={(id) => deleteMutation.mutate(id)}
            allUsers={allUsers}
            agents={workflowAgents}
            onWorkflowPatch={(id, patch) => updateMutation.mutate({ id, data: patch })}
            workflowDisabled={updateMutation.isPending}
          />
        ) : null}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedNonBacklogIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sortedDraggableStatuses.map((s) => (
                <StatusRow
                  key={s.id}
                  status={s}
                  allStatuses={statuses}
                  onRename={(id, name) => updateMutation.mutate({ id, data: { name } })}
                  onColorChange={(id, color) => updateMutation.mutate({ id, data: { color } })}
                  onToggleActive={(id, isActive) => updateMutation.mutate({ id, data: { isActive } })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onUpdateApprovers={(id, approverUserIds) =>
                    updateMutation.mutate({ id, data: { approverUserIds } })
                  }
                  allUsers={allUsers}
                  agents={workflowAgents}
                  onWorkflowPatch={(id, patch) => updateMutation.mutate({ id, data: patch })}
                  workflowDisabled={updateMutation.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}
