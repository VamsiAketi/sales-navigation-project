import type { ReactNode } from "react";
import { useMemo } from "react";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";
import { Link, useLocation } from "@/lib/router";
import { createIssueDetailPath, mergeIssueModalLocationState } from "../lib/issueDetailBreadcrumb";
import { cn } from "../lib/utils";
import { NEW_ISSUE_BADGE_CLASS } from "../lib/focus-created-issue";
import { StatusIcon } from "./StatusIcon";
import { ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS } from "../lib/issue-list-layout";

type UnreadState = "hidden" | "visible" | "fading";

interface IssueRowProps {
  issue: Issue;
  selected?: boolean;
  issueLinkState?: unknown;
  mobileLeading?: ReactNode;
  desktopMetaLeading?: ReactNode;
  desktopLeadingSpacer?: boolean;
  mobileMeta?: ReactNode;
  desktopTrailing?: ReactNode;
  trailingMeta?: ReactNode;
  unreadState?: UnreadState | null;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  className?: string;
  /** Short-lived marker after creating a task (e.g. 30s). */
  showNewBadge?: boolean;
  /** Custom project statuses to display for status icon */
  projectStatuses?: ProjectIssueStatus[];
}

export function IssueRow({
  issue,
  selected = false,
  issueLinkState,
  mobileLeading,
  desktopMetaLeading,
  desktopLeadingSpacer = false,
  mobileMeta,
  desktopTrailing,
  trailingMeta,
  unreadState = null,
  onMarkRead,
  className,
  showNewBadge = false,
  projectStatuses,
}: IssueRowProps) {
  const location = useLocation();
  const issuePathId = issue.identifier ?? issue.id;
  const issueHref = createIssueDetailPath(issuePathId, issueLinkState);
  const rowLinkState = useMemo(
    () => mergeIssueModalLocationState(issueLinkState, location),
    [issueLinkState, location],
  );
  const identifier = issue.identifier ?? issue.id.slice(0, 8);
  const showUnreadSlot = unreadState !== null;
  const showUnreadDot = unreadState === "visible" || unreadState === "fading";

  return (
    <Link
      id={`issue-surface-${issue.id}`}
      data-inbox-issue-link
      to={issueHref}
      state={rowLinkState}
      className={cn(
        "flex items-start gap-2 border-b border-border py-2.5 pl-2 pr-3 text-sm no-underline text-inherit transition-colors hover:bg-accent/50 last:border-b-0 sm:items-center sm:py-2 sm:pl-1",
        selected && "bg-accent hover:bg-transparent",
        className,
      )}
    >
      <span className="shrink-0 pt-px sm:hidden">
        {mobileLeading ?? <StatusIcon status={issue.status} projectStatuses={projectStatuses} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
        <span className="line-clamp-2 text-sm sm:order-2 sm:min-w-0 sm:flex-1 sm:truncate sm:line-clamp-none">
          {issue.title}
        </span>
        <span className="flex items-center gap-2 sm:order-1 sm:shrink-0">
          {desktopLeadingSpacer ? (
            <span className="hidden w-3.5 shrink-0 sm:block" />
          ) : null}
          {desktopMetaLeading ?? (
            <>
              <span
                className={cn(
                  "hidden items-center justify-start sm:inline-flex",
                  ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS,
                )}
              >
                <span className="min-w-0 max-w-full">
                  <StatusIcon
                    status={issue.status}
                    projectStatuses={projectStatuses}
                    className={selected ? "border-muted-foreground! text-muted-foreground!" : undefined}
                  />
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {identifier}
              </span>
            </>
          )}
          {showNewBadge ? (
            <span className={NEW_ISSUE_BADGE_CLASS} aria-label="Newly created task">
              New
            </span>
          ) : null}
          {mobileMeta ? (
            <>
              <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">
                &middot;
              </span>
              <span className="text-xs text-muted-foreground sm:hidden">{mobileMeta}</span>
            </>
          ) : null}
        </span>
      </span>
      {(desktopTrailing || trailingMeta) ? (
        <span className="ml-auto hidden shrink-0 items-center gap-2 sm:order-3 sm:flex sm:gap-3">
          {desktopTrailing}
          {trailingMeta ? (
            <span className="text-xs text-muted-foreground">{trailingMeta}</span>
          ) : null}
        </span>
      ) : null}
      {showUnreadSlot ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center">
          {showUnreadDot ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMarkRead?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onMarkRead?.();
                }
              }}
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
          ) : (
            <span className="inline-flex h-4 w-4" aria-hidden="true" />
          )}
        </span>
      ) : null}
    </Link>
  );
}
