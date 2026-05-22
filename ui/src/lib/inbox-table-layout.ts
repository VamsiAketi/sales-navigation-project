import type { InboxIssueColumn } from "./inbox";
import { ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS } from "./issue-list-layout";

/** Fixed width for the unread / dismiss control column. */
export const INBOX_TABLE_UNREAD_COL = "1.25rem";

/** Width for inline row actions (approve / retry). */
export const INBOX_TABLE_ACTIONS_COL = "max-content";

const INBOX_TRAILING_COLUMN_WIDTHS: Record<
  Exclude<InboxIssueColumn, "status" | "id">,
  string
> = {
  assignee: "minmax(7.5rem, 9.5rem)",
  project: "minmax(6.5rem, 8.5rem)",
  workspace: "minmax(9rem, 12rem)",
  labels: "minmax(8rem, 10rem)",
  updated: "minmax(6.5rem, 7.5rem)",
};

export function inboxTrailingColumnWidth(column: InboxIssueColumn): string | null {
  if (column === "status" || column === "id") return null;
  return INBOX_TRAILING_COLUMN_WIDTHS[column];
}

export function buildInboxIssueTableGridColumns({
  showStatus,
  showId,
  trailingColumns,
  includeActions = false,
}: {
  showStatus: boolean;
  showId: boolean;
  trailingColumns: InboxIssueColumn[];
  includeActions?: boolean;
}): string {
  const parts: string[] = [INBOX_TABLE_UNREAD_COL];
  if (showStatus) parts.push("8.5rem");
  if (showId) parts.push("5.5rem");
  parts.push("minmax(12rem, 1fr)");
  for (const column of trailingColumns) {
    const width = inboxTrailingColumnWidth(column);
    if (width) parts.push(width);
  }
  if (includeActions) parts.push(INBOX_TABLE_ACTIONS_COL);
  return parts.join(" ");
}

/** Run title column — capped width so Details/Last run sit closer to the title. */
export const INBOX_AGENT_RUN_COL_RUN = "minmax(8rem, 18rem)";

/** Error / status summary — capped so Last run is not pushed to the far right. */
export const INBOX_AGENT_RUN_COL_DETAILS = "minmax(10rem, 24rem)";

/** Relative time (e.g. "2h ago"). */
export const INBOX_AGENT_RUN_COL_LAST_RUN = "minmax(5rem, 6.5rem)";

/** Trailing column: grows to the table edge; Actions align to the end inside this cell. */
export const INBOX_AGENT_RUN_COL_TRAILING = "minmax(0, 1fr)";

export type InboxAgentRunTableVisibility = {
  showStatus: boolean;
  showDetails: boolean;
  showLastRun: boolean;
};

/** Agent runs table: status (optional), run, details (optional), last run (optional), trailing (actions). */
export function buildInboxAgentRunTableGridColumns(visibility: InboxAgentRunTableVisibility): string {
  const parts: string[] = [];
  if (visibility.showStatus) parts.push("8.5rem");
  parts.push(INBOX_AGENT_RUN_COL_RUN);
  if (visibility.showDetails) parts.push(INBOX_AGENT_RUN_COL_DETAILS);
  if (visibility.showLastRun) parts.push(INBOX_AGENT_RUN_COL_LAST_RUN);
  parts.push(INBOX_AGENT_RUN_COL_TRAILING);
  return parts.join(" ");
}

export const INBOX_AGENT_RUN_TABLE_ROW_CLASS =
  "border-b border-border/80 last:border-b-0 sm:grid sm:w-full sm:items-center sm:gap-x-3 sm:px-3 sm:py-2";

/** Status column cell — unread control + badge; header uses the same width/spacer. */
export const INBOX_AGENT_RUN_STATUS_CELL_CLASS =
  `inline-flex min-w-0 items-center gap-1.5 ${ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS}`;

/** Trailing column cell — header label and row actions share this layout. */
export const INBOX_AGENT_RUN_TRAILING_CELL_CLASS = "flex min-w-0 items-center justify-end gap-2";

/** Approvals / join requests: unread, type icon, title, details, optional actions. */
export function buildInboxGovernanceTableGridColumns(includeActions = false): string {
  const parts = [
    INBOX_TABLE_UNREAD_COL,
    "2.25rem",
    "minmax(12rem, 1fr)",
    "minmax(10rem, 14rem)",
  ];
  if (includeActions) parts.push(INBOX_TABLE_ACTIONS_COL);
  return parts.join(" ");
}

/** @deprecated Use buildInboxGovernanceTableGridColumns or buildInboxAgentRunTableGridColumns */
export function buildInboxAttentionTableGridColumns(includeActions = false): string {
  return buildInboxGovernanceTableGridColumns(includeActions);
}

export const INBOX_TABLE_HEADER_CLASS =
  "hidden border-b border-border bg-muted/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:grid sm:items-center sm:gap-x-3";

export const INBOX_TABLE_ROW_CLASS =
  "border-b border-border/80 px-3 py-2.5 transition-colors last:border-b-0 sm:grid sm:items-center sm:gap-x-3 sm:py-2";

export const INBOX_TABLE_CELL_MUTED = "min-w-0 truncate text-xs text-muted-foreground";

export const INBOX_TABLE_CELL_META = "min-w-0 truncate text-xs text-muted-foreground tabular-nums";

export { ISSUE_LIST_STATUS_COLUMN_WIDTH_CLASS };
