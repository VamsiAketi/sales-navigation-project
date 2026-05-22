import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";
import { Link, useLocation } from "@/lib/router";
import { createIssueDetailPath, mergeIssueModalLocationState } from "../lib/issueDetailBreadcrumb";
import { cn } from "../lib/utils";
import { NEW_ISSUE_BADGE_CLASS } from "../lib/focus-created-issue";
import { StatusIcon } from "./StatusIcon";
import { ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS } from "../lib/issue-list-layout";

type UnreadState = "hidden" | "visible" | "fading";
type IssueRowTitleVars = CSSProperties & {
  "--issue-row-title-width"?: string;
  "--issue-row-title-min-width"?: string;
};

interface IssueRowProps {
  issue: Issue;
  selected?: boolean;
  issueLinkState?: unknown;
  /** Pass `false` to remove the mobile leading slot entirely. */
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
  /** Optional fixed/flexible width styling for desktop title column. */
  desktopTitleStyle?: CSSProperties;
  /** Keep trailing metadata docked right; disable for fixed table-like layouts. */
  alignDesktopTrailingRight?: boolean;
  /** Keep the default left padding before trailing desktop metadata. */
  desktopTrailingPaddingLeft?: boolean;
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
  desktopTitleStyle,
  alignDesktopTrailingRight = true,
  desktopTrailingPaddingLeft = true,
}: IssueRowProps) {
  const location = useLocation();
  const issuePathId = issue.identifier ?? issue.id;
  const issueHref = createIssueDetailPath(issuePathId, issueLinkState);
  const rowLinkState = useMemo(
    () => mergeIssueModalLocationState(issueLinkState, location),
    [issueLinkState, location],
  );
  const identifier = issue.identifier ?? issue.id.slice(0, 8);
  const descriptionPreview = issue.description?.trim() ?? "";
  const showUnreadSlot = unreadState !== null;
  const showUnreadDot = unreadState === "visible" || unreadState === "fading";
  const showMobileLeading = mobileLeading !== false;
  const desktopTitleVars = useMemo<IssueRowTitleVars | undefined>(() => {
    if (!desktopTitleStyle) return undefined;
    const vars: IssueRowTitleVars = {};
    if (desktopTitleStyle.width != null) {
      vars["--issue-row-title-width"] =
        typeof desktopTitleStyle.width === "number"
          ? `${desktopTitleStyle.width}px`
          : desktopTitleStyle.width;
    }
    if (desktopTitleStyle.minWidth != null) {
      vars["--issue-row-title-min-width"] =
        typeof desktopTitleStyle.minWidth === "number"
          ? `${desktopTitleStyle.minWidth}px`
          : desktopTitleStyle.minWidth;
    }
    return vars;
  }, [desktopTitleStyle]);

  return (
    <Link
      id={`issue-surface-${issue.id}`}
      data-inbox-issue-link
      to={issueHref}
      state={rowLinkState}
      className={cn(
        "flex items-start gap-2.5 border-b border-border px-3 py-3 text-sm no-underline text-inherit transition-colors hover:bg-accent/50 first:pt-3 last:border-b-0 sm:items-center sm:gap-2 sm:px-3 sm:py-2 sm:pl-1 sm:pr-3 sm:first:pt-0",
        !showMobileLeading && !mobileMeta && "gap-0 sm:gap-2",
        selected && "bg-accent hover:bg-transparent",
        className,
      )}
    >
      {showMobileLeading ? (
        <span className="shrink-0 pt-px sm:hidden">
          {mobileLeading ?? <StatusIcon status={issue.status} projectStatuses={projectStatuses} />}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-2 sm:contents sm:gap-0">
        <span
          className={cn(
            "flex min-w-0 items-start gap-2 sm:order-2 sm:items-center",
            desktopTitleStyle
              ? "sm:flex-none sm:[width:var(--issue-row-title-width)] sm:[min-width:var(--issue-row-title-min-width)]"
              : "sm:flex-1",
          )}
          style={desktopTitleVars}
        >
          {showNewBadge ? (
            <span
              className={cn(NEW_ISSUE_BADGE_CLASS, "mt-0.5 shrink-0 sm:mt-0")}
              aria-label="Newly created task"
            >
              New
            </span>
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 break-words text-[15px] font-medium leading-snug [overflow-wrap:anywhere] sm:truncate sm:text-sm sm:font-normal sm:leading-normal sm:line-clamp-none",
              descriptionPreview ? "line-clamp-2" : "line-clamp-3",
            )}
          >
            {issue.title}
          </span>
        </span>
        {descriptionPreview ? (
          <p className="min-w-0 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere] sm:hidden">
            {descriptionPreview}
          </p>
        ) : null}
        {mobileMeta ? (
          <span className="flex min-w-0 flex-col gap-1.5 sm:hidden">{mobileMeta}</span>
        ) : null}
        <span className="hidden items-center gap-2 sm:order-1 sm:flex sm:shrink-0">
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
        </span>
      </span>
      {(desktopTrailing || trailingMeta) ? (
        <span
          className={cn(
            "hidden shrink-0 items-center gap-2 sm:order-3 sm:flex sm:gap-3",
            alignDesktopTrailingRight && "ml-auto",
            desktopTrailingPaddingLeft && "sm:pl-3",
          )}
        >
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
