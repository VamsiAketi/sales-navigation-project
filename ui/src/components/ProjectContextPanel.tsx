import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { projectsApi } from "@/api/projects";
import { assetsApi } from "@/api/assets";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { ProjectViewRenderer } from "@/components/ProjectViewRenderer";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { MarkdownBody } from "@/components/MarkdownBody";
import type { ProjectMaintenanceRequest, ProjectView } from "@paperclipai/shared";
import { FileText, Database, LayoutDashboard, Pencil, RefreshCw, Trash2, WandSparkles } from "lucide-react";

type MaintenanceType = "context_summary" | "dashboards" | "workflow";

const MAINTENANCE_TYPE_OPTIONS: Array<{ value: MaintenanceType; label: string }> = [
  { value: "context_summary", label: "Project summary and context" },
  { value: "dashboards", label: "Dashboards and reporting" },
  { value: "workflow", label: "Workflow stages and handoffs" },
];

const MAINTENANCE_TEMPLATES: Record<MaintenanceType, string> = {
  context_summary:
    "Refresh the project summary as business context for humans and agents: purpose, success metrics, goals, decisions, risks/blockers, timeline, key stakeholders and terminology, and any human or agent SOPs from our files. Synthesize — do not paste raw extracts or API/technical details. Keep per-stage rules in the workflow document.",
  dashboards:
    "Please add or update dashboard widgets so leadership can track weekly progress, conversion, and bottlenecks.",
  workflow:
    "Set up a complete sales workflow for this project: review all existing stages, add any missing pipeline stages (lead, qualified, proposal, won/lost, etc.), configure transitions and default assignees between stages, and rewrite the workflow summary as a business playbook (per-stage purpose, ownership, entry/exit, handoffs, approvals). Do not only adjust transition validations on existing stages, and do not put API or technical field names in the workflow summary document.",
};
const PREVIEW_CHAR_LIMIT = 12_000;
const DOCUMENT_EDITOR_TEXTAREA_CLASS =
  "max-h-[28rem] min-h-[12rem] resize-y overflow-y-auto field-sizing-fixed border-primary/60 ring-2 ring-primary/20";
const DOCUMENT_PREVIEW_SCROLL_CLASS =
  "max-h-[28rem] min-h-[12rem] overflow-y-auto overscroll-y-contain";
const AUTO_MAINTENANCE_DESCRIPTIONS = new Set([
  "refresh project context from project updates",
  "refresh project context from newly extracted files",
  "initial project context sync",
  "manual context sync requested.",
]);

function maintenanceTypeLabel(value: MaintenanceType): string {
  return MAINTENANCE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toLocaleString();
}

function summarizeText(value: string, maxLength = 140): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

function isAutoMaintenanceRequest(request: ProjectMaintenanceRequest): boolean {
  return AUTO_MAINTENANCE_DESCRIPTIONS.has(request.description.trim().toLowerCase());
}

function clampPreviewBody(value: string): { text: string; truncated: boolean } {
  if (value.length <= PREVIEW_CHAR_LIMIT) return { text: value, truncated: false };
  return { text: `${value.slice(0, PREVIEW_CHAR_LIMIT)}\n\n---\nPreview truncated for readability. Use manual edit to view full content.`, truncated: true };
}

function ProjectDocumentPanel({
  title,
  description,
  isEditing,
  isSaving,
  body,
  previewText,
  previewTruncated,
  placeholder,
  emptyMessage,
  onStartEdit,
  onCancel,
  onSave,
  onBodyChange,
  readOnly = false,
}: {
  title: string;
  description: string;
  isEditing: boolean;
  isSaving: boolean;
  body: string;
  previewText: string;
  previewTruncated: boolean;
  placeholder: string;
  emptyMessage: string;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onBodyChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="flex min-h-[22rem] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {readOnly ? (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            Read-only
          </Badge>
        ) : !isEditing ? (
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onStartEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        ) : (
          <Badge variant="secondary" className="shrink-0">Editing</Badge>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {isEditing ? (
          <>
            <Textarea
              value={body}
              onChange={(event) => onBodyChange(event.target.value)}
              rows={12}
              className={cn(DOCUMENT_EDITOR_TEXTAREA_CLASS, "flex-1")}
              placeholder={placeholder}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <Button size="sm" onClick={onSave} disabled={isSaving}>
                Save draft
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={cn(DOCUMENT_PREVIEW_SCROLL_CLASS, "rounded-md border border-border/60 bg-muted/20 p-4")}>
              {body.trim().length > 0 ? (
                <MarkdownBody>{previewText}</MarkdownBody>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">{emptyMessage}</p>
              )}
            </div>
            {previewTruncated ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Preview truncated for readability. Edit to view the full document.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function DashboardListItem({
  view,
  selected,
  widgetCount,
  onSelect,
}: {
  view: ProjectView;
  selected: boolean;
  widgetCount: number | null;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
          selected
            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
            : "border-border/70 bg-background hover:bg-muted/30",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-snug">{view.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatDate(view.updatedAt)}
          </span>
        </div>
        {view.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{view.description}</p>
        ) : null}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {widgetCount != null ? `${widgetCount} widget${widgetCount === 1 ? "" : "s"}` : "Select to preview"}
        </p>
      </button>
    </li>
  );
}

function MaintenanceRequestRow({
  request,
  compact = false,
}: {
  request: ProjectMaintenanceRequest;
  compact?: boolean;
}) {
  const auto = isAutoMaintenanceRequest(request);
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5",
        auto ? "border-border/50 bg-muted/15" : "border-border/70 bg-background",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{maintenanceTypeLabel(request.type)}</p>
        <p className={cn("mt-0.5 text-muted-foreground", compact ? "text-[11px] line-clamp-1" : "text-xs line-clamp-2")}>
          {auto ? "Automatic background sync" : summarizeText(request.description, compact ? 90 : 160)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={request.status} />
        <span className="text-[11px] text-muted-foreground">{formatDate(request.createdAt)}</span>
      </div>
    </div>
  );
}

export function ProjectContextPanel({
  projectId,
  companyId,
  mode = "all",
  lockWorkflowMaintenance = false,
}: {
  projectId: string;
  companyId: string;
  mode?: "all" | "context" | "data" | "dashboards";
  /** When true (AI-Admin Project), workflow maintenance requests are hidden. */
  lockWorkflowMaintenance?: boolean;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [summaryBody, setSummaryBody] = useState("");
  const [workflowBody, setWorkflowBody] = useState("");
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false);
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>("context_summary");
  const [maintenanceDescription, setMaintenanceDescription] = useState("");
  const [assetTitle, setAssetTitle] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInputResetKey, setFileInputResetKey] = useState(0);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [showCompletedRequests, setShowCompletedRequests] = useState(false);
  const [showDocumentSaveHistory, setShowDocumentSaveHistory] = useState(false);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "dashboards") setMaintenanceType("dashboards");
    if (mode === "context") setMaintenanceType("context_summary");
  }, [mode]);

  const contextQuery = useQuery({
    queryKey: queryKeys.projects.context(projectId),
    queryFn: () => projectsApi.getContext(projectId, companyId),
    enabled: Boolean(projectId && companyId),
  });
  const filesQuery = useQuery({
    queryKey: queryKeys.projects.contextFiles(projectId),
    queryFn: () => projectsApi.listContextFiles(projectId, companyId),
    enabled: Boolean(projectId && companyId),
  });
  const dataObjectsQuery = useQuery({
    queryKey: queryKeys.projects.dataObjects(projectId),
    queryFn: () => projectsApi.listDataObjects(projectId, companyId),
    enabled: Boolean(projectId && companyId),
  });
  const viewsQuery = useQuery({
    queryKey: queryKeys.projects.views(projectId),
    queryFn: () => projectsApi.listViews(projectId, companyId),
    enabled: Boolean(projectId && companyId && (mode === "all" || mode === "dashboards")),
  });
  const widgetsQuery = useQuery({
    queryKey: queryKeys.projects.viewWidgets(projectId, selectedViewId || "__none__"),
    queryFn: () => projectsApi.listViewWidgets(projectId, selectedViewId, companyId),
    enabled: Boolean(projectId && companyId && selectedViewId),
  });
  const widgetDataQuery = useQuery({
    queryKey: queryKeys.projects.viewWidgetData(projectId, selectedViewId || "__none__"),
    queryFn: () => projectsApi.getViewWidgetData(projectId, selectedViewId, companyId),
    enabled: Boolean(projectId && companyId && selectedViewId),
  });
  const summaryRevisionsQuery = useQuery({
    queryKey: ["projects", "document-revisions", projectId, "summary"],
    queryFn: () => projectsApi.listProjectDocumentRevisions(projectId, "summary", companyId),
    enabled: Boolean(projectId && companyId && (mode === "all" || mode === "context")),
  });
  const workflowRevisionsQuery = useQuery({
    queryKey: ["projects", "document-revisions", projectId, "workflow"],
    queryFn: () => projectsApi.listProjectDocumentRevisions(projectId, "workflow", companyId),
    enabled: Boolean(projectId && companyId && (mode === "all" || mode === "context")),
  });

  useEffect(() => {
    if (!isEditingSummary) {
      setSummaryBody((contextQuery.data?.summary as { body?: string } | null)?.body ?? "");
    }
    if (!isEditingWorkflow) {
      setWorkflowBody((contextQuery.data?.workflowSummary as { body?: string } | null)?.body ?? "");
    }
  }, [contextQuery.data?.summary, contextQuery.data?.workflowSummary, isEditingSummary, isEditingWorkflow]);

  useEffect(() => {
    if (!selectedViewId && viewsQuery.data && viewsQuery.data.length > 0) {
      setSelectedViewId(viewsQuery.data[0]!.id);
    }
  }, [selectedViewId, viewsQuery.data]);

  const refreshContext = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.context(projectId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.contextFiles(projectId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.dataObjects(projectId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.views(projectId) });
    queryClient.invalidateQueries({ queryKey: ["projects", "document-revisions", projectId, "summary"] });
    queryClient.invalidateQueries({ queryKey: ["projects", "document-revisions", projectId, "workflow"] });
    if (selectedViewId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.viewWidgets(projectId, selectedViewId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.viewWidgetData(projectId, selectedViewId) });
    }
  };

  const triggerSyncMutation = useMutation({
    mutationFn: () => projectsApi.triggerContextSync(projectId, companyId),
    onSuccess: () => {
      pushToast({ title: "Context sync queued", tone: "success" });
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to queue sync", tone: "error" });
    },
  });

  const saveSummaryMutation = useMutation({
    mutationFn: () =>
      projectsApi.upsertProjectDocument(
        projectId,
        "summary",
        { format: "markdown", body: summaryBody, title: "Project Summary" },
        companyId,
      ),
    onSuccess: () => {
      pushToast({ title: "Summary saved", tone: "success" });
      setIsEditingSummary(false);
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to save summary", tone: "error" });
    },
  });

  const saveWorkflowMutation = useMutation({
    mutationFn: () =>
      projectsApi.upsertProjectDocument(
        projectId,
        "workflow",
        { format: "markdown", body: workflowBody, title: "Workflow Summary" },
        companyId,
      ),
    onSuccess: () => {
      pushToast({ title: "Workflow summary saved", tone: "success" });
      setIsEditingWorkflow(false);
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to save workflow summary", tone: "error" });
    },
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: (input: { type: MaintenanceType; description: string }) =>
      projectsApi.createMaintenanceRequest(
        projectId,
        {
          type: input.type,
          description: input.description,
        },
        companyId,
      ),
    onSuccess: () => {
      pushToast({ title: "Maintenance request created", tone: "success" });
      setMaintenanceDescription("");
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to create maintenance request", tone: "error" });
    },
  });

  const removeFileMutation = useMutation({
    mutationFn: (fileId: string) => projectsApi.deleteContextFile(projectId, fileId, companyId),
    onSuccess: () => {
      pushToast({ title: "Reference document removed", tone: "success" });
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to remove file", tone: "error" });
    },
  });

  const replaceFileMutation = useMutation({
    mutationFn: async ({ fileId, file }: { fileId: string; file: File }) => {
      const uploaded = await assetsApi.uploadImage(companyId, file, `projects/${projectId}/context`);
      await projectsApi.addContextFile(
        projectId,
        { assetId: uploaded.assetId, title: file.name },
        companyId,
      );
      await projectsApi.deleteContextFile(projectId, fileId, companyId);
    },
    onSuccess: () => {
      pushToast({ title: "Reference document replaced", tone: "success" });
      setReplacingFileId(null);
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to replace file", tone: "error" });
      setReplacingFileId(null);
    },
  });

  const addFileMutation = useMutation({
    mutationFn: async () => {
      if (selectedFiles.length === 0) throw new Error("Select at least one file to upload.");
      for (const file of selectedFiles) {
        const uploaded = await assetsApi.uploadImage(companyId, file, `projects/${projectId}/context`);
        const resolvedTitle = selectedFiles.length === 1 && assetTitle.trim().length > 0
          ? assetTitle.trim()
          : file.name;
        await projectsApi.addContextFile(
          projectId,
          {
            assetId: uploaded.assetId,
            ...(resolvedTitle ? { title: resolvedTitle } : {}),
          },
          companyId,
        );
      }
    },
    onSuccess: () => {
      pushToast({ title: "Reference documents uploaded", tone: "success" });
      setAssetTitle("");
      setSelectedFiles([]);
      setFileInputResetKey((value) => value + 1);
      refreshContext();
    },
    onError: (error) => {
      pushToast({ title: error instanceof Error ? error.message : "Failed to upload reference files", tone: "error" });
    },
  });

  const maintenanceRequests = useMemo(
    () => contextQuery.data?.maintenanceRequests ?? [],
    [contextQuery.data?.maintenanceRequests],
  );
  const maintenanceRequestGroups = useMemo(() => {
    const active = maintenanceRequests.filter((request) =>
      request.status === "in_progress" || request.status === "pending" || request.status === "pending_approval",
    );
    const queued = maintenanceRequests.filter((request) => request.status === "queued");
    const completed = maintenanceRequests.filter((request) =>
      request.status === "completed" || request.status === "failed" || request.status === "cancelled",
    );
    const userQueued = queued.filter((request) => !isAutoMaintenanceRequest(request));
    const autoQueued = queued.filter((request) => isAutoMaintenanceRequest(request));
    return { active, userQueued, autoQueued, completed };
  }, [maintenanceRequests]);
  const contextHistoryItems = useMemo(() => {
    const summary = (summaryRevisionsQuery.data ?? []).map((item) => ({
      ...item,
      historyKind: "summary" as const,
    }));
    const workflow = (workflowRevisionsQuery.data ?? []).map((item) => ({
      ...item,
      historyKind: "workflow" as const,
    }));
    return [...summary, ...workflow]
      .sort((a, b) => {
        const aTs = new Date(a.createdAt).getTime();
        const bTs = new Date(b.createdAt).getTime();
        return bTs - aTs;
      })
      .slice(0, 12);
  }, [summaryRevisionsQuery.data, workflowRevisionsQuery.data]);
  const widgetDataById = useMemo(() => {
    const result: Record<string, { rows: Record<string, unknown>[]; error: string | null }> = {};
    for (const item of widgetDataQuery.data?.widgets ?? []) {
      result[item.widgetId] = {
        rows: item.data?.rows ?? [],
        error: item.error,
      };
    }
    return result;
  }, [widgetDataQuery.data?.widgets]);

  const dashboardViews = useMemo(() => {
    return [...(viewsQuery.data ?? [])].sort((a, b) => {
      const aTs = new Date(a.updatedAt).getTime();
      const bTs = new Date(b.updatedAt).getTime();
      return bTs - aTs;
    });
  }, [viewsQuery.data]);

  const selectedDashboard = useMemo(
    () => dashboardViews.find((view) => view.id === selectedViewId) ?? null,
    [dashboardViews, selectedViewId],
  );

  const maintenanceTypeOptions = useMemo(
    () =>
      lockWorkflowMaintenance
        ? MAINTENANCE_TYPE_OPTIONS.filter((option) => option.value !== "workflow")
        : MAINTENANCE_TYPE_OPTIONS,
    [lockWorkflowMaintenance],
  );

  useEffect(() => {
    if (lockWorkflowMaintenance && maintenanceType === "workflow") {
      setMaintenanceType("context_summary");
    }
  }, [lockWorkflowMaintenance, maintenanceType]);

  const dashboardHistoryItems = useMemo(() => {
    return maintenanceRequests
      .filter((request) => request.type === "dashboards")
      .map((request) => ({
        id: request.id,
        at: request.completedAt ?? request.updatedAt ?? request.createdAt,
        status: request.status,
        headline:
          request.status === "completed"
            ? "Request completed"
            : request.status === "failed"
              ? "Request failed"
              : request.status === "in_progress"
                ? "Request in progress"
                : "Request queued",
        detail: request.changeSummary ?? request.failureReason ?? summarizeText(request.description, 100),
      }))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);
  }, [maintenanceRequests]);

  const summaryPreview = clampPreviewBody(summaryBody);
  const workflowPreview = clampPreviewBody(workflowBody);

  if (contextQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading context...</p>;
  }

  return (
    <div className="space-y-6">
      {(mode === "all" || mode === "context") ? (
      <Card>
        <CardHeader>
          <CardTitle>Project knowledge</CardTitle>
          <CardDescription>
            Business project summary (context and SOPs) plus a workflow playbook (rules per stage). Use agent requests below for AI-driven updates.
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => triggerSyncMutation.mutate()}
              disabled={triggerSyncMutation.isPending}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", triggerSyncMutation.isPending && "animate-spin")} />
              Refresh from agent
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4 shrink-0" />
            <span>
              Data workspace{" "}
              <span className="font-medium text-foreground">
                {contextQuery.data?.dataSchemaName ? "ready" : "not initialized"}
              </span>
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
            <ProjectDocumentPanel
              title="Summary"
              description="Business context, SOPs, decisions, and risks — for humans and agents"
              isEditing={isEditingSummary}
              isSaving={saveSummaryMutation.isPending}
              body={summaryBody}
              previewText={summaryPreview.text}
              previewTruncated={summaryPreview.truncated}
              placeholder="Purpose, metrics, goals, decisions, risks, stakeholders, terminology, human/agent SOPs. Plain language — no API or config dumps."
              emptyMessage="No summary yet. Edit to add one, or send an agent request below."
              onStartEdit={() => setIsEditingSummary(true)}
              onCancel={() => {
                setSummaryBody((contextQuery.data?.summary as { body?: string } | null)?.body ?? "");
                setIsEditingSummary(false);
              }}
              onSave={() => saveSummaryMutation.mutate()}
              onBodyChange={setSummaryBody}
            />
            <ProjectDocumentPanel
              title="Workflow"
              description="Business rules and stage context for agents — not technical board configuration"
              isEditing={isEditingWorkflow}
              isSaving={saveWorkflowMutation.isPending}
              body={workflowBody}
              previewText={workflowPreview.text}
              previewTruncated={workflowPreview.truncated}
              placeholder="Per stage: purpose, owner role, entry/exit criteria, handoffs, approvals. Plain language only — no API paths or field names."
              emptyMessage="No workflow summary yet. Edit to add one, or send an agent request below."
              onStartEdit={() => setIsEditingWorkflow(true)}
              onCancel={() => {
                setWorkflowBody((contextQuery.data?.workflowSummary as { body?: string } | null)?.body ?? "");
                setIsEditingWorkflow(false);
              }}
              onSave={() => saveWorkflowMutation.mutate()}
              onBodyChange={setWorkflowBody}
              readOnly={lockWorkflowMaintenance}
            />
          </div>
        </CardContent>
      </Card>
      ) : null}

      {(mode === "all" || mode === "context") ? (
      <Card>
        <CardHeader>
          <CardTitle>Agent requests</CardTitle>
          <CardDescription>
            Send one-off tasks to the agent and track their status. Manual summary and workflow saves are listed at the bottom.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New request</p>
            <div className="flex flex-wrap gap-2">
              {maintenanceTypeOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={maintenanceType === option.value ? "default" : "outline"}
                  onClick={() => setMaintenanceType(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Textarea
              rows={3}
              value={maintenanceDescription}
              onChange={(event) => setMaintenanceDescription(event.target.value)}
              placeholder="Describe what should change and why (at least 20 characters)."
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMaintenanceDescription(MAINTENANCE_TEMPLATES[maintenanceType])}
              >
                Use example
              </Button>
              <Button
                size="sm"
                onClick={() => createMaintenanceMutation.mutate({ type: maintenanceType, description: maintenanceDescription })}
                disabled={createMaintenanceMutation.isPending || maintenanceDescription.trim().length < 20}
              >
                Send to agent
              </Button>
            </div>
          </div>
          {maintenanceRequests.length === 0 && contextHistoryItems.length === 0 ? (
            <EmptyState
              icon={WandSparkles}
              message="No agent requests yet. Send one above when you want the agent to update context, workflow, or dashboards."
            />
          ) : null}
          {maintenanceRequests.length > 0 ? (
            <div className="space-y-4">
              {maintenanceRequestGroups.active.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Active ({maintenanceRequestGroups.active.length})
                  </p>
                  {maintenanceRequestGroups.active.map((request) => (
                    <MaintenanceRequestRow key={request.id} request={request} />
                  ))}
                </div>
              ) : null}

              {maintenanceRequestGroups.userQueued.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Waiting ({maintenanceRequestGroups.userQueued.length})
                  </p>
                  {maintenanceRequestGroups.userQueued.map((request) => (
                    <MaintenanceRequestRow key={request.id} request={request} />
                  ))}
                </div>
              ) : null}

              {maintenanceRequestGroups.autoQueued.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Background sync ({maintenanceRequestGroups.autoQueued.length})
                  </p>
                  {maintenanceRequestGroups.autoQueued.map((request) => (
                    <MaintenanceRequestRow key={request.id} request={request} compact />
                  ))}
                </div>
              ) : null}

              {maintenanceRequestGroups.completed.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Finished ({maintenanceRequestGroups.completed.length})
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setShowCompletedRequests((value) => !value)}
                    >
                      {showCompletedRequests ? "Hide" : "Show"}
                    </Button>
                  </div>
                  {showCompletedRequests
                    ? maintenanceRequestGroups.completed.slice(0, 8).map((request) => (
                        <MaintenanceRequestRow key={request.id} request={request} compact />
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {contextHistoryItems.length > 0 ? (
            <div className="space-y-2 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Manual document saves ({contextHistoryItems.length})
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowDocumentSaveHistory((value) => !value)}
                >
                  {showDocumentSaveHistory ? "Hide" : "Show"}
                </Button>
              </div>
              {showDocumentSaveHistory
                ? contextHistoryItems.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border/70 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.historyKind === "summary" ? "Summary" : "Workflow"}</Badge>
                        <span className="text-xs text-muted-foreground">Revision {item.revisionNumber}</span>
                        <span className="text-[11px] text-muted-foreground">{formatDate(item.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.changeSummary ?? "No save note provided."}
                      </p>
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {(mode === "all" || mode === "context") ? (
      <Card>
        <CardHeader>
          <CardTitle>Reference Documents</CardTitle>
          <CardDescription>Upload files directly here. We will attach them to this project automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={replaceFileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file || !replacingFileId) return;
              replaceFileMutation.mutate({ fileId: replacingFileId, file });
              event.target.value = "";
            }}
          />
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add documents</p>
            <div className="grid gap-2 sm:grid-cols-2">
            <Input
              key={fileInputResetKey}
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                setSelectedFiles(files);
              }}
            />
            <Input
              value={assetTitle}
              onChange={(event) => setAssetTitle(event.target.value)}
              placeholder="Optional title (single file upload)"
              />
            </div>
            {selectedFiles.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedFiles.map((file) => file.name).join(", ")}
              </p>
            ) : null}
            <Button size="sm" onClick={() => addFileMutation.mutate()} disabled={addFileMutation.isPending || selectedFiles.length === 0}>
              Upload and attach
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attached files</p>
            {(filesQuery.data ?? []).slice(0, 20).map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{file.originalFilename}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={file.extractionStatus} />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    aria-label={`Replace ${file.title}`}
                    disabled={replaceFileMutation.isPending}
                    onClick={() => {
                      setReplacingFileId(file.id);
                      replaceFileInputRef.current?.click();
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    aria-label={`Remove ${file.title}`}
                    disabled={removeFileMutation.isPending}
                    onClick={() => {
                      if (!window.confirm(`Remove "${file.title}" from this project?`)) return;
                      removeFileMutation.mutate(file.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {(filesQuery.data ?? []).length === 0 ? (
              <EmptyState icon={FileText} message="No reference documents yet." />
            ) : null}
          </div>
        </CardContent>
      </Card>
      ) : null}

      {(mode === "all" || mode === "data") ? (
      <Card>
        <CardHeader>
          <CardTitle>Project Data Objects</CardTitle>
          <CardDescription>Read-only view of the business data structures the agent is using for reporting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-border/70 p-2 text-sm">
              <p className="text-xs text-muted-foreground">Schema</p>
              <p className="font-medium">{contextQuery.data?.dataSchemaName ?? "not initialized"}</p>
            </div>
            <div className="rounded border border-border/70 p-2 text-sm">
              <p className="text-xs text-muted-foreground">Objects</p>
              <p className="font-medium">{(dataObjectsQuery.data ?? []).length}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Available data objects</p>
            {(dataObjectsQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Database} message="No data objects yet. Ask the agent to set up reporting tables first." />
            ) : (
              <div className="space-y-2">
                {(dataObjectsQuery.data ?? []).map((obj) => (
                  <div key={obj.id} className="rounded border border-border/70 p-2 text-sm">
                    <span className="font-medium">{obj.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{obj.kind}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      ) : null}

      {(mode === "all" || mode === "dashboards") ? (
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border/60 py-5">
          <CardTitle>Project dashboards</CardTitle>
          <CardDescription>
            Browse dashboards for this project. Request a new one from the agent when you need another view.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 py-5">
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Request from agent</p>
            <Textarea
              rows={2}
              value={maintenanceDescription}
              onChange={(event) => setMaintenanceDescription(event.target.value)}
              placeholder="Describe the dashboard you want and who will use it."
              className="text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMaintenanceDescription(MAINTENANCE_TEMPLATES.dashboards)}
              >
                Example request
              </Button>
              <Button
                size="sm"
                onClick={() => createMaintenanceMutation.mutate({ type: "dashboards", description: maintenanceDescription })}
                disabled={createMaintenanceMutation.isPending || maintenanceDescription.trim().length < 20}
              >
                Request via agent
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Dashboards</p>
              {dashboardViews.length > 0 ? (
                <span className="text-xs text-muted-foreground">{dashboardViews.length} total</span>
              ) : null}
            </div>
            {viewsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading dashboards…</p>
            ) : dashboardViews.length === 0 ? (
              <EmptyState icon={LayoutDashboard} message="No dashboards yet. Use “Request via agent” above to create one." />
            ) : (
              <ul className="space-y-2">
                {dashboardViews.map((view) => (
                  <DashboardListItem
                    key={view.id}
                    view={view}
                    selected={selectedViewId === view.id}
                    widgetCount={selectedViewId === view.id ? (widgetsQuery.data ?? []).length : null}
                    onSelect={() => setSelectedViewId(view.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {selectedDashboard ? (
            <div className="space-y-3 border-t border-border/60 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{selectedDashboard.name}</h3>
                  {selectedDashboard.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{selectedDashboard.description}</p>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Updated {formatDate(selectedDashboard.updatedAt)}
                </span>
              </div>
              {widgetsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading widgets…</p>
              ) : (widgetsQuery.data ?? []).length === 0 ? (
                <EmptyState icon={LayoutDashboard} message="This dashboard has no widgets yet." />
              ) : (
                <ProjectViewRenderer widgets={widgetsQuery.data ?? []} widgetDataById={widgetDataById} />
              )}
            </div>
          ) : dashboardViews.length > 0 ? (
            <p className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
              Select a dashboard to preview its widgets.
            </p>
          ) : null}
        </CardContent>
        {dashboardHistoryItems.length > 0 ? (
          <CardFooter className="flex-col items-stretch gap-2 border-t border-border/60 bg-muted/10 px-6 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent activity</p>
            <ul className="space-y-1.5">
              {dashboardHistoryItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="min-w-0 truncate">
                      <span className="text-foreground/80">{item.headline}</span>
                      {item.detail ? <span> — {item.detail}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatDate(item.at)}</span>
                </li>
              ))}
            </ul>
          </CardFooter>
        ) : null}
      </Card>
      ) : null}
    </div>
  );
}
