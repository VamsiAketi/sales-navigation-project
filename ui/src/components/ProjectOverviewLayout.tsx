import { useState, type ReactNode } from "react";
import type { ProjectMaintenanceRequest } from "@paperclipai/shared";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Database, FileText, RefreshCw, WandSparkles } from "lucide-react";
import { ProjectAgentRequestsPanel } from "@/components/ProjectAgentRequestsPanel";
import { ProjectReferenceFilesPanel } from "@/components/ProjectReferenceFilesPanel";
import {
  ProjectDocumentPanel,
  type OverviewContextFile,
  type OverviewDocumentRevision,
  type OverviewMaintenanceGroups,
  type OverviewMaintenanceOption,
  type OverviewMaintenanceType,
} from "@/components/project-overview-shared";

export type OverviewSection = "knowledge" | "files" | "agent";
type DocumentTab = "summary" | "workflow";

export function resolveOverviewSection(pathname: string, projectRef: string): OverviewSection {
  const segments = pathname.split("/").filter(Boolean);
  const projectsIdx = segments.indexOf("projects");
  if (projectsIdx === -1 || segments[projectsIdx + 1] !== projectRef) return "knowledge";
  const tab = segments[projectsIdx + 2];
  const sub = segments[projectsIdx + 3];
  if (tab === "overview" || tab === "context") {
    if (sub === "files") return "files";
    if (sub === "agent") return "agent";
    return "knowledge";
  }
  if (tab === "files") return "files";
  if (tab === "agent") return "agent";
  return "knowledge";
}

function SegmentedToggle({
  value,
  onChange,
  options,
}: {
  value: DocumentTab;
  onChange: (next: DocumentTab) => void;
  options: Array<{ value: DocumentTab; label: string }>;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/70 bg-muted/30 p-0.5">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[5px] px-3 py-1 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MetaRow({
  label,
  value,
  action,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 text-right text-sm tabular-nums">
        {value}
        {action}
      </div>
    </div>
  );
}

export function ProjectOverviewLayout({
  projectRef,
  section,
  referenceFileCount,
  activeRequestCount,
  onSyncFromAgent,
  syncFromAgentPending,
  dataSchemaReady,
  dataSchemaName,
  lastSyncAt,
  summary,
  workflow,
  lockWorkflowMaintenance,
  files,
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
}: {
  projectRef: string;
  section: OverviewSection;
  referenceFileCount: number;
  activeRequestCount: number;
  onSyncFromAgent: () => void;
  syncFromAgentPending: boolean;
  dataSchemaReady: boolean;
  dataSchemaName?: string | null;
  lastSyncAt?: string | null;
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
  files: OverviewContextFile[];
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
}) {
  const navigate = useNavigate();
  const [documentTab, setDocumentTab] = useState<DocumentTab>("summary");

  const filesOpen = section === "files";
  const agentOpen = section === "agent";

  const closeSheet = () => navigate(`/projects/${projectRef}/overview`);
  const openFiles = () => navigate(`/projects/${projectRef}/overview/files`);
  const openAgent = () => navigate(`/projects/${projectRef}/overview/agent`);

  const activeDoc = documentTab === "summary" ? summary : workflow;
  const lastSyncDisplay = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString()
    : "Not yet synced";

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <SegmentedToggle
              value={documentTab}
              onChange={setDocumentTab}
              options={[
                { value: "summary", label: "Summary" },
                { value: "workflow", label: "Workflow" },
              ]}
            />
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={openFiles}
              >
                <FileText className="h-4 w-4" />
                Files
                {referenceFileCount > 0 ? (
                  <span className="ml-0.5 rounded bg-muted px-1 py-0 text-[10px] font-medium tabular-nums text-foreground/80">
                    {referenceFileCount}
                  </span>
                ) : null}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={openAgent}
              >
                <WandSparkles className="h-4 w-4" />
                Agent
                {activeRequestCount > 0 ? (
                  <span className="ml-0.5 rounded bg-primary/15 px-1 py-0 text-[10px] font-medium tabular-nums text-primary">
                    {activeRequestCount}
                  </span>
                ) : null}
              </Button>
              <div className="mx-1 h-5 w-px bg-border/60" aria-hidden />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={onSyncFromAgent}
                disabled={syncFromAgentPending}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", syncFromAgentPending && "animate-spin")} />
                Sync
              </Button>
            </div>
          </div>

          <div className="pt-5">
            {documentTab === "summary" ? (
              <ProjectDocumentPanel
                title="Project summary"
                description="Business context, goals, decisions, and SOPs"
                isEditing={activeDoc.isEditing}
                isSaving={activeDoc.isSaving}
                body={activeDoc.body}
                previewText={activeDoc.previewText}
                previewTruncated={activeDoc.previewTruncated}
                placeholder="Purpose, metrics, stakeholders, risks, terminology, and operating procedures."
                emptyMessage="No summary yet. Edit to draft one, or open Agent to request an update."
                onStartEdit={activeDoc.onStartEdit}
                onCancel={activeDoc.onCancel}
                onSave={activeDoc.onSave}
                onBodyChange={activeDoc.onBodyChange}
              />
            ) : (
              <ProjectDocumentPanel
                title="Workflow playbook"
                description="Stage purpose, ownership, and handoffs"
                isEditing={activeDoc.isEditing}
                isSaving={activeDoc.isSaving}
                body={activeDoc.body}
                previewText={activeDoc.previewText}
                previewTruncated={activeDoc.previewTruncated}
                placeholder="Per stage: purpose, owner, entry/exit, handoffs, and approvals."
                emptyMessage="No workflow summary yet. Edit to draft one, or open Agent to request an update."
                onStartEdit={activeDoc.onStartEdit}
                onCancel={activeDoc.onCancel}
                onSave={activeDoc.onSave}
                onBodyChange={activeDoc.onBodyChange}
                readOnly={lockWorkflowMaintenance}
              />
            )}
          </div>
        </div>

        <aside className="hidden self-start lg:block">
          <div className="sticky top-4">
            <div className="rounded-lg border border-border/70 bg-card/50">
              <div className="border-b border-border/60 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Project snapshot
                </p>
              </div>
              <div className="divide-y divide-border/50 px-4">
                <MetaRow
                  label="Knowledge sync"
                  value={<span className="text-foreground">{lastSyncDisplay}</span>}
                />
                <MetaRow
                  label="Data workspace"
                  value={
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5",
                        dataSchemaReady ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          dataSchemaReady ? "bg-emerald-500" : "bg-muted-foreground/40",
                        )}
                      />
                      {dataSchemaReady ? dataSchemaName ?? "Ready" : "Not initialized"}
                    </span>
                  }
                />
                <MetaRow
                  label="Reference files"
                  value={<span className="text-foreground">{referenceFileCount}</span>}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto px-0 text-xs"
                      onClick={openFiles}
                    >
                      Manage
                    </Button>
                  }
                />
                <MetaRow
                  label="Active requests"
                  value={
                    <span className={activeRequestCount > 0 ? "text-foreground" : "text-muted-foreground"}>
                      {activeRequestCount}
                    </span>
                  }
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto px-0 text-xs"
                      onClick={openAgent}
                    >
                      View
                    </Button>
                  }
                />
              </div>
              <div className="border-t border-border/60 px-4 py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full justify-center gap-1.5"
                  onClick={openAgent}
                >
                  <WandSparkles className="h-3.5 w-3.5" />
                  Send agent a request
                </Button>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
              <Database className="mt-0.5 h-3 w-3 shrink-0" />
              <p>
                Knowledge sync rebuilds project context from documents the agent has access to.
                Trigger a sync after major changes.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <Sheet open={filesOpen} onOpenChange={(open) => (open ? openFiles() : closeSheet())}>
        <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border/60 px-6 py-4">
            <SheetTitle>Reference files</SheetTitle>
            <SheetDescription>
              Project source documents the agent uses during knowledge sync.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <ProjectReferenceFilesPanel
              embedded
              files={files}
              selectedFiles={selectedFiles}
              assetTitle={assetTitle}
              onAssetTitleChange={onAssetTitleChange}
              onChooseFiles={onChooseFiles}
              onUploadFiles={onUploadFiles}
              uploadPending={uploadFilesPending}
              onReplaceFile={onReplaceFile}
              onRemoveFile={onRemoveFile}
              replacePending={replaceFilePending}
              removePending={removeFilePending}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={agentOpen} onOpenChange={(open) => (open ? openAgent() : closeSheet())}>
        <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border/60 px-6 py-4">
            <SheetTitle>Agent requests</SheetTitle>
            <SheetDescription>
              Queue updates to knowledge, workflow, or dashboards. Files live in Reference files.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <ProjectAgentRequestsPanel
              embedded
              maintenanceOptions={maintenanceOptions}
              maintenanceType={maintenanceType}
              onMaintenanceTypeChange={onMaintenanceTypeChange}
              maintenanceDescription={maintenanceDescription}
              onMaintenanceDescriptionChange={onMaintenanceDescriptionChange}
              onInsertExample={onInsertExample}
              onSendMaintenanceRequest={onSendMaintenanceRequest}
              sendPending={sendMaintenancePending}
              maintenanceGroups={maintenanceGroups}
              maintenanceRequestsEmpty={maintenanceRequestsEmpty}
              isAutoMaintenanceRequest={isAutoMaintenanceRequest}
              showCompletedRequests={showCompletedRequests}
              onToggleCompletedRequests={onToggleCompletedRequests}
              contextHistoryItems={contextHistoryItems}
              showDocumentSaveHistory={showDocumentSaveHistory}
              onToggleDocumentSaveHistory={onToggleDocumentSaveHistory}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
