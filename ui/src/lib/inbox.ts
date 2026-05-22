import type { Approval, DashboardSummary, HeartbeatRun, Issue, JoinRequest } from "@paperclipai/shared";

export const RECENT_ISSUES_LIMIT = 100;
export const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);
export const ACTIONABLE_APPROVAL_STATUSES = new Set(["pending", "revision_requested"]);
export const DISMISSED_KEY = "paperclip:inbox:dismissed";
export const READ_ITEMS_KEY = "paperclip:inbox:read-items";
export const INBOX_LAST_TAB_KEY = "paperclip:inbox:last-tab";
export const INBOX_ISSUE_COLUMNS_KEY = "paperclip:inbox:issue-columns";
export const INBOX_AGENT_RUN_COLUMNS_KEY = "paperclip:inbox:agent-run-columns";
export const INBOX_SECTIONS_OPEN_KEY = "paperclip:inbox:sections-open";

/** Page title shown in the header breadcrumb for `/inbox/*`. */
export const ATTENTION_QUEUE_PAGE_LABEL = "Attention Queue";

export type InboxSectionId = "tasks" | "agent_runs" | "approvals";

export type InboxSectionsOpenState = Record<InboxSectionId, boolean>;

const DEFAULT_INBOX_SECTIONS_OPEN: InboxSectionsOpenState = {
  tasks: true,
  agent_runs: true,
  approvals: true,
};

export function loadInboxSectionsOpen(): InboxSectionsOpenState {
  try {
    const raw = localStorage.getItem(INBOX_SECTIONS_OPEN_KEY);
    if (!raw) return { ...DEFAULT_INBOX_SECTIONS_OPEN };
    const parsed = JSON.parse(raw) as Partial<InboxSectionsOpenState>;
    return {
      tasks: parsed.tasks ?? true,
      agent_runs: parsed.agent_runs ?? true,
      approvals: parsed.approvals ?? true,
    };
  } catch {
    return { ...DEFAULT_INBOX_SECTIONS_OPEN };
  }
}

export function saveInboxSectionsOpen(state: InboxSectionsOpenState) {
  try {
    localStorage.setItem(INBOX_SECTIONS_OPEN_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage failures.
  }
}
export type InboxTab = "mine" | "recent" | "unread" | "all";
export type InboxApprovalFilter = "all" | "actionable" | "resolved";
export const inboxIssueColumns = ["status", "id", "assignee", "project", "workspace", "labels", "updated"] as const;
export type InboxIssueColumn = (typeof inboxIssueColumns)[number];
export const DEFAULT_INBOX_ISSUE_COLUMNS: InboxIssueColumn[] = ["status", "id", "updated"];

export const inboxAgentRunColumns = ["status", "details", "last_run"] as const;
export type InboxAgentRunColumn = (typeof inboxAgentRunColumns)[number];
export const DEFAULT_INBOX_AGENT_RUN_COLUMNS: InboxAgentRunColumn[] = [
  "status",
  "details",
  "last_run",
];

export type InboxWorkItem =
  | {
      kind: "issue";
      timestamp: number;
      issue: Issue;
    }
  | {
      kind: "approval";
      timestamp: number;
      approval: Approval;
    }
  | {
      kind: "failed_run";
      timestamp: number;
      run: HeartbeatRun;
    }
  | {
      kind: "join_request";
      timestamp: number;
      joinRequest: JoinRequest;
    };

export interface InboxBadgeData {
  /**
   * Total open items for the Attention Queue badge: actionable approvals, visible join requests,
   * latest failed runs per agent, unread tasks you touched (`Mine`), and undismissed dashboard
   * alerts (agent errors / budget), minus rows dismissed in the queue.
   */
  inbox: number;
  approvals: number;
  failedRuns: number;
  joinRequests: number;
  /** Touched issues that are still unread for the current user (drives issue slice of `inbox`). */
  mineIssues: number;
  alerts: number;
  /** Undismissed dashboard alert: one or more agents in error (when no failed-run rows). */
  agentErrorAlert: number;
  /** Undismissed dashboard alert: monthly budget at or above 80%. */
  budgetAlert: number;
}

export type InboxBadgeBreakdownLine = { label: string; count: number };

/** Non-zero slices of `InboxBadgeData` for badge hover tooltips. */
export function getInboxBadgeBreakdown(data: InboxBadgeData): InboxBadgeBreakdownLine[] {
  const lines: InboxBadgeBreakdownLine[] = [];
  if (data.mineIssues > 0) {
    lines.push({
      label: data.mineIssues === 1 ? "Unread task (Mine)" : "Unread tasks (Mine)",
      count: data.mineIssues,
    });
  }
  if (data.approvals > 0) {
    lines.push({
      label: data.approvals === 1 ? "Approval" : "Approvals",
      count: data.approvals,
    });
  }
  if (data.failedRuns > 0) {
    lines.push({
      label: data.failedRuns === 1 ? "Failed agent run" : "Failed agent runs",
      count: data.failedRuns,
    });
  }
  if (data.joinRequests > 0) {
    lines.push({
      label: data.joinRequests === 1 ? "Join request" : "Join requests",
      count: data.joinRequests,
    });
  }
  if (data.agentErrorAlert > 0) {
    lines.push({ label: "Agents in error", count: data.agentErrorAlert });
  }
  if (data.budgetAlert > 0) {
    lines.push({ label: "Budget usage high", count: data.budgetAlert });
  }
  return lines;
}

/** Short hover text for the Attention Queue badge, e.g. `1 failed run` or `2 approvals · 1 unread task`. */
export function formatInboxBadgeTooltip(lines: InboxBadgeBreakdownLine[]): string {
  return lines.map(inboxBadgeTooltipPhrase).join(" · ");
}

function inboxBadgeTooltipPhrase(line: InboxBadgeBreakdownLine): string {
  const { count, label } = line;
  const nouns: Record<string, [string, string]> = {
    "Unread task (Mine)": ["unread task", "unread tasks"],
    "Unread tasks (Mine)": ["unread task", "unread tasks"],
    Approval: ["approval", "approvals"],
    Approvals: ["approval", "approvals"],
    "Failed agent run": ["failed run", "failed runs"],
    "Failed agent runs": ["failed run", "failed runs"],
    "Join request": ["join request", "join requests"],
    "Join requests": ["join request", "join requests"],
    "Agents in error": ["agent error", "agent errors"],
    "Budget usage high": ["budget alert", "budget alerts"],
  };
  const pair = nouns[label];
  const noun = pair ? (count === 1 ? pair[0] : pair[1]) : label.toLowerCase();
  return `${count} ${noun}`;
}

export function loadDismissedInboxItems(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveDismissedInboxItems(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore localStorage failures.
  }
}

export function loadReadInboxItems(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_ITEMS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveReadInboxItems(ids: Set<string>) {
  try {
    localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore localStorage failures.
  }
}

export function normalizeInboxIssueColumns(columns: Iterable<string | InboxIssueColumn>): InboxIssueColumn[] {
  const selected = new Set(columns);
  return inboxIssueColumns.filter((column) => selected.has(column));
}

export function getAvailableInboxIssueColumns(enableWorkspaceColumn: boolean): InboxIssueColumn[] {
  if (enableWorkspaceColumn) return [...inboxIssueColumns];
  return inboxIssueColumns.filter((column) => column !== "workspace");
}

export function loadInboxIssueColumns(): InboxIssueColumn[] {
  try {
    const raw = localStorage.getItem(INBOX_ISSUE_COLUMNS_KEY);
    if (raw === null) return DEFAULT_INBOX_ISSUE_COLUMNS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_INBOX_ISSUE_COLUMNS;
    return normalizeInboxIssueColumns(parsed);
  } catch {
    return DEFAULT_INBOX_ISSUE_COLUMNS;
  }
}

export function saveInboxIssueColumns(columns: InboxIssueColumn[]) {
  try {
    localStorage.setItem(
      INBOX_ISSUE_COLUMNS_KEY,
      JSON.stringify(normalizeInboxIssueColumns(columns)),
    );
  } catch {
    // Ignore localStorage failures.
  }
}

export function normalizeInboxAgentRunColumns(
  columns: Iterable<string | InboxAgentRunColumn>,
): InboxAgentRunColumn[] {
  const selected = new Set(columns);
  return inboxAgentRunColumns.filter((column) => selected.has(column));
}

export function loadInboxAgentRunColumns(): InboxAgentRunColumn[] {
  try {
    const raw = localStorage.getItem(INBOX_AGENT_RUN_COLUMNS_KEY);
    if (raw === null) return DEFAULT_INBOX_AGENT_RUN_COLUMNS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_INBOX_AGENT_RUN_COLUMNS;
    return normalizeInboxAgentRunColumns(parsed);
  } catch {
    return DEFAULT_INBOX_AGENT_RUN_COLUMNS;
  }
}

export function saveInboxAgentRunColumns(columns: InboxAgentRunColumn[]) {
  try {
    localStorage.setItem(
      INBOX_AGENT_RUN_COLUMNS_KEY,
      JSON.stringify(normalizeInboxAgentRunColumns(columns)),
    );
  } catch {
    // Ignore localStorage failures.
  }
}

export function resolveIssueWorkspaceName(
  issue: Pick<Issue, "executionWorkspaceId" | "projectId" | "projectWorkspaceId">,
  {
    executionWorkspaceById,
    projectWorkspaceById,
    defaultProjectWorkspaceIdByProjectId,
  }: {
    executionWorkspaceById?: ReadonlyMap<string, {
      name: string;
      mode: "shared_workspace" | "isolated_workspace" | "operator_branch" | "adapter_managed" | "cloud_sandbox";
      projectWorkspaceId: string | null;
    }>;
    projectWorkspaceById?: ReadonlyMap<string, { name: string }>;
    defaultProjectWorkspaceIdByProjectId?: ReadonlyMap<string, string>;
  },
): string | null {
  const defaultProjectWorkspaceId = issue.projectId
    ? defaultProjectWorkspaceIdByProjectId?.get(issue.projectId) ?? null
    : null;

  if (issue.executionWorkspaceId) {
    const executionWorkspace = executionWorkspaceById?.get(issue.executionWorkspaceId) ?? null;
    const linkedProjectWorkspaceId =
      executionWorkspace?.projectWorkspaceId ?? issue.projectWorkspaceId ?? null;
    const isDefaultSharedExecutionWorkspace =
      executionWorkspace?.mode === "shared_workspace" && linkedProjectWorkspaceId === defaultProjectWorkspaceId;
    if (isDefaultSharedExecutionWorkspace) return null;

    const workspaceName = executionWorkspace?.name;
    if (workspaceName) return workspaceName;
  }

  if (issue.projectWorkspaceId) {
    if (issue.projectWorkspaceId === defaultProjectWorkspaceId) return null;
    const workspaceName = projectWorkspaceById?.get(issue.projectWorkspaceId)?.name;
    if (workspaceName) return workspaceName;
  }

  return null;
}

export function loadLastInboxTab(): InboxTab {
  try {
    const raw = localStorage.getItem(INBOX_LAST_TAB_KEY);
    if (raw === "all" || raw === "unread" || raw === "recent" || raw === "mine") return raw;
    if (raw === "new") return "mine";
    return "mine";
  } catch {
    return "mine";
  }
}

export function saveLastInboxTab(tab: InboxTab) {
  try {
    localStorage.setItem(INBOX_LAST_TAB_KEY, tab);
  } catch {
    // Ignore localStorage failures.
  }
}

export function isMineInboxTab(tab: InboxTab): boolean {
  return tab === "mine";
}

export function resolveInboxSelectionIndex(
  previousIndex: number,
  itemCount: number,
): number {
  if (itemCount === 0) return -1;
  if (previousIndex < 0) return -1;
  return Math.min(previousIndex, itemCount - 1);
}

export function getInboxKeyboardSelectionIndex(
  previousIndex: number,
  itemCount: number,
  direction: "next" | "previous",
): number {
  if (itemCount === 0) return -1;
  if (previousIndex < 0) return 0;
  return direction === "next"
    ? Math.min(previousIndex + 1, itemCount - 1)
    : Math.max(previousIndex - 1, 0);
}

/** Most recent failed/timed_out run per agent (ignores newer queued/running/succeeded runs). */
export function getLatestFailedRunsByAgent(runs: HeartbeatRun[]): HeartbeatRun[] {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latestFailedByAgent = new Map<string, HeartbeatRun>();

  for (const run of sorted) {
    if (!FAILED_RUN_STATUSES.has(run.status)) continue;
    if (!latestFailedByAgent.has(run.agentId)) {
      latestFailedByAgent.set(run.agentId, run);
    }
  }

  return Array.from(latestFailedByAgent.values());
}

export function normalizeTimestamp(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function issueLastActivityTimestamp(issue: Issue): number {
  const lastActivityAt = normalizeTimestamp(issue.lastActivityAt);
  if (lastActivityAt > 0) return lastActivityAt;

  const lastExternalCommentAt = normalizeTimestamp(issue.lastExternalCommentAt);
  if (lastExternalCommentAt > 0) return lastExternalCommentAt;

  return normalizeTimestamp(issue.updatedAt);
}

export function sortIssuesByMostRecentActivity(a: Issue, b: Issue): number {
  const activityDiff = issueLastActivityTimestamp(b) - issueLastActivityTimestamp(a);
  if (activityDiff !== 0) return activityDiff;
  return normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt);
}

export function getRecentTouchedIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(sortIssuesByMostRecentActivity).slice(0, RECENT_ISSUES_LIMIT);
}

export function getUnreadTouchedIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.isUnreadForMe);
}

export function getApprovalsForTab(
  approvals: Approval[],
  tab: InboxTab,
  filter: InboxApprovalFilter,
): Approval[] {
  const sortedApprovals = [...approvals].sort(
    (a, b) => normalizeTimestamp(b.updatedAt) - normalizeTimestamp(a.updatedAt),
  );

  if (tab === "mine" || tab === "recent") return sortedApprovals;
  if (tab === "unread") {
    return sortedApprovals.filter((approval) => ACTIONABLE_APPROVAL_STATUSES.has(approval.status));
  }
  if (filter === "all") return sortedApprovals;

  return sortedApprovals.filter((approval) => {
    const isActionable = ACTIONABLE_APPROVAL_STATUSES.has(approval.status);
    return filter === "actionable" ? isActionable : !isActionable;
  });
}

export function approvalActivityTimestamp(approval: Approval): number {
  const updatedAt = normalizeTimestamp(approval.updatedAt);
  if (updatedAt > 0) return updatedAt;
  return normalizeTimestamp(approval.createdAt);
}

export function getInboxWorkItems({
  issues,
  approvals,
  failedRuns = [],
  joinRequests = [],
}: {
  issues: Issue[];
  approvals: Approval[];
  failedRuns?: HeartbeatRun[];
  joinRequests?: JoinRequest[];
}): InboxWorkItem[] {
  return [
    ...issues.map((issue) => ({
      kind: "issue" as const,
      timestamp: issueLastActivityTimestamp(issue),
      issue,
    })),
    ...approvals.map((approval) => ({
      kind: "approval" as const,
      timestamp: approvalActivityTimestamp(approval),
      approval,
    })),
    ...failedRuns.map((run) => ({
      kind: "failed_run" as const,
      timestamp: normalizeTimestamp(run.createdAt),
      run,
    })),
    ...joinRequests.map((joinRequest) => ({
      kind: "join_request" as const,
      timestamp: normalizeTimestamp(joinRequest.createdAt),
      joinRequest,
    })),
  ].sort((a, b) => {
    const timestampDiff = b.timestamp - a.timestamp;
    if (timestampDiff !== 0) return timestampDiff;

    if (a.kind === "issue" && b.kind === "issue") {
      return sortIssuesByMostRecentActivity(a.issue, b.issue);
    }
    if (a.kind === "approval" && b.kind === "approval") {
      return approvalActivityTimestamp(b.approval) - approvalActivityTimestamp(a.approval);
    }

    return a.kind === "approval" ? -1 : 1;
  });
}

export function shouldShowInboxSection({
  tab,
  hasItems,
  showOnMine,
  showOnRecent,
  showOnUnread,
  showOnAll,
}: {
  tab: InboxTab;
  hasItems: boolean;
  showOnMine: boolean;
  showOnRecent: boolean;
  showOnUnread: boolean;
  showOnAll: boolean;
}): boolean {
  if (!hasItems) return false;
  if (tab === "mine") return showOnMine;
  if (tab === "recent") return showOnRecent;
  if (tab === "unread") return showOnUnread;
  return showOnAll;
}

export function computeInboxBadgeData({
  approvals,
  joinRequests,
  dashboard,
  heartbeatRuns,
  mineIssues,
  dismissed,
}: {
  approvals: Approval[];
  joinRequests: JoinRequest[];
  dashboard: DashboardSummary | undefined;
  heartbeatRuns: HeartbeatRun[];
  mineIssues: Issue[];
  dismissed: Set<string>;
}): InboxBadgeData {
  const actionableApprovals = approvals.filter(
    (approval) =>
      ACTIONABLE_APPROVAL_STATUSES.has(approval.status) &&
      !dismissed.has(`approval:${approval.id}`),
  ).length;
  const failedRuns = getLatestFailedRunsByAgent(heartbeatRuns).filter(
    (run) => !dismissed.has(`run:${run.id}`),
  ).length;
  const visibleJoinRequests = joinRequests.filter(
    (jr) => !dismissed.has(`join:${jr.id}`),
  ).length;
  const unreadMineIssues = mineIssues.filter((issue) => issue.isUnreadForMe).length;
  const agentErrorCount = dashboard?.agents.error ?? 0;
  const monthBudgetCents = dashboard?.costs.monthBudgetCents ?? 0;
  const monthUtilizationPercent = dashboard?.costs.monthUtilizationPercent ?? 0;
  const showAggregateAgentError =
    agentErrorCount > 0 &&
    failedRuns === 0 &&
    !dismissed.has("alert:agent-errors");
  const showBudgetAlert =
    monthBudgetCents > 0 &&
    monthUtilizationPercent >= 80 &&
    !dismissed.has("alert:budget");
  const alerts = Number(showAggregateAgentError) + Number(showBudgetAlert);

  return {
    inbox: actionableApprovals + visibleJoinRequests + failedRuns + unreadMineIssues + alerts,
    approvals: actionableApprovals,
    failedRuns,
    joinRequests: visibleJoinRequests,
    mineIssues: unreadMineIssues,
    alerts,
    agentErrorAlert: Number(showAggregateAgentError),
    budgetAlert: Number(showBudgetAlert),
  };
}
