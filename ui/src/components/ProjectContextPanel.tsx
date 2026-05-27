import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { projectsApi } from "@/api/projects";
import { assetsApi } from "@/api/assets";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { ProjectViewRenderer } from "@/components/ProjectViewRenderer";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import type { ProjectMaintenanceRequest, ProjectView } from "@paperclipai/shared";
import { Database, LayoutDashboard, WandSparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ProjectOverviewLayout,
  type OverviewSection,
} from "@/components/ProjectOverviewLayout";

type MaintenanceType = "context_summary" | "dashboards" | "workflow";

const MAINTENANCE_TYPE_OPTIONS: Array<{ value: MaintenanceType; label: string; shortLabel: string }> = [
  { value: "context_summary", label: "Project summary and context", shortLabel: "Context" },
  { value: "dashboards", label: "Dashboards and reporting", shortLabel: "Dashboards" },
  { value: "workflow", label: "Workflow stages and handoffs", shortLabel: "Workflow" },
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
const AUTO_MAINTENANCE_DESCRIPTIONS = new Set([
  "refresh project context from project updates",
  "refresh project context from newly extracted files",
  "initial project context sync",
  "manual context sync requested.",
]);

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
          "group relative w-full rounded-md px-3 py-2.5 text-left transition-colors",
          selected
            ? "bg-primary/10 text-foreground"
            : "text-foreground/90 hover:bg-muted/40",
        )}
      >
        {selected ? (
          <span
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
            aria-hidden
          />
        ) : null}
        <div className="flex items-start gap-2 pl-1">
          <LayoutDashboard
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              selected ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-sm font-medium leading-snug">{view.name}</span>
              {widgetCount != null ? (
                <span className="shrink-0 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {widgetCount}
                </span>
              ) : null}
            </div>
            {view.description ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{view.description}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
              Updated {formatDate(view.updatedAt)}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

export function ProjectContextPanel({
  projectId,
  companyId,
  projectRef,
  overviewSection = "knowledge",
  mode = "all",
  lockWorkflowMaintenance = false,
}: {
  projectId: string;
  companyId: string;
  /** URL segment for `/projects/:projectRef/...` links from Overview. */
  projectRef: string;
  overviewSection?: OverviewSection;
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
  const [dashboardRequestOpen, setDashboardRequestOpen] = useState(false);
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "dashboards") setMaintenanceType("dashboards");
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

  const dataSchemaReady = Boolean(contextQuery.data?.dataSchemaName);
  const activeMaintenanceCount = maintenanceRequestGroups.active.length + maintenanceRequestGroups.userQueued.length;
  const lastSyncAt = useMemo<string | null>(() => {
    const completed = maintenanceRequests
      .filter((request) => request.type === "context_summary" && request.status === "completed")
      .map((request) => {
        const at = request.completedAt ?? request.updatedAt ?? request.createdAt;
        if (!at) return null;
        if (at instanceof Date) return at.toISOString();
        return typeof at === "string" ? at : null;
      })
      .filter((value): value is string => value != null);
    if (completed.length === 0) return null;
    return completed.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  }, [maintenanceRequests]);

  if (contextQuery.isLoading) {
    if (mode === "dashboards") return <PageSkeleton variant="dashboard" />;
    return <PageSkeleton variant="detail" />;
  }

  const overviewFiles = (filesQuery.data ?? []).slice(0, 50).map((file) => ({
    id: file.id,
    title: file.title,
    originalFilename: file.originalFilename,
    extractionStatus: file.extractionStatus,
  }));

  const referenceFileCount = overviewFiles.length;

  const fileInputs = (
    <>
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
      <input
        key={fileInputResetKey}
        ref={uploadFilesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          setSelectedFiles(files);
          event.target.value = "";
        }}
      />
    </>
  );

  const sharedSummary = {
    body: summaryBody,
    previewText: summaryPreview.text,
    previewTruncated: summaryPreview.truncated,
    isEditing: isEditingSummary,
    isSaving: saveSummaryMutation.isPending,
    onStartEdit: () => setIsEditingSummary(true),
    onCancel: () => {
      setSummaryBody((contextQuery.data?.summary as { body?: string } | null)?.body ?? "");
      setIsEditingSummary(false);
    },
    onSave: () => saveSummaryMutation.mutate(),
    onBodyChange: setSummaryBody,
  };

  const sharedWorkflow = {
    body: workflowBody,
    previewText: workflowPreview.text,
    previewTruncated: workflowPreview.truncated,
    isEditing: isEditingWorkflow,
    isSaving: saveWorkflowMutation.isPending,
    onStartEdit: () => setIsEditingWorkflow(true),
    onCancel: () => {
      setWorkflowBody((contextQuery.data?.workflowSummary as { body?: string } | null)?.body ?? "");
      setIsEditingWorkflow(false);
    },
    onSave: () => saveWorkflowMutation.mutate(),
    onBodyChange: setWorkflowBody,
  };

  return (
    <div className={cn("space-y-5", mode === "dashboards" && "space-y-4")}>
      {mode === "context" || mode === "all" ? (
        <>
          {fileInputs}
          <ProjectOverviewLayout
            projectRef={projectRef}
            section={overviewSection}
            referenceFileCount={referenceFileCount}
            activeRequestCount={activeMaintenanceCount}
            onSyncFromAgent={() => triggerSyncMutation.mutate()}
            syncFromAgentPending={triggerSyncMutation.isPending}
            dataSchemaReady={dataSchemaReady}
            dataSchemaName={contextQuery.data?.dataSchemaName ?? null}
            lastSyncAt={lastSyncAt}
            summary={sharedSummary}
            workflow={sharedWorkflow}
            lockWorkflowMaintenance={lockWorkflowMaintenance}
            files={overviewFiles}
            selectedFiles={selectedFiles}
            assetTitle={assetTitle}
            onAssetTitleChange={setAssetTitle}
            onChooseFiles={() => uploadFilesInputRef.current?.click()}
            onUploadFiles={() => addFileMutation.mutate()}
            uploadFilesPending={addFileMutation.isPending}
            onReplaceFile={(fileId) => {
              setReplacingFileId(fileId);
              replaceFileInputRef.current?.click();
            }}
            onRemoveFile={(fileId, title) => {
              if (!window.confirm(`Remove "${title}" from this project?`)) return;
              removeFileMutation.mutate(fileId);
            }}
            replaceFilePending={replaceFileMutation.isPending}
            removeFilePending={removeFileMutation.isPending}
            maintenanceOptions={maintenanceTypeOptions}
            maintenanceType={maintenanceType}
            onMaintenanceTypeChange={setMaintenanceType}
            maintenanceDescription={maintenanceDescription}
            onMaintenanceDescriptionChange={setMaintenanceDescription}
            onInsertExample={() => setMaintenanceDescription(MAINTENANCE_TEMPLATES[maintenanceType])}
            onSendMaintenanceRequest={() =>
              createMaintenanceMutation.mutate({ type: maintenanceType, description: maintenanceDescription })
            }
            sendMaintenancePending={createMaintenanceMutation.isPending}
            maintenanceGroups={maintenanceRequestGroups}
            maintenanceRequestsEmpty={maintenanceRequests.length === 0 && contextHistoryItems.length === 0}
            isAutoMaintenanceRequest={isAutoMaintenanceRequest}
            showCompletedRequests={showCompletedRequests}
            onToggleCompletedRequests={() => setShowCompletedRequests((value) => !value)}
            contextHistoryItems={contextHistoryItems}
            showDocumentSaveHistory={showDocumentSaveHistory}
            onToggleDocumentSaveHistory={() => setShowDocumentSaveHistory((value) => !value)}
          />
        </>
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
      <div className="flex h-[calc(100vh-12rem)] min-h-[32rem] flex-col lg:flex-row lg:gap-0">
        <aside className="flex flex-col border-b border-border/60 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r lg:pr-4">
          <div className="flex items-center justify-between gap-2 pb-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">Dashboards</h3>
              {dashboardViews.length > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">{dashboardViews.length}</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMaintenanceDescription("");
                setDashboardRequestOpen(true);
              }}
            >
              <WandSparkles className="h-3.5 w-3.5" />
              Request
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto pr-1">
            {viewsQuery.isLoading ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
            ) : dashboardViews.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-6 text-center">
                <LayoutDashboard className="mx-auto mb-2 h-5 w-5 text-muted-foreground/70" />
                <p className="text-xs font-medium">No dashboards yet</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Use Request to ask the agent for one.
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
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
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto pt-4 lg:pl-6 lg:pt-0">
          {selectedDashboard ? (
            <div>
              <header className="flex flex-wrap items-start justify-between gap-3 pb-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{selectedDashboard.name}</h2>
                  {selectedDashboard.description ? (
                    <p className="mt-1 max-w-prose text-sm text-muted-foreground">{selectedDashboard.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {(widgetsQuery.data ?? []).length > 0 ? (
                    <span className="tabular-nums">
                      {(widgetsQuery.data ?? []).length} widget{(widgetsQuery.data ?? []).length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span className="tabular-nums">Updated {formatDate(selectedDashboard.updatedAt)}</span>
                </div>
              </header>
              {widgetsQuery.isLoading || widgetDataQuery.isLoading ? (
                <PageSkeleton variant="dashboard" />
              ) : (widgetsQuery.data ?? []).length === 0 ? (
                <EmptyState icon={LayoutDashboard} message="This dashboard has no widgets yet." />
              ) : (
                <ProjectViewRenderer widgets={widgetsQuery.data ?? []} widgetDataById={widgetDataById} />
              )}
            </div>
          ) : dashboardViews.length > 0 ? (
            <div className="flex h-full min-h-[16rem] flex-col items-center justify-center text-center">
              <LayoutDashboard className="mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Select a dashboard</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Choose a dashboard from the list to load its widgets and metrics.
              </p>
            </div>
          ) : null}
          {dashboardHistoryItems.length > 0 ? (
            <div className="mt-8 border-t border-border/60 pt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Recent dashboard activity
              </p>
              <ul className="mt-3 space-y-2">
                {dashboardHistoryItems.slice(0, 5).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusBadge status={item.status} />
                      <span className="min-w-0 truncate">
                        <span className="text-foreground/85">{item.headline}</span>
                        {item.detail ? <span className="text-muted-foreground"> — {item.detail}</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatDate(item.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </main>
      </div>
      ) : null}

      <Sheet open={dashboardRequestOpen} onOpenChange={setDashboardRequestOpen}>
        <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border/60 px-6 py-4">
            <SheetTitle>Request a dashboard</SheetTitle>
            <SheetDescription>
              The agent will draft a new dashboard based on the brief below.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="dashboard-request-body" className="text-xs font-medium text-muted-foreground">
                  Describe the dashboard
                </label>
                <Textarea
                  id="dashboard-request-body"
                  rows={5}
                  value={maintenanceDescription}
                  onChange={(event) => setMaintenanceDescription(event.target.value)}
                  placeholder="Audience, metrics, time range, breakdowns. Minimum 20 characters."
                  className="min-h-[8rem] resize-y text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  {maintenanceDescription.trim().length < 20
                    ? `${20 - maintenanceDescription.trim().length} more characters required`
                    : "Ready to send"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-auto px-0 text-xs text-muted-foreground"
                onClick={() => setMaintenanceDescription(MAINTENANCE_TEMPLATES.dashboards)}
              >
                Use example brief
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-6 py-4">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDashboardRequestOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                createMaintenanceMutation.mutate({ type: "dashboards", description: maintenanceDescription });
                setDashboardRequestOpen(false);
              }}
              disabled={createMaintenanceMutation.isPending || maintenanceDescription.trim().length < 20}
            >
              <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
              Send to agent
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
