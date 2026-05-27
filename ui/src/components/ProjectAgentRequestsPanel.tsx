import type { ProjectMaintenanceRequest } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
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
import { EmptyState } from "@/components/EmptyState";
import {
  formatOverviewDate,
  MaintenanceRequestTable,
  OverviewPageHeader,
  type OverviewDocumentRevision,
  type OverviewMaintenanceGroups,
  type OverviewMaintenanceOption,
  type OverviewMaintenanceType,
} from "@/components/project-overview-shared";
import { WandSparkles } from "lucide-react";

export function ProjectAgentRequestsPanel({
  embedded = false,
  maintenanceOptions,
  maintenanceType,
  onMaintenanceTypeChange,
  maintenanceDescription,
  onMaintenanceDescriptionChange,
  onInsertExample,
  onSendMaintenanceRequest,
  sendPending,
  maintenanceGroups,
  maintenanceRequestsEmpty,
  isAutoMaintenanceRequest,
  showCompletedRequests,
  onToggleCompletedRequests,
  contextHistoryItems,
  showDocumentSaveHistory,
  onToggleDocumentSaveHistory,
}: {
  embedded?: boolean;
  maintenanceOptions: OverviewMaintenanceOption[];
  maintenanceType: OverviewMaintenanceType;
  onMaintenanceTypeChange: (value: OverviewMaintenanceType) => void;
  maintenanceDescription: string;
  onMaintenanceDescriptionChange: (value: string) => void;
  onInsertExample: () => void;
  onSendMaintenanceRequest: () => void;
  sendPending: boolean;
  maintenanceGroups: OverviewMaintenanceGroups;
  maintenanceRequestsEmpty: boolean;
  isAutoMaintenanceRequest: (request: ProjectMaintenanceRequest) => boolean;
  showCompletedRequests: boolean;
  onToggleCompletedRequests: () => void;
  contextHistoryItems: OverviewDocumentRevision[];
  showDocumentSaveHistory: boolean;
  onToggleDocumentSaveHistory: () => void;
}) {
  const descriptionLength = maintenanceDescription.trim().length;
  const canSend = descriptionLength >= 20;

  const sections = [
    { label: "Active", rows: maintenanceGroups.active, compact: false },
    { label: "Queued", rows: maintenanceGroups.userQueued, compact: false },
    { label: "Background sync", rows: maintenanceGroups.autoQueued, compact: true },
  ] as const;

  return (
    <div className={embedded ? "space-y-4" : "mx-auto w-full max-w-4xl space-y-6"}>
      {!embedded ? (
        <OverviewPageHeader
          title="Agent"
          description="Ask the agent to update project knowledge, workflow, or dashboards. To attach documents, switch to Files."
        />
      ) : null}

      <div className={embedded ? "" : "rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5"}>
        {!embedded ? <p className="text-sm font-medium">New request</p> : null}
        <div className={embedded ? "grid gap-4" : "mt-4 grid gap-4"}>
          <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="agent-request-type" className="text-xs text-muted-foreground">
                Type
              </Label>
              <Select
                value={maintenanceType}
                onValueChange={(value) => onMaintenanceTypeChange(value as OverviewMaintenanceType)}
              >
                <SelectTrigger id="agent-request-type" className="w-full">
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
            <div className="space-y-1.5">
              <Label htmlFor="agent-request-body" className="text-xs text-muted-foreground">
                Instructions
              </Label>
              <Textarea
                id="agent-request-body"
                rows={5}
                value={maintenanceDescription}
                onChange={(event) => onMaintenanceDescriptionChange(event.target.value)}
                placeholder="Describe the outcome you want and any constraints."
                className="min-h-[7rem] resize-y"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
            <p className="text-xs text-muted-foreground">
              {canSend ? "Ready to send" : `${20 - descriptionLength} more characters required`}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onInsertExample}>
                Insert example
              </Button>
              <Button type="button" size="sm" onClick={onSendMaintenanceRequest} disabled={sendPending || !canSend}>
                <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
                Send to agent
              </Button>
            </div>
          </div>
        </div>
      </div>

      {maintenanceRequestsEmpty ? (
        <EmptyState
          icon={WandSparkles}
          message="No agent requests yet"
          description="Your queue of agent work will show up here after you send a request."
        />
      ) : (
        <div className="space-y-6">
          {sections.map((section) =>
            section.rows.length > 0 ? (
              <div key={section.label}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {section.label} ({section.rows.length})
                </p>
                <MaintenanceRequestTable
                  requests={section.rows}
                  maintenanceOptions={maintenanceOptions}
                  isAutoMaintenanceRequest={isAutoMaintenanceRequest}
                  compact={section.compact}
                />
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
                <MaintenanceRequestTable
                  requests={maintenanceGroups.completed.slice(0, 12)}
                  maintenanceOptions={maintenanceOptions}
                  isAutoMaintenanceRequest={isAutoMaintenanceRequest}
                  compact
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {contextHistoryItems.length > 0 ? (
        <div className={embedded ? "border-t border-border/60 pt-4" : "rounded-xl border border-border/80 bg-card p-4 shadow-xs sm:p-5"}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Manual saves</p>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onToggleDocumentSaveHistory}>
              {showDocumentSaveHistory ? "Hide" : "Show"}
            </Button>
          </div>
          {showDocumentSaveHistory ? (
            <ul className="mt-3 space-y-2">
              {contextHistoryItems.map((item) => (
                <li key={item.id} className="rounded-md border border-border/60 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{item.historyKind === "summary" ? "Summary" : "Workflow"}</Badge>
                    <span className="text-muted-foreground">Rev. {item.revisionNumber}</span>
                    <span className="tabular-nums text-muted-foreground">{formatOverviewDate(item.createdAt)}</span>
                  </div>
                  {item.changeSummary ? <p className="mt-1 text-muted-foreground">{item.changeSummary}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
