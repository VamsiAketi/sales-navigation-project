import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { Link } from "@/lib/router";
import { IssueLink } from "./IssueLink";
import type { Issue } from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { instanceSettingsApi } from "../api/instanceSettings";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { useProjectIssueStatuses } from "../hooks/useProjectIssueStatuses";
import { getRecentAssigneeIds, sortAgentsByRecency, trackRecentAssignee } from "../lib/recent-assignees";
import { formatAssigneeUserLabel } from "../lib/assignees";
import { assigneeUpdateErrorMessage } from "../lib/permission-feedback";
import { toggleIssueLabelSelection } from "../lib/issue-labels-state";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Identity } from "./Identity";
import { projectStatusSwatchClass } from "../lib/status-colors";
import { formatDate, cn, projectUrl } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User, Hexagon, ArrowUpRight, Tag, Plus, Trash2, Copy, Check, Loader2, X, Target, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { AgentIcon } from "./AgentIconPicker";

/** Color swatches for label creation — excludes white and very light colors. */
const LABEL_PALETTE = [
  ["#ddd6fe", "#fbcfe8", "#fda4af", "#fed7aa", "#fde68a", "#a7f3d0", "#99f6e4", "#bae6fd", "#bfdbfe", "#c7d2fe"],
  ["#a78bfa", "#f472b6", "#fb7185", "#fb923c", "#fbbf24", "#34d399", "#2dd4bf", "#38bdf8", "#60a5fa", "#818cf8"],
  ["#7c3aed", "#db2777", "#e11d48", "#ea580c", "#d97706", "#059669", "#0d9488", "#0284c7", "#2563eb", "#4f46e5"],
];

function ColorSwatchPickerInline({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="space-y-1">
      {LABEL_PALETTE.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => onChange(color)}
              className={cn(
                "h-5 w-5 rounded-full shrink-0 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                value === color && "ring-2 ring-ring ring-offset-1 scale-110",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const EXECUTION_WORKSPACE_OPTIONS = [
  { value: "shared_workspace", label: "Project default" },
  { value: "isolated_workspace", label: "New isolated workspace" },
  { value: "reuse_existing", label: "Reuse existing workspace" },
] as const;

function defaultProjectWorkspaceIdForProject(project: {
  workspaces?: Array<{ id: string; isPrimary: boolean }>;
  executionWorkspacePolicy?: { defaultProjectWorkspaceId?: string | null } | null;
} | null | undefined) {
  if (!project) return null;
  return project.executionWorkspacePolicy?.defaultProjectWorkspaceId
    ?? project.workspaces?.find((workspace) => workspace.isPrimary)?.id
    ?? project.workspaces?.[0]?.id
    ?? null;
}

function defaultExecutionWorkspaceModeForProject(project: { executionWorkspacePolicy?: { enabled?: boolean; defaultMode?: string | null } | null } | null | undefined) {
  const defaultMode = project?.executionWorkspacePolicy?.enabled ? project.executionWorkspacePolicy.defaultMode : null;
  if (defaultMode === "isolated_workspace" || defaultMode === "operator_branch") return defaultMode;
  if (defaultMode === "adapter_default") return "agent_default";
  return "shared_workspace";
}

function issueModeForExistingWorkspace(mode: string | null | undefined) {
  if (mode === "isolated_workspace" || mode === "operator_branch" || mode === "shared_workspace") return mode;
  if (mode === "adapter_managed" || mode === "cloud_sandbox") return "agent_default";
  return "shared_workspace";
}

function projectGoalIdSetFromProject(
  project:
    | { goals?: Array<{ id: string }>; goalIds?: string[]; goalId?: string | null }
    | null
    | undefined,
) {
  const ids = [
    ...(project?.goalId ? [project.goalId] : []),
    ...(project?.goalIds ?? []),
    ...((project?.goals ?? []).map((goal) => goal.id)),
  ].filter(Boolean);
  return new Set(ids);
}

function shouldPresentExistingWorkspaceSelection(issue: Issue) {
  const persistedMode =
    issue.currentExecutionWorkspace?.mode
    ?? issue.executionWorkspaceSettings?.mode
    ?? issue.executionWorkspacePreference;
  return Boolean(
    issue.executionWorkspaceId &&
    (persistedMode === "isolated_workspace" || persistedMode === "operator_branch"),
  );
}

interface IssuePropertiesProps {
  issue: Issue;
  onUpdate: (data: Record<string, unknown>) => Promise<unknown>;
  inline?: boolean;
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 w-20">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Renders a Popover on desktop, or an inline collapsible section on mobile (inline mode). */
function PropertyPicker({
  inline,
  label,
  open,
  onOpenChange,
  triggerContent,
  triggerClassName,
  popoverClassName,
  popoverAlign = "end",
  extra,
  children,
}: {
  inline?: boolean;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerContent: React.ReactNode;
  triggerClassName?: string;
  popoverClassName?: string;
  popoverAlign?: "start" | "center" | "end";
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const btnCn = cn(
    "inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors",
    triggerClassName,
  );

  if (inline) {
    return (
      <div>
        <PropertyRow label={label}>
          <button className={btnCn} onClick={() => onOpenChange(!open)}>
            {triggerContent}
          </button>
          {extra}
        </PropertyRow>
        {open && (
          <div className={cn("rounded-md border border-border bg-popover p-1 mb-2", popoverClassName)}>
            {children}
          </div>
        )}
      </div>
    );
  }

  return (
    <PropertyRow label={label}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button className={btnCn}>{triggerContent}</button>
        </PopoverTrigger>
        <PopoverContent className={cn("p-1", popoverClassName)} align={popoverAlign} collisionPadding={16}>
          {children}
        </PopoverContent>
      </Popover>
      {extra}
    </PropertyRow>
  );
}

/** Splits a string at `/` and `-` boundaries, inserting <wbr> for natural line breaks. */
function BreakablePath({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  // Split on path separators and hyphens, keeping them in the output
  const segments = text.split(/(?<=[\/-])/);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) parts.push(<wbr key={i} />);
    parts.push(segments[i]);
  }
  return <>{parts}</>;
}

function issuePlanningDateInputValue(value: Date | string | null | undefined): string {
  if (value == null) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function openNativeDatePicker(input: HTMLInputElement): void {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  if (typeof pickerInput.showPicker !== "function") return;
  try {
    pickerInput.showPicker();
  } catch {
    // Ignore browsers that block showPicker in some interaction states.
  }
}

const nativeDateLeftClass = cn(
  "min-w-0 w-full max-w-[7rem] bg-transparent text-sm outline-none",
  "relative pl-[1.35rem]",
  "[&::-webkit-calendar-picker-indicator]:absolute",
  "[&::-webkit-calendar-picker-indicator]:left-[0.15rem]",
  "[&::-webkit-calendar-picker-indicator]:right-auto",
  "[&::-webkit-calendar-picker-indicator]:m-0",
  "[&::-webkit-calendar-picker-indicator]:p-0",
);

function truncateProjectDisplayName(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "None";
  return text.length > 11 ? `${text.slice(0, 8)}...` : text;
}

function truncateGoalDisplayName(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "No goal";
  return text.length > 11 ? `${text.slice(0, 8)}...` : text;
}

function fullDisplayNameTitle(value: string | null | undefined): string | undefined {
  const text = (value ?? "").trim();
  return text.length > 11 ? text : undefined;
}

/** Displays a value with a copy-to-clipboard icon and "Copied!" feedback. */
function CopyableValue({ value, label, mono, className }: { value: string; label?: string; mono?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }, [value]);

  return (
    <div className={cn("flex items-start gap-1 group", className)}>
      <span className="min-w-0" style={{ overflowWrap: "anywhere" }}>
        {label && <span className="text-muted-foreground">{label} </span>}
        <span className={mono ? "font-mono" : undefined}><BreakablePath text={value} /></span>
      </span>
      <button
        type="button"
        className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

/** Unselected label row — click to add to task, hover-trash to delete the label definition. */
function LabelUnselectedRow({
  label,
  disabled,
  confirmingDelete,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  label: { id: string; name: string; color: string; usageCount?: number };
  disabled: boolean;
  confirmingDelete: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const isUsed = (label.usageCount ?? 0) > 0;
  return (
    <div className="group">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 px-2 py-1.5 text-xs rounded text-left hover:bg-accent/50 disabled:opacity-50"
          onClick={onSelect}
          disabled={disabled}
        >
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
          <span className="truncate">{label.name}</span>
        </button>
        <button
          type="button"
          className={cn(
            "p-1 rounded transition-opacity opacity-0 group-hover:opacity-100",
            isUsed ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-destructive",
          )}
          onClick={!isUsed ? onRequestDelete : undefined}
          title={isUsed ? `Used in ${label.usageCount} task${label.usageCount === 1 ? "" : "s"} — cannot delete` : `Delete "${label.name}"`}
          disabled={disabled || isUsed}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {confirmingDelete && (
        <div className="flex items-center gap-1 mt-0.5 px-2 py-1 rounded border border-destructive/30 bg-destructive/5">
          <span className="flex-1 text-[11px] text-destructive">Delete "{label.name}"? Removes from all tasks.</span>
          <button type="button" className="px-1.5 py-0.5 text-[11px] rounded hover:bg-accent/50" onClick={onCancelDelete}>Cancel</button>
          <button type="button" className="px-1.5 py-0.5 text-[11px] rounded bg-destructive text-black dark:text-white hover:bg-destructive/90 disabled:opacity-50" onClick={onConfirmDelete} disabled={disabled}>Delete</button>
        </div>
      )}
    </div>
  );
}

export function IssueProperties({ issue, onUpdate, inline }: IssuePropertiesProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const companyId = issue.companyId ?? selectedCompanyId;
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeUpdateError, setAssigneeUpdateError] = useState<string | null>(null);
  const [assigneeUpdating, setAssigneeUpdating] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [labelDraftIds, setLabelDraftIds] = useState<string[]>(issue.labelIds ?? []);
  const [labelsSaving, setLabelsSaving] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#7c3aed");
  const [confirmDeleteLabelId, setConfirmDeleteLabelId] = useState<string | null>(null);
  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const persistedLabelSignature = (issue.labelIds ?? []).join(",");

  useEffect(() => {
    setLabelDraftIds(issue.labelIds ?? []);
    setLabelsSaving(false);
  }, [issue.id, persistedLabelSignature]);

  // Reset create-label form when popover closes
  useEffect(() => {
    if (!labelsOpen) {
      setCreateLabelOpen(false);
      setColorPickerOpen(false);
      setNewLabelName("");
      setNewLabelColor("#7c3aed");
      setConfirmDeleteLabelId(null);
      setLabelSearch("");
    }
  }, [labelsOpen]);

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId;

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });

  const { data: members, error: membersError } = useQuery({
    queryKey: queryKeys.access.members(companyId!),
    queryFn: () => accessApi.listMembers(companyId!),
    enabled: !!companyId,
  });
  const membersPermissionDenied = membersError instanceof ApiError && membersError.status === 403;

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(companyId!),
    queryFn: () => projectsApi.list(companyId!),
    enabled: !!companyId,
  });
  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archivedAt || p.id === issue.projectId),
    [projects, issue.projectId],
  );
  const { orderedProjects } = useProjectOrder({
    projects: activeProjects,
    companyId,
    userId: currentUserId,
  });

  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(companyId!),
    queryFn: () => issuesApi.listLabels(companyId!),
    enabled: !!companyId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(companyId!),
    queryFn: () => goalsApi.list(companyId!),
    enabled: !!companyId,
  });

  const [goalOpen, setGoalOpen] = useState(false);
  const [goalSearch, setGoalSearch] = useState("");

  const labelDraftIdsRef = useRef<string[]>(labelDraftIds);
  labelDraftIdsRef.current = labelDraftIds;

  const createLabel = useMutation({
    mutationFn: (data: { name: string; color: string }) => issuesApi.createLabel(companyId!, data),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.labels(companyId!) });
      const newIds = labelDraftIdsRef.current.includes(created.id)
        ? labelDraftIdsRef.current
        : [...labelDraftIdsRef.current, created.id];
      setLabelDraftIds(newIds);
      setNewLabelName("");
      try {
        await onUpdate({ labelIds: newIds });
      } catch { /* silent — issue refetch will resync state */ }
    },
  });

  const deleteLabel = useMutation({
    mutationFn: (labelId: string) => issuesApi.deleteLabel(labelId),
    onSuccess: (_, labelId) => {
      setLabelDraftIds((current) => current.filter((id) => id !== labelId));
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.labels(companyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.id) });
    },
  });

  const toggleLabel = async (labelId: string) => {
    const newIds = toggleIssueLabelSelection(labelDraftIds, labelId);
    setLabelDraftIds(newIds);
    setLabelsSaving(true);
    try {
      await onUpdate({ labelIds: newIds });
    } catch { /* silent — issue refetch will resync state */ } finally {
      setLabelsSaving(false);
    }
  };

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    const agent = agents.find((a) => a.id === id);
    return agent?.name ?? id.slice(0, 8);
  };

  const projectName = (id: string | null) => {
    if (!id) return "None";
    const project = orderedProjects.find((p) => p.id === id);
    return truncateProjectDisplayName(project?.name ?? id);
  };
  const currentProject = issue.projectId
    ? orderedProjects.find((project) => project.id === issue.projectId) ?? null
    : null;
  const projectStatuses = useProjectIssueStatuses(issue.projectId ?? null);
  const activeProjectStatuses = projectStatuses.filter((s) => s.isActive).sort((a, b) => a.position - b.position);
  const statusWorkflowMeta = useMemo(
    () => projectStatuses.find((s) => s.value === issue.status),
    [projectStatuses, issue.status],
  );
  const assigneePickerAllowsUsers = statusWorkflowMeta?.allowedActors !== "agent_only";
  const assigneePickerAllowsAgents = statusWorkflowMeta?.allowedActors !== "human_only";

  useEffect(() => {
    setStatusUpdateError(null);
  }, [issue.id, issue.assigneeAgentId, issue.assigneeUserId, issue.status]);
  const currentProjectExecutionWorkspacePolicy =
    experimentalSettings?.enableIsolatedWorkspaces === true
      ? currentProject?.executionWorkspacePolicy ?? null
      : null;
  const currentProjectSupportsExecutionWorkspace = Boolean(currentProjectExecutionWorkspacePolicy?.enabled);
  const { data: reusableExecutionWorkspaces } = useQuery({
    queryKey: queryKeys.executionWorkspaces.list(companyId!, {
      projectId: issue.projectId ?? undefined,
      projectWorkspaceId: issue.projectWorkspaceId ?? undefined,
      reuseEligible: true,
    }),
    queryFn: () =>
      executionWorkspacesApi.list(companyId!, {
        projectId: issue.projectId ?? undefined,
        projectWorkspaceId: issue.projectWorkspaceId ?? undefined,
        reuseEligible: true,
      }),
    enabled: Boolean(companyId) && Boolean(issue.projectId),
  });
  const deduplicatedReusableWorkspaces = useMemo(() => {
    const workspaces = reusableExecutionWorkspaces ?? [];
    const seen = new Map<string, typeof workspaces[number]>();
    for (const ws of workspaces) {
      const key = ws.cwd ?? ws.id;
      const existing = seen.get(key);
      if (!existing || new Date(ws.lastUsedAt) > new Date(existing.lastUsedAt)) {
        seen.set(key, ws);
      }
    }
    return Array.from(seen.values());
  }, [reusableExecutionWorkspaces]);
  const selectedReusableExecutionWorkspace =
    deduplicatedReusableWorkspaces.find((workspace) => workspace.id === issue.executionWorkspaceId)
    ?? issue.currentExecutionWorkspace
    ?? null;
  const currentExecutionWorkspaceSelection = shouldPresentExistingWorkspaceSelection(issue)
    ? "reuse_existing"
    : (
        issue.executionWorkspacePreference
        ?? issue.executionWorkspaceSettings?.mode
        ?? defaultExecutionWorkspaceModeForProject(currentProject)
      );
  const projectLink = (id: string | null) => {
    if (!id) return null;
    const project = projects?.find((p) => p.id === id) ?? null;
    return project ? projectUrl(project) : `/projects/${id}`;
  };
  const scopedProjectGoals = useMemo(() => {
    if (!issue.projectId || !currentProject) return [];
    const scopedIds = projectGoalIdSetFromProject(currentProject);
    if (scopedIds.size === 0) return [];
    const byId = new Map((goals ?? []).map((goal) => [goal.id, goal]));
    return Array.from(scopedIds)
      .map((goalId) => byId.get(goalId) ?? currentProject.goals?.find((goal) => goal.id === goalId))
      .filter((goal): goal is NonNullable<typeof goals>[number] => Boolean(goal))
      .filter((goal) => goal.status !== "cancelled");
  }, [issue.projectId, currentProject, goals]);
  const goalCandidates = useMemo(
    () => (issue.projectId ? scopedProjectGoals : (goals ?? []).filter((goal) => goal.status !== "cancelled")),
    [issue.projectId, scopedProjectGoals, goals],
  );
  const currentGoal = useMemo(
    () =>
      (goals ?? []).find((goal) => goal.id === issue.goalId)
      ?? goalCandidates.find((goal) => goal.id === issue.goalId)
      ?? null,
    [goals, goalCandidates, issue.goalId],
  );

  const recentAssigneeIds = useMemo(() => getRecentAssigneeIds(), [assigneeOpen]);
  const sortedAgents = useMemo(
    () => sortAgentsByRecency((agents ?? []).filter((a) => a.status !== "terminated"), recentAssigneeIds),
    [agents, recentAssigneeIds],
  );

  const assignee = issue.assigneeAgentId
    ? agents?.find((a) => a.id === issue.assigneeAgentId)
    : null;
  const userLabel = (userId: string | null | undefined) => {
    if (userId && userId !== currentUserId && userId !== "local-board") {
      const member = (members ?? []).find((m) => m.user?.id === userId);
      if (member?.user?.name) return member.user.name;
    }
    return formatAssigneeUserLabel(userId, currentUserId);
  };
  const assigneeUserLabel = userLabel(issue.assigneeUserId);
  const creatorUserLabel = userLabel(issue.createdByUserId);

  const selectedLabels = labelDraftIds
    .map((id) => (labels ?? []).find((label) => label.id === id) ?? (issue.labels ?? []).find((label) => label.id === id))
    .filter((label): label is NonNullable<Issue["labels"]>[number] => Boolean(label));

  const labelsTrigger = selectedLabels.length > 0 ? (
    <div className="flex items-center gap-1 flex-wrap">
      {selectedLabels.slice(0, 3).map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border"
          style={{
            borderColor: label.color,
            backgroundColor: `${label.color}22`,
            color: pickTextColorForPillBg(label.color, 0.13),
          }}
        >
          {label.name}
        </span>
      ))}
      {selectedLabels.length > 3 && (
        <span className="text-xs text-muted-foreground">+{selectedLabels.length - 3}</span>
      )}
    </div>
  ) : (
    <>
      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">No labels</span>
    </>
  );

  const unselectedLabels = (labels ?? []).filter((l) => !labelDraftIds.includes(l.id));
  const filteredUnselected = unselectedLabels.filter((l) =>
    !labelSearch.trim() || l.name.toLowerCase().includes(labelSearch.toLowerCase()),
  );
  const filteredSelected = selectedLabels.filter((l) =>
    !labelSearch.trim() || l.name.toLowerCase().includes(labelSearch.toLowerCase()),
  );

  const labelsContent = (
    <>
      {/* ── Selected tags as pills ── */}
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1.5 pt-1.5 pb-2 border-b border-border">
          {filteredSelected.map((label) => {
            const isUsed = (label.usageCount ?? 0) > 0;
            return (
              <span
                key={label.id}
                className="group/pill inline-flex items-center gap-0.5 rounded-full pl-2 pr-1 py-0.5 text-xs font-medium border"
                style={{
                  borderColor: label.color,
                  backgroundColor: `${label.color}22`,
                  color: pickTextColorForPillBg(label.color, 0.13),
                }}
              >
                {label.name}
                {/* × removes from task */}
                <button
                  type="button"
                  className="ml-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors"
                  onClick={() => void toggleLabel(label.id)}
                  disabled={labelsSaving}
                  title={`Remove from task`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                {/* 🗑 deletes the label definition — hover only */}
                {/* <button
                  type="button"
                  className={cn(
                    "p-0.5 rounded-full transition-all opacity-0 group-hover/pill:opacity-100",
                    isUsed ? "cursor-not-allowed opacity-30" : "hover:bg-black/10",
                  )}
                  onClick={!isUsed ? () => setConfirmDeleteLabelId(label.id) : undefined}
                  disabled={deleteLabel.isPending || isUsed}
                  title={isUsed ? `Used in ${label.usageCount} task${label.usageCount === 1 ? "" : "s"} — cannot delete` : `Delete tag "${label.name}"`}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button> */}
              </span>
            );
          })}
          {labelsSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground self-center" />}
        </div>
      )}

      {/* Inline delete confirmation for a selected pill */}
      {confirmDeleteLabelId && labelDraftIds.includes(confirmDeleteLabelId) && (
        <div className="flex items-center gap-1 mx-1.5 mb-1 px-2 py-1 rounded border border-destructive/30 bg-destructive/5">
          <span className="flex-1 text-[11px] text-destructive truncate">
            Delete "{(labels ?? []).find((l) => l.id === confirmDeleteLabelId)?.name}"? Removes from all tasks.
          </span>
          <button type="button" className="shrink-0 px-1.5 py-0.5 text-[11px] rounded hover:bg-accent/50" onClick={() => setConfirmDeleteLabelId(null)}>Cancel</button>
          <button type="button" className="shrink-0 px-1.5 py-0.5 text-[11px] rounded bg-destructive text-black dark:text-white hover:bg-destructive/90 disabled:opacity-50" onClick={() => { deleteLabel.mutate(confirmDeleteLabelId); setConfirmDeleteLabelId(null); }} disabled={deleteLabel.isPending}>Delete</button>
        </div>
      )}

      {/* ── Search ── */}
      <input
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border placeholder:text-muted-foreground/50"
        placeholder="Search tags…"
        value={labelSearch}
        onChange={(e) => setLabelSearch(e.target.value)}
        autoFocus={!inline}
      />

      {/* ── Unselected tags list ── */}
      <div className="max-h-40 overflow-y-auto overscroll-contain space-y-0.5 py-1">
        {filteredUnselected.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-2 py-1">
            {labelSearch.trim() ? "No matching tags" : selectedLabels.length > 0 ? "All tags selected" : "No tags yet"}
          </p>
        )}
        {filteredUnselected.map((label) => (
          <LabelUnselectedRow
            key={label.id}
            label={label}
            disabled={deleteLabel.isPending || labelsSaving}
            confirmingDelete={confirmDeleteLabelId === label.id}
            onSelect={() => void toggleLabel(label.id)}
            onRequestDelete={() => setConfirmDeleteLabelId(label.id)}
            onCancelDelete={() => setConfirmDeleteLabelId(null)}
            onConfirmDelete={() => { deleteLabel.mutate(label.id); setConfirmDeleteLabelId(null); }}
          />
        ))}
      </div>

      {/* ── Create tag — collapsible ── */}
      <div className="border-t border-border">
        <button
          type="button"
          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={() => setCreateLabelOpen((v) => !v)}
        >
          {createLabelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Plus className="h-3 w-3" />
          <span className="font-medium">Create tag</span>
        </button>

        {createLabelOpen && (
          <div className="px-2 pb-2 space-y-2">
            <div className="flex items-center gap-1.5">
              {/* Color dot — click to open palette */}
              <button
                type="button"
                onClick={() => setColorPickerOpen((v) => !v)}
                title="Pick color"
                className="h-6 w-6 rounded-full shrink-0 border-2 hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                style={{ borderColor: newLabelColor, backgroundColor: `${newLabelColor}55` }}
              />
              <input
                className="flex-1 px-2 py-1.5 text-xs bg-transparent outline outline-1 outline-border rounded placeholder:text-muted-foreground/50"
                placeholder="Tag name…"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLabelName.trim() && !createLabel.isPending) {
                    createLabel.mutate({ name: newLabelName.trim(), color: newLabelColor });
                  }
                }}
                autoFocus
              />
            </div>

            {/* Palette — only when color dot clicked */}
            {colorPickerOpen && (
              <ColorSwatchPickerInline
                value={newLabelColor}
                onChange={(c) => { setNewLabelColor(c); setColorPickerOpen(false); }}
              />
            )}

            <button
              className="flex items-center justify-center gap-1.5 w-full px-2 py-1.5 text-xs rounded border border-border text-white hover:brightness-105 active:brightness-95 disabled:opacity-100"
              style={{ backgroundColor: "#6569E1" }}
              disabled={!newLabelName.trim() || createLabel.isPending || labelsSaving}
              onClick={() => createLabel.mutate({ name: newLabelName.trim(), color: newLabelColor })}
            >
              {createLabel.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {createLabel.isPending ? "Creating…" : "Create tag"}
            </button>

            {createLabel.isError && (
              <div className="text-[11px] text-destructive">
                {createLabel.error instanceof Error ? createLabel.error.message : "Failed to create tag."}
              </div>
            )}
          </div>
        )}

        {deleteLabel.isError && (
          <div className="text-[11px] text-destructive px-2 pb-1">
            {deleteLabel.error instanceof Error ? deleteLabel.error.message : "Failed to delete tag."}
          </div>
        )}
      </div>
    </>
  );

  const assigneeTrigger = assignee ? (
    <span className="min-w-0" title={assignee.name}>
      <Identity name={assignee.name} size="sm" />
    </span>
  ) : assigneeUserLabel ? (
    <>
      <User className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm truncate" title={assigneeUserLabel}>{assigneeUserLabel}</span>
    </>
  ) : (
    <>
      <User className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Unassigned</span>
    </>
  );

  const assigneeContent = (
    <>
      <input
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
        placeholder="Search assignees..."
        value={assigneeSearch}
        onChange={(e) => setAssigneeSearch(e.target.value)}
        autoFocus={!inline}
      />
      <div className="max-h-48 overflow-y-auto overscroll-contain">
        <button
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
            !issue.assigneeAgentId && !issue.assigneeUserId && "bg-accent"
          )}
          disabled={assigneeUpdating}
          onClick={async () => {
            setAssigneeUpdateError(null);
            setAssigneeUpdating(true);
            try {
              await onUpdate({ assigneeAgentId: null, assigneeUserId: null });
              setAssigneeOpen(false);
            } catch (error) {
              setAssigneeUpdateError(assigneeUpdateErrorMessage(error));
            } finally {
              setAssigneeUpdating(false);
            }
          }}
        >
          No assignee
        </button>
        {assigneePickerAllowsUsers && currentUserId && (
          <button
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
              issue.assigneeUserId === currentUserId && "bg-accent",
            )}
            disabled={assigneeUpdating}
            onClick={async () => {
              setAssigneeUpdateError(null);
              setAssigneeUpdating(true);
              try {
                await onUpdate({ assigneeAgentId: null, assigneeUserId: currentUserId });
                setAssigneeOpen(false);
              } catch (error) {
                setAssigneeUpdateError(assigneeUpdateErrorMessage(error));
              } finally {
                setAssigneeUpdating(false);
              }
            }}
          >
            <User className="h-3 w-3 shrink-0 text-muted-foreground" />
            Assign to me
          </button>
        )}
        {assigneePickerAllowsUsers && issue.createdByUserId && issue.createdByUserId !== currentUserId && (
          <button
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
              issue.assigneeUserId === issue.createdByUserId && "bg-accent",
            )}
            disabled={assigneeUpdating}
            onClick={async () => {
              setAssigneeUpdateError(null);
              setAssigneeUpdating(true);
              try {
                await onUpdate({ assigneeAgentId: null, assigneeUserId: issue.createdByUserId });
                setAssigneeOpen(false);
              } catch (error) {
                setAssigneeUpdateError(assigneeUpdateErrorMessage(error));
              } finally {
                setAssigneeUpdating(false);
              }
            }}
          >
            <User className="h-3 w-3 shrink-0 text-muted-foreground" />
            {creatorUserLabel ? `Assign to ${creatorUserLabel}` : "Assign to requester"}
          </button>
        )}
        {assigneePickerAllowsUsers && (members ?? [])
          .filter((m) => m.principalType === "user" && m.user && m.user.id !== currentUserId && m.user.id !== issue.createdByUserId)
          .filter((m) => {
            if (!assigneeSearch.trim()) return true;
            const q = assigneeSearch.toLowerCase();
            return m.user!.name.toLowerCase().includes(q);
          })
          .map((m) => (
            <button
              key={m.user!.id}
              className={cn(
                "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                issue.assigneeUserId === m.user!.id && "bg-accent"
              )}
              disabled={assigneeUpdating}
              onClick={async () => {
                setAssigneeUpdateError(null);
                setAssigneeUpdating(true);
                try {
                  await onUpdate({ assigneeAgentId: null, assigneeUserId: m.user!.id });
                  setAssigneeOpen(false);
                } catch (error) {
                  setAssigneeUpdateError(assigneeUpdateErrorMessage(error));
                } finally {
                  setAssigneeUpdating(false);
                }
              }}
            >
              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1 text-left" title={m.user!.name}>
                {m.user!.name}
              </span>
            </button>
          ))}
        {assigneePickerAllowsAgents && sortedAgents
          .filter((a) => {
            if (!assigneeSearch.trim()) return true;
            const q = assigneeSearch.toLowerCase();
            return a.name.toLowerCase().includes(q);
          })
          .map((a) => (
          <button
            key={a.id}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
              a.id === issue.assigneeAgentId && "bg-accent"
            )}
            disabled={assigneeUpdating}
            onClick={async () => {
              setAssigneeUpdateError(null);
              setAssigneeUpdating(true);
              try {
                trackRecentAssignee(a.id);
                await onUpdate({ assigneeAgentId: a.id, assigneeUserId: null });
                setAssigneeOpen(false);
              } catch (error) {
                setAssigneeUpdateError(assigneeUpdateErrorMessage(error));
              } finally {
                setAssigneeUpdating(false);
              }
            }}
          >
            <AgentIcon icon={a.icon} className="shrink-0 h-3 w-3 text-muted-foreground" />
            <span className="truncate flex-1 text-left" title={a.name}>
              {a.name}
            </span>
          </button>
        ))}
      </div>
      {membersPermissionDenied ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground">
          You can reassign this issue, but full member directory access requires <code>users:manage_permissions</code>.
        </div>
      ) : null}
      {issue.projectId && statusWorkflowMeta && (!assigneePickerAllowsUsers || !assigneePickerAllowsAgents) ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground">
          {assigneePickerAllowsUsers && !assigneePickerAllowsAgents
            ? "This workflow status only allows AI agents to be assigned."
            : !assigneePickerAllowsUsers && assigneePickerAllowsAgents
              ? "This workflow status only allows humans to be assigned."
              : "This workflow status limits who can be assigned."}
        </div>
      ) : null}
      {assigneeUpdateError ? (
        <div className="px-2 py-1 text-[11px] text-destructive">{assigneeUpdateError}</div>
      ) : null}
    </>
  );

  const projectTrigger = issue.projectId ? (
    <>
      <span
        className={cn(
          "shrink-0 h-3 w-3 rounded-sm border border-border/40",
          projectStatusSwatchClass(orderedProjects.find((p) => p.id === issue.projectId)?.status),
        )}
      />
      <span className="text-sm truncate" title={fullDisplayNameTitle(currentProject?.name ?? issue.projectId)}>
        {projectName(issue.projectId)}
      </span>
    </>
  ) : (
    <>
      <Hexagon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">No project</span>
    </>
  );

  const projectContent = (
    <>
      <input
        className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
        placeholder="Search projects..."
        value={projectSearch}
        onChange={(e) => setProjectSearch(e.target.value)}
        autoFocus={!inline}
      />
      <div className="max-h-48 overflow-y-auto overscroll-contain">
        <button
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 whitespace-nowrap",
            !issue.projectId && "bg-accent"
          )}
          onClick={() => {
            onUpdate({
              projectId: null,
              projectWorkspaceId: null,
              executionWorkspaceId: null,
              executionWorkspacePreference: null,
              executionWorkspaceSettings: null,
            });
            setProjectOpen(false);
          }}
        >
          No project
        </button>
        {orderedProjects
          .filter((p) => {
            if (!projectSearch.trim()) return true;
            const q = projectSearch.toLowerCase();
            return p.name.toLowerCase().includes(q);
          })
          .map((p) => (
          <button
            key={p.id}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 whitespace-nowrap",
              p.id === issue.projectId && "bg-accent"
            )}
            onClick={() => {
              const defaultMode = defaultExecutionWorkspaceModeForProject(p);
              onUpdate({
                projectId: p.id,
                projectWorkspaceId: defaultProjectWorkspaceIdForProject(p),
                executionWorkspaceId: null,
                executionWorkspacePreference: defaultMode,
                executionWorkspaceSettings: p.executionWorkspacePolicy?.enabled
                  ? { mode: defaultMode }
                  : null,
              });
              setProjectOpen(false);
            }}
          >
            <span
              className={cn("shrink-0 h-3 w-3 rounded-sm border border-border/40", projectStatusSwatchClass(p.status))}
            />
            <span className="truncate" title={fullDisplayNameTitle(p.name)}>
              {truncateProjectDisplayName(p.name)}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <PropertyRow label="Status">
          <StatusIcon
            status={issue.status}
            onChange={(status) => {
              setStatusUpdateError(null);
              const movingOutOfBacklog = issue.status === "backlog" && status !== "backlog";
              const hasAssignee = Boolean(issue.assigneeAgentId || issue.assigneeUserId);
              const targetWorkflowStatus = projectStatuses.find((workflowStatus) => workflowStatus.value === status);
              const hasDefaultAssignee = Boolean(
                targetWorkflowStatus?.defaultAssigneeUserId || targetWorkflowStatus?.defaultAssigneeAgentId,
              );
              if (movingOutOfBacklog && !hasAssignee && !hasDefaultAssignee) {
                setStatusUpdateError(
                  "An Assignee is required when the task is not in backlog",
                );
                return;
              }
              void onUpdate({ status });
            }}
            projectStatuses={projectStatuses.length > 0 ? projectStatuses : undefined}
            showLabel
          />
        </PropertyRow>
        {statusUpdateError ? (
          <p className="text-[11px] text-destructive">{statusUpdateError}</p>
        ) : null}

        <PropertyRow label="Priority">
          <PriorityIcon
            priority={issue.priority}
            onChange={(priority) => onUpdate({ priority })}
            showLabel
          />
        </PropertyRow>

        <PropertyRow label="Start">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="date"
              className={nativeDateLeftClass}
              onPointerDown={(e) => openNativeDatePicker(e.currentTarget)}
              value={issuePlanningDateInputValue(issue.targetStartAt)}
              onChange={(e) => {
                const v = e.target.value;
                void onUpdate(v ? { targetStartAt: `${v}T00:00:00.000Z` } : { targetStartAt: null });
              }}
              aria-label="Planned start date"
            />
          </div>
        </PropertyRow>

        <PropertyRow label="Due">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="date"
              className={nativeDateLeftClass}
              onPointerDown={(e) => openNativeDatePicker(e.currentTarget)}
              value={issuePlanningDateInputValue(issue.dueAt)}
              onChange={(e) => {
                const v = e.target.value;
                void onUpdate(v ? { dueAt: `${v}T00:00:00.000Z` } : { dueAt: null });
              }}
              aria-label="Due date"
            />
          </div>
        </PropertyRow>

        <PropertyPicker
          inline={inline}
          label="Labels"
          open={labelsOpen}
          onOpenChange={(open) => { setLabelsOpen(open); if (!open) { setLabelSearch(""); setConfirmDeleteLabelId(null); } }}
          triggerContent={labelsTrigger}
          triggerClassName="min-w-0 w-full"
          popoverClassName="w-64"
        >
          {labelsContent}
        </PropertyPicker>

        <PropertyPicker
          inline={inline}
          label="Assignee"
          open={assigneeOpen}
          onOpenChange={(open) => { setAssigneeOpen(open); if (!open) setAssigneeSearch(""); }}
          triggerContent={assigneeTrigger}
          popoverClassName="w-52"
          extra={issue.assigneeAgentId ? (
            <Link
              to={`/agents/${issue.assigneeAgentId}`}
              className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : undefined}
        >
          {assigneeContent}
        </PropertyPicker>

        <PropertyPicker
          inline={inline}
          label="Project"
          open={projectOpen}
          onOpenChange={(open) => { setProjectOpen(open); if (!open) setProjectSearch(""); }}
          triggerContent={projectTrigger}
          triggerClassName="min-w-0 max-w-full"
          popoverClassName="w-fit min-w-[11rem]"
          extra={issue.projectId ? (
            <Link
              to={projectLink(issue.projectId)!}
              className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : undefined}
        >
          {projectContent}
        </PropertyPicker>

        {(goalCandidates.length > 0 || Boolean(issue.goalId)) && (
          <>
            {!issue.goalId && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 dark:border-amber-500/30 dark:bg-amber-950/40 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-xs text-amber-800 dark:text-amber-200">No goal linked. Assign one below.</span>
              </div>
            )}
            <PropertyPicker
              inline={inline}
              label="Goal"
              open={goalOpen}
              onOpenChange={(open) => { setGoalOpen(open); if (!open) setGoalSearch(""); }}
              triggerContent={
                issue.goalId
                  ? (
                    <>
                      <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span
                        className="text-sm truncate"
                        title={fullDisplayNameTitle(currentGoal?.title ?? issue.goalId)}
                      >
                        {truncateGoalDisplayName(currentGoal?.title ?? issue.goalId)}
                      </span>
                    </>
                    )
                  : (
                    <>
                      <Target className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-sm text-amber-600 dark:text-amber-400">No goal</span>
                    </>
                  )
              }
              extra={issue.goalId ? (
                <Link
                  to="/goals"
                  className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : undefined}
              popoverClassName="w-64"
            >
              <input
                className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                placeholder="Search goals..."
                value={goalSearch}
                onChange={(e) => setGoalSearch(e.target.value)}
                autoFocus={!inline}
              />
              <div className="max-h-48 overflow-y-auto overscroll-contain space-y-0.5">
                {goalCandidates
                  .filter((goal) => !goalSearch.trim() || goal.title.toLowerCase().includes(goalSearch.toLowerCase()))
                  .map((goal) => (
                    <button
                      key={goal.id}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                        issue.goalId === goal.id && "bg-accent",
                      )}
                      onClick={async () => {
                        await onUpdate({ goalId: goal.id });
                        setGoalOpen(false);
                      }}
                    >
                      <Target className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1 text-left" title={fullDisplayNameTitle(goal.title)}>
                        {truncateGoalDisplayName(goal.title)}
                      </span>
                      {goal.status !== "active" && (
                        <span className="text-[10px] text-muted-foreground capitalize shrink-0">{goal.status}</span>
                      )}
                      {issue.goalId === goal.id && <Check className="h-3 w-3 shrink-0" />}
                    </button>
                  ))}
                {goalCandidates.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No goals linked to this project.
                  </div>
                )}
              </div>
            </PropertyPicker>
          </>
        )}

        {currentProjectSupportsExecutionWorkspace && (
          <PropertyRow label="Workspace">
            <div className="w-full space-y-2">
              <select
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                value={currentExecutionWorkspaceSelection}
                onChange={(e) => {
                  const nextMode = e.target.value;
                  onUpdate({
                    executionWorkspacePreference: nextMode,
                    executionWorkspaceId: nextMode === "reuse_existing" ? issue.executionWorkspaceId : null,
                    executionWorkspaceSettings: {
                      mode:
                        nextMode === "reuse_existing"
                          ? issueModeForExistingWorkspace(selectedReusableExecutionWorkspace?.mode)
                          : nextMode,
                    },
                  });
                }}
              >
                {EXECUTION_WORKSPACE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === "reuse_existing" && selectedReusableExecutionWorkspace?.mode === "isolated_workspace"
                      ? "Existing isolated workspace"
                      : option.label}
                  </option>
                ))}
              </select>

              {currentExecutionWorkspaceSelection === "reuse_existing" && (
                <select
                  className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                  value={issue.executionWorkspaceId ?? ""}
                  onChange={(e) => {
                    const nextExecutionWorkspaceId = e.target.value || null;
                    const nextExecutionWorkspace = deduplicatedReusableWorkspaces.find(
                      (workspace) => workspace.id === nextExecutionWorkspaceId,
                    );
                    onUpdate({
                      executionWorkspacePreference: "reuse_existing",
                      executionWorkspaceId: nextExecutionWorkspaceId,
                      executionWorkspaceSettings: {
                        mode: issueModeForExistingWorkspace(nextExecutionWorkspace?.mode),
                      },
                    });
                  }}
                >
                  <option value="">Choose an existing workspace</option>
                  {deduplicatedReusableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name} · {workspace.status} · {workspace.branchName ?? workspace.cwd ?? workspace.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              )}

              {issue.currentExecutionWorkspace && (
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <div style={{ overflowWrap: "anywhere" }}>
                    Current:{" "}
                    <Link
                      to={`/execution-workspaces/${issue.currentExecutionWorkspace.id}`}
                      className="hover:text-foreground hover:underline"
                    >
                      <BreakablePath text={issue.currentExecutionWorkspace.name} />
                    </Link>
                    {" · "}
                    {issue.currentExecutionWorkspace.status}
                  </div>
                  {issue.currentExecutionWorkspace.cwd && (
                    <CopyableValue value={issue.currentExecutionWorkspace.cwd} mono className="text-[11px]" />
                  )}
                  {issue.currentExecutionWorkspace.branchName && (
                    <CopyableValue value={issue.currentExecutionWorkspace.branchName} label="Branch:" className="text-[11px]" />
                  )}
                  {issue.currentExecutionWorkspace.repoUrl && (
                    <CopyableValue value={issue.currentExecutionWorkspace.repoUrl} label="Repo:" mono className="text-[11px]" />
                  )}
                </div>
              )}
              {!issue.currentExecutionWorkspace && currentProject?.primaryWorkspace?.cwd && (
                <CopyableValue value={currentProject.primaryWorkspace.cwd} mono className="text-[11px] text-muted-foreground" />
              )}
            </div>
          </PropertyRow>
        )}

        {issue.parentId && (
          <PropertyRow label="Parent">
            <IssueLink
              issuePathId={issue.ancestors?.[0]?.identifier ?? issue.parentId}
              className="text-sm hover:underline"
            >
              {issue.ancestors?.[0]?.title ?? issue.parentId.slice(0, 8)}
            </IssueLink>
          </PropertyRow>
        )}

        {issue.requestDepth > 0 && (
          <PropertyRow label="Depth">
            <span className="text-sm font-mono">{issue.requestDepth}</span>
          </PropertyRow>
        )}
      </div>

      <Separator />

      <div className="space-y-1">
        {(issue.createdByAgentId || issue.createdByUserId) && (
          <PropertyRow label="Reporter">
            {issue.createdByAgentId ? (
              <Link
                to={`/agents/${issue.createdByAgentId}`}
                className="hover:underline"
              >
                <Identity name={agentName(issue.createdByAgentId) ?? issue.createdByAgentId.slice(0, 8)} size="sm" />
              </Link>
            ) : (
              <>
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm">{creatorUserLabel ?? "User"}</span>
              </>
            )}
          </PropertyRow>
        )}
        {issue.startedAt && (
          <PropertyRow label="Started">
            <span className="text-sm">{formatDate(issue.startedAt)}</span>
          </PropertyRow>
        )}
        {issue.completedAt && (
          <PropertyRow label="Completed">
            <span className="text-sm">{formatDate(issue.completedAt)}</span>
          </PropertyRow>
        )}
        <PropertyRow label="Created">
          <span className="text-sm">{formatDate(issue.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label="Updated">
          <span className="text-sm">{timeAgo(issue.updatedAt)}</span>
        </PropertyRow>
      </div>
    </div>
  );
}
