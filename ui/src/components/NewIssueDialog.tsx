import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type DragEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pickTextColorForSolidBg } from "@/lib/color-contrast";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { issuesApi } from "../api/issues";
import { instanceSettingsApi } from "../api/instanceSettings";
import { projectsApi } from "../api/projects";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { useProjectIssueStatuses } from "../hooks/useProjectIssueStatuses";
import { isBoardPinnedHiddenProjectIssueStatusValue } from "@paperclipai/shared";
import { getRecentAssigneeIds, sortAgentsByRecency, trackRecentAssignee } from "../lib/recent-assignees";
import { useToast } from "../context/ToastContext";
import {
  assigneeValueFromSelection,
  currentUserAssigneeOption,
  parseAssigneeValue,
} from "../lib/assignees";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Maximize2,
  Minimize2,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  CircleDot,
  Minus,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Tag,
  Calendar,
  Paperclip,
  FileText,
  Loader2,
  X,
  Check,
} from "lucide-react";
import { cn } from "../lib/utils";
import { extractProviderIdWithFallback } from "../lib/model-utils";
import { issueStatusText, issueStatusTextDefault, priorityColor, priorityColorDefault } from "../lib/status-colors";
import { toggleIssueLabelSelection } from "../lib/issue-labels-state";
import { setFocusAfterIssueCreate } from "../lib/focus-created-issue";
import { MarkdownEditor, type MarkdownEditorRef, type MentionOption } from "./MarkdownEditor";
import { AgentIcon } from "./AgentIconPicker";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";

const DRAFT_KEY = "paperclip:issue-draft";
const DEBOUNCE_MS = 800;


interface IssueDraft {
  title: string;
  description: string;
  status: string;
  priority: string;
  labelIds?: string[];
  assigneeValue: string;
  assigneeId?: string;
  projectId: string;
  projectWorkspaceId?: string;
  assigneeModelOverride: string;
  assigneeThinkingEffort: string;
  assigneeChrome: boolean;
  executionWorkspaceMode?: string;
  selectedExecutionWorkspaceId?: string;
  useIsolatedExecutionWorkspace?: boolean;
  /** YYYY-MM-DD */
  targetStartDate?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
}

type StagedIssueFile = {
  id: string;
  file: File;
  kind: "document" | "attachment";
  documentKey?: string;
  title?: string | null;
};

const ISSUE_OVERRIDE_ADAPTER_TYPES = new Set(["claude_local", "codex_local", "opencode_local"]);
const STAGED_FILE_ACCEPT = "image/*,application/pdf,text/plain,text/markdown,application/json,text/csv,text/html,.md,.markdown";

const ISSUE_THINKING_EFFORT_OPTIONS = {
  claude_local: [
    { value: "", label: "Default" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
  codex_local: [
    { value: "", label: "Default" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "X-High" },
  ],
  opencode_local: [
    { value: "", label: "Default" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "X-High" },
    { value: "max", label: "Max" },
  ],
} as const;

function buildAssigneeAdapterOverrides(input: {
  adapterType: string | null | undefined;
  modelOverride: string;
  thinkingEffortOverride: string;
  chrome: boolean;
}): Record<string, unknown> | null {
  const adapterType = input.adapterType ?? null;
  if (!adapterType || !ISSUE_OVERRIDE_ADAPTER_TYPES.has(adapterType)) {
    return null;
  }

  const adapterConfig: Record<string, unknown> = {};
  if (input.modelOverride) adapterConfig.model = input.modelOverride;
  if (input.thinkingEffortOverride) {
    if (adapterType === "codex_local") {
      adapterConfig.modelReasoningEffort = input.thinkingEffortOverride;
    } else if (adapterType === "opencode_local") {
      adapterConfig.variant = input.thinkingEffortOverride;
    } else if (adapterType === "claude_local") {
      adapterConfig.effort = input.thinkingEffortOverride;
    } else if (adapterType === "opencode_local") {
      adapterConfig.variant = input.thinkingEffortOverride;
    }
  }
  if (adapterType === "claude_local" && input.chrome) {
    adapterConfig.chrome = true;
  }

  const overrides: Record<string, unknown> = {};
  if (Object.keys(adapterConfig).length > 0) {
    overrides.adapterConfig = adapterConfig;
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

function loadDraft(): IssueDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IssueDraft;
  } catch {
    return null;
  }
}

function saveDraft(draft: IssueDraft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

function isTextDocumentFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".txt") ||
    file.type === "text/markdown" ||
    file.type === "text/plain"
  );
}

function fileBaseName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function slugifyDocumentKey(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "document";
}

function titleizeFilename(input: string) {
  return input
    .split(/[-_ ]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createUniqueDocumentKey(baseKey: string, stagedFiles: StagedIssueFile[]) {
  const existingKeys = new Set(
    stagedFiles
      .filter((file) => file.kind === "document")
      .map((file) => file.documentKey)
      .filter((key): key is string => Boolean(key)),
  );
  if (!existingKeys.has(baseKey)) return baseKey;
  let suffix = 2;
  while (existingKeys.has(`${baseKey}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseKey}-${suffix}`;
}

function formatFileSize(file: File) {
  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
}

const statuses = [
  { value: "backlog", label: "Backlog", color: issueStatusText.backlog ?? issueStatusTextDefault },
  { value: "todo", label: "Todo", color: issueStatusText.todo ?? issueStatusTextDefault },
  { value: "in_progress", label: "In Progress", color: issueStatusText.in_progress ?? issueStatusTextDefault },
  { value: "in_review", label: "In Review", color: issueStatusText.in_review ?? issueStatusTextDefault },
  { value: "done", label: "Done", color: issueStatusText.done ?? issueStatusTextDefault },
];

const priorities = [
  { value: "critical", label: "Critical", icon: AlertTriangle, color: priorityColor.critical ?? priorityColorDefault },
  { value: "high", label: "High", icon: ArrowUp, color: priorityColor.high ?? priorityColorDefault },
  { value: "medium", label: "Medium", icon: Minus, color: priorityColor.medium ?? priorityColorDefault },
  { value: "low", label: "Low", icon: ArrowDown, color: priorityColor.low ?? priorityColorDefault },
];

const EXECUTION_WORKSPACE_MODES = [
  { value: "shared_workspace", label: "Project default" },
  { value: "isolated_workspace", label: "New isolated workspace" },
  { value: "reuse_existing", label: "Reuse existing workspace" },
] as const;

const REQUIRED_FIELD_MARKER = "*";

export function formatRequiredFieldLabel(label: string) {
  return `${label} ${REQUIRED_FIELD_MARKER}`;
}

function defaultProjectWorkspaceIdForProject(project: { workspaces?: Array<{ id: string; isPrimary: boolean }>; executionWorkspacePolicy?: { defaultProjectWorkspaceId?: string | null } | null } | null | undefined) {
  if (!project) return "";
  return project.executionWorkspacePolicy?.defaultProjectWorkspaceId
    ?? project.workspaces?.find((workspace) => workspace.isPrimary)?.id
    ?? project.workspaces?.[0]?.id
    ?? "";
}

function defaultExecutionWorkspaceModeForProject(project: { executionWorkspacePolicy?: { enabled?: boolean; defaultMode?: string | null } | null } | null | undefined) {
  const defaultMode = project?.executionWorkspacePolicy?.enabled ? project.executionWorkspacePolicy.defaultMode : null;
  if (
    defaultMode === "isolated_workspace" ||
    defaultMode === "operator_branch" ||
    defaultMode === "adapter_default"
  ) {
    return defaultMode === "adapter_default" ? "agent_default" : defaultMode;
  }
  return "shared_workspace";
}

function issueExecutionWorkspaceModeForExistingWorkspace(mode: string | null | undefined) {
  if (mode === "isolated_workspace" || mode === "operator_branch" || mode === "shared_workspace") {
    return mode;
  }
  if (mode === "adapter_managed" || mode === "cloud_sandbox") {
    return "agent_default";
  }
  return "shared_workspace";
}

function resolveProjectByRef<T extends { id: string; urlKey?: string | null }>(
  projects: T[],
  projectRef: string,
): T | undefined {
  if (!projectRef) return undefined;
  return projects.find((project) => project.id === projectRef || project.urlKey === projectRef);
}

export function canSubmitNewIssue(input: {
  title: string;
  projectId: string;
  isPending: boolean;
  /** When omitted, treated as backlog (assignee optional). */
  status?: string;
  /** Required when status is not a list-only stage such as backlog. */
  hasAssignee?: boolean;
}) {
  if (!input.title.trim() || !input.projectId || input.isPending) return false;
  const status = input.status ?? "backlog";
  if (!isBoardPinnedHiddenProjectIssueStatusValue(status) && !input.hasAssignee) return false;
  return true;
}

export function NewIssueDialog() {
  const { newIssueOpen, newIssueDefaults, closeNewIssue } = useDialog();
  const { companies, selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("backlog");
  const [priority, setPriority] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [assigneeValue, setAssigneeValue] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectWorkspaceId, setProjectWorkspaceId] = useState("");
  const [assigneeOptionsOpen, setAssigneeOptionsOpen] = useState(false);
  const [assigneeModelOverride, setAssigneeModelOverride] = useState("");
  const [assigneeThinkingEffort, setAssigneeThinkingEffort] = useState("");
  const [assigneeChrome, setAssigneeChrome] = useState(false);
  const [executionWorkspaceMode, setExecutionWorkspaceMode] = useState<string>("shared_workspace");
  const [selectedExecutionWorkspaceId, setSelectedExecutionWorkspaceId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dialogCompanyId, setDialogCompanyId] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedIssueFile[]>([]);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [projectValidationError, setProjectValidationError] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executionWorkspaceDefaultProjectId = useRef<string | null>(null);

  const effectiveCompanyId = dialogCompanyId ?? selectedCompanyId;
  const dialogCompany = companies.find((c) => c.id === effectiveCompanyId) ?? selectedCompany;

  const rawProjectStatuses = useProjectIssueStatuses(projectId || null);
  /** All workflow stages (including list-only e.g. backlog) — used for new-task status chip and picker. */
  const sortedProjectStatuses = useMemo(
    () => [...rawProjectStatuses].sort((a, b) => a.position - b.position),
    [rawProjectStatuses],
  );
  const newIssueStatusWorkflowMeta = useMemo(
    () => rawProjectStatuses.find((s) => s.value === status),
    [rawProjectStatuses, status],
  );
  const newIssueAssigneeAllowsUsers = newIssueStatusWorkflowMeta?.allowedActors !== "agent_only";
  const newIssueAssigneeAllowsAgents = newIssueStatusWorkflowMeta?.allowedActors !== "human_only";

  // Popover states
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [targetStartDate, setTargetStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);
  const descriptionEditorRef = useRef<MarkdownEditorRef>(null);
  const stageFileInputRef = useRef<HTMLInputElement | null>(null);
  const assigneeSelectorRef = useRef<HTMLButtonElement | null>(null);
  const projectSelectorRef = useRef<HTMLButtonElement | null>(null);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(effectiveCompanyId!),
    queryFn: () => agentsApi.list(effectiveCompanyId!),
    enabled: !!effectiveCompanyId && newIssueOpen,
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(effectiveCompanyId!),
    queryFn: () => accessApi.listMembers(effectiveCompanyId!),
    enabled: !!effectiveCompanyId && newIssueOpen,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(effectiveCompanyId!),
    queryFn: () => projectsApi.list(effectiveCompanyId!),
    enabled: !!effectiveCompanyId && newIssueOpen,
  });
  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(effectiveCompanyId!),
    queryFn: () => issuesApi.listLabels(effectiveCompanyId!),
    enabled: !!effectiveCompanyId && newIssueOpen,
  });

  const { data: reusableExecutionWorkspaces } = useQuery({
    queryKey: queryKeys.executionWorkspaces.list(effectiveCompanyId!, {
      projectId,
      projectWorkspaceId: projectWorkspaceId || undefined,
      reuseEligible: true,
    }),
    queryFn: () =>
      executionWorkspacesApi.list(effectiveCompanyId!, {
        projectId,
        projectWorkspaceId: projectWorkspaceId || undefined,
        reuseEligible: true,
      }),
    enabled: Boolean(effectiveCompanyId) && newIssueOpen && Boolean(projectId),
  });
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    enabled: newIssueOpen,
    retry: false,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archivedAt),
    [projects],
  );
  const { orderedProjects } = useProjectOrder({
    projects: activeProjects,
    companyId: effectiveCompanyId,
    userId: currentUserId,
  });

  const selectedAssignee = useMemo(() => parseAssigneeValue(assigneeValue), [assigneeValue]);
  const selectedAssigneeAgentId = selectedAssignee.assigneeAgentId;
  const selectedAssigneeUserId = selectedAssignee.assigneeUserId;

  const assigneeAdapterType = (agents ?? []).find((agent) => agent.id === selectedAssigneeAgentId)?.adapterType ?? null;
  const supportsAssigneeOverrides = Boolean(
    assigneeAdapterType && ISSUE_OVERRIDE_ADAPTER_TYPES.has(assigneeAdapterType),
  );
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const options: MentionOption[] = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({
        id: `agent:${agent.id}`,
        name: agent.name,
        kind: "agent",
        agentId: agent.id,
        agentIcon: agent.icon,
      });
    }
    for (const project of orderedProjects) {
      options.push({
        id: `project:${project.id}`,
        name: project.name,
        kind: "project",
        projectId: project.id,
        projectColor: project.color,
      });
    }
    return options;
  }, [agents, orderedProjects]);

  const { data: assigneeAdapterModels } = useQuery({
    queryKey:
      effectiveCompanyId && assigneeAdapterType
        ? queryKeys.agents.adapterModels(effectiveCompanyId, assigneeAdapterType)
        : ["agents", "none", "adapter-models", assigneeAdapterType ?? "none"],
    queryFn: () => agentsApi.adapterModels(effectiveCompanyId!, assigneeAdapterType!),
    enabled: Boolean(effectiveCompanyId) && newIssueOpen && supportsAssigneeOverrides,
  });

  const createIssue = useMutation({
    mutationFn: async ({
      companyId,
      stagedFiles: pendingStagedFiles,
      ...data
    }: { companyId: string; stagedFiles: StagedIssueFile[] } & Record<string, unknown>) => {
      const issue = await issuesApi.create(companyId, data);
      const failures: string[] = [];

      for (const stagedFile of pendingStagedFiles) {
        try {
          if (stagedFile.kind === "document") {
            const body = await stagedFile.file.text();
            await issuesApi.upsertDocument(issue.id, stagedFile.documentKey ?? "document", {
              title: stagedFile.documentKey === "plan" ? null : stagedFile.title ?? null,
              format: "markdown",
              body,
              baseRevisionId: null,
            });
          } else {
            await issuesApi.uploadAttachment(companyId, issue.id, stagedFile.file);
          }
        } catch {
          failures.push(stagedFile.file.name);
        }
      }

      return { issue, companyId, failures };
    },
    onSuccess: ({ issue, companyId, failures }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const prefix = (companies.find((c) => c.id === companyId)?.issuePrefix ?? "").trim();
      const issueRef = issue.identifier ?? issue.id;
      const statusLabel = issue.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      setFocusAfterIssueCreate(companyId, {
        issueId: issue.id,
        identifier: issue.identifier ?? null,
        status: issue.status,
        title: issue.title,
      });

      if (failures.length > 0) {
        pushToast({
          title: `Created ${issueRef} with upload warnings`,
          body: `${failures.length} staged ${failures.length === 1 ? "file" : "files"} could not be added.`,
          tone: "warn",
          ttlMs: 15_000,
          action: prefix
            ? { label: `Open ${issueRef}`, href: `/${prefix}/issues/${issueRef}` }
            : undefined,
        });
      } else {
        pushToast({
          title: `Created ${issueRef}`,
          body: `Placed in ${statusLabel}. Look for the highlighted task below.`,
          tone: "success",
          ttlMs: 15_000,
          action: prefix ? { label: "Open task", href: `/${prefix}/issues/${issueRef}` } : undefined,
        });
      }
      clearDraft();
      reset();
      closeNewIssue();
    },
  });

  const uploadDescriptionImage = useMutation({
    mutationFn: async (file: File) => {
      if (!effectiveCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(effectiveCompanyId, file, "issues/drafts");
    },
  });

  // Debounced draft saving
  const scheduleSave = useCallback(
    (draft: IssueDraft) => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        if (draft.title.trim()) saveDraft(draft);
      }, DEBOUNCE_MS);
    },
    [],
  );

  // Save draft on meaningful changes
  useEffect(() => {
    if (!newIssueOpen) return;
    scheduleSave({
      title,
      description,
      status,
      priority,
      labelIds: selectedLabelIds,
      assigneeValue,
      projectId,
      projectWorkspaceId,
      assigneeModelOverride,
      assigneeThinkingEffort,
      assigneeChrome,
      executionWorkspaceMode,
      selectedExecutionWorkspaceId,
      targetStartDate,
      dueDate,
    });
  }, [
    title,
    description,
    status,
    priority,
    selectedLabelIds,
    assigneeValue,
    projectId,
    projectWorkspaceId,
    assigneeModelOverride,
    assigneeThinkingEffort,
    assigneeChrome,
    executionWorkspaceMode,
    selectedExecutionWorkspaceId,
    targetStartDate,
    dueDate,
    newIssueOpen,
    scheduleSave,
  ]);

  // Restore draft or apply defaults when dialog opens
  useEffect(() => {
    if (!newIssueOpen) return;
    setDialogCompanyId(selectedCompanyId);
    setProjectValidationError(null);
    executionWorkspaceDefaultProjectId.current = null;

    const draft = loadDraft();
    if (newIssueDefaults.title) {
      setTitle(newIssueDefaults.title);
      setDescription(newIssueDefaults.description ?? "");
      setStatus(newIssueDefaults.status ?? "backlog");
      setPriority(newIssueDefaults.priority ?? "");
      setSelectedLabelIds([]);
      const defaultProjectRef = newIssueDefaults.projectId ?? "";
      const defaultProject = resolveProjectByRef(orderedProjects, defaultProjectRef);
      const defaultProjectId = defaultProject?.id ?? defaultProjectRef;
      setProjectId(defaultProjectId);
      setProjectWorkspaceId(defaultProjectWorkspaceIdForProject(defaultProject));
      setAssigneeValue(assigneeValueFromSelection(newIssueDefaults));
      setAssigneeModelOverride("");
      setAssigneeThinkingEffort("");
      setAssigneeChrome(false);
      setExecutionWorkspaceMode(defaultExecutionWorkspaceModeForProject(defaultProject));
      setSelectedExecutionWorkspaceId("");
      setTargetStartDate("");
      setDueDate("");
      executionWorkspaceDefaultProjectId.current = defaultProjectId || null;
    } else if (draft && draft.title.trim()) {
      const restoredProjectRef = newIssueDefaults.projectId ?? draft.projectId;
      const restoredProject = resolveProjectByRef(orderedProjects, restoredProjectRef);
      const restoredProjectId = restoredProject?.id ?? restoredProjectRef;
      setTitle(draft.title);
      setDescription(draft.description);
      setStatus(newIssueDefaults.status ?? (draft.status || "backlog"));
      setPriority(draft.priority);
      setSelectedLabelIds(Array.isArray(draft.labelIds) ? draft.labelIds : []);
      setAssigneeValue(
        newIssueDefaults.assigneeAgentId || newIssueDefaults.assigneeUserId
          ? assigneeValueFromSelection(newIssueDefaults)
          : (draft.assigneeValue ?? draft.assigneeId ?? ""),
      );
      setProjectId(restoredProjectId);
      setProjectWorkspaceId(draft.projectWorkspaceId ?? defaultProjectWorkspaceIdForProject(restoredProject));
      setAssigneeModelOverride(draft.assigneeModelOverride ?? "");
      setAssigneeThinkingEffort(draft.assigneeThinkingEffort ?? "");
      setAssigneeChrome(draft.assigneeChrome ?? false);
      setExecutionWorkspaceMode(
        draft.executionWorkspaceMode
          ?? (draft.useIsolatedExecutionWorkspace ? "isolated_workspace" : defaultExecutionWorkspaceModeForProject(restoredProject)),
      );
      setSelectedExecutionWorkspaceId(draft.selectedExecutionWorkspaceId ?? "");
      setTargetStartDate(draft.targetStartDate ?? "");
      setDueDate(draft.dueDate ?? "");
      executionWorkspaceDefaultProjectId.current = restoredProjectId || null;
    } else {
      const defaultProjectRef = newIssueDefaults.projectId ?? "";
      const defaultProject = resolveProjectByRef(orderedProjects, defaultProjectRef);
      const defaultProjectId = defaultProject?.id ?? defaultProjectRef;
      setStatus(newIssueDefaults.status ?? "backlog");
      setPriority(newIssueDefaults.priority ?? "");
      setSelectedLabelIds([]);
      setProjectId(defaultProjectId);
      setProjectWorkspaceId(defaultProjectWorkspaceIdForProject(defaultProject));
      setAssigneeValue(assigneeValueFromSelection(newIssueDefaults));
      setAssigneeModelOverride("");
      setAssigneeThinkingEffort("");
      setAssigneeChrome(false);
      setExecutionWorkspaceMode(defaultExecutionWorkspaceModeForProject(defaultProject));
      setSelectedExecutionWorkspaceId("");
      setTargetStartDate("");
      setDueDate("");
      executionWorkspaceDefaultProjectId.current = defaultProjectId || null;
    }
  }, [newIssueOpen, newIssueDefaults, orderedProjects]);

  useEffect(() => {
    if (!supportsAssigneeOverrides) {
      setAssigneeOptionsOpen(false);
      setAssigneeModelOverride("");
      setAssigneeThinkingEffort("");
      setAssigneeChrome(false);
      return;
    }

    const validThinkingValues =
      assigneeAdapterType === "codex_local"
        ? ISSUE_THINKING_EFFORT_OPTIONS.codex_local
        : assigneeAdapterType === "opencode_local"
          ? ISSUE_THINKING_EFFORT_OPTIONS.opencode_local
          : ISSUE_THINKING_EFFORT_OPTIONS.claude_local;
    if (!validThinkingValues.some((option) => option.value === assigneeThinkingEffort)) {
      setAssigneeThinkingEffort("");
    }
  }, [supportsAssigneeOverrides, assigneeAdapterType, assigneeThinkingEffort]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  function reset() {
    setTitle("");
    setDescription("");
    setStatus("backlog");
    setPriority("");
    setSelectedLabelIds([]);
    setAssigneeValue("");
    setProjectId("");
    setProjectWorkspaceId("");
    setAssigneeOptionsOpen(false);
    setAssigneeModelOverride("");
    setAssigneeThinkingEffort("");
    setAssigneeChrome(false);
    setExecutionWorkspaceMode("shared_workspace");
    setSelectedExecutionWorkspaceId("");
    setExpanded(false);
    setDialogCompanyId(null);
    setStagedFiles([]);
    setIsFileDragOver(false);
    setProjectValidationError(null);
    setCompanyOpen(false);
    setTargetStartDate("");
    setDueDate("");
    executionWorkspaceDefaultProjectId.current = null;
  }

  function handleCompanyChange(companyId: string) {
    if (companyId === effectiveCompanyId) return;
    setDialogCompanyId(companyId);
    setSelectedLabelIds([]);
    setAssigneeValue("");
    setProjectId("");
    setProjectWorkspaceId("");
    setAssigneeModelOverride("");
    setAssigneeThinkingEffort("");
    setAssigneeChrome(false);
    setExecutionWorkspaceMode("shared_workspace");
    setSelectedExecutionWorkspaceId("");
    setTargetStartDate("");
    setDueDate("");
    setProjectValidationError(null);
  }

  function discardDraft() {
    clearDraft();
    reset();
    closeNewIssue();
  }

  function handleSubmit() {
    if (!effectiveCompanyId || createIssue.isPending) return;
    if (!title.trim()) return;
    if (!projectId) {
      setProjectValidationError("Project is required.");
      return;
    }
    setProjectValidationError(null);
    const assigneeAdapterOverrides = buildAssigneeAdapterOverrides({
      adapterType: assigneeAdapterType,
      modelOverride: assigneeModelOverride,
      thinkingEffortOverride: assigneeThinkingEffort,
      chrome: assigneeChrome,
    });
    const selectedProject = orderedProjects.find((project) => project.id === projectId);
    const executionWorkspacePolicy =
      experimentalSettings?.enableIsolatedWorkspaces === true
        ? selectedProject?.executionWorkspacePolicy ?? null
        : null;
    const selectedReusableExecutionWorkspace = deduplicatedReusableWorkspaces.find(
      (workspace) => workspace.id === selectedExecutionWorkspaceId,
    );
    const requestedExecutionWorkspaceMode =
      executionWorkspaceMode === "reuse_existing"
        ? issueExecutionWorkspaceModeForExistingWorkspace(selectedReusableExecutionWorkspace?.mode)
        : executionWorkspaceMode;
    const executionWorkspaceSettings = executionWorkspacePolicy?.enabled
      ? { mode: requestedExecutionWorkspaceMode }
      : null;
    createIssue.mutate({
      companyId: effectiveCompanyId,
      stagedFiles,
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority: priority || "medium",
      ...(selectedAssigneeAgentId ? { assigneeAgentId: selectedAssigneeAgentId } : {}),
      ...(selectedAssigneeUserId ? { assigneeUserId: selectedAssigneeUserId } : {}),
      ...(selectedLabelIds.length > 0 ? { labelIds: selectedLabelIds } : {}),
      ...(projectId ? { projectId } : {}),
      ...(projectWorkspaceId ? { projectWorkspaceId } : {}),
      ...(assigneeAdapterOverrides ? { assigneeAdapterOverrides } : {}),
      ...(executionWorkspacePolicy?.enabled ? { executionWorkspacePreference: executionWorkspaceMode } : {}),
      ...(executionWorkspaceMode === "reuse_existing" && selectedExecutionWorkspaceId
        ? { executionWorkspaceId: selectedExecutionWorkspaceId }
        : {}),
      ...(executionWorkspaceSettings ? { executionWorkspaceSettings } : {}),
      ...(targetStartDate ? { targetStartAt: `${targetStartDate}T00:00:00.000Z` } : {}),
      ...(dueDate ? { dueAt: `${dueDate}T00:00:00.000Z` } : {}),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function stageFiles(files: File[]) {
    if (files.length === 0) return;
    setStagedFiles((current) => {
      const next = [...current];
      for (const file of files) {
        if (isTextDocumentFile(file)) {
          const baseName = fileBaseName(file.name);
          const documentKey = createUniqueDocumentKey(slugifyDocumentKey(baseName), next);
          next.push({
            id: `${file.name}:${file.size}:${file.lastModified}:${documentKey}`,
            file,
            kind: "document",
            documentKey,
            title: titleizeFilename(baseName),
          });
          continue;
        }
        next.push({
          id: `${file.name}:${file.size}:${file.lastModified}`,
          file,
          kind: "attachment",
        });
      }
      return next;
    });
  }

  function handleStageFilesPicked(evt: ChangeEvent<HTMLInputElement>) {
    stageFiles(Array.from(evt.target.files ?? []));
    if (stageFileInputRef.current) {
      stageFileInputRef.current.value = "";
    }
  }

  function handleFileDragEnter(evt: DragEvent<HTMLDivElement>) {
    if (!evt.dataTransfer.types.includes("Files")) return;
    evt.preventDefault();
    setIsFileDragOver(true);
  }

  function handleFileDragOver(evt: DragEvent<HTMLDivElement>) {
    if (!evt.dataTransfer.types.includes("Files")) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = "copy";
    setIsFileDragOver(true);
  }

  function handleFileDragLeave(evt: DragEvent<HTMLDivElement>) {
    if (evt.currentTarget.contains(evt.relatedTarget as Node | null)) return;
    setIsFileDragOver(false);
  }

  function handleFileDrop(evt: DragEvent<HTMLDivElement>) {
    if (!evt.dataTransfer.files.length) return;
    evt.preventDefault();
    setIsFileDragOver(false);
    stageFiles(Array.from(evt.dataTransfer.files));
  }

  function removeStagedFile(id: string) {
    setStagedFiles((current) => current.filter((file) => file.id !== id));
  }

  const hasDraft = title.trim().length > 0 || description.trim().length > 0 || stagedFiles.length > 0 || selectedLabelIds.length > 0;
  const currentStatus =
    sortedProjectStatuses.length > 0
      ? (sortedProjectStatuses.find((s) => s.value === status) ?? sortedProjectStatuses[0]!)
      : (statuses.find((s) => s.value === status) ?? statuses[1]!);
  const currentStatusLabel =
    sortedProjectStatuses.length > 0
      ? (currentStatus as (typeof sortedProjectStatuses)[number]).name
      : (currentStatus as (typeof statuses)[number]).label;
  const currentPriority = priorities.find((p) => p.value === priority);
  const selectedLabels = useMemo(
    () => selectedLabelIds
      .map((labelId) => (labels ?? []).find((label) => label.id === labelId))
      .filter((label): label is NonNullable<typeof labels>[number] => Boolean(label)),
    [labels, selectedLabelIds],
  );
  const currentAssignee = selectedAssigneeAgentId
    ? (agents ?? []).find((a) => a.id === selectedAssigneeAgentId)
    : null;
  const currentProject = orderedProjects.find((project) => project.id === projectId);
  const currentProjectExecutionWorkspacePolicy =
    experimentalSettings?.enableIsolatedWorkspaces === true
      ? currentProject?.executionWorkspacePolicy ?? null
      : null;
  const currentProjectSupportsExecutionWorkspace = Boolean(currentProjectExecutionWorkspacePolicy?.enabled);
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
  const selectedReusableExecutionWorkspace = deduplicatedReusableWorkspaces.find(
    (workspace) => workspace.id === selectedExecutionWorkspaceId,
  );
  const assigneeOptionsTitle =
    assigneeAdapterType === "claude_local"
      ? "Claude options"
      : assigneeAdapterType === "codex_local"
        ? "Codex options"
        : assigneeAdapterType === "opencode_local"
          ? "OpenCode options"
        : "Agent options";
  const thinkingEffortOptions =
    assigneeAdapterType === "codex_local"
      ? ISSUE_THINKING_EFFORT_OPTIONS.codex_local
      : assigneeAdapterType === "opencode_local"
        ? ISSUE_THINKING_EFFORT_OPTIONS.opencode_local
      : ISSUE_THINKING_EFFORT_OPTIONS.claude_local;
  const recentAssigneeIds = useMemo(() => getRecentAssigneeIds(), [newIssueOpen]);
  const assigneeOptions = useMemo<InlineEntityOption[]>(
    () => [
      ...(newIssueAssigneeAllowsUsers ? currentUserAssigneeOption(currentUserId) : []),
      ...(newIssueAssigneeAllowsUsers
        ? (members ?? [])
            .filter((m) => m.principalType === "user" && m.user && m.user.id !== currentUserId)
            .map((m) => ({
              id: assigneeValueFromSelection({ assigneeUserId: m.user!.id }),
              label: m.user!.name,
              searchText: `${m.user!.name} ${m.user!.email}`,
            }))
        : []),
      ...(newIssueAssigneeAllowsAgents
        ? sortAgentsByRecency(
            (agents ?? []).filter((agent) => agent.status !== "terminated"),
            recentAssigneeIds,
          ).map((agent) => ({
            id: assigneeValueFromSelection({ assigneeAgentId: agent.id }),
            label: agent.name,
            searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`,
          }))
        : []),
    ],
    [
      agents,
      currentUserId,
      members,
      recentAssigneeIds,
      newIssueAssigneeAllowsUsers,
      newIssueAssigneeAllowsAgents,
    ],
  );
  const projectOptions = useMemo<InlineEntityOption[]>(
    () =>
      orderedProjects.map((project) => ({
        id: project.id,
        label: project.name,
        searchText: project.description ?? "",
      })),
    [orderedProjects],
  );

  const savedDraft = loadDraft();
  const hasSavedDraft = Boolean(savedDraft?.title.trim() || savedDraft?.description.trim() || savedDraft?.labelIds?.length);
  const canDiscardDraft = hasDraft || hasSavedDraft;
  const createIssueErrorMessage =
    createIssue.error instanceof Error ? createIssue.error.message : "Failed to create issue. Try again.";
  const hasAssignee = Boolean(selectedAssigneeAgentId || selectedAssigneeUserId);
  const assigneeRequired = !isBoardPinnedHiddenProjectIssueStatusValue(status);
  const missingRequiredFields: string[] = [];
  if (!title.trim()) missingRequiredFields.push("Task title");
  if (!projectId) missingRequiredFields.push("Project");
  if (assigneeRequired && !hasAssignee) missingRequiredFields.push("Assignee");
  const canSubmit = missingRequiredFields.length === 0 && !createIssue.isPending;
  const projectFieldLabel = formatRequiredFieldLabel("Project");
  const projectMarkerClassName = cn("text-muted-foreground/90", projectValidationError && "text-destructive");
  const stagedDocuments = stagedFiles.filter((file) => file.kind === "document");
  const stagedAttachments = stagedFiles.filter((file) => file.kind === "attachment");
  const visibleLabels = useMemo(
    () =>
      (labels ?? []).filter((label) => {
        if (!labelSearch.trim()) return true;
        return label.name.toLowerCase().includes(labelSearch.toLowerCase());
      }),
    [labels, labelSearch],
  );

  const toggleSelectedLabel = useCallback((labelId: string) => {
    setSelectedLabelIds((current) => toggleIssueLabelSelection(current, labelId));
  }, []);

  const handleProjectChange = useCallback((nextProjectId: string) => {
    setProjectId(nextProjectId);
    if (nextProjectId) {
      setProjectValidationError(null);
    }
    const nextProject = orderedProjects.find((project) => project.id === nextProjectId);
    executionWorkspaceDefaultProjectId.current = nextProjectId || null;
    setProjectWorkspaceId(defaultProjectWorkspaceIdForProject(nextProject));
    setExecutionWorkspaceMode(defaultExecutionWorkspaceModeForProject(nextProject));
    setSelectedExecutionWorkspaceId("");
  }, [orderedProjects]);

  useEffect(() => {
    if (!newIssueOpen || !projectId || executionWorkspaceDefaultProjectId.current === projectId) {
      return;
    }
    const project = orderedProjects.find((entry) => entry.id === projectId);
    if (!project) return;
    executionWorkspaceDefaultProjectId.current = projectId;
    setProjectWorkspaceId(defaultProjectWorkspaceIdForProject(project));
    setExecutionWorkspaceMode(defaultExecutionWorkspaceModeForProject(project));
    setSelectedExecutionWorkspaceId("");
  }, [newIssueOpen, orderedProjects, projectId]);
  const modelOverrideOptions = useMemo<InlineEntityOption[]>(
    () => {
      return [...(assigneeAdapterModels ?? [])]
        .sort((a, b) => {
          const providerA = extractProviderIdWithFallback(a.id);
          const providerB = extractProviderIdWithFallback(b.id);
          const byProvider = providerA.localeCompare(providerB);
          if (byProvider !== 0) return byProvider;
          return a.id.localeCompare(b.id);
        })
        .map((model) => ({
          id: model.id,
          label: model.label,
          searchText: `${model.id} ${extractProviderIdWithFallback(model.id)}`,
        }));
    },
    [assigneeAdapterModels],
  );

  return (
    <Dialog
      open={newIssueOpen}
      onOpenChange={(open) => {
        if (!open && !createIssue.isPending) closeNewIssue();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "p-0 gap-0 flex flex-col max-h-[calc(100dvh-2rem)]",
          expanded
            ? "sm:max-w-2xl h-[calc(100dvh-2rem)]"
            : "sm:max-w-lg"
        )}
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={(event) => {
          if (createIssue.isPending) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (createIssue.isPending) {
            event.preventDefault();
            return;
          }
          // Radix Dialog's modal DismissableLayer calls preventDefault() on
          // pointerdown events that originate outside the Dialog DOM tree.
          // Popover portals render at the body level (outside the Dialog), so
          // touch events on popover content get their default prevented — which
          // kills scroll gesture recognition on mobile.  Telling Radix "this
          // event is handled" skips that preventDefault, restoring touch scroll.
          const target = event.detail.originalEvent.target as HTMLElement | null;
          if (target?.closest("[data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "px-1.5 py-0.5 rounded text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity",
                    !dialogCompany?.brandColor && "bg-muted",
                  )}
                  style={
                    dialogCompany?.brandColor
                      ? {
                          backgroundColor: dialogCompany.brandColor,
                          color: pickTextColorForSolidBg(dialogCompany.brandColor),
                        }
                      : undefined
                  }
                >
                  {(dialogCompany?.name ?? "").slice(0, 3).toUpperCase()}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                {companies.filter((c) => c.status !== "archived").map((c) => (
                  <button
                    key={c.id}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                      c.id === effectiveCompanyId && "bg-accent",
                    )}
                    onClick={() => {
                      handleCompanyChange(c.id);
                      setCompanyOpen(false);
                    }}
                  >
                    <span
                      className={cn(
                        "px-1 py-0.5 rounded text-[10px] font-semibold leading-none",
                        !c.brandColor && "bg-muted",
                      )}
                      style={
                        c.brandColor
                          ? {
                              backgroundColor: c.brandColor,
                              color: pickTextColorForSolidBg(c.brandColor),
                            }
                          : undefined
                      }
                    >
                      {c.name.slice(0, 3).toUpperCase()}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground/60">&rsaquo;</span>
            <span>New task</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
              disabled={createIssue.isPending}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={() => closeNewIssue()}
              disabled={createIssue.isPending}
            >
              <span className="text-lg leading-none">&times;</span>
            </Button>
          </div>
        </div>

        {/* Title */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <textarea
            className="w-full text-lg font-semibold bg-transparent outline-none resize-none overflow-hidden placeholder:text-muted-foreground/50"
            placeholder="Task title"
            rows={1}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            readOnly={createIssue.isPending}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                descriptionEditorRef.current?.focus();
              }
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                if (assigneeValue) {
                  // Assignee already set — skip to project or description
                  if (projectId) {
                    descriptionEditorRef.current?.focus();
                  } else {
                    projectSelectorRef.current?.focus();
                  }
                } else {
                  assigneeSelectorRef.current?.focus();
                }
              }
            }}
            autoFocus
          />
        </div>

        <div className="px-4 pb-2 shrink-0">
          <div className="overflow-x-auto overscroll-x-contain">
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground flex-wrap sm:flex-nowrap sm:min-w-max">
              <span>For</span>
              <InlineEntitySelector
                ref={assigneeSelectorRef}
                value={assigneeValue}
                options={assigneeOptions}
                placeholder="Assignee"
                className="w-[150px]"
                disablePortal
                noneLabel="No assignee"
                searchPlaceholder="Search assignees..."
                emptyMessage="No assignees found."
                onChange={(value) => {
                  const nextAssignee = parseAssigneeValue(value);
                  if (nextAssignee.assigneeAgentId) {
                    trackRecentAssignee(nextAssignee.assigneeAgentId);
                  }
                  setAssigneeValue(value);
                }}
                onConfirm={() => {
                  if (projectId) {
                    descriptionEditorRef.current?.focus();
                  } else {
                    projectSelectorRef.current?.focus();
                  }
                }}
                renderTriggerValue={(option) =>
                  option ? (
                    currentAssignee ? (
                      <>
                        <AgentIcon icon={currentAssignee.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate" title={option.label}>{option.label}</span>
                      </>
                    ) : (
                      <span className="truncate" title={option.label}>{option.label}</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">Assignee</span>
                  )
                }
                renderOption={(option) => {
                  if (!option.id) return <span className="truncate" title={option.label}>{option.label}</span>;
                  const assignee = parseAssigneeValue(option.id).assigneeAgentId
                    ? (agents ?? []).find((agent) => agent.id === parseAssigneeValue(option.id).assigneeAgentId)
                    : null;
                  return (
                    <>
                      {assignee ? <AgentIcon icon={assignee.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                      <span className="truncate" title={option.label}>{option.label}</span>
                    </>
                  );
                }}
              />
              <span>in</span>
              <InlineEntitySelector
                ref={projectSelectorRef}
                value={projectId}
                options={projectOptions}
                placeholder="Select Project"
                className="w-[150px]"
                disablePortal
                noneLabel="No project"
                includeNoneOption={false}
                triggerAriaLabel={projectFieldLabel}
                triggerAriaRequired
                triggerAriaInvalid={Boolean(projectValidationError)}
                searchPlaceholder="Search projects..."
                emptyMessage="No projects found."
                onChange={handleProjectChange}
                onConfirm={() => {
                  descriptionEditorRef.current?.focus();
                }}
                renderTriggerValue={(option) =>
                  option && currentProject ? (
                    <>
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: currentProject.color ?? "#6366f1" }}
                      />
                      <span className="truncate" title={option.label}>{option.label}</span>
                      <span aria-hidden="true" className={projectMarkerClassName}>{REQUIRED_FIELD_MARKER}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Select Project <span aria-hidden="true" className={projectMarkerClassName}>{REQUIRED_FIELD_MARKER}</span>
                    </span>
                  )
                }
                renderOption={(option) => {
                  if (!option.id) return <span className="truncate" title={option.label}>{option.label}</span>;
                  const project = orderedProjects.find((item) => item.id === option.id);
                  return (
                    <>
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: project?.color ?? "#6366f1" }}
                      />
                      <span className="truncate" title={option.label}>{option.label}</span>
                    </>
                  );
                }}
              />
            </div>
          </div>
        </div>

        {currentProject && currentProjectSupportsExecutionWorkspace && (
          <div className="px-4 py-3 shrink-0 space-y-2">
            <div className="space-y-1.5">
              <div className="text-xs font-medium">Execution workspace</div>
              <div className="text-[11px] text-muted-foreground">
                Control whether this task runs in the shared workspace, a new isolated workspace, or an existing one.
              </div>
              <select
                className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                value={executionWorkspaceMode}
                onChange={(e) => {
                  setExecutionWorkspaceMode(e.target.value);
                  if (e.target.value !== "reuse_existing") {
                    setSelectedExecutionWorkspaceId("");
                  }
                }}
              >
                {EXECUTION_WORKSPACE_MODES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {executionWorkspaceMode === "reuse_existing" && (
                <select
                  className="w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                  value={selectedExecutionWorkspaceId}
                  onChange={(e) => setSelectedExecutionWorkspaceId(e.target.value)}
                >
                  <option value="">Choose an existing workspace</option>
                  {deduplicatedReusableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name} · {workspace.status} · {workspace.branchName ?? workspace.cwd ?? workspace.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              )}
              {executionWorkspaceMode === "reuse_existing" && selectedReusableExecutionWorkspace && (
                <div className="text-[11px] text-muted-foreground">
                  Reusing {selectedReusableExecutionWorkspace.name} from {selectedReusableExecutionWorkspace.branchName ?? selectedReusableExecutionWorkspace.cwd ?? "existing execution workspace"}.
                </div>
              )}
            </div>
          </div>
        )}

        {supportsAssigneeOverrides && (
          <div className="px-4 pb-2 shrink-0">
            <button
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAssigneeOptionsOpen((open) => !open)}
            >
              {assigneeOptionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {assigneeOptionsTitle}
            </button>
            {assigneeOptionsOpen && (
              <div className="mt-2 rounded-md border border-border p-3 bg-muted/20 space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Model</div>
                  <InlineEntitySelector
                    value={assigneeModelOverride}
                    options={modelOverrideOptions}
                    placeholder="Default model"
                    disablePortal
                    noneLabel="Default model"
                    searchPlaceholder="Search models..."
                    emptyMessage="No models found."
                    onChange={setAssigneeModelOverride}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Thinking effort</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {thinkingEffortOptions.map((option) => (
                      <button
                        key={option.value || "default"}
                        className={cn(
                          "px-2 py-1 rounded-md text-xs border border-border hover:bg-accent/50 transition-colors",
                          assigneeThinkingEffort === option.value && "bg-accent"
                        )}
                        onClick={() => setAssigneeThinkingEffort(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {assigneeAdapterType === "claude_local" && (
                  <div className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
                    <div className="text-xs text-muted-foreground">Enable Chrome (--chrome)</div>
                    <button
                      data-slot="toggle"
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        assigneeChrome ? "bg-green-600" : "bg-muted"
                      )}
                      onClick={() => setAssigneeChrome((value) => !value)}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                          assigneeChrome ? "translate-x-4.5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Description */}
        <div
          className={cn("px-4 pb-2 overflow-y-auto min-h-0 border-t border-border/60 pt-3", expanded ? "flex-1" : "")}
          onDragEnter={handleFileDragEnter}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        >
          <div
            className={cn(
              "rounded-md transition-colors",
              isFileDragOver && "bg-accent/20",
            )}
          >
            <MarkdownEditor
              ref={descriptionEditorRef}
              value={description}
              onChange={setDescription}
              placeholder="Add description..."
              bordered={false}
              mentions={mentionOptions}
              contentClassName={cn("text-sm text-muted-foreground pb-12", expanded ? "min-h-[220px]" : "min-h-[120px]")}
              imageUploadHandler={async (file) => {
                const asset = await uploadDescriptionImage.mutateAsync(file);
                return asset.contentPath;
              }}
            />
          </div>
          {stagedFiles.length > 0 ? (
            <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-3">
              {stagedDocuments.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Documents</div>
                  <div className="space-y-2">
                    {stagedDocuments.map((file) => (
                      <div key={file.id} className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                              {file.documentKey}
                            </span>
                            <span className="truncate text-sm">{file.file.name}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <FileText className="h-3.5 w-3.5" />
                            <span>{file.title || file.file.name}</span>
                            <span>•</span>
                            <span>{formatFileSize(file.file)}</span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground"
                          onClick={() => removeStagedFile(file.id)}
                          disabled={createIssue.isPending}
                          title="Remove document"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {stagedAttachments.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Attachments</div>
                  <div className="space-y-2">
                    {stagedAttachments.map((file) => (
                      <div key={file.id} className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm">{file.file.name}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {file.file.type || "application/octet-stream"} • {formatFileSize(file.file)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground"
                          onClick={() => removeStagedFile(file.id)}
                          disabled={createIssue.isPending}
                          title="Remove attachment"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Property chips bar */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border flex-wrap shrink-0">
          {/* Status chip */}
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
                {sortedProjectStatuses.length > 0 ? (
                  <span
                    className="inline-flex h-3 w-3 rounded-full border-2 shrink-0"
                    style={{ borderColor: (currentStatus as (typeof sortedProjectStatuses)[number]).color }}
                  />
                ) : (
                  <CircleDot className={cn("h-3 w-3", (currentStatus as (typeof statuses)[number]).color)} />
                )}
                {currentStatusLabel}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              {sortedProjectStatuses.length > 0
                ? sortedProjectStatuses.map((s) => (
                    <button
                      key={s.value}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                        s.value === status && "bg-accent"
                      )}
                      onClick={() => { setStatus(s.value); setStatusOpen(false); }}
                    >
                      <span
                        className="inline-flex h-3 w-3 rounded-full border-2 shrink-0"
                        style={{ borderColor: s.color }}
                      />
                      {s.name}
                    </button>
                  ))
                : statuses.map((s) => (
                    <button
                      key={s.value}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                        s.value === status && "bg-accent"
                      )}
                      onClick={() => { setStatus(s.value); setStatusOpen(false); }}
                    >
                      <CircleDot className={cn("h-3 w-3", s.color)} />
                      {s.label}
                    </button>
                  ))
              }
            </PopoverContent>
          </Popover>

          {/* Priority chip */}
          <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
                {currentPriority ? (
                  <>
                    <currentPriority.icon className={cn("h-3 w-3", currentPriority.color)} />
                    {currentPriority.label}
                  </>
                ) : (
                  <>
                    <Minus className="h-3 w-3 text-muted-foreground" />
                    Priority
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              {priorities.map((p) => (
                <button
                  key={p.value}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    p.value === priority && "bg-accent"
                  )}
                  onClick={() => { setPriority(p.value); setPriorityOpen(false); }}
                >
                  <p.icon className={cn("h-3 w-3", p.color)} />
                  {p.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover open={labelsOpen} onOpenChange={(open) => { setLabelsOpen(open); if (!open) setLabelSearch(""); }}>
            <PopoverTrigger asChild>
              <button className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors text-muted-foreground">
                <Tag className="h-3 w-3 shrink-0" />
                {selectedLabels.length === 0 ? (
                  <span>Labels</span>
                ) : (
                  <span className="truncate">
                    {selectedLabels.slice(0, 2).map((label) => label.name).join(", ")}
                    {selectedLabels.length > 2 ? ` +${selectedLabels.length - 2}` : ""}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-1" align="start">
              <input
                className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                placeholder="Search labels..."
                value={labelSearch}
                onChange={(e) => setLabelSearch(e.target.value)}
                autoFocus
              />
              <div className="max-h-44 overflow-y-auto overscroll-contain space-y-0.5">
                {visibleLabels.map((label) => {
                  const selected = selectedLabelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-left",
                        selected && "bg-accent",
                      )}
                      onClick={() => toggleSelectedLabel(label.id)}
                      disabled={createIssue.isPending}
                    >
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                      <span className="truncate flex-1">{label.name}</span>
                      {selected ? <Check className="h-3 w-3 shrink-0" /> : null}
                    </button>
                  );
                })}
                {visibleLabels.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No matching labels.</div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>

          <input
            ref={stageFileInputRef}
            type="file"
            accept={STAGED_FILE_ACCEPT}
            className="hidden"
            onChange={handleStageFilesPicked}
            multiple
          />
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors text-muted-foreground"
            onClick={() => stageFileInputRef.current?.click()}
            disabled={createIssue.isPending}
          >
            <Paperclip className="h-3 w-3" />
            Upload
          </button>

          {/* More (dates) */}
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center justify-center rounded-md border border-border p-1 text-xs hover:bg-accent/50 transition-colors text-muted-foreground">
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 space-y-2" align="start">
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Start date</div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1.5">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    type="date"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                    value={targetStartDate}
                    onChange={(e) => setTargetStartDate(e.target.value)}
                    disabled={createIssue.isPending}
                    aria-label="Start date"
                  />
                  {targetStartDate ? (
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setTargetStartDate("")}
                      disabled={createIssue.isPending}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">Due date</div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1.5">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    type="date"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={createIssue.isPending}
                    aria-label="Due date"
                  />
                  {dueDate ? (
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setDueDate("")}
                      disabled={createIssue.isPending}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground self-start sm:self-auto"
            onClick={discardDraft}
            disabled={createIssue.isPending || !canDiscardDraft}
          >
            Discard Draft
          </Button>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <div className="min-h-5 min-w-0 text-left sm:max-w-88 sm:text-right">
              {createIssue.isPending ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Creating issue...
                </span>
              ) : createIssue.isError ? (
                <p className="text-xs leading-snug text-destructive">{createIssueErrorMessage}</p>
              ) : !canSubmit ? (
                <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
                  Required: {missingRequiredFields.join(", ")}
                </span>
              ) : projectValidationError ? (
                <p className="text-xs leading-snug text-destructive">{projectValidationError}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              className="min-w-34 shrink-0 select-none text-white hover:brightness-105 active:brightness-95 disabled:opacity-100"
              style={{ backgroundColor: "#6569E1" }}
              disabled={!canSubmit}
              onClick={handleSubmit}
              aria-busy={createIssue.isPending}
            >
              {createIssue.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Task"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
