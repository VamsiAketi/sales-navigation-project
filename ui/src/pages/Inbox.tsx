import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { INBOX_MINE_ISSUE_STATUS_FILTER } from "@paperclipai/shared";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { useCurrentUserCompanyPermissions } from "../hooks/useCurrentUserCompanyPermissions";
import { ApiError } from "../api/client";
import { dashboardApi } from "../api/dashboard";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { projectsApi } from "../api/projects";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useGeneralSettings } from "../context/GeneralSettingsContext";
import { queryKeys } from "../lib/queryKeys";
import {
  armIssueDetailInboxQuickArchive,
  createIssueDetailLocationState,
  createIssueDetailPath,
  mergeIssueModalLocationState,
} from "../lib/issueDetailBreadcrumb";
import { hasBlockingShortcutDialog, isKeyboardShortcutTextInputTarget } from "../lib/keyboardShortcuts";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { IssueRow } from "../components/IssueRow";
import { SwipeToArchive } from "../components/SwipeToArchive";

import { StatusIcon } from "../components/StatusIcon";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { approvalLabel, defaultTypeIcon, typeIcon } from "../components/ApprovalPayload";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { projectStatusSwatchClass } from "../lib/status-colors";
import { timeAgo } from "../lib/timeAgo";
import { formatAssigneeUserLabel } from "../lib/assignees";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Inbox as InboxIcon,
  AlertTriangle,
  X,
  RotateCcw,
  UserPlus,
  User,
  Columns3,
  ChevronRight,
  Search,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { PageTabBar } from "../components/PageTabBar";
import type { Approval, HeartbeatRun, Issue, JoinRequest } from "@paperclipai/shared";
import {
  ACTIONABLE_APPROVAL_STATUSES,
  DEFAULT_INBOX_AGENT_RUN_COLUMNS,
  DEFAULT_INBOX_ISSUE_COLUMNS,
  getAvailableInboxIssueColumns,
  getApprovalsForTab,
  getInboxWorkItems,
  getInboxKeyboardSelectionIndex,
  getLatestFailedRunsByAgent,
  getRecentTouchedIssues,
  isMineInboxTab,
  inboxAgentRunColumns,
  loadInboxAgentRunColumns,
  loadInboxIssueColumns,
  normalizeInboxAgentRunColumns,
  normalizeInboxIssueColumns,
  resolveIssueWorkspaceName,
  resolveInboxSelectionIndex,
  saveInboxAgentRunColumns,
  saveInboxIssueColumns,
  InboxApprovalFilter,
  type InboxAgentRunColumn,
  type InboxIssueColumn,
  loadInboxSectionsOpen,
  saveInboxSectionsOpen,
  ATTENTION_QUEUE_PAGE_LABEL,
  saveLastInboxTab,
  shouldShowInboxSection,
  type InboxSectionId,
  type InboxSectionsOpenState,
  type InboxTab,
  type InboxWorkItem,
} from "../lib/inbox";
import { useDismissedInboxItems, useReadInboxItems } from "../hooks/useInboxBadge";
import {
  buildInboxAgentRunTableGridColumns,
  buildInboxGovernanceTableGridColumns,
  buildInboxIssueTableGridColumns,
  inboxTrailingColumnWidth,
  INBOX_TABLE_CELL_META,
  INBOX_TABLE_CELL_MUTED,
  INBOX_TABLE_HEADER_CLASS,
  INBOX_AGENT_RUN_STATUS_CELL_CLASS,
  INBOX_AGENT_RUN_TABLE_ROW_CLASS,
  INBOX_AGENT_RUN_TRAILING_CELL_CLASS,
  ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS,
} from "../lib/inbox-table-layout";

type InboxCategoryFilter =
  | "everything"
  | "issues_i_touched"
  | "join_requests"
  | "approvals"
  | "failed_runs"
  | "alerts";
type SectionKey =
  | "work_items"
  | "alerts";

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = value.split("\n").map((chunk) => chunk.trim()).find(Boolean);
  return line ?? null;
}

function runFailureMessage(run: HeartbeatRun): string {
  return firstNonEmptyLine(run.error) ?? firstNonEmptyLine(run.stderrExcerpt) ?? "Run exited with an error.";
}

function approvalStatusLabel(status: Approval["status"]): string {
  return status.replaceAll("_", " ");
}

function formatRunInboxWhen(run: HeartbeatRun): string {
  return timeAgo(run.finishedAt ?? run.createdAt);
}

function formatRunInboxDetails(run: HeartbeatRun): ReactNode {
  if (run.status === "succeeded") {
    return <span>Completed</span>;
  }
  if (run.status === "running") {
    return <span>In progress</span>;
  }
  if (run.status === "queued") {
    return <span>Queued</span>;
  }
  if (run.status === "cancelled") {
    return <span>Cancelled</span>;
  }
  return <span className="truncate">{runFailureMessage(run)}</span>;
}

function readIssueIdFromRun(run: HeartbeatRun): string | null {
  const context = run.contextSnapshot;
  if (!context) return null;

  const issueId = context["issueId"];
  if (typeof issueId === "string" && issueId.length > 0) return issueId;

  const taskId = context["taskId"];
  if (typeof taskId === "string" && taskId.length > 0) return taskId;

  return null;
}


type NonIssueUnreadState = "visible" | "fading" | "hidden" | null;
const trailingIssueColumns: InboxIssueColumn[] = ["assignee", "project", "workspace", "labels", "updated"];
const inboxIssueColumnLabels: Record<InboxIssueColumn, string> = {
  status: "Status",
  id: "ID",
  assignee: "Assignee",
  project: "Project",
  workspace: "Workspace",
  labels: "Tags",
  updated: "Last updated",
};
const inboxAgentRunColumnLabels: Record<InboxAgentRunColumn, string> = {
  status: "Status",
  details: "Details",
  last_run: "Last run",
};
const inboxAgentRunColumnDescriptions: Record<InboxAgentRunColumn, string> = {
  status: "Run outcome chip beside the unread control.",
  details: "Error summary or run state text.",
  last_run: "Relative time since the run finished or started.",
};

const inboxIssueColumnDescriptions: Record<InboxIssueColumn, string> = {
  status: "Issue state chip on the left edge.",
  id: "Ticket identifier like PAP-1009.",
  assignee: "Assigned agent or board user.",
  project: "Linked project pill with its color.",
  workspace: "Execution or project workspace used for the issue.",
  labels: "Issue labels and tags.",
  updated: "Latest visible activity time.",
};

function InboxLiveIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5",
        !compact && "sm:gap-1.5 sm:px-2",
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
      </span>
      {!compact ? (
        <span className="hidden text-[11px] font-medium text-blue-600 sm:inline dark:text-blue-400">
          Live
        </span>
      ) : null}
    </span>
  );
}

export function InboxIssueMetaLeading({
  issue,
  isLive,
  showStatus = true,
  showIdentifier = true,
}: {
  issue: Issue;
  isLive: boolean;
  showStatus?: boolean;
  showIdentifier?: boolean;
}) {
  return (
    <>
      {showStatus || (isLive && !showIdentifier) ? (
        <span
          className={cn(
            "hidden items-center gap-1.5 sm:inline-flex",
            ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS,
          )}
        >
          {showStatus ? (
            <span className="min-w-0 max-w-full">
              <StatusIcon status={issue.status} />
            </span>
          ) : null}
          {isLive ? <InboxLiveIndicator /> : null}
        </span>
      ) : null}
      {showIdentifier ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="truncate">{issue.identifier ?? issue.id.slice(0, 8)}</span>
          {isLive && !showStatus ? <InboxLiveIndicator compact /> : null}
        </span>
      ) : null}
    </>
  );
}

function issueActivityText(issue: Issue): string {
  return `Updated ${timeAgo(issue.lastActivityAt ?? issue.lastExternalCommentAt ?? issue.updatedAt)}`;
}

function InboxUnreadControl({
  unreadState,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
}: {
  unreadState: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
}) {
  const showUnreadDot = unreadState === "visible" || unreadState === "fading";
  return (
    <span className="flex items-center justify-center">
      {showUnreadDot ? (
        <button
          type="button"
          onClick={onMarkRead}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors",
            selected ? "hover:bg-muted/80" : "hover:bg-blue-500/20",
          )}
          aria-label="Mark as read"
        >
          <span
            className={cn(
              "block h-2 w-2 rounded-full transition-opacity duration-300",
              selected ? "bg-muted-foreground/70" : "bg-blue-600 dark:bg-blue-400",
              unreadState === "fading" ? "opacity-0" : "opacity-100",
            )}
          />
        </button>
      ) : onArchive ? (
        <button
          type="button"
          onClick={onArchive}
          disabled={archiveDisabled}
          className="inline-flex h-4 w-4 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Dismiss from inbox"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="inline-flex h-4 w-4" aria-hidden="true" />
      )}
    </span>
  );
}

function InboxTableColumnsMenu<Column extends string>({
  menuTitle,
  menuDescription,
  availableColumns,
  columnLabels,
  columnDescriptions,
  visibleColumnSet,
  onToggleColumn,
  onResetDefaults,
  resetHint,
}: {
  menuTitle: string;
  menuDescription: string;
  availableColumns: Column[];
  columnLabels: Record<Column, string>;
  columnDescriptions: Record<Column, string>;
  visibleColumnSet: Set<Column>;
  onToggleColumn: (column: Column, enabled: boolean) => void;
  onResetDefaults: () => void;
  resetHint: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Columns3 className="mr-1 h-3.5 w-3.5" />
          Show / hide columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[300px] rounded-xl border-border/70 p-1.5 shadow-xl shadow-black/10"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5">
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {menuTitle}
            </div>
            <div className="text-sm font-medium text-foreground">{menuDescription}</div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableColumns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={visibleColumnSet.has(column)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onToggleColumn(column, checked === true)}
            className="items-start rounded-lg px-3 py-2.5 pl-8"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{columnLabels[column]}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {columnDescriptions[column]}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onResetDefaults} className="rounded-lg px-3 py-2 text-sm">
          Reset defaults
          <span className="ml-auto text-xs text-muted-foreground">{resetHint}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InboxCollapsibleSection({
  sectionId,
  title,
  count,
  open,
  onOpenChange,
  headerActions,
  children,
}: {
  sectionId: InboxSectionId;
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <section
        className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm"
        aria-labelledby={`inbox-section-${sectionId}`}
      >
        <CollapsibleTrigger
          id={`inbox-section-${sectionId}`}
          className="flex w-full items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/35"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerActions}
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function InboxRunsTableHeaderRow({
  gridTemplateColumns,
  showActions,
  showStatus,
  showDetails,
  showLastRun,
}: {
  gridTemplateColumns: string;
  showActions: boolean;
  showStatus: boolean;
  showDetails: boolean;
  showLastRun: boolean;
}) {
  return (
    <div
      className={INBOX_TABLE_HEADER_CLASS}
      style={{ gridTemplateColumns }}
      aria-hidden="true"
    >
      {showStatus ? (
        <span className={INBOX_AGENT_RUN_STATUS_CELL_CLASS}>
          <span className="inline-flex h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Status</span>
        </span>
      ) : null}
      <span>Run</span>
      {showDetails ? <span>Details</span> : null}
      {showLastRun ? <span>Last run</span> : null}
      <div className={INBOX_AGENT_RUN_TRAILING_CELL_CLASS}>
        {showActions ? <span>Actions</span> : null}
      </div>
    </div>
  );
}

function InboxIssueTableHeader({
  gridTemplateColumns,
  showStatus,
  showId,
  trailingColumns,
}: {
  gridTemplateColumns: string;
  showStatus: boolean;
  showId: boolean;
  trailingColumns: InboxIssueColumn[];
}) {
  return (
    <div
      className={INBOX_TABLE_HEADER_CLASS}
      style={{ gridTemplateColumns }}
      aria-hidden="true"
    >
      <span />
      {showStatus ? <span>Status</span> : null}
      {showId ? <span>ID</span> : null}
      <span>Title</span>
      {trailingColumns.map((column) => (
        <span
          key={column}
          className={column === "updated" ? "text-right" : undefined}
        >
          {inboxIssueColumnLabels[column]}
        </span>
      ))}
    </div>
  );
}

export function InboxIssueTrailingColumns({
  issue,
  columns,
  projectName,
  projectStatus,
  workspaceName,
  assigneeName,
  currentUserId,
  currentUserDisplayName,
  variant = "grouped",
}: {
  issue: Issue;
  columns: InboxIssueColumn[];
  projectName: string | null;
  projectStatus: string | null;
  workspaceName: string | null;
  assigneeName: string | null;
  currentUserId: string | null;
  currentUserDisplayName?: string | null;
  /** `flat` emits one grid cell per column for inbox-table rows. */
  variant?: "grouped" | "flat";
}) {
  const activityText = timeAgo(issue.lastActivityAt ?? issue.lastExternalCommentAt ?? issue.updatedAt);
  const userLabel =
    formatAssigneeUserLabel(issue.assigneeUserId, currentUserId, { currentUserDisplayName }) ?? "User";

  const cells = columns.map((column) => {
    if (column === "assignee") {
      if (issue.assigneeAgentId) {
        return (
          <span key={column} className="inline-flex min-w-0 max-w-full items-center text-xs text-foreground">
            <Identity
              name={assigneeName ?? issue.assigneeAgentId.slice(0, 8)}
              size="sm"
              className="min-w-0"
            />
          </span>
        );
      }

      if (issue.assigneeUserId) {
        return (
          <span key={column} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
              <User className="size-3.5" />
            </span>
            <span className="min-w-0 truncate font-medium text-foreground/90">{userLabel}</span>
          </span>
        );
      }

      return <span key={column} className={INBOX_TABLE_CELL_MUTED}>Unassigned</span>;
    }

    if (column === "project") {
      if (projectName) {
        return (
          <span
            key={column}
            className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full border border-border/40",
                projectStatusSwatchClass(projectStatus),
              )}
              title={projectStatus ? `Project status: ${projectStatus.replace(/_/g, " ")}` : undefined}
            />
            <span className="truncate text-foreground/90">{projectName}</span>
          </span>
        );
      }

      return <span key={column} className={INBOX_TABLE_CELL_MUTED}>No project</span>;
    }

    if (column === "labels") {
      if ((issue.labels ?? []).length > 0) {
        return (
          <span key={column} className="flex min-w-0 items-center gap-1 overflow-hidden text-xs">
            {(issue.labels ?? []).slice(0, 2).map((label) => (
              <span
                key={label.id}
                className="inline-flex min-w-0 max-w-full items-center font-medium"
                style={{
                  color: pickTextColorForPillBg(label.color, 0.12),
                }}
              >
                <span className="truncate">{label.name}</span>
              </span>
            ))}
            {(issue.labels ?? []).length > 2 ? (
              <span className="shrink-0 font-medium text-muted-foreground">
                +{(issue.labels ?? []).length - 2}
              </span>
            ) : null}
          </span>
        );
      }

      return <span key={column} className="min-w-0" aria-hidden="true" />;
    }

    if (column === "workspace") {
      if (!workspaceName) {
        return <span key={column} className="min-w-0" aria-hidden="true" />;
      }

      return <span key={column} className={INBOX_TABLE_CELL_MUTED}>{workspaceName}</span>;
    }

    return (
      <span key={column} className={cn(INBOX_TABLE_CELL_META, "text-right")}>
        {activityText}
      </span>
    );
  });

  if (variant === "flat") {
    return <>{cells}</>;
  }

  return (
    <span
      className="hidden shrink-0 items-center sm:grid sm:gap-x-3"
      style={{
        gridTemplateColumns: columns
          .map((column) => inboxTrailingColumnWidth(column))
          .filter((width): width is string => width !== null)
          .join(" "),
      }}
    >
      {cells}
    </span>
  );
}

function InboxAttentionTableRow({
  gridTemplateColumns,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
  status,
  icon,
  title,
  meta,
  href,
  actions,
  className,
}: {
  gridTemplateColumns: string;
  unreadState?: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
  /** When set, renders a dedicated Status column (agent runs). */
  status?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  href?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const titleNode = href ? (
    <Link
      to={href}
      className={cn(
        "min-w-0 truncate text-sm font-medium no-underline text-inherit transition-colors hover:text-foreground",
        selected && "hover:text-inherit",
      )}
    >
      {title}
    </Link>
  ) : (
    <span className="min-w-0 truncate text-sm font-medium">{title}</span>
  );
  const unreadCell = unreadState !== null ? (
    <InboxUnreadControl
      unreadState={unreadState}
      onMarkRead={onMarkRead}
      onArchive={onArchive}
      archiveDisabled={archiveDisabled}
      selected={selected}
    />
  ) : (
    <span className="inline-flex h-4 w-4" aria-hidden="true" />
  );

  return (
    <div className={cn("group border-b border-border/80 last:border-b-0", className)}>
      <div className="flex flex-col gap-2 px-3 py-3 sm:hidden">
        <div className="flex items-start gap-2">
          {unreadCell}
          {status ? (
            <span className="shrink-0 pt-0.5">{status}</span>
          ) : icon ? (
            <span className="flex shrink-0 items-center justify-center">{icon}</span>
          ) : null}
          <div className="min-w-0 flex-1">
            {titleNode}
            <div className={cn("mt-1", INBOX_TABLE_CELL_MUTED)}>{meta}</div>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div
        className={cn(
          "hidden items-center gap-x-3 px-3 py-2 sm:grid",
          selected && "bg-accent/80",
        )}
        style={{ gridTemplateColumns }}
      >
        {unreadCell}
        {status ? (
          <span
            className={cn(
              "hidden min-w-0 items-center justify-start sm:inline-flex",
              ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS,
            )}
          >
            {status}
          </span>
        ) : icon ? (
          <span className="flex items-center justify-center">{icon}</span>
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="min-w-0">{titleNode}</span>
        <span className={INBOX_TABLE_CELL_MUTED}>{meta}</span>
        {actions ? <div className="flex items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function buildFailedRunInboxRowContent({
  run,
  issueById,
  agentName: linkedAgentName,
}: {
  run: HeartbeatRun;
  issueById: Map<string, Issue>;
  agentName: string | null;
}) {
  const issueId = readIssueIdFromRun(run);
  const issue = issueId ? issueById.get(issueId) ?? null : null;

  return {
    href: `/agents/${run.agentId}/runs/${run.id}`,
    status: <StatusBadge status={run.status} />,
    title: issue ? (
      <>
        <span className="mr-1.5 font-mono text-muted-foreground">
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        {issue.title}
      </>
    ) : (
      <>
        Agent run
        {linkedAgentName ? ` — ${linkedAgentName}` : ""}
      </>
    ),
    meta: formatRunInboxDetails(run),
    when: formatRunInboxWhen(run),
  };
}

export function AgentRunInboxTableRow({
  run,
  issueById,
  agentName,
  onRetry,
  isRetrying,
  showActionsColumn = false,
  hideRetryAndDismiss = false,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
  className,
  gridTemplateColumns,
  showStatus,
  showDetails,
  showLastRun,
  onSelect,
}: {
  run: HeartbeatRun;
  issueById: Map<string, Issue>;
  agentName: string | null;
  onRetry: () => void;
  isRetrying: boolean;
  gridTemplateColumns: string;
  showStatus: boolean;
  showDetails: boolean;
  showLastRun: boolean;
  showActionsColumn?: boolean;
  hideRetryAndDismiss?: boolean;
  unreadState?: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
  className?: string;
  onSelect?: () => void;
}) {
  const { href, status, title, meta, when } = buildFailedRunInboxRowContent({ run, issueById, agentName });
  const includeActions = showActionsColumn && !hideRetryAndDismiss;
  const showRetry = includeActions && (run.status === "failed" || run.status === "timed_out");
  const retryActions = showRetry ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 shrink-0 px-2.5"
      onClick={(event) => {
        event.stopPropagation();
        onRetry();
      }}
      disabled={isRetrying}
    >
      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
      {isRetrying ? "Retrying…" : "Retry"}
    </Button>
  ) : null;
  const unreadCell = unreadState !== null ? (
    <InboxUnreadControl
      unreadState={unreadState}
      onMarkRead={onMarkRead}
      onArchive={onArchive}
      archiveDisabled={archiveDisabled}
      selected={selected}
    />
  ) : (
    <span className="inline-flex h-4 w-4" aria-hidden="true" />
  );
  const titleNode = (
    <Link
      to={href}
      className={cn(
        "block min-w-0 truncate text-sm font-medium no-underline text-inherit transition-colors hover:text-foreground",
        selected && "hover:text-inherit",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      {title}
    </Link>
  );

  return (
    <div
      data-inbox-item
      className={cn(
        INBOX_AGENT_RUN_TABLE_ROW_CLASS,
        "hidden cursor-pointer sm:grid",
        selected && "bg-accent/80",
        className,
      )}
      style={{ gridTemplateColumns }}
      onClick={onSelect}
    >
      {showStatus ? (
        <span className={INBOX_AGENT_RUN_STATUS_CELL_CLASS}>
          {unreadCell}
          {status}
        </span>
      ) : (
        <span className="inline-flex min-w-0 items-center">{unreadCell}</span>
      )}
      {titleNode}
      {showDetails ? <span className={INBOX_TABLE_CELL_MUTED}>{meta}</span> : null}
      {showLastRun ? <span className={INBOX_TABLE_CELL_META}>{when}</span> : null}
      <div className={INBOX_AGENT_RUN_TRAILING_CELL_CLASS}>
        {includeActions ? retryActions : null}
      </div>
    </div>
  );
}

/** Mobile-only agent run row (desktop uses `AgentRunInboxTableRow`). */
export function FailedRunInboxRow({
  run,
  issueById,
  agentName,
  onRetry,
  isRetrying,
  showActionsColumn = false,
  hideRetryAndDismiss = false,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
  className,
}: {
  run: HeartbeatRun;
  issueById: Map<string, Issue>;
  agentName: string | null;
  onRetry: () => void;
  isRetrying: boolean;
  showActionsColumn?: boolean;
  unreadState?: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
  className?: string;
  hideRetryAndDismiss?: boolean;
}) {
  const { href, status, title, meta, when } = buildFailedRunInboxRowContent({ run, issueById, agentName });
  const includeActions = showActionsColumn && !hideRetryAndDismiss;
  const showRetry = includeActions && (run.status === "failed" || run.status === "timed_out");
  const retryActions = showRetry ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 shrink-0 px-2.5"
      onClick={onRetry}
      disabled={isRetrying}
    >
      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
      {isRetrying ? "Retrying…" : "Retry"}
    </Button>
  ) : undefined;

  return (
    <div className={cn("group border-b border-border/80 last:border-b-0 sm:hidden", className)}>
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-start gap-2">
          {unreadState !== null ? (
            <InboxUnreadControl
              unreadState={unreadState}
              onMarkRead={onMarkRead}
              onArchive={onArchive}
              archiveDisabled={archiveDisabled}
              selected={selected}
            />
          ) : (
            <span className="inline-flex h-4 w-4" aria-hidden="true" />
          )}
          <span className="shrink-0 pt-0.5">{status}</span>
          <div className="min-w-0 flex-1">
            <Link
              to={href}
              className={cn(
                "min-w-0 truncate text-sm font-medium no-underline text-inherit transition-colors hover:text-foreground",
                selected && "hover:text-inherit",
              )}
            >
              {title}
            </Link>
            <div className={cn("mt-1 flex flex-wrap items-baseline gap-x-2", INBOX_TABLE_CELL_MUTED)}>
              <span className="min-w-0">{meta}</span>
              <span className={cn(INBOX_TABLE_CELL_META, "shrink-0")}>{when}</span>
            </div>
          </div>
        </div>
        {retryActions ? <div className="flex flex-wrap gap-2">{retryActions}</div> : null}
      </div>
    </div>
  );
}

function ApprovalInboxRow({
  approval,
  requesterName,
  onApprove,
  onReject,
  isPending,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
  className,
}: {
  approval: Approval;
  requesterName: string | null;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  unreadState?: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const Icon = typeIcon[approval.type] ?? defaultTypeIcon;
  const label = approvalLabel(approval.type, approval.payload as Record<string, unknown> | null);
  const showResolutionButtons =
    approval.type !== "budget_override_required" &&
    ACTIONABLE_APPROVAL_STATUSES.has(approval.status);
  const gridTemplateColumns = buildInboxGovernanceTableGridColumns(showResolutionButtons);
  const resolutionActions = showResolutionButtons ? (
    <>
      <Button
        size="sm"
        className="h-8 bg-green-700 px-3 text-white hover:bg-green-600"
        onClick={onApprove}
        disabled={isPending}
      >
        Approve
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="h-8 px-3"
        onClick={onReject}
        disabled={isPending}
      >
        Reject
      </Button>
    </>
  ) : undefined;

  return (
    <InboxAttentionTableRow
      gridTemplateColumns={gridTemplateColumns}
      unreadState={unreadState}
      onMarkRead={onMarkRead}
      onArchive={onArchive}
      archiveDisabled={archiveDisabled}
      selected={selected}
      className={className}
      href={`/approvals/${approval.id}`}
      icon={(
        <span className="rounded-md bg-muted/80 p-1.5 ring-1 ring-border/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
      )}
      title={label}
      meta={(
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="capitalize">{approvalStatusLabel(approval.status)}</span>
          {requesterName ? (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">·</span>
              <span>requested by {requesterName}</span>
            </>
          ) : null}
          <span className="text-muted-foreground/50" aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">updated {timeAgo(approval.updatedAt)}</span>
        </span>
      )}
      actions={resolutionActions}
    />
  );
}

function JoinRequestInboxRow({
  joinRequest,
  onApprove,
  onReject,
  isPending,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  selected = false,
  className,
}: {
  joinRequest: JoinRequest;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  unreadState?: NonIssueUnreadState;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const label =
    joinRequest.requestType === "human"
      ? "Human join request"
      : `Agent join request${joinRequest.agentName ? `: ${joinRequest.agentName}` : ""}`;
  const gridTemplateColumns = buildInboxGovernanceTableGridColumns(true);

  return (
    <InboxAttentionTableRow
      gridTemplateColumns={gridTemplateColumns}
      unreadState={unreadState}
      onMarkRead={onMarkRead}
      onArchive={onArchive}
      archiveDisabled={archiveDisabled}
      selected={selected}
      className={className}
      icon={(
        <span className="rounded-md bg-muted/80 p-1.5 ring-1 ring-border/60">
          <UserPlus className="h-4 w-4 text-muted-foreground" />
        </span>
      )}
      title={label}
      meta={(
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="shrink-0 tabular-nums">requested {timeAgo(joinRequest.createdAt)}</span>
          <span className="text-muted-foreground/50" aria-hidden="true">·</span>
          <span>IP {joinRequest.requestIp}</span>
          {joinRequest.adapterType ? (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">·</span>
              <span>adapter {joinRequest.adapterType}</span>
            </>
          ) : null}
        </span>
      )}
      actions={(
        <>
          <Button
            size="sm"
            className="h-8 bg-green-700 px-3 text-white hover:bg-green-600"
            onClick={onApprove}
            disabled={isPending}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 px-3"
            onClick={onReject}
            disabled={isPending}
          >
            Reject
          </Button>
        </>
      )}
    />
  );
}

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadAttentionQueue = sidebarBadges?.canReadAttentionQueue ?? true;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const { keyboardShortcutsEnabled } = useGeneralSettings();
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    retry: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [allCategoryFilter, setAllCategoryFilter] = useState<InboxCategoryFilter>("everything");
  const [allApprovalFilter, setAllApprovalFilter] = useState<InboxApprovalFilter>("all");
  const [visibleIssueColumns, setVisibleIssueColumns] = useState<InboxIssueColumn[]>(loadInboxIssueColumns);
  const [visibleAgentRunColumns, setVisibleAgentRunColumns] = useState<InboxAgentRunColumn[]>(
    loadInboxAgentRunColumns,
  );
  const [sectionsOpen, setSectionsOpen] = useState<InboxSectionsOpenState>(loadInboxSectionsOpen);
  const { dismissed, dismiss } = useDismissedInboxItems();
  const { readItems, markRead: markItemRead, markUnread: markItemUnread } = useReadInboxItems();

  const pathSegment = location.pathname.split("/").pop() ?? "mine";
  const tab: InboxTab =
    pathSegment === "mine" || pathSegment === "recent" || pathSegment === "all" || pathSegment === "unread"
      ? pathSegment
      : "mine";
  const canArchiveFromTab = isMineInboxTab(tab);
  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        ATTENTION_QUEUE_PAGE_LABEL,
        `${location.pathname}${location.search}${location.hash}`,
        "inbox",
      ),
    [location.pathname, location.search, location.hash],
  );
  const locationRef = useRef(location);
  locationRef.current = location;

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { canMutateAttentionQueue } = useCurrentUserCompanyPermissions(selectedCompanyId);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const isolatedWorkspacesEnabled = experimentalSettings?.enableIsolatedWorkspaces === true;
  const { data: executionWorkspaces = [] } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.executionWorkspaces.list(selectedCompanyId)
      : ["execution-workspaces", "__disabled__"],
    queryFn: () => executionWorkspacesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && isolatedWorkspacesEnabled,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: ATTENTION_QUEUE_PAGE_LABEL }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    saveLastInboxTab(tab);
    setSelectedIndex(-1);
    setSearchQuery("");
  }, [tab]);

  const {
    data: approvals,
    isLoading: isApprovalsLoading,
    error: approvalsError,
  } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: joinRequests = [],
    isLoading: isJoinRequestsLoading,
  } = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId!),
    queryFn: async () => {
      try {
        return await accessApi.listJoinRequests(selectedCompanyId!, "pending_approval");
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          return [];
        }
        throw err;
      }
    },
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const { data: dashboard, isLoading: isDashboardLoading } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues, isLoading: isIssuesLoading } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const {
    data: mineIssuesRaw = [],
    isLoading: isMineIssuesLoading,
  } = useQuery({
    queryKey: queryKeys.issues.listMineByMe(selectedCompanyId!),
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        touchedByUserId: "me",
        inboxArchivedByUserId: "me",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
      }),
    enabled: !!selectedCompanyId,
  });
  const {
    data: touchedIssuesRaw = [],
    isLoading: isTouchedIssuesLoading,
  } = useQuery({
    queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId!),
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        touchedByUserId: "me",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
      }),
    enabled: !!selectedCompanyId,
  });

  const { data: heartbeatRuns, isLoading: isRunsLoading } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const mineIssues = useMemo(() => getRecentTouchedIssues(mineIssuesRaw), [mineIssuesRaw]);
  const touchedIssues = useMemo(() => getRecentTouchedIssues(touchedIssuesRaw), [touchedIssuesRaw]);
  const unreadTouchedIssues = useMemo(
    () => touchedIssues.filter((issue) => issue.isUnreadForMe),
    [touchedIssues],
  );
  const issuesToRender = useMemo(
    () => {
      if (tab === "mine") return mineIssues;
      if (tab === "unread") return unreadTouchedIssues;
      return touchedIssues;
    },
    [tab, mineIssues, touchedIssues, unreadTouchedIssues],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);
  const projectById = useMemo(() => {
    const map = new Map<string, { name: string; status: string }>();
    for (const project of projects ?? []) {
      map.set(project.id, { name: project.name, status: project.status });
    }
    return map;
  }, [projects]);
  const projectWorkspaceById = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const project of projects ?? []) {
      for (const workspace of project.workspaces ?? []) {
        map.set(workspace.id, { name: workspace.name });
      }
    }
    return map;
  }, [projects]);
  const defaultProjectWorkspaceIdByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects ?? []) {
      const defaultWorkspaceId =
        project.executionWorkspacePolicy?.defaultProjectWorkspaceId
        ?? project.primaryWorkspace?.id
        ?? null;
      if (defaultWorkspaceId) map.set(project.id, defaultWorkspaceId);
    }
    return map;
  }, [projects]);
  const executionWorkspaceById = useMemo(() => {
    const map = new Map<string, {
      name: string;
      mode: "shared_workspace" | "isolated_workspace" | "operator_branch" | "adapter_managed" | "cloud_sandbox";
      projectWorkspaceId: string | null;
    }>();
    for (const workspace of executionWorkspaces) {
      map.set(workspace.id, {
        name: workspace.name,
        mode: workspace.mode,
        projectWorkspaceId: workspace.projectWorkspaceId ?? null,
      });
    }
    return map;
  }, [executionWorkspaces]);
  const visibleIssueColumnSet = useMemo(() => new Set(visibleIssueColumns), [visibleIssueColumns]);
  const visibleAgentRunColumnSet = useMemo(() => new Set(visibleAgentRunColumns), [visibleAgentRunColumns]);
  const availableIssueColumns = useMemo(
    () => getAvailableInboxIssueColumns(isolatedWorkspacesEnabled),
    [isolatedWorkspacesEnabled],
  );
  const availableIssueColumnSet = useMemo(() => new Set(availableIssueColumns), [availableIssueColumns]);
  const visibleTrailingIssueColumns = useMemo(
    () => trailingIssueColumns.filter((column) => visibleIssueColumnSet.has(column) && availableIssueColumnSet.has(column)),
    [availableIssueColumnSet, visibleIssueColumnSet],
  );
  const currentUserId = session?.user.id ?? session?.session.userId ?? null;
  const currentUserDisplayName =
    session?.user?.name?.trim() || session?.user?.email?.trim() || null;

  const failedRuns = useMemo(
    () => getLatestFailedRunsByAgent(heartbeatRuns ?? []).filter((r) => !dismissed.has(`run:${r.id}`)),
    [heartbeatRuns, dismissed],
  );
  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of heartbeatRuns ?? []) {
      if (run.status !== "running" && run.status !== "queued") continue;
      const issueId = readIssueIdFromRun(run);
      if (issueId) ids.add(issueId);
    }
    return ids;
  }, [heartbeatRuns]);

  const approvalsToRender = useMemo(() => {
    let filtered = getApprovalsForTab(approvals ?? [], tab, allApprovalFilter);
    if (tab === "mine") {
      filtered = filtered.filter((a) => !dismissed.has(`approval:${a.id}`));
    }
    return filtered;
  }, [approvals, tab, allApprovalFilter, dismissed]);
  const showJoinRequestsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "join_requests";
  const showTouchedCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "issues_i_touched";
  const showApprovalsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "approvals";
  const showFailedRunsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "failed_runs";
  const showAlertsCategory = allCategoryFilter === "everything" || allCategoryFilter === "alerts";
  const failedRunsForTab = useMemo(() => {
    if (tab === "all" && !showFailedRunsCategory) return [];
    return failedRuns;
  }, [failedRuns, tab, showFailedRunsCategory]);

  const joinRequestsForTab = useMemo(() => {
    if (tab === "all" && !showJoinRequestsCategory) return [];
    if (tab === "mine") return joinRequests.filter((jr) => !dismissed.has(`join:${jr.id}`));
    return joinRequests;
  }, [joinRequests, tab, showJoinRequestsCategory, dismissed]);

  const workItemsToRender = useMemo(
    () =>
      getInboxWorkItems({
        issues: tab === "all" && !showTouchedCategory ? [] : issuesToRender,
        approvals: tab === "all" && !showApprovalsCategory ? [] : approvalsToRender,
        failedRuns: failedRunsForTab,
        joinRequests: joinRequestsForTab,
      }),
    [approvalsToRender, issuesToRender, showApprovalsCategory, showTouchedCategory, tab, failedRunsForTab, joinRequestsForTab],
  );

  const filteredWorkItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return workItemsToRender;
    return workItemsToRender.filter((item) => {
      if (item.kind === "issue") {
        const issue = item.issue;
        if (issue.title.toLowerCase().includes(q)) return true;
        if (issue.identifier?.toLowerCase().includes(q)) return true;
        if (issue.description?.toLowerCase().includes(q)) return true;
        if (isolatedWorkspacesEnabled) {
          const workspaceName = resolveIssueWorkspaceName(issue, {
            executionWorkspaceById,
            projectWorkspaceById,
            defaultProjectWorkspaceIdByProjectId,
          });
          if (workspaceName?.toLowerCase().includes(q)) return true;
        }
        return false;
      }
      if (item.kind === "approval") {
        const a = item.approval;
        const label = approvalLabel(a.type, a.payload as Record<string, unknown> | null);
        if (label.toLowerCase().includes(q)) return true;
        if (a.type.toLowerCase().includes(q)) return true;
        return false;
      }
      if (item.kind === "failed_run") {
        const run = item.run;
        const name = agentById.get(run.agentId);
        if (name?.toLowerCase().includes(q)) return true;
        const msg = runFailureMessage(run);
        if (msg.toLowerCase().includes(q)) return true;
        const issueId = readIssueIdFromRun(run);
        if (issueId) {
          const issue = issueById.get(issueId);
          if (issue?.title.toLowerCase().includes(q)) return true;
          if (issue?.identifier?.toLowerCase().includes(q)) return true;
        }
        return false;
      }
      if (item.kind === "join_request") {
        const jr = item.joinRequest;
        if (jr.agentName?.toLowerCase().includes(q)) return true;
        if (jr.capabilities?.toLowerCase().includes(q)) return true;
        return false;
      }
      return false;
    });
  }, [
    workItemsToRender,
    searchQuery,
    agentById,
    defaultProjectWorkspaceIdByProjectId,
    executionWorkspaceById,
    issueById,
    isolatedWorkspacesEnabled,
    projectWorkspaceById,
  ]);

  const showInboxIssueStatus =
    visibleIssueColumnSet.has("status") && availableIssueColumnSet.has("status");
  const showInboxIssueId =
    visibleIssueColumnSet.has("id") && availableIssueColumnSet.has("id");
  const inboxIssueGridTemplateColumns = useMemo(
    () =>
      buildInboxIssueTableGridColumns({
        showStatus: showInboxIssueStatus,
        showId: showInboxIssueId,
        trailingColumns: visibleTrailingIssueColumns,
      }),
    [showInboxIssueId, showInboxIssueStatus, visibleTrailingIssueColumns],
  );
  const filteredIssueItems = useMemo(
    () => filteredWorkItems.filter((item): item is Extract<InboxWorkItem, { kind: "issue" }> => item.kind === "issue"),
    [filteredWorkItems],
  );
  const filteredFailedRunItems = useMemo(
    () =>
      filteredWorkItems.filter(
        (item): item is Extract<InboxWorkItem, { kind: "failed_run" }> => item.kind === "failed_run",
      ),
    [filteredWorkItems],
  );
  const filteredGovernanceItems = useMemo(
    () =>
      filteredWorkItems.filter(
        (item): item is Extract<InboxWorkItem, { kind: "approval" | "join_request" }> =>
          item.kind === "approval" || item.kind === "join_request",
      ),
    [filteredWorkItems],
  );

  const setSectionOpen = useCallback((sectionId: InboxSectionId, open: boolean) => {
    setSectionsOpen((prev) => {
      const next = { ...prev, [sectionId]: open };
      saveInboxSectionsOpen(next);
      return next;
    });
  }, []);

  const keyboardNavItems = useMemo(() => {
    const items: InboxWorkItem[] = [];
    if (sectionsOpen.approvals) items.push(...filteredGovernanceItems);
    if (sectionsOpen.tasks) items.push(...filteredIssueItems);
    if (sectionsOpen.agent_runs) items.push(...filteredFailedRunItems);
    return items;
  }, [
    filteredFailedRunItems,
    filteredGovernanceItems,
    filteredIssueItems,
    sectionsOpen.agent_runs,
    sectionsOpen.approvals,
    sectionsOpen.tasks,
  ]);

  const showInboxAgentRunStatus = visibleAgentRunColumnSet.has("status");
  const showInboxAgentRunDetails = visibleAgentRunColumnSet.has("details");
  const showInboxAgentRunLastRun = visibleAgentRunColumnSet.has("last_run");
  const agentRunsGridTemplateColumns = useMemo(
    () =>
      buildInboxAgentRunTableGridColumns({
        showStatus: showInboxAgentRunStatus,
        showDetails: showInboxAgentRunDetails,
        showLastRun: showInboxAgentRunLastRun,
      }),
    [showInboxAgentRunDetails, showInboxAgentRunLastRun, showInboxAgentRunStatus],
  );

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agentById.get(id) ?? null;
  };
  const setIssueColumns = useCallback((next: InboxIssueColumn[]) => {
    const normalized = normalizeInboxIssueColumns(next);
    setVisibleIssueColumns(normalized);
    saveInboxIssueColumns(normalized);
  }, []);
  const toggleIssueColumn = useCallback((column: InboxIssueColumn, enabled: boolean) => {
    if (enabled) {
      setIssueColumns([...visibleIssueColumns, column]);
      return;
    }
    setIssueColumns(visibleIssueColumns.filter((value) => value !== column));
  }, [setIssueColumns, visibleIssueColumns]);
  const setAgentRunColumns = useCallback((next: InboxAgentRunColumn[]) => {
    const normalized = normalizeInboxAgentRunColumns(next);
    setVisibleAgentRunColumns(normalized);
    saveInboxAgentRunColumns(normalized);
  }, []);
  const toggleAgentRunColumn = useCallback((column: InboxAgentRunColumn, enabled: boolean) => {
    if (enabled) {
      setAgentRunColumns([...visibleAgentRunColumns, column]);
      return;
    }
    setAgentRunColumns(visibleAgentRunColumns.filter((value) => value !== column));
  }, [setAgentRunColumns, visibleAgentRunColumns]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const approveJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.approveJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve join request");
    },
  });

  const rejectJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.rejectJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject join request");
    },
  });

  const [retryingRunIds, setRetryingRunIds] = useState<Set<string>>(new Set());

  const retryRunMutation = useMutation({
    mutationFn: async (run: HeartbeatRun) => {
      const payload: Record<string, unknown> = {};
      const context = run.contextSnapshot as Record<string, unknown> | null;
      if (context) {
        if (typeof context.issueId === "string" && context.issueId) payload.issueId = context.issueId;
        if (typeof context.taskId === "string" && context.taskId) payload.taskId = context.taskId;
        if (typeof context.taskKey === "string" && context.taskKey) payload.taskKey = context.taskKey;
      }
      const result = await agentsApi.wakeup(run.agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        reason: "retry_failed_run",
        payload,
      });
      if (!("id" in result)) {
        throw new Error(result.message ?? "Retry was skipped.");
      }
      return { newRun: result, originalRun: run };
    },
    onMutate: (run) => {
      setRetryingRunIds((prev) => new Set(prev).add(run.id));
    },
    onSuccess: ({ newRun, originalRun }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(originalRun.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(originalRun.companyId, originalRun.agentId) });
      navigate(`/agents/${originalRun.agentId}/runs/${newRun.id}`);
    },
    onSettled: (_data, _error, run) => {
      if (!run) return;
      setRetryingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(run.id);
        return next;
      });
    },
  });

  const [fadingOutIssues, setFadingOutIssues] = useState<Set<string>>(new Set());
  const [showMarkAllReadConfirm, setShowMarkAllReadConfirm] = useState(false);
  const [archivingIssueIds, setArchivingIssueIds] = useState<Set<string>>(new Set());
  const [fadingNonIssueItems, setFadingNonIssueItems] = useState<Set<string>>(new Set());
  const [archivingNonIssueIds, setArchivingNonIssueIds] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const invalidateInboxIssueQueries = () => {
    if (!selectedCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
  };

  const archiveIssueMutation = useMutation({
    mutationFn: (id: string) => issuesApi.archiveFromInbox(id),
    onMutate: (id) => {
      setActionError(null);
      setArchivingIssueIds((prev) => new Set(prev).add(id));
    },
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
    onError: (err, id) => {
      setActionError(err instanceof Error ? err.message : "Failed to archive issue");
      setArchivingIssueIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSettled: (_data, error, id) => {
      if (error) return;
      window.setTimeout(() => {
        setArchivingIssueIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 500);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => issuesApi.markRead(id),
    onMutate: (id) => {
      setFadingOutIssues((prev) => new Set(prev).add(id));
    },
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
    onSettled: (_data, _error, id) => {
      setTimeout(() => {
        setFadingOutIssues((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 300);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (issueIds: string[]) => {
      await Promise.all(issueIds.map((issueId) => issuesApi.markRead(issueId)));
    },
    onMutate: (issueIds) => {
      setFadingOutIssues((prev) => {
        const next = new Set(prev);
        for (const issueId of issueIds) next.add(issueId);
        return next;
      });
    },
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
    onSettled: (_data, _error, issueIds) => {
      setTimeout(() => {
        setFadingOutIssues((prev) => {
          const next = new Set(prev);
          for (const issueId of issueIds) next.delete(issueId);
          return next;
        });
      }, 300);
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: (id: string) => issuesApi.markUnread(id),
    onSuccess: () => {
      invalidateInboxIssueQueries();
    },
  });

  const handleMarkNonIssueRead = useCallback((key: string) => {
    setFadingNonIssueItems((prev) => new Set(prev).add(key));
    markItemRead(key);
    setTimeout(() => {
      setFadingNonIssueItems((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 300);
  }, [markItemRead]);

  const handleArchiveNonIssue = useCallback((key: string) => {
    setArchivingNonIssueIds((prev) => new Set(prev).add(key));
    setTimeout(() => {
      dismiss(key);
      setArchivingNonIssueIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 200);
  }, [dismiss]);

  const nonIssueUnreadState = (key: string): NonIssueUnreadState => {
    if (!canArchiveFromTab) return null;
    const isRead = readItems.has(key);
    const isFading = fadingNonIssueItems.has(key);
    if (isFading) return "fading";
    if (!isRead) return "visible";
    return "hidden";
  };

  const getWorkItemKey = useCallback((item: InboxWorkItem): string => {
    if (item.kind === "issue") return `issue:${item.issue.id}`;
    if (item.kind === "approval") return `approval:${item.approval.id}`;
    if (item.kind === "failed_run") return `run:${item.run.id}`;
    return `join:${item.joinRequest.id}`;
  }, []);

  // Keep selection valid when the list shape changes, but do not auto-select on initial load.
  useEffect(() => {
    setSelectedIndex((prev) => resolveInboxSelectionIndex(prev, keyboardNavItems.length));
  }, [keyboardNavItems.length]);

  // Use refs for keyboard handler to avoid stale closures
  const kbStateRef = useRef({
    workItems: keyboardNavItems,
    selectedIndex,
    canArchive: canArchiveFromTab,
    archivingIssueIds,
    archivingNonIssueIds,
    fadingOutIssues,
    readItems,
  });
  kbStateRef.current = {
    workItems: keyboardNavItems,
    selectedIndex,
    canArchive: canArchiveFromTab,
    archivingIssueIds,
    archivingNonIssueIds,
    fadingOutIssues,
    readItems,
  };

  const kbActionsRef = useRef({
    archiveIssue: (id: string) => archiveIssueMutation.mutate(id),
    archiveNonIssue: handleArchiveNonIssue,
    markRead: (id: string) => markReadMutation.mutate(id),
    markUnreadIssue: (id: string) => markUnreadMutation.mutate(id),
    markNonIssueRead: handleMarkNonIssueRead,
    markNonIssueUnread: markItemUnread,
    navigate,
  });
  kbActionsRef.current = {
    archiveIssue: (id: string) => archiveIssueMutation.mutate(id),
    archiveNonIssue: handleArchiveNonIssue,
    markRead: (id: string) => markReadMutation.mutate(id),
    markUnreadIssue: (id: string) => markUnreadMutation.mutate(id),
    markNonIssueRead: handleMarkNonIssueRead,
    markNonIssueUnread: markItemUnread,
    navigate,
  };

  // Keyboard shortcuts (mail-client style) — single stable listener using refs
  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Don't capture when typing in inputs/textareas or with modifier keys
      const target = e.target;
      if (
        !(target instanceof HTMLElement) ||
        isKeyboardShortcutTextInputTarget(target) ||
        hasBlockingShortcutDialog(document) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      const st = kbStateRef.current;
      const act = kbActionsRef.current;

      // Keyboard shortcuts are only active on the "mine" tab
      if (!st.canArchive) return;

      const itemCount = st.workItems.length;
      if (itemCount === 0) return;

      switch (e.key) {
        case "j": {
          e.preventDefault();
          setSelectedIndex((prev) => getInboxKeyboardSelectionIndex(prev, itemCount, "next"));
          break;
        }
        case "k": {
          e.preventDefault();
          setSelectedIndex((prev) => getInboxKeyboardSelectionIndex(prev, itemCount, "previous"));
          break;
        }
        case "a":
        case "y": {
          if (st.selectedIndex < 0 || st.selectedIndex >= itemCount) return;
          e.preventDefault();
          const item = st.workItems[st.selectedIndex];
          if (item.kind === "issue") {
            if (!st.archivingIssueIds.has(item.issue.id)) {
              act.archiveIssue(item.issue.id);
            }
          } else {
            const key = getWorkItemKey(item);
            if (!st.archivingNonIssueIds.has(key)) {
              act.archiveNonIssue(key);
            }
          }
          break;
        }
        case "U": {
          if (st.selectedIndex < 0 || st.selectedIndex >= itemCount) return;
          e.preventDefault();
          const item = st.workItems[st.selectedIndex];
          if (item.kind === "issue") {
            act.markUnreadIssue(item.issue.id);
          } else {
            act.markNonIssueUnread(getWorkItemKey(item));
          }
          break;
        }
        case "r": {
          if (st.selectedIndex < 0 || st.selectedIndex >= itemCount) return;
          e.preventDefault();
          const item = st.workItems[st.selectedIndex];
          if (item.kind === "issue") {
            if (item.issue.isUnreadForMe && !st.fadingOutIssues.has(item.issue.id)) {
              act.markRead(item.issue.id);
            }
          } else {
            const key = getWorkItemKey(item);
            if (!st.readItems.has(key)) {
              act.markNonIssueRead(key);
            }
          }
          break;
        }
        case "Enter": {
          if (st.selectedIndex < 0 || st.selectedIndex >= itemCount) return;
          e.preventDefault();
          const item = st.workItems[st.selectedIndex];
          if (item.kind === "issue") {
            const pathId = item.issue.identifier ?? item.issue.id;
            const baseState = armIssueDetailInboxQuickArchive(issueLinkState);
            const navigationState = mergeIssueModalLocationState(baseState, locationRef.current);
            act.navigate(createIssueDetailPath(pathId, navigationState), { state: navigationState });
          } else if (item.kind === "approval") {
            act.navigate(`/approvals/${item.approval.id}`);
          } else if (item.kind === "failed_run") {
            act.navigate(`/agents/${item.run.agentId}/runs/${item.run.id}`);
          }
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [getWorkItemKey, issueLinkState, keyboardShortcutsEnabled]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const rows = listRef.current.querySelectorAll("[data-inbox-item]");
    const row = rows[selectedIndex];
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!selectedCompanyId) {
    return <EmptyState icon={InboxIcon} message="Select a company to view inbox." />;
  }
  if (!canReadAttentionQueue) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm ring-1 ring-border/30">
        <div className="font-medium text-foreground">You do not have permission to view Attention Queue.</div>
        <div className="mt-2">
          Ask a company admin for the <code>attention_queue.read</code> permission.
        </div>
      </div>
    );
  }

  const hasRunFailures = failedRuns.length > 0;
  const showAggregateAgentError = !!dashboard && dashboard.agents.error > 0 && !hasRunFailures && !dismissed.has("alert:agent-errors");
  const showBudgetAlert =
    !!dashboard &&
    dashboard.costs.monthBudgetCents > 0 &&
    dashboard.costs.monthUtilizationPercent >= 80 &&
    !dismissed.has("alert:budget");
  const hasAlerts = showAggregateAgentError || showBudgetAlert;
  const showWorkItemsSection = filteredWorkItems.length > 0;
  const showAlertsSection = shouldShowInboxSection({
    tab,
    hasItems: hasAlerts,
    showOnMine: hasAlerts,
    showOnRecent: hasAlerts,
    showOnUnread: hasAlerts,
    showOnAll: showAlertsCategory && hasAlerts,
  });

  const visibleSections = [
    showAlertsSection ? "alerts" : null,
    showWorkItemsSection ? "work_items" : null,
  ].filter((key): key is SectionKey => key !== null);

  const allLoaded =
    !isJoinRequestsLoading &&
    !isApprovalsLoading &&
    !isDashboardLoading &&
    !isIssuesLoading &&
    !isMineIssuesLoading &&
    !isTouchedIssuesLoading &&
    !isRunsLoading;

  const showSeparatorBefore = (key: SectionKey) => visibleSections.indexOf(key) > 0;
  const markAllReadIssues = (tab === "mine" ? mineIssues : unreadTouchedIssues)
    .filter((issue) => issue.isUnreadForMe && !fadingOutIssues.has(issue.id) && !archivingIssueIds.has(issue.id));
  const unreadIssueIds = markAllReadIssues
    .map((issue) => issue.id);
  const canMarkAllRead = unreadIssueIds.length > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-2">
        <div className="order-1 flex w-full min-w-0 items-center gap-2 lg:order-2 lg:w-[180px] lg:gap-0 sm:lg:w-[220px]">
          <div className="relative min-w-0 flex-1 lg:w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search inbox…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search inbox"
              className="h-9 w-full pl-8 text-sm lg:h-8 lg:text-xs"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-9 shrink-0 p-0 lg:hidden"
                title="Show / hide columns"
              >
                <Columns3 className="h-4 w-4" aria-hidden />
                <span className="sr-only">Show / hide columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-230 w-[min(calc(100vw-2rem),300px)] rounded-xl border-border/70 p-1.5 shadow-xl shadow-black/10"
            >
              <DropdownMenuLabel className="px-2 pb-1 pt-1.5">
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Issue rows
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    Choose which inbox columns stay visible
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableIssueColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={visibleIssueColumnSet.has(column)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => toggleIssueColumn(column, checked === true)}
                  className="items-start rounded-lg px-3 py-2.5 pl-8 max-lg:min-h-11"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {inboxIssueColumnLabels[column]}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {inboxIssueColumnDescriptions[column]}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setIssueColumns(DEFAULT_INBOX_ISSUE_COLUMNS)}
                className="rounded-lg px-3 py-2 text-sm max-lg:min-h-11"
              >
                Reset defaults
                <span className="ml-auto text-xs text-muted-foreground">status, id, updated</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="order-2 flex min-w-0 max-lg:w-full max-lg:flex-col max-lg:gap-1.5 lg:order-1 lg:min-w-0 lg:flex-1 lg:flex-row lg:items-center lg:justify-between lg:gap-2">
          <Tabs
            value={tab}
            onValueChange={(value) => navigate(`/inbox/${value}`)}
            className={cn(
              "min-w-0 flex-1 max-lg:w-full lg:overflow-visible",
              "max-lg:[&_[data-slot=tabs-list]]:grid max-lg:[&_[data-slot=tabs-list]]:h-10 max-lg:[&_[data-slot=tabs-list]]:w-full max-lg:[&_[data-slot=tabs-list]]:grid-cols-4 max-lg:[&_[data-slot=tabs-list]]:gap-0 max-lg:[&_[data-slot=tabs-list]]:rounded-none max-lg:[&_[data-slot=tabs-list]]:border-b max-lg:[&_[data-slot=tabs-list]]:border-border max-lg:[&_[data-slot=tabs-list]]:bg-transparent max-lg:[&_[data-slot=tabs-list]]:p-0",
              "max-lg:[&_[data-slot=tabs-trigger]]:h-10 max-lg:[&_[data-slot=tabs-trigger]]:flex-none max-lg:[&_[data-slot=tabs-trigger]]:px-1 max-lg:[&_[data-slot=tabs-trigger]]:text-sm",
            )}
          >
            <PageTabBar
              align="start"
              items={[
                {
                  value: "mine",
                  label: "Mine",
                },
                {
                  value: "recent",
                  label: "Recent",
                },
                { value: "unread", label: "Unread" },
                { value: "all", label: "All" },
              ]}
            />
          </Tabs>

          <div className="flex shrink-0 items-center justify-end gap-2 max-lg:w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden h-8 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground lg:inline-flex"
              >
                <Columns3 className="mr-1 h-3.5 w-3.5" />
                Show / hide columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[300px] rounded-xl border-border/70 p-1.5 shadow-xl shadow-black/10">
              <DropdownMenuLabel className="px-2 pb-1 pt-1.5">
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Desktop issue rows
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    Choose which inbox columns stay visible
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableIssueColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={visibleIssueColumnSet.has(column)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => toggleIssueColumn(column, checked === true)}
                  className="items-start rounded-lg px-3 py-2.5 pl-8"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {inboxIssueColumnLabels[column]}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {inboxIssueColumnDescriptions[column]}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setIssueColumns(DEFAULT_INBOX_ISSUE_COLUMNS)}
                className="rounded-lg px-3 py-2 text-sm"
              >
                Reset defaults
                <span className="ml-auto text-xs text-muted-foreground">status, id, updated</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canMarkAllRead && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 max-lg:ml-auto lg:h-8"
                onClick={() => setShowMarkAllReadConfirm(true)}
                disabled={markAllReadMutation.isPending}
              >
                {markAllReadMutation.isPending ? "Marking…" : "Mark all as read"}
              </Button>
              <Dialog open={showMarkAllReadConfirm} onOpenChange={setShowMarkAllReadConfirm}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Mark all as read?</DialogTitle>
                    <DialogDescription>
                      This will mark {unreadIssueIds.length} unread {unreadIssueIds.length === 1 ? "item" : "items"} as read.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowMarkAllReadConfirm(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        setShowMarkAllReadConfirm(false);
                        markAllReadMutation.mutate(unreadIssueIds);
                      }}
                    >
                      Mark all as read
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          </div>
        </div>
      </div>

      {tab === "all" && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={allCategoryFilter}
            onValueChange={(value) => setAllCategoryFilter(value as InboxCategoryFilter)}
          >
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="everything">All categories</SelectItem>
              <SelectItem value="issues_i_touched">My recent tasks</SelectItem>
              <SelectItem value="join_requests">Join requests</SelectItem>
              <SelectItem value="approvals">Approvals</SelectItem>
              <SelectItem value="failed_runs">Failed runs</SelectItem>
              <SelectItem value="alerts">Alerts</SelectItem>
            </SelectContent>
          </Select>

          {showApprovalsCategory && (
            <Select
              value={allApprovalFilter}
              onValueChange={(value) => setAllApprovalFilter(value as InboxApprovalFilter)}
            >
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue placeholder="Approval status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All approval statuses</SelectItem>
                <SelectItem value="actionable">Needs action</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {approvalsError && <p className="text-sm text-destructive">{approvalsError.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {!allLoaded && visibleSections.length === 0 && (
        <PageSkeleton variant="inbox" />
      )}

      {allLoaded && visibleSections.length === 0 && (
        <EmptyState
          icon={searchQuery.trim() ? Search : InboxIcon}
          message={
            searchQuery.trim()
              ? "No inbox items match your search."
              : tab === "mine"
              ? "Inbox zero."
              : tab === "unread"
              ? "No new inbox items."
              : tab === "recent"
                ? "No recent inbox items."
                : "No inbox items match these filters."
          }
        />
      )}

      {showWorkItemsSection && (
        <div ref={listRef} className="space-y-4">
          {filteredGovernanceItems.length > 0 ? (
            <InboxCollapsibleSection
              sectionId="approvals"
              title="Approvals & requests"
              count={filteredGovernanceItems.length}
              open={sectionsOpen.approvals}
              onOpenChange={(open) => setSectionOpen("approvals", open)}
            >
              <div className="overflow-x-auto">
                {filteredGovernanceItems.map((item) => {
                  const navIndex = keyboardNavItems.indexOf(item);
                  const isSelected = selectedIndex === navIndex;
                  const wrapItem = (key: string, child: ReactNode) => (
                    <div
                      key={`sel-${key}`}
                      data-inbox-item
                      className="relative"
                      onClick={() => setSelectedIndex(navIndex)}
                    >
                      {child}
                    </div>
                  );

                  if (item.kind === "approval") {
                    const approvalKey = `approval:${item.approval.id}`;
                    const isArchiving = archivingNonIssueIds.has(approvalKey);
                    const row = (
                      <ApprovalInboxRow
                        key={approvalKey}
                        approval={item.approval}
                        selected={isSelected}
                        requesterName={agentName(item.approval.requestedByAgentId)}
                        onApprove={() => approveMutation.mutate(item.approval.id)}
                        onReject={() => rejectMutation.mutate(item.approval.id)}
                        isPending={approveMutation.isPending || rejectMutation.isPending}
                        unreadState={nonIssueUnreadState(approvalKey)}
                        onMarkRead={() => handleMarkNonIssueRead(approvalKey)}
                        onArchive={canArchiveFromTab ? () => handleArchiveNonIssue(approvalKey) : undefined}
                        archiveDisabled={isArchiving}
                        className={
                          isArchiving
                            ? "pointer-events-none -translate-x-4 scale-[0.98] opacity-0 transition-all duration-200 ease-out"
                            : "transition-all duration-200 ease-out"
                        }
                      />
                    );
                    return wrapItem(approvalKey, canArchiveFromTab ? (
                      <SwipeToArchive
                        key={approvalKey}
                        selected={isSelected}
                        disabled={isArchiving}
                        onArchive={() => handleArchiveNonIssue(approvalKey)}
                      >
                        {row}
                      </SwipeToArchive>
                    ) : row);
                  }

                  if (item.kind !== "join_request") return null;

                  const joinKey = `join:${item.joinRequest.id}`;
                  const isArchiving = archivingNonIssueIds.has(joinKey);
                  const row = (
                    <JoinRequestInboxRow
                      key={joinKey}
                      joinRequest={item.joinRequest}
                      selected={isSelected}
                      onApprove={() => approveJoinMutation.mutate(item.joinRequest)}
                      onReject={() => rejectJoinMutation.mutate(item.joinRequest)}
                      isPending={approveJoinMutation.isPending || rejectJoinMutation.isPending}
                      unreadState={nonIssueUnreadState(joinKey)}
                      onMarkRead={() => handleMarkNonIssueRead(joinKey)}
                      onArchive={canArchiveFromTab ? () => handleArchiveNonIssue(joinKey) : undefined}
                      archiveDisabled={isArchiving}
                      className={
                        isArchiving
                          ? "pointer-events-none -translate-x-4 scale-[0.98] opacity-0 transition-all duration-200 ease-out"
                          : "transition-all duration-200 ease-out"
                      }
                    />
                  );
                  return wrapItem(joinKey, canArchiveFromTab ? (
                    <SwipeToArchive
                      key={joinKey}
                      selected={isSelected}
                      disabled={isArchiving}
                      onArchive={() => handleArchiveNonIssue(joinKey)}
                    >
                      {row}
                    </SwipeToArchive>
                  ) : row);
                })}
              </div>
            </InboxCollapsibleSection>
          ) : null}

          {filteredIssueItems.length > 0 ? (
            <InboxCollapsibleSection
              sectionId="tasks"
              title="Tasks"
              count={filteredIssueItems.length}
              open={sectionsOpen.tasks}
              onOpenChange={(open) => setSectionOpen("tasks", open)}
              headerActions={(
                <InboxTableColumnsMenu
                  menuTitle="Desktop issue rows"
                  menuDescription="Choose which task columns stay visible"
                  availableColumns={availableIssueColumns}
                  columnLabels={inboxIssueColumnLabels}
                  columnDescriptions={inboxIssueColumnDescriptions}
                  visibleColumnSet={visibleIssueColumnSet}
                  onToggleColumn={toggleIssueColumn}
                  onResetDefaults={() => setIssueColumns(DEFAULT_INBOX_ISSUE_COLUMNS)}
                  resetHint="status, id, updated"
                />
              )}
            >
              <div className="overflow-x-auto">
                <InboxIssueTableHeader
                  gridTemplateColumns={inboxIssueGridTemplateColumns}
                  showStatus={showInboxIssueStatus}
                  showId={showInboxIssueId}
                  trailingColumns={visibleTrailingIssueColumns}
                />
                {filteredIssueItems.map((item) => {
                  const navIndex = keyboardNavItems.indexOf(item);
                  const isSelected = selectedIndex === navIndex;
                  const issue = item.issue;
                  const isUnread = issue.isUnreadForMe && !fadingOutIssues.has(issue.id);
                  const isFading = fadingOutIssues.has(issue.id);
                  const isArchiving = archivingIssueIds.has(issue.id);
                  const issueProject = issue.projectId ? projectById.get(issue.projectId) ?? null : null;
                  const row = (
                    <IssueRow
                      key={`issue:${issue.id}`}
                      issue={issue}
                      issueLinkState={issueLinkState}
                      layout="inbox-table"
                      inboxGridTemplateColumns={inboxIssueGridTemplateColumns}
                      selected={isSelected}
                      className={
                        isArchiving
                          ? "pointer-events-none -translate-x-4 scale-[0.98] opacity-0 transition-all duration-200 ease-out"
                          : "transition-all duration-200 ease-out"
                      }
                      desktopMetaLeading={
                        <InboxIssueMetaLeading
                          issue={issue}
                          isLive={liveIssueIds.has(issue.id)}
                          showStatus={showInboxIssueStatus}
                          showIdentifier={showInboxIssueId}
                        />
                      }
                      mobileMeta={issueActivityText(issue).toLowerCase()}
                      unreadState={
                        isUnread ? "visible" : isFading ? "fading" : "hidden"
                      }
                      onMarkRead={() => markReadMutation.mutate(issue.id)}
                      onArchive={
                        canArchiveFromTab
                          ? () => archiveIssueMutation.mutate(issue.id)
                          : undefined
                      }
                      archiveDisabled={isArchiving || archiveIssueMutation.isPending}
                      desktopTrailing={
                        visibleTrailingIssueColumns.length > 0 ? (
                          <InboxIssueTrailingColumns
                            variant="flat"
                            issue={issue}
                            columns={visibleTrailingIssueColumns}
                            projectName={issueProject?.name ?? null}
                            projectStatus={issueProject?.status ?? null}
                            workspaceName={resolveIssueWorkspaceName(issue, {
                              executionWorkspaceById,
                              projectWorkspaceById,
                              defaultProjectWorkspaceIdByProjectId,
                            })}
                            assigneeName={agentName(issue.assigneeAgentId)}
                            currentUserId={currentUserId}
                            currentUserDisplayName={currentUserDisplayName}
                          />
                        ) : undefined
                      }
                    />
                  );

                  return (
                    <div
                      key={`sel-issue:${issue.id}`}
                      data-inbox-item
                      className="relative"
                      onClick={() => setSelectedIndex(navIndex)}
                    >
                      {canArchiveFromTab ? (
                        <SwipeToArchive
                          selected={isSelected}
                          disabled={isArchiving || archiveIssueMutation.isPending}
                          onArchive={() => archiveIssueMutation.mutate(issue.id)}
                        >
                          {row}
                        </SwipeToArchive>
                      ) : (
                        row
                      )}
                    </div>
                  );
                })}
              </div>
            </InboxCollapsibleSection>
          ) : null}

          {filteredFailedRunItems.length > 0 ? (
            <InboxCollapsibleSection
              sectionId="agent_runs"
              title="Agent runs"
              count={filteredFailedRunItems.length}
              open={sectionsOpen.agent_runs}
              onOpenChange={(open) => setSectionOpen("agent_runs", open)}
              headerActions={(
                <InboxTableColumnsMenu
                  menuTitle="Desktop agent run rows"
                  menuDescription="Choose which agent run columns stay visible"
                  availableColumns={[...inboxAgentRunColumns]}
                  columnLabels={inboxAgentRunColumnLabels}
                  columnDescriptions={inboxAgentRunColumnDescriptions}
                  visibleColumnSet={visibleAgentRunColumnSet}
                  onToggleColumn={toggleAgentRunColumn}
                  onResetDefaults={() => setAgentRunColumns(DEFAULT_INBOX_AGENT_RUN_COLUMNS)}
                  resetHint="status, details, last run"
                />
              )}
            >
              <div className="overflow-x-auto">
                <InboxRunsTableHeaderRow
                  gridTemplateColumns={agentRunsGridTemplateColumns}
                  showActions={canMutateAttentionQueue}
                  showStatus={showInboxAgentRunStatus}
                  showDetails={showInboxAgentRunDetails}
                  showLastRun={showInboxAgentRunLastRun}
                />
                {filteredFailedRunItems.map((item) => {
                  const navIndex = keyboardNavItems.indexOf(item);
                  const isSelected = selectedIndex === navIndex;
                  const runKey = `run:${item.run.id}`;
                  const isArchiving = archivingNonIssueIds.has(runKey);
                  return (
                    <AgentRunInboxTableRow
                      key={runKey}
                      run={item.run}
                      selected={isSelected}
                      issueById={issueById}
                      agentName={agentName(item.run.agentId)}
                      gridTemplateColumns={agentRunsGridTemplateColumns}
                      showStatus={showInboxAgentRunStatus}
                      showDetails={showInboxAgentRunDetails}
                      showLastRun={showInboxAgentRunLastRun}
                      showActionsColumn={canMutateAttentionQueue}
                      onRetry={() => retryRunMutation.mutate(item.run)}
                      isRetrying={retryingRunIds.has(item.run.id)}
                      hideRetryAndDismiss={!canMutateAttentionQueue}
                      unreadState={nonIssueUnreadState(runKey)}
                      onMarkRead={() => handleMarkNonIssueRead(runKey)}
                      onArchive={canArchiveFromTab ? () => handleArchiveNonIssue(runKey) : undefined}
                      archiveDisabled={isArchiving}
                      onSelect={() => setSelectedIndex(navIndex)}
                      className={
                        isArchiving
                          ? "pointer-events-none -translate-x-4 scale-[0.98] opacity-0 transition-all duration-200 ease-out"
                          : "transition-all duration-200 ease-out"
                      }
                    />
                  );
                })}
                <div className="sm:hidden">
                  {filteredFailedRunItems.map((item) => {
                    const navIndex = keyboardNavItems.indexOf(item);
                    const isSelected = selectedIndex === navIndex;
                    const runKey = `run:${item.run.id}`;
                    const isArchiving = archivingNonIssueIds.has(runKey);
                    const row = (
                      <FailedRunInboxRow
                        key={runKey}
                        run={item.run}
                        selected={isSelected}
                        issueById={issueById}
                        agentName={agentName(item.run.agentId)}
                        showActionsColumn={canMutateAttentionQueue}
                        onRetry={() => retryRunMutation.mutate(item.run)}
                        isRetrying={retryingRunIds.has(item.run.id)}
                        hideRetryAndDismiss={!canMutateAttentionQueue}
                        unreadState={nonIssueUnreadState(runKey)}
                        onMarkRead={() => handleMarkNonIssueRead(runKey)}
                        onArchive={canArchiveFromTab ? () => handleArchiveNonIssue(runKey) : undefined}
                        archiveDisabled={isArchiving}
                        className={
                          isArchiving
                            ? "pointer-events-none -translate-x-4 scale-[0.98] opacity-0 transition-all duration-200 ease-out"
                            : "transition-all duration-200 ease-out"
                        }
                      />
                    );
                    return (
                      <div
                        key={`sel-mobile-${runKey}`}
                        className="relative"
                        onClick={() => setSelectedIndex(navIndex)}
                      >
                        {canArchiveFromTab ? (
                          <SwipeToArchive
                            selected={isSelected}
                            disabled={isArchiving}
                            onArchive={() => handleArchiveNonIssue(runKey)}
                          >
                            {row}
                          </SwipeToArchive>
                        ) : (
                          row
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </InboxCollapsibleSection>
          ) : null}
        </div>
      )}

      {showAlertsSection && (
        <>
          {showSeparatorBefore("alerts") && <Separator />}
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Alerts
            </h3>
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm divide-y divide-border/80">
              {showAggregateAgentError && (
                <div className="group/alert relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40">
                  <Link
                    to="/agents"
                    className="flex flex-1 cursor-pointer items-center gap-3 no-underline text-inherit"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <span className="text-sm">
                      <span className="font-medium">{dashboard!.agents.error}</span>{" "}
                      {dashboard!.agents.error === 1 ? "agent has" : "agents have"} errors
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss("alert:agent-errors")}
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/alert:opacity-100"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {showBudgetAlert && (
                <div className="group/alert relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40">
                  <Link
                    to="/costs"
                    className="flex flex-1 cursor-pointer items-center gap-3 no-underline text-inherit"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
                    <span className="text-sm">
                      Budget at{" "}
                      <span className="font-medium">{dashboard!.costs.monthUtilizationPercent}%</span>{" "}
                      utilization this month
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss("alert:budget")}
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/alert:opacity-100"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
