import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanySecret, Project } from "@paperclipai/shared";
import { StatusBadge } from "./StatusBadge";
import { cn, formatDate } from "../lib/utils";
import { goalsApi } from "../api/goals";
import { instanceSettingsApi } from "../api/instanceSettings";
import { projectsApi } from "../api/projects";
import { secretsApi } from "../api/secrets";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Archive, ArchiveRestore, Check, ExternalLink, Github, Loader2, Plus, Trash2, X } from "lucide-react";
import { DraftInput } from "./agent-config-primitives";
import { InlineEditor } from "./InlineEditor";

function rowsFromEnvConfig(env: Record<string, string> | null | undefined): Array<{ envKey: string; secretName: string }> {
  const e = Object.entries(env ?? {});
  return e.length > 0 ? e.map(([k, v]) => ({ envKey: k, secretName: v })) : [{ envKey: "", secretName: "" }];
}

function stableProjectEnvKey(env: Record<string, string> | null | undefined): string {
  if (!env || Object.keys(env).length === 0) return "__empty__";
  return JSON.stringify(
    Object.keys(env)
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        acc[k] = env[k]!;
        return acc;
      }, {}),
  );
}

function ProjectSecretBindingsEditor({
  envConfig,
  companySecrets,
  companySettingsPath,
  onSave,
}: {
  envConfig: Record<string, string> | null;
  companySecrets: CompanySecret[];
  companySettingsPath: string;
  onSave: (next: Record<string, string> | null) => void;
}) {
  const [rows, setRows] = useState(() => rowsFromEnvConfig(envConfig));
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    setRows(rowsFromEnvConfig(envConfig));
  }, [stableProjectEnvKey(envConfig)]);

  const secretNames = [...new Set(companySecrets.map((s) => s.name))].sort();

  function buildRecord(): Record<string, string> | null {
    const rec: Record<string, string> = {};
    for (const r of rows) {
      const k = r.envKey.trim();
      const s = r.secretName.trim();
      if (k && s) rec[k] = s;
    }
    return Object.keys(rec).length > 0 ? rec : null;
  }

  function handleSave() {
    onSave(buildRecord());
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        For each row: <span className="font-medium text-foreground">env var name</span> (what the agent sees) →{" "}
        <span className="font-medium text-foreground">company secret</span> (name from{" "}
        <Link to={companySettingsPath} className="underline underline-offset-2">
          Company settings
        </Link>
        ).
      </p>
      {secretNames.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No company secrets yet. Add them under Company settings → Secrets first.
        </p>
      ) : null}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className="min-w-28 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
              placeholder="ENV_VAR_NAME"
              value={row.envKey}
              onChange={(e) => {
                const v = e.target.value;
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, envKey: v } : r)));
              }}
              disabled={secretNames.length === 0}
            />
            <span className="text-xs text-muted-foreground shrink-0">→</span>
            <select
              className="min-w-32 flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
              value={row.secretName}
              onChange={(e) => {
                const v = e.target.value;
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, secretName: v } : r)));
              }}
              disabled={secretNames.length === 0}
            >
              <option value="">— company secret —</option>
              {secretNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={() => {
                setRows((prev) => {
                  const next = prev.filter((_, j) => j !== i);
                  return next.length ? next : [{ envKey: "", secretName: "" }];
                });
              }}
              aria-label="Remove row"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7"
          onClick={() => setRows((prev) => [...prev, { envKey: "", secretName: "" }])}
          disabled={secretNames.length === 0}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add mapping
        </Button>
        <Button type="button" size="xs" className="h-7" onClick={handleSave} disabled={secretNames.length === 0}>
          Save bindings
        </Button>
        {savedOk ? <span className="text-xs text-green-600 dark:text-green-400">Saved</span> : null}
      </div>
    </div>
  );
}

const PROJECT_STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

interface ProjectPropertiesProps {
  project: Project;
  onUpdate?: (data: Record<string, unknown>) => void;
  onFieldUpdate?: (field: ProjectConfigFieldKey, data: Record<string, unknown>) => void;
  getFieldSaveState?: (field: ProjectConfigFieldKey) => ProjectFieldSaveState;
  onArchive?: (archived: boolean) => void;
  archivePending?: boolean;
  /** Rendered in a property row immediately above Secrets (e.g. task notification settings). */
  aboveSecrets?: ReactNode;
}

export type ProjectFieldSaveState = "idle" | "saving" | "saved" | "error";
export type ProjectConfigFieldKey =
  | "name"
  | "description"
  | "status"
  | "goals"
  | "env_config"
  | "notification_config"
  | "execution_workspace_enabled"
  | "execution_workspace_default_mode"
  | "execution_workspace_base_ref"
  | "execution_workspace_branch_template"
  | "execution_workspace_worktree_parent_dir"
  | "execution_workspace_provision_command"
  | "execution_workspace_teardown_command";

function SaveIndicator({ state }: { state: ProjectFieldSaveState }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return null;
}

function FieldLabel({
  label,
  state,
}: {
  label: string;
  state: ProjectFieldSaveState;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <SaveIndicator state={state} />
    </div>
  );
}

function PropertyRow({
  label,
  children,
  alignStart = false,
  valueClassName = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  alignStart?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 px-5 py-3.5 sm:px-6",
        alignStart ? "items-start" : "items-center",
      )}
    >
      <div className="shrink-0 w-22 pt-0.5 sm:w-28">{label}</div>
      <div className={cn("min-w-0 flex-1", alignStart ? "pt-0.5" : "flex items-center gap-1.5", valueClassName)}>
        {children}
      </div>
    </div>
  );
}

function ProjectStatusPicker({ status, onChange }: { status: string; onChange: (status: string) => void }) {
  const [open, setOpen] = useState(false);
  const colorClass = statusBadge[status] ?? statusBadgeDefault;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer hover:opacity-80 transition-opacity",
            colorClass,
          )}
        >
          {status.replace("_", " ")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {PROJECT_STATUSES.map((s) => (
          <Button
            key={s.value}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", s.value === status && "bg-accent")}
            onClick={() => {
              onChange(s.value);
              setOpen(false);
            }}
          >
            {s.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ArchiveDangerZone({
  project,
  onArchive,
  archivePending,
}: {
  project: Project;
  onArchive: (archived: boolean) => void;
  archivePending?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const isArchive = !project.archivedAt;
  const action = isArchive ? "Archive" : "Unarchive";

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
      <p className="text-sm text-muted-foreground">
        {isArchive
          ? "Archive this project to hide it from the sidebar and project selectors."
          : "Unarchive this project to restore it in the sidebar and project selectors."}
      </p>
      {archivePending ? (
        <Button size="sm" variant="destructive" disabled>
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          {isArchive ? "Archiving..." : "Unarchiving..."}
        </Button>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-destructive font-medium">
            {action} &ldquo;{project.name}&rdquo;?
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              onArchive(isArchive);
            }}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          {isArchive ? (
            <><Archive className="h-3 w-3 mr-1" />{action} project</>
          ) : (
            <><ArchiveRestore className="h-3 w-3 mr-1" />{action} project</>
          )}
        </Button>
      )}
    </div>
  );
}

export function ProjectProperties({
  project,
  onUpdate,
  onFieldUpdate,
  getFieldSaveState,
  onArchive,
  archivePending,
  aboveSecrets,
}: ProjectPropertiesProps) {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const companyPrefix = selectedCompany?.issuePrefix?.trim() ?? "";
  const companySettingsPath = companyPrefix ? `/${companyPrefix}/company/settings` : "/company/settings";
  const queryClient = useQueryClient();
  const [goalOpen, setGoalOpen] = useState(false);
  const [projectSecretsModalOpen, setProjectSecretsModalOpen] = useState(false);
  const [executionWorkspaceAdvancedOpen, setExecutionWorkspaceAdvancedOpen] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"repo" | null>(null);
  const [workspaceRepoUrl, setWorkspaceRepoUrl] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const commitField = (field: ProjectConfigFieldKey, data: Record<string, unknown>) => {
    if (onFieldUpdate) {
      onFieldUpdate(field, data);
      return;
    }
    onUpdate?.(data);
  };
  const fieldState = (field: ProjectConfigFieldKey): ProjectFieldSaveState => getFieldSaveState?.(field) ?? "idle";

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: companySecrets = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.secrets.list(selectedCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    retry: false,
  });

  const linkedGoalIds = project.goalIds.length > 0
    ? project.goalIds
    : project.goalId
      ? [project.goalId]
      : [];

  const linkedGoals = project.goals.length > 0
    ? project.goals
    : linkedGoalIds.map((id) => ({
        id,
        title: allGoals?.find((g) => g.id === id)?.title ?? id.slice(0, 8),
      }));

  const availableGoals = (allGoals ?? []).filter((g) => !linkedGoalIds.includes(g.id));
  const workspaces = project.workspaces ?? [];
  const codebase = project.codebase;
  const primaryCodebaseWorkspace = project.primaryWorkspace ?? null;
  const repoWorkspaceForSecretBinding =
    primaryCodebaseWorkspace && primaryCodebaseWorkspace.repoUrl
      ? primaryCodebaseWorkspace
      : workspaces.find((workspace) => Boolean(workspace.repoUrl)) ?? null;
  const hasAdditionalLegacyWorkspaces = workspaces.some((workspace) => workspace.id !== primaryCodebaseWorkspace?.id);
  const executionWorkspacePolicy = project.executionWorkspacePolicy ?? null;
  const executionWorkspacesEnabled = executionWorkspacePolicy?.enabled === true;
  const isolatedWorkspacesEnabled = experimentalSettings?.enableIsolatedWorkspaces === true;
  const executionWorkspaceDefaultMode =
    executionWorkspacePolicy?.defaultMode === "isolated_workspace" ? "isolated_workspace" : "shared_workspace";
  const executionWorkspaceStrategy = executionWorkspacePolicy?.workspaceStrategy ?? {
    type: "git_worktree",
    baseRef: "",
    branchTemplate: "",
    worktreeParentDir: "",
  };

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
    if (project.urlKey !== project.id) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.urlKey) });
    }
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId) });
    }
  };

  const createWorkspace = useMutation({
    mutationFn: (data: Record<string, unknown>) => projectsApi.createWorkspace(project.id, data),
    onSuccess: () => {
      setWorkspaceRepoUrl("");
      setWorkspaceMode(null);
      setWorkspaceError(null);
      invalidateProject();
    },
  });

  const removeWorkspace = useMutation({
    mutationFn: (workspaceId: string) => projectsApi.removeWorkspace(project.id, workspaceId),
    onSuccess: () => {
      setWorkspaceRepoUrl("");
      setWorkspaceMode(null);
      setWorkspaceError(null);
      invalidateProject();
    },
  });
  const updateWorkspace = useMutation({
    mutationFn: ({ workspaceId, data }: { workspaceId: string; data: Record<string, unknown> }) =>
      projectsApi.updateWorkspace(project.id, workspaceId, data),
    onSuccess: () => {
      setWorkspaceRepoUrl("");
      setWorkspaceMode(null);
      setWorkspaceError(null);
      invalidateProject();
    },
  });

  const removeGoal = (goalId: string) => {
    if (!onUpdate && !onFieldUpdate) return;
    commitField("goals", { goalIds: linkedGoalIds.filter((id) => id !== goalId) });
  };

  const addGoal = (goalId: string) => {
    if ((!onUpdate && !onFieldUpdate) || linkedGoalIds.includes(goalId)) return;
    commitField("goals", { goalIds: [...linkedGoalIds, goalId] });
    setGoalOpen(false);
  };

  const updateExecutionWorkspacePolicy = (patch: Record<string, unknown>) => {
    if (!onUpdate && !onFieldUpdate) return;
    return {
      executionWorkspacePolicy: {
        enabled: executionWorkspacesEnabled,
        defaultMode: executionWorkspaceDefaultMode,
        allowIssueOverride: executionWorkspacePolicy?.allowIssueOverride ?? true,
        ...executionWorkspacePolicy,
        ...patch,
      },
    };
  };

  const looksLikeRepoUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") return false;
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments.length >= 2;
    } catch {
      return false;
    }
  };

  const isSafeExternalUrl = (value: string | null | undefined) => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const formatRepoUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length < 2) return parsed.host;
      const owner = segments[0];
      const repo = segments[1]?.replace(/\.git$/i, "");
      if (!owner || !repo) return parsed.host;
      return `${parsed.host}/${owner}/${repo}`;
    } catch {
      return value;
    }
  };

  const deriveSourceType = (cwd: string | null, repoUrl: string | null) => {
    if (repoUrl) return "git_repo";
    if (cwd) return "local_path";
    return undefined;
  };

  const persistCodebase = (patch: { cwd?: string | null; repoUrl?: string | null }) => {
    const nextCwd = patch.cwd !== undefined ? patch.cwd : codebase.localFolder;
    const nextRepoUrl = patch.repoUrl !== undefined ? patch.repoUrl : codebase.repoUrl;
    if (!nextCwd && !nextRepoUrl) {
      if (primaryCodebaseWorkspace) {
        removeWorkspace.mutate(primaryCodebaseWorkspace.id);
      }
      return;
    }

    const data: Record<string, unknown> = {
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.repoUrl !== undefined ? { repoUrl: patch.repoUrl } : {}),
      ...(deriveSourceType(nextCwd, nextRepoUrl) ? { sourceType: deriveSourceType(nextCwd, nextRepoUrl) } : {}),
      isPrimary: true,
    };

    if (primaryCodebaseWorkspace) {
      updateWorkspace.mutate({ workspaceId: primaryCodebaseWorkspace.id, data });
      return;
    }

    createWorkspace.mutate(data);
  };

  const submitRepoWorkspace = () => {
    const repoUrl = workspaceRepoUrl.trim();
    if (!repoUrl) {
      setWorkspaceError(null);
      persistCodebase({ repoUrl: null });
      return;
    }
    if (!looksLikeRepoUrl(repoUrl)) {
      setWorkspaceError("Repo must use a valid GitHub or GitHub Enterprise repo URL.");
      return;
    }
    setWorkspaceError(null);
    persistCodebase({ repoUrl });
  };

  const clearRepoWorkspace = () => {
    const hasLocalFolder = Boolean(codebase.localFolder);
    const confirmed = window.confirm(
      hasLocalFolder
        ? "Clear repo from this workspace?"
        : "Delete this workspace repo?",
    );
    if (!confirmed) return;
    if (primaryCodebaseWorkspace && hasLocalFolder) {
      updateWorkspace.mutate({
        workspaceId: primaryCodebaseWorkspace.id,
        data: { repoUrl: null, repoRef: null, defaultRef: null, sourceType: deriveSourceType(codebase.localFolder, null) },
      });
      return;
    }
    persistCodebase({ repoUrl: null });
  };

  const getWorkspaceGitHubSecretId = (workspace: Project["workspaces"][number]): string => {
    const metadata = (workspace.metadata as
      | {
          githubSecretId?: unknown;
          projectSecrets?: { githubPatSecretId?: unknown } | null;
        }
      | null
      | undefined) ?? null;
    if (typeof metadata?.githubSecretId === "string") {
      return metadata.githubSecretId;
    }
    const projectSecretsBinding = metadata?.projectSecrets;
    if (
      projectSecretsBinding &&
      typeof projectSecretsBinding === "object" &&
      typeof (projectSecretsBinding as { githubPatSecretId?: unknown }).githubPatSecretId === "string"
    ) {
      return (projectSecretsBinding as { githubPatSecretId: string }).githubPatSecretId;
    }
    return "";
  };

  const setWorkspaceGitHubSecretId = (
    workspace: Project["workspaces"][number],
    secretId: string,
  ) => {
    const currentMetadata = (workspace.metadata as Record<string, unknown> | null) ?? {};
    const projectSecretsBinding = (currentMetadata.projectSecrets as
      | { githubPatSecretId?: string }
      | null
      | undefined) ?? {};
    const nextProjectSecrets: { githubPatSecretId?: string } = { ...projectSecretsBinding };
    if (secretId) {
      nextProjectSecrets.githubPatSecretId = secretId;
    } else {
      delete nextProjectSecrets.githubPatSecretId;
    }
    const nextMetadata: Record<string, unknown> = {
      ...currentMetadata,
    };
    if (Object.keys(nextProjectSecrets).length > 0) {
      nextMetadata.projectSecrets = nextProjectSecrets;
    } else {
      // Avoid leaving an empty object that could be misleading
      if ("projectSecrets" in nextMetadata) {
        delete nextMetadata.projectSecrets;
      }
    }
    // Also set legacy top-level githubSecretId so existing helpers keep working.
    if (secretId) {
      nextMetadata.githubSecretId = secretId;
    } else if ("githubSecretId" in nextMetadata) {
      delete nextMetadata.githubSecretId;
    }

    updateWorkspace.mutate({
      workspaceId: workspace.id,
      data: { metadata: nextMetadata },
    });
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
        <header className="border-b border-border/60 bg-muted/20 px-5 py-4 sm:px-6">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Project settings</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Core details, goals, notifications, and how agents receive secrets for this project.
          </p>
        </header>
        <div className="divide-y divide-border/55">
        <PropertyRow label={<FieldLabel label="Name" state={fieldState("name")} />}>
          {onUpdate || onFieldUpdate ? (
            <DraftInput
              value={project.name}
              onCommit={(name) => commitField("name", { name })}
              immediate
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40"
              placeholder="Project name"
            />
          ) : (
            <span className="text-sm">{project.name}</span>
          )}
        </PropertyRow>
        <PropertyRow
          label={<FieldLabel label="Description" state={fieldState("description")} />}
          alignStart
          valueClassName="space-y-0.5"
        >
          {onUpdate || onFieldUpdate ? (
            <div className="rounded-md border border-border bg-background p-2.5">
              <InlineEditor
                value={project.description ?? ""}
                onSave={(description) => commitField("description", { description })}
                as="p"
                className="text-sm text-muted-foreground"
                placeholder="Add a description..."
                multiline
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {project.description?.trim() || "No description"}
            </p>
          )}
        </PropertyRow>
        <PropertyRow label={<FieldLabel label="Status" state={fieldState("status")} />}>
          {onUpdate || onFieldUpdate ? (
            <ProjectStatusPicker
              status={project.status}
              onChange={(status) => commitField("status", { status })}
            />
          ) : (
            <StatusBadge status={project.status} />
          )}
        </PropertyRow>
        {project.leadAgentId && (
          <PropertyRow
            label={
              <span className="text-xs font-medium text-muted-foreground">Lead</span>
            }
          >
            <span className="text-sm font-mono">{project.leadAgentId.slice(0, 8)}</span>
          </PropertyRow>
        )}
        <PropertyRow
          label={<FieldLabel label="Goals" state={fieldState("goals")} />}
          alignStart
          valueClassName="space-y-2"
        >
          {linkedGoals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedGoals.map((goal) => (
                <span
                  key={goal.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
                >
                  <Link to={`/goals/${goal.id}`} className="hover:underline max-w-[220px] truncate">
                    {goal.title}
                  </Link>
                  {(onUpdate || onFieldUpdate) && (
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      type="button"
                      onClick={() => removeGoal(goal.id)}
                      aria-label={`Remove goal ${goal.title}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {(onUpdate || onFieldUpdate) && (
            <Popover open={goalOpen} onOpenChange={setGoalOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="xs"
                  className={cn("h-6 w-fit px-2", linkedGoals.length > 0 && "ml-1")}
                  disabled={availableGoals.length === 0}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Goal
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {availableGoals.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    All goals linked.
                  </div>
                ) : (
                  availableGoals.map((goal) => (
                    <button
                      key={goal.id}
                      className="flex items-center w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
                      onClick={() => addGoal(goal.id)}
                    >
                      {goal.title}
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
          )}
        </PropertyRow>
        <PropertyRow label={<FieldLabel label="Created" state="idle" />}>
          <span className="text-sm">{formatDate(project.createdAt)}</span>
        </PropertyRow>
        <PropertyRow label={<FieldLabel label="Updated" state="idle" />}>
          <span className="text-sm">{formatDate(project.updatedAt)}</span>
        </PropertyRow>
        {project.targetDate && (
          <PropertyRow label={<FieldLabel label="Target Date" state="idle" />}>
            <span className="text-sm">{formatDate(project.targetDate)}</span>
          </PropertyRow>
        )}
        {aboveSecrets != null ? (
          <PropertyRow
            label={<FieldLabel label="Notifications" state={fieldState("notification_config")} />}
            alignStart
            valueClassName="space-y-2"
          >
            {aboveSecrets}
          </PropertyRow>
        ) : null}
        <PropertyRow label={<FieldLabel label="Secrets" state="idle" />}>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="min-w-0 text-sm leading-snug text-muted-foreground sm:max-w-md">
              {project.envConfig && Object.keys(project.envConfig).length > 0
                ? `${Object.keys(project.envConfig).length} env mapping${
                    Object.keys(project.envConfig).length === 1 ? "" : "s"
                  } configured for agents.`
                : "Map environment variable names to company secrets for agent runtime."}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full shrink-0 sm:w-auto"
              onClick={() => setProjectSecretsModalOpen(true)}
              disabled={!(onUpdate || onFieldUpdate)}
            >
              Configure secrets
            </Button>
          </div>
        </PropertyRow>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
        <header className="border-b border-border/60 bg-muted/20 px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Codebase</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/80 text-[10px] font-medium text-muted-foreground hover:border-border hover:text-foreground"
                  aria-label="Codebase help"
                >
                  ?
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Repo identifies the source of truth for this project&apos;s codebase.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Repository URL and GitHub credentials used when agents work in this codebase.
          </p>
        </header>
        <div className="space-y-4 px-5 py-4 sm:px-6">
        <div className="space-y-2">
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/5 p-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Repo</div>
              {codebase.repoUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    {isSafeExternalUrl(codebase.repoUrl) ? (
                      <a
                        href={codebase.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Github className="h-3 w-3 shrink-0" />
                        <span className="truncate">{formatRepoUrl(codebase.repoUrl)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Github className="h-3 w-3 shrink-0" />
                        <span className="truncate">{codebase.repoUrl}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        className="h-6 px-2"
                        onClick={() => {
                          setWorkspaceMode("repo");
                          setWorkspaceRepoUrl(codebase.repoUrl ?? "");
                          setWorkspaceError(null);
                        }}
                      >
                        Change repo
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={clearRepoWorkspace}
                        aria-label="Clear repo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">GitHub PAT secret</div>
                    <select
                      className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
                      value={repoWorkspaceForSecretBinding ? getWorkspaceGitHubSecretId(repoWorkspaceForSecretBinding) : ""}
                      onChange={(e) => {
                        if (!repoWorkspaceForSecretBinding) return;
                        setWorkspaceGitHubSecretId(repoWorkspaceForSecretBinding, e.target.value);
                      }}
                      disabled={!repoWorkspaceForSecretBinding || updateWorkspace.isPending}
                    >
                      <option value="">None</option>
                      {companySecrets.map((secret) => (
                        <option key={secret.id} value={secret.id}>
                          {secret.name}
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-muted-foreground">
                      {companySecrets.length > 0
                        ? "Select the company secret containing a GitHub PAT for this repo."
                        : "No company secrets found. Create one in Company settings first."}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">Not set.</div>
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-6 px-2"
                    onClick={() => {
                      setWorkspaceMode("repo");
                      setWorkspaceRepoUrl(codebase.repoUrl ?? "");
                      setWorkspaceError(null);
                    }}
                  >
                    Set repo
                  </Button>
                </div>
              )}
            </div>

            {hasAdditionalLegacyWorkspaces && (
              <div className="text-[11px] text-muted-foreground">
                Additional legacy workspace records exist on this project. Paperclip is using the primary workspace as the codebase view.
              </div>
            )}

            {primaryCodebaseWorkspace?.runtimeServices && primaryCodebaseWorkspace.runtimeServices.length > 0 ? (
              <div className="space-y-1">
                {primaryCodebaseWorkspace.runtimeServices.map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium">{service.serviceName}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            service.status === "running"
                              ? "bg-green-500/15 text-green-700 dark:text-green-300"
                              : service.status === "failed"
                                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {service.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {service.url ? (
                          <a
                            href={service.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-foreground hover:underline"
                          >
                            {service.url}
                          </a>
                        ) : (
                          service.command ?? "No URL"
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {service.lifecycle}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {workspaceMode === "repo" && (
            <div className="space-y-1.5 rounded-md border border-border p-2">
              <input
                className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs outline-none"
                value={workspaceRepoUrl}
                onChange={(e) => setWorkspaceRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6 px-2"
                  disabled={(!workspaceRepoUrl.trim() && !primaryCodebaseWorkspace) || createWorkspace.isPending || updateWorkspace.isPending}
                  onClick={submitRepoWorkspace}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 px-2"
                  onClick={() => {
                    setWorkspaceMode(null);
                    setWorkspaceRepoUrl("");
                    setWorkspaceError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {workspaceError && (
            <p className="text-xs text-destructive">{workspaceError}</p>
          )}
          {createWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to save workspace.</p>
          )}
          {removeWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to delete workspace.</p>
          )}
          {updateWorkspace.isError && (
            <p className="text-xs text-destructive">Failed to update workspace.</p>
          )}
        </div>
        </div>

        {isolatedWorkspacesEnabled ? (
          <div className="space-y-4 border-t border-border/55 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Execution workspaces</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/80 text-[10px] font-medium text-muted-foreground hover:border-border hover:text-foreground"
                    aria-label="Execution workspaces help"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Project-owned defaults for isolated issue checkouts and execution workspace behavior.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>Enable isolated issue checkouts</span>
                      <SaveIndicator state={fieldState("execution_workspace_enabled")} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Let issues choose between the project's primary checkout and an isolated execution workspace.
                    </div>
                  </div>
                  {onUpdate || onFieldUpdate ? (
                    <button
                      data-slot="toggle"
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        executionWorkspacesEnabled ? "bg-green-600" : "bg-muted",
                      )}
                      type="button"
                      onClick={() =>
                        commitField(
                          "execution_workspace_enabled",
                          updateExecutionWorkspacePolicy({ enabled: !executionWorkspacesEnabled })!,
                        )}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                          executionWorkspacesEnabled ? "translate-x-4.5" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {executionWorkspacesEnabled ? "Enabled" : "Disabled"}
                    </span>
                  )}
                </div>

                {executionWorkspacesEnabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 text-sm">
                          <span>New issues default to isolated checkout</span>
                          <SaveIndicator state={fieldState("execution_workspace_default_mode")} />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          If disabled, new issues stay on the project's primary checkout unless someone opts in.
                        </div>
                      </div>
                      <button
                        data-slot="toggle"
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          executionWorkspaceDefaultMode === "isolated_workspace" ? "bg-green-600" : "bg-muted",
                        )}
                        type="button"
                        onClick={() =>
                          commitField(
                            "execution_workspace_default_mode",
                            updateExecutionWorkspacePolicy({
                              defaultMode:
                                executionWorkspaceDefaultMode === "isolated_workspace"
                                  ? "shared_workspace"
                                  : "isolated_workspace",
                            })!,
                          )}
                      >
                        <span
                          className={cn(
                            "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                            executionWorkspaceDefaultMode === "isolated_workspace"
                              ? "translate-x-4.5"
                              : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </div>

                    <div className="border-t border-border/60 pt-2">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setExecutionWorkspaceAdvancedOpen((open) => !open)}
                      >
                        {executionWorkspaceAdvancedOpen
                          ? "Hide advanced checkout settings"
                          : "Show advanced checkout settings"}
                      </button>
                    </div>

                    {executionWorkspaceAdvancedOpen ? (
                      <div className="space-y-3">
                        <div className="text-xs text-muted-foreground">
                          Host-managed implementation: <span className="text-foreground">Git worktree</span>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Base ref</span>
                              <SaveIndicator state={fieldState("execution_workspace_base_ref")} />
                            </label>
                          </div>
                          <DraftInput
                            value={executionWorkspaceStrategy.baseRef ?? ""}
                            onCommit={(value) =>
                              commitField("execution_workspace_base_ref", {
                                ...updateExecutionWorkspacePolicy({
                                  workspaceStrategy: {
                                    ...executionWorkspaceStrategy,
                                    type: "git_worktree",
                                    baseRef: value || null,
                                  },
                                })!,
                              })}
                            immediate
                            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                            placeholder="origin/main"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Branch template</span>
                              <SaveIndicator state={fieldState("execution_workspace_branch_template")} />
                            </label>
                          </div>
                          <DraftInput
                            value={executionWorkspaceStrategy.branchTemplate ?? ""}
                            onCommit={(value) =>
                              commitField("execution_workspace_branch_template", {
                                ...updateExecutionWorkspacePolicy({
                                  workspaceStrategy: {
                                    ...executionWorkspaceStrategy,
                                    type: "git_worktree",
                                    branchTemplate: value || null,
                                  },
                                })!,
                              })}
                            immediate
                            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                            placeholder="{{issue.identifier}}-{{slug}}"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Worktree parent dir</span>
                              <SaveIndicator state={fieldState("execution_workspace_worktree_parent_dir")} />
                            </label>
                          </div>
                          <DraftInput
                            value={executionWorkspaceStrategy.worktreeParentDir ?? ""}
                            onCommit={(value) =>
                              commitField("execution_workspace_worktree_parent_dir", {
                                ...updateExecutionWorkspacePolicy({
                                  workspaceStrategy: {
                                    ...executionWorkspaceStrategy,
                                    type: "git_worktree",
                                    worktreeParentDir: value || null,
                                  },
                                })!,
                              })}
                            immediate
                            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                            placeholder=".paperclip/worktrees"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Provision command</span>
                              <SaveIndicator state={fieldState("execution_workspace_provision_command")} />
                            </label>
                          </div>
                          <DraftInput
                            value={executionWorkspaceStrategy.provisionCommand ?? ""}
                            onCommit={(value) =>
                              commitField("execution_workspace_provision_command", {
                                ...updateExecutionWorkspacePolicy({
                                  workspaceStrategy: {
                                    ...executionWorkspaceStrategy,
                                    type: "git_worktree",
                                    provisionCommand: value || null,
                                  },
                                })!,
                              })}
                            immediate
                            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                            placeholder="bash ./scripts/provision-worktree.sh"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Teardown command</span>
                              <SaveIndicator state={fieldState("execution_workspace_teardown_command")} />
                            </label>
                          </div>
                          <DraftInput
                            value={executionWorkspaceStrategy.teardownCommand ?? ""}
                            onCommit={(value) =>
                              commitField("execution_workspace_teardown_command", {
                                ...updateExecutionWorkspacePolicy({
                                  workspaceStrategy: {
                                    ...executionWorkspaceStrategy,
                                    type: "git_worktree",
                                    teardownCommand: value || null,
                                  },
                                })!,
                              })}
                            immediate
                            className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs font-mono outline-none"
                            placeholder="bash ./scripts/teardown-worktree.sh"
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Provision runs inside the derived worktree before agent execution. Teardown is stored here for
                          future cleanup flows.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
          </div>
        ) : null}
      </section>

      {onUpdate || onFieldUpdate ? (
        <Dialog open={projectSecretsModalOpen} onOpenChange={setProjectSecretsModalOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Project secret mappings</DialogTitle>
              <DialogDescription className="text-xs">
                Map env var names to company secret names. Agents on this project get these env vars at runtime.
              </DialogDescription>
            </DialogHeader>
            <ProjectSecretBindingsEditor
              envConfig={project.envConfig ?? null}
              companySecrets={companySecrets}
              companySettingsPath={companySettingsPath}
              onSave={(next) => {
                commitField("env_config", { envConfig: next });
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {onArchive && (
        <section className="overflow-hidden rounded-xl border border-destructive/25 bg-card shadow-xs">
          <header className="border-b border-destructive/20 bg-destructive/5 px-5 py-3 sm:px-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">Danger zone</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Archiving hides this project from the sidebar and selectors.
            </p>
          </header>
          <div className="px-5 py-4 sm:px-6">
            <ArchiveDangerZone
              project={project}
              onArchive={onArchive}
              archivePending={archivePending}
            />
          </div>
        </section>
      )}
    </div>
  );
}
