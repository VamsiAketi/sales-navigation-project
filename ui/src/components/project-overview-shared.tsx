import type { ReactNode } from "react";
import type { ProjectMaintenanceRequest } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownBody } from "@/components/MarkdownBody";
import { DASHBOARD_TILE_SURFACE } from "@/lib/dashboard-tile-styles";
import { cn } from "@/lib/utils";
import { ChevronRight, Pencil } from "lucide-react";

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
  "max-h-[32rem] min-h-[12rem] resize-y overflow-y-auto field-sizing-fixed border-primary/60 ring-2 ring-primary/20";
const DOCUMENT_PREVIEW_SCROLL_CLASS =
  "max-h-[32rem] min-h-[12rem] overflow-y-auto overscroll-y-contain";

export function formatOverviewDate(value: unknown): string {
  if (typeof value !== "string") return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toLocaleString();
}

export function summarizeOverviewText(value: string, maxLength = 140): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

export function maintenanceTypeLabel(
  value: OverviewMaintenanceType,
  options: OverviewMaintenanceOption[],
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function OverviewPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function OverviewNavCard({
  to,
  icon: Icon,
  label,
  detail,
  badge,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  badge?: string | number;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center gap-3 p-4 transition-colors hover:bg-muted/30",
        DASHBOARD_TILE_SURFACE,
      )}
    >
      <div className="rounded-lg bg-muted/50 p-2 text-muted-foreground group-hover:text-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {badge != null && badge !== "" ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </Link>
  );
}

export function ProjectDocumentPanel({
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
    <article className="flex min-h-[20rem] flex-col">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
        ) : null}
      </header>
      {isEditing ? (
        <>
          <Textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            rows={16}
            className={cn(DOCUMENT_EDITOR_TEXTAREA_CLASS, "flex-1")}
            placeholder={placeholder}
          />
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
            <p className="text-xs text-muted-foreground">Markdown supported</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={isSaving}>
                Save
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={DOCUMENT_PREVIEW_SCROLL_CLASS}>
            {body.trim().length > 0 ? (
              <MarkdownBody>{previewText}</MarkdownBody>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">{emptyMessage}</p>
            )}
          </div>
          {previewTruncated ? (
            <p className="mt-3 text-xs text-muted-foreground">Preview truncated. Edit to view the full document.</p>
          ) : null}
        </>
      )}
    </article>
  );
}

export function MaintenanceRequestTable({
  requests,
  maintenanceOptions,
  isAutoMaintenanceRequest,
  compact = false,
}: {
  requests: ProjectMaintenanceRequest[];
  maintenanceOptions: OverviewMaintenanceOption[];
  isAutoMaintenanceRequest: (request: ProjectMaintenanceRequest) => boolean;
  compact?: boolean;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Request</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const auto = isAutoMaintenanceRequest(request);
            return (
              <tr key={request.id} className="border-b border-border/50 last:border-0 hover:bg-muted/15">
                <td className="px-4 py-3 align-top">
                  <p className="font-medium">{maintenanceTypeLabel(request.type, maintenanceOptions)}</p>
                  <p className={cn("mt-0.5 text-muted-foreground", compact ? "line-clamp-1 text-xs" : "line-clamp-2 text-xs")}>
                    {auto ? "Automatic background sync" : summarizeOverviewText(request.description, compact ? 100 : 160)}
                  </p>
                </td>
                <td className="hidden px-4 py-3 align-top sm:table-cell">
                  <StatusBadge status={request.status} />
                </td>
                <td className="px-4 py-3 text-right align-top text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                  <div className="mb-1 sm:hidden">
                    <StatusBadge status={request.status} />
                  </div>
                  {formatOverviewDate(request.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
