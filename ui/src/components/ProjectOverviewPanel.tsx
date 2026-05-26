import type { ReactNode } from "react";
import type { ProjectMaintenanceRequest } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { MarkdownBody } from "@/components/MarkdownBody";
import { DASHBOARD_TILE_SURFACE } from "@/lib/dashboard-tile-styles";
import { cn } from "@/lib/utils";
import {
  Database,
  FileText,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";

export type OverviewMaintenanceType = "context_summary" | "dashboards" | "workflow";

export type OverviewMaintenanceOption = {
  value: OverviewMaintenanceType;
  label: string;
};

export type OverviewContextFile = {
  id: string;
  title: string;
  originalFilename: string;
  extractionStatus: string;
};

export type OverviewDocumentRevision = {
  id: string;
  historyKind: "summary" | "workflow";
  revisionNumber: number;
  createdAt: string;
  changeSummary: string | null;
};

export type OverviewMaintenanceGroups = {
  active: ProjectMaintenanceRequest[];
  userQueued: ProjectMaintenanceRequest[];
  autoQueued: ProjectMaintenanceRequest[];
  completed: ProjectMaintenanceRequest[];
};

const DOCUMENT_EDITOR_TEXTAREA_CLASS =
  "max-h-[26rem] min-h-[10rem] resize-y overflow-y-auto field-sizing-fixed border-primary/60 ring-2 ring-primary/20";
const DOCUMENT_PREVIEW_SCROLL_CLASS =
  "max-h-[26rem] min-h-[10rem] overflow-y-auto overscroll-y-contain";

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

function maintenanceTypeLabel(
  value: OverviewMaintenanceType,
  options: OverviewMaintenanceOption[],
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function OverviewBlock({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("overflow-hidden", DASHBOARD_TILE_SURFACE)}>{children}</div>
    </section>
  );
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
    <article className="flex min-h-[16rem] flex-col bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
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
          <Badge variant="secondary" className="shrink-0">
            Editing
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        {isEditing ? (
          <>
            <Textarea
              value={body}
              onChange={(event) => onBodyChange(event.target.value)}
              rows={10}
              className={cn(DOCUMENT_EDITOR_TEXTAREA_CLASS, "flex-1")}
              placeholder={placeholder}
            />
            <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={isSaving}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={cn(DOCUMENT_PREVIEW_SCROLL_CLASS, "rounded-md bg-muted/15 p-4")}>
              {body.trim().length > 0 ? (
                <MarkdownBody>{previewText}</MarkdownBody>
              ) : (
                <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              )}
            </div>
            {previewTruncated ? (
              <p className="mt-2 text-xs text-muted-foreground">Preview truncated. Edit to view the full document.</p>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

function MaintenanceRequestRow({
  request,
  maintenanceOptions,
  compact = false,
  isAuto,
}: {
  request: ProjectMaintenanceRequest;
  maintenanceOptions: OverviewMaintenanceOption[];
  compact?: boolean;
  isAuto: boolean;
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/20">
      <td className="px-4 py-2.5 align-top">
        <p className="text-sm font-medium">{maintenanceTypeLabel(request.type, maintenanceOptions)}</p>
        <p className={cn("mt-0.5 text-muted-foreground", compact ? "line-clamp-1 text-[11px]" : "line-clamp-2 text-xs")}>
          {isAuto ? "Automatic background sync" : summarizeText(request.description, compact ? 80 : 140)}
        </p>
      </td>
      <td className="hidden px-4 py-2.5 align-top sm:table-cell">
        <StatusBadge status={request.status} />
      </td>
      <td className="px-4 py-2.5 text-right align-top text-xs tabular-nums text-muted-foreground whitespace-nowrap">
        <div className="flex flex-col items-end gap-1 sm:hidden">
          <StatusBadge status={request.status} />
        </div>
        {formatDate(request.createdAt)}
      </td>
    </tr>
  );
}

export function ProjectOverviewPanel({
  dataSchemaReady,
  dataSchemaName,
  referenceFiles,
  activeRequestCount,
  maintenanceOptions,
  maintenanceType,
  onMaintenanceTypeChange,
  maintenanceDescription,
  onMaintenanceDescriptionChange,
  onInsertExample,
  onSendMaintenanceRequest,
  sendMaintenancePending,
  maintenanceGroups,
  maintenanceRequestsEmpty,
  isAutoMaintenanceRequest,
  showCompletedRequests,
  onToggleCompletedRequests,
  contextHistoryItems,
  showDocumentSaveHistory,
  onToggleDocumentSaveHistory,
  summary,
  workflow,
  lockWorkflowMaintenance,
  onSyncFromAgent,
  syncFromAgentPending,
  selectedFiles,
  assetTitle,
  onAssetTitleChange,
  onChooseFiles,
  onUploadFiles,
  uploadFilesPending,
  onReplaceFile,
  onRemoveFile,
  replaceFilePending,
  removeFilePending,
}: {
  dataSchemaReady: boolean;
  dataSchemaName: string | null | undefined;
  referenceFiles: OverviewContextFile[];
  activeRequestCount: number;
  maintenanceOptions: OverviewMaintenanceOption[];
  maintenanceType: OverviewMaintenanceType;
  onMaintenanceTypeChange: (value: OverviewMaintenanceType) => void;
  maintenanceDescription: string;
  onMaintenanceDescriptionChange: (value: string) => void;
  onInsertExample: () => void;
  onSendMaintenanceRequest: () => void;
  sendMaintenancePending: boolean;
  maintenanceGroups: OverviewMaintenanceGroups;
  maintenanceRequestsEmpty: boolean;
  isAutoMaintenanceRequest: (request: ProjectMaintenanceRequest) => boolean;
  showCompletedRequests: boolean;
  onToggleCompletedRequests: () => void;
  contextHistoryItems: OverviewDocumentRevision[];
  showDocumentSaveHistory: boolean;
  onToggleDocumentSaveHistory: () => void;
  summary: {
    body: string;
    previewText: string;
    previewTruncated: boolean;
    isEditing: boolean;
    isSaving: boolean;
    onStartEdit: () => void;
    onCancel: () => void;
    onSave: () => void;
    onBodyChange: (value: string) => void;
  };
  workflow: {
    body: string;
    previewText: string;
    previewTruncated: boolean;
    isEditing: boolean;
    isSaving: boolean;
    onStartEdit: () => void;
    onCancel: () => void;
    onSave: () => void;
    onBodyChange: (value: string) => void;
  };
  lockWorkflowMaintenance: boolean;
  onSyncFromAgent: () => void;
  syncFromAgentPending: boolean;
  selectedFiles: File[];
  assetTitle: string;
  onAssetTitleChange: (value: string) => void;
  onChooseFiles: () => void;
  onUploadFiles: () => void;
  uploadFilesPending: boolean;
  onReplaceFile: (fileId: string) => void;
  onRemoveFile: (fileId: string, title: string) => void;
  replaceFilePending: boolean;
  removeFilePending: boolean;
}) {
  const descriptionLength = maintenanceDescription.trim().length;
  const canSendRequest = descriptionLength >= 20;

  const requestSections = [
    { key: "active", label: "Active", rows: maintenanceGroups.active, compact: false },
    { key: "waiting", label: "Queued", rows: maintenanceGroups.userQueued, compact: false },
    { key: "background", label: "Background sync", rows: maintenanceGroups.autoQueued, compact: true },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project overview</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Knowledge base, project source files, and agent coordination — each in its own area below.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onSyncFromAgent}
          disabled={syncFromAgentPending}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncFromAgentPending && "animate-spin")} />
          Sync knowledge from agent
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={Database}
          iconTint="sky"
          value={dataSchemaReady ? "Ready" : "—"}
          label="Data workspace"
          description={dataSchemaName ?? "Not initialized"}
        />
        <MetricCard
          icon={FileText}
          iconTint="emerald"
          value={referenceFiles.length}
          label="Reference files"
          description="Source documents for this project"
        />
        <MetricCard
          icon={WandSparkles}
          iconTint="violet"
          value={activeRequestCount}
          label="Open agent requests"
          description="Active and queued"
        />
      </div>

      <OverviewBlock
        title="Knowledge base"
        description="Canonical summary and workflow playbook used by humans and agents."
      >
        <div className="grid divide-y divide-border/60 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <ProjectDocumentPanel
            title="Project summary"
            description="Business context, goals, decisions, and SOPs"
            isEditing={summary.isEditing}
            isSaving={summary.isSaving}
            body={summary.body}
            previewText={summary.previewText}
            previewTruncated={summary.previewTruncated}
            placeholder="Purpose, metrics, stakeholders, risks, terminology, and operating procedures."
            emptyMessage="No summary yet. Edit to draft one or send an agent request."
            onStartEdit={summary.onStartEdit}
            onCancel={summary.onCancel}
            onSave={summary.onSave}
            onBodyChange={summary.onBodyChange}
          />
          <ProjectDocumentPanel
            title="Workflow playbook"
            description="Stage purpose, ownership, and handoffs"
            isEditing={workflow.isEditing}
            isSaving={workflow.isSaving}
            body={workflow.body}
            previewText={workflow.previewText}
            previewTruncated={workflow.previewTruncated}
            placeholder="Per stage: purpose, owner, entry/exit, handoffs, and approvals."
            emptyMessage="No workflow summary yet. Edit to draft one or send an agent request."
            onStartEdit={workflow.onStartEdit}
            onCancel={workflow.onCancel}
            onSave={workflow.onSave}
            onBodyChange={workflow.onBodyChange}
            readOnly={lockWorkflowMaintenance}
          />
        </div>
      </OverviewBlock>

      <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
        <div className="space-y-8 lg:col-span-7">
          <OverviewBlock
            title="Agent requests"
            description="Queue work for the agent to update context, workflow, or dashboards. Not for uploading files."
          >
            <div className="space-y-0">
              <div className="space-y-4 border-b border-border/60 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="overview-request-type" className="text-xs text-muted-foreground">
                      Request type
                    </Label>
                    <Select value={maintenanceType} onValueChange={(value) => onMaintenanceTypeChange(value as OverviewMaintenanceType)}>
                      <SelectTrigger id="overview-request-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {maintenanceOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label htmlFor="overview-request-body" className="text-xs text-muted-foreground">
                      Instructions
                    </Label>
                    <Textarea
                      id="overview-request-body"
                      rows={4}
                      value={maintenanceDescription}
                      onChange={(event) => onMaintenanceDescriptionChange(event.target.value)}
                      placeholder="What should change, who it is for, and any constraints."
                      className="min-h-[5.5rem] resize-y text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {canSendRequest
                      ? "Ready to send"
                      : `${20 - descriptionLength} more characters required`}
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={onInsertExample}>
                      Insert example
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSendMaintenanceRequest}
                      disabled={sendMaintenancePending || !canSendRequest}
                    >
                      <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
                      Send to agent
                    </Button>
                  </div>
                </div>
              </div>

              {maintenanceRequestsEmpty ? (
                <div className="p-4 sm:p-5">
                  <EmptyState
                    compact
                    icon={WandSparkles}
                    message="No agent requests"
                    description="Submitted requests and their status will appear here."
                  />
                </div>
              ) : (
                <div className="space-y-5 p-4 sm:p-5">
                  {requestSections.map((section) =>
                    section.rows.length > 0 ? (
                      <div key={section.key}>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          {section.label} ({section.rows.length})
                        </p>
                        <div className="overflow-x-auto rounded-lg border border-border/60">
                          <table className="w-full min-w-[28rem] text-left text-sm">
                            <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
                              <tr>
                                <th className="px-4 py-2 font-medium">Request</th>
                                <th className="hidden px-4 py-2 font-medium sm:table-cell">Status</th>
                                <th className="px-4 py-2 text-right font-medium">Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.rows.map((request) => (
                                <MaintenanceRequestRow
                                  key={request.id}
                                  request={request}
                                  maintenanceOptions={maintenanceOptions}
                                  compact={section.compact}
                                  isAuto={isAutoMaintenanceRequest(request)}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null,
                  )}

                  {maintenanceGroups.completed.length > 0 ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">
                          Completed ({maintenanceGroups.completed.length})
                        </p>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onToggleCompletedRequests}>
                          {showCompletedRequests ? "Hide" : "Show"}
                        </Button>
                      </div>
                      {showCompletedRequests ? (
                        <div className="overflow-x-auto rounded-lg border border-border/60">
                          <table className="w-full min-w-[28rem] text-left text-sm">
                            <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
                              <tr>
                                <th className="px-4 py-2 font-medium">Request</th>
                                <th className="hidden px-4 py-2 font-medium sm:table-cell">Status</th>
                                <th className="px-4 py-2 text-right font-medium">Created</th>
                              </tr>
                            </thead>
                            <tbody>
                              {maintenanceGroups.completed.slice(0, 8).map((request) => (
                                <MaintenanceRequestRow
                                  key={request.id}
                                  request={request}
                                  maintenanceOptions={maintenanceOptions}
                                  compact
                                  isAuto={isAutoMaintenanceRequest(request)}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              {contextHistoryItems.length > 0 ? (
                <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Manual document saves ({contextHistoryItems.length})
                    </p>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onToggleDocumentSaveHistory}>
                      {showDocumentSaveHistory ? "Hide" : "Show"}
                    </Button>
                  </div>
                  {showDocumentSaveHistory ? (
                    <ul className="mt-2 space-y-2">
                      {contextHistoryItems.map((item) => (
                        <li key={item.id} className="rounded-md border border-border/60 px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{item.historyKind === "summary" ? "Summary" : "Workflow"}</Badge>
                            <span className="text-muted-foreground">Rev. {item.revisionNumber}</span>
                            <span className="tabular-nums text-muted-foreground">{formatDate(item.createdAt)}</span>
                          </div>
                          {item.changeSummary ? (
                            <p className="mt-1 text-muted-foreground">{item.changeSummary}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </OverviewBlock>
        </div>

        <div className="lg:col-span-5">
          <OverviewBlock
            title="Reference files"
            description="Project source materials (SOPs, specs, briefs). Used during knowledge sync — separate from agent task requests."
          >
            <div className="border-b border-border/60 p-4 sm:p-5">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={onChooseFiles}>
                    Choose files
                  </Button>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {selectedFiles.length > 0
                      ? selectedFiles.map((file) => file.name).join(", ")
                      : "No files selected"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={onUploadFiles}
                    disabled={uploadFilesPending || selectedFiles.length === 0}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Upload
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="overview-file-title" className="text-xs text-muted-foreground">
                    Display title (optional, single file)
                  </Label>
                  <Input
                    id="overview-file-title"
                    value={assetTitle}
                    onChange={(event) => onAssetTitleChange(event.target.value)}
                    placeholder="e.g. Q2 sales playbook"
                    disabled={selectedFiles.length > 1}
                  />
                </div>
              </div>
            </div>

            {referenceFiles.length === 0 ? (
              <div className="p-4 sm:p-5">
                <EmptyState
                  compact
                  icon={FileText}
                  message="No reference files"
                  description="Upload documents that belong to this project."
                  action="Choose files"
                  onAction={onChooseFiles}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[20rem] text-left text-sm">
                  <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Title</th>
                      <th className="hidden px-4 py-2 font-medium md:table-cell">Filename</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referenceFiles.map((file) => (
                      <tr key={file.id} className="border-b border-border/50 last:border-0 hover:bg-muted/15">
                        <td className="max-w-[10rem] truncate px-4 py-2.5 font-medium">{file.title}</td>
                        <td className="hidden max-w-[12rem] truncate px-4 py-2.5 text-muted-foreground md:table-cell">
                          {file.originalFilename}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={file.extractionStatus} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex gap-0.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              aria-label={`Replace ${file.title}`}
                              disabled={replaceFilePending}
                              onClick={() => onReplaceFile(file.id)}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${file.title}`}
                              disabled={removeFilePending}
                              onClick={() => onRemoveFile(file.id, file.title)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </OverviewBlock>
        </div>
      </div>
    </div>
  );
}
