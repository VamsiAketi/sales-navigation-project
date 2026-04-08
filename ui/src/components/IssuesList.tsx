import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { issuesApi } from "../api/issues";
import { authApi } from "../api/auth";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import {
  readFocusAfterIssueCreate,
  clearFocusAfterIssueCreate,
  issueRowGroupKey,
  NEW_ISSUE_BADGE_DURATION_MS,
} from "../lib/focus-created-issue";
import { formatAssigneeUserLabel } from "../lib/assignees";
import { groupBy } from "../lib/groupBy";
import { formatDate, cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { EmptyState } from "./EmptyState";
import { Identity } from "./Identity";
import { IssueRow } from "./IssueRow";
import { PageSkeleton } from "./PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { CircleDot, Plus, Filter, ArrowUpDown, Layers, Check, X, ChevronRight, List, Columns3, User, Search, ChevronDown, EyeOff, Eye } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { KanbanBoard, AssigneeAvatar, nameToInitials } from "./KanbanBoard";
import type { Issue, ProjectIssueStatus } from "@paperclipai/shared";

/* ── Helpers ── */

const statusOrder = ["in_progress", "todo", "backlog", "in_review", "blocked", "done", "cancelled"];
const priorityOrder = ["critical", "high", "medium", "low"];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── View state ── */

export type IssueViewState = {
  statuses: string[];
  priorities: string[];
  assignees: string[];
  reporters: string[];
  labels: string[];
  projects: string[];
  sortField: "status" | "priority" | "title" | "created" | "updated";
  sortDir: "asc" | "desc";
  groupBy: "status" | "priority" | "assignee" | "none";
  viewMode: "list" | "board";
  collapsedGroups: string[];
  showHidden: boolean;
};

const defaultViewState: IssueViewState = {
  statuses: [],
  priorities: [],
  assignees: [],
  reporters: [],
  labels: [],
  projects: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  viewMode: "board",
  collapsedGroups: [],
  showHidden: false,
};

const quickFilterPresets = [
  { label: "All", statuses: [] as string[] },
  { label: "Active", statuses: ["todo", "in_progress", "in_review", "blocked"] },
  { label: "Backlog", statuses: ["backlog"] },
  { label: "Done", statuses: ["done", "cancelled"] },
];

function getViewState(key: string): IssueViewState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaultViewState, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultViewState };
}

function saveViewState(key: string, state: IssueViewState) {
  localStorage.setItem(key, JSON.stringify(state));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function applyFilters(issues: Issue[], state: IssueViewState, currentUserId?: string | null): Issue[] {
  let result = issues;
  if (state.statuses.length > 0) result = result.filter((i) => state.statuses.includes(i.status));
  if (state.priorities.length > 0) result = result.filter((i) => state.priorities.includes(i.priority));
  if (state.assignees.length > 0) {
    result = result.filter((issue) => {
      for (const assignee of state.assignees) {
        if (assignee === "__unassigned" && !issue.assigneeAgentId && !issue.assigneeUserId) return true;
        if (assignee === "__me" && currentUserId && issue.assigneeUserId === currentUserId) return true;
        if (issue.assigneeAgentId === assignee) return true;
        if (issue.assigneeUserId === assignee) return true;
      }
      return false;
    });
  }
  if (state.reporters.length > 0) {
    result = result.filter((issue) => {
      for (const reporter of state.reporters) {
        if (reporter === "__me" && currentUserId && issue.createdByUserId === currentUserId) return true;
        if (issue.createdByAgentId === reporter) return true;
        if (issue.createdByUserId === reporter) return true;
      }
      return false;
    });
  }
  if (state.labels.length > 0) result = result.filter((i) => (i.labelIds ?? []).some((id) => state.labels.includes(id)));
  if (state.projects.length > 0) result = result.filter((i) => i.projectId != null && state.projects.includes(i.projectId));
  return result;
}

function sortIssues(issues: Issue[], state: IssueViewState): Issue[] {
  const sorted = [...issues];
  const dir = state.sortDir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (state.sortField) {
      case "status":
        return dir * (statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
      case "priority":
        return dir * (priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "updated":
        return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      default:
        return 0;
    }
  });
  return sorted;
}

function countActiveFilters(state: IssueViewState): number {
  let count = 0;
  if (state.statuses.length > 0) count++;
  if (state.priorities.length > 0) count++;
  if (state.assignees.length > 0) count++;
  if (state.reporters.length > 0) count++;
  if (state.labels.length > 0) count++;
  if (state.projects.length > 0) count++;
  return count;
}

/* ── Component ── */

interface Agent {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface IssuesListProps {
  issues: Issue[];
  isLoading?: boolean;
  error?: Error | null;
  agents?: Agent[];
  projects?: ProjectOption[];
  liveIssueIds?: Set<string>;
  projectId?: string;
  viewStateKey: string;
  issueLinkState?: unknown;
  initialAssignees?: string[];
  initialSearch?: string;
  searchFilters?: {
    participantAgentId?: string;
  };
  onSearchChange?: (search: string) => void;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
  projectStatuses?: ProjectIssueStatus[];
  forceListView?: boolean;
}

/* ── Assignee filter strip component ─────────────────────────────────────────
 * Shows up to MAX_VISIBLE avatar bubbles. When there are more assignees, a
 * clickable "+N" badge opens a full dropdown listing every assignee with
 * checkboxes (Jira-style).
 * ─────────────────────────────────────────────────────────────────────────── */
const MAX_VISIBLE = 4;

type BoardAssignee = { id: string; label: string; kind: "user" | "agent" };

/** Popover body for the +N overflow badge — lists all assignees with checkboxes. */
function AssigneePopoverBody({
  boardAssignees,
  activeIds,
  onToggle,
  onClear,
}: {
  boardAssignees: BoardAssignee[];
  activeIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const hasActive = activeIds.length > 0;

  const filtered = boardAssignees.filter((m) =>
    m.label.toLowerCase().includes(search.toLowerCase())
  );
  const showUnassigned = "unassigned".includes(search.toLowerCase());

  return (
    <div className="flex flex-col">
      {/* Window title bar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-foreground uppercase">Assignee</span>
        {hasActive && (
          <button
            onClick={onClear}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Search input */}
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assignees…"
          className="w-full bg-background py-2 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {/* Scrollable list — max 10 rows (~240px) */}
      <div className="max-h-[240px] overflow-y-auto">
        {/* Unassigned row */}
        {showUnassigned && (
          <button
            onClick={() => onToggle("__unassigned")}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${activeIds.includes("__unassigned") ? "border-primary bg-primary" : "border-border"}`}>
              {activeIds.includes("__unassigned") && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground">
              <User className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs truncate">Unassigned</span>
          </button>
        )}

        {/* Member / agent rows */}
        {filtered.map((member) => (
          <button
            key={member.id}
            onClick={() => onToggle(member.id)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${activeIds.includes(member.id) ? "border-primary bg-primary" : "border-border"}`}>
              {activeIds.includes(member.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <AssigneeAvatar name={member.label} isAgent={member.kind === "agent"} size="sm" />
            <span className="text-xs truncate">{member.label}</span>
          </button>
        ))}

        {/* Empty state */}
        {!showUnassigned && filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No assignees found</p>
        )}
      </div>
    </div>
  );
}

function AssigneeFilterStrip({
  boardAssignees,
  activeIds,
  onToggle,
  onClear,
}: {
  boardAssignees: BoardAssignee[];
  activeIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const visible  = boardAssignees.slice(0, MAX_VISIBLE);
  const hidden   = boardAssignees.slice(MAX_VISIBLE);
  const overflow = hidden.length;
  const hasActive = activeIds.length > 0;

  return (
    <div className="flex items-center gap-1">
      {/* Unassigned toggle */}
      <button
        title="Unassigned"
        onClick={() => onToggle("__unassigned")}
        className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all
          ${activeIds.includes("__unassigned")
            ? "border-primary bg-accent text-foreground ring-2 ring-primary ring-offset-1 ring-offset-background"
            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
          }`}
      >
        <User className="h-3.5 w-3.5" />
      </button>

      {/* Avatar bubbles — first MAX_VISIBLE only */}
      {visible.map((member) => {
        const isActive = activeIds.includes(member.id);
        return (
          <button
            key={member.id}
            title={member.label}
            onClick={() => onToggle(member.id)}
            className={`transition-all rounded-full ${isActive ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-70 hover:opacity-100"}`}
          >
            <AssigneeAvatar
              name={member.label}
              isAgent={member.kind === "agent"}
              size="md"
              active={isActive}
            />
          </button>
        );
      })}

      {/* +N overflow badge — clickable, opens full assignee list */}
      {overflow > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              title={`${overflow} more assignees`}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-all
                ${hidden.some((m) => activeIds.includes(m.id))
                  ? "border-primary bg-primary/10 text-primary ring-2 ring-primary ring-offset-1 ring-offset-background"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
            >
              +{overflow}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0 rounded-none border border-border shadow-lg overflow-hidden">
            <AssigneePopoverBody
              boardAssignees={boardAssignees}
              activeIds={activeIds}
              onToggle={onToggle}
              onClear={onClear}
            />
          </PopoverContent>
        </Popover>
      )}


      {/* Active filter summary label */}
      {hasActive && (
        <span className="hidden sm:block max-w-[120px] truncate text-xs text-muted-foreground">
          {activeIds
            .filter((id) => id !== "__unassigned")
            .map((id) => boardAssignees.find((m) => m.id === id)?.label ?? id.slice(0, 6))
            .concat(activeIds.includes("__unassigned") ? ["Unassigned"] : [])
            .join(", ")}
        </span>
      )}
    </div>
  );
}

export function IssuesList({
  issues,
  isLoading,
  error,
  agents,
  projects,
  liveIssueIds,
  projectId,
  viewStateKey,
  issueLinkState,
  initialAssignees,
  initialSearch,
  searchFilters,
  onSearchChange,
  onUpdateIssue,
  projectStatuses,
  forceListView = false,
}: IssuesListProps) {
  const { selectedCompanyId } = useCompany();
  const { openNewIssue } = useDialog();
  const { pushToast } = useToast();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const { data: members } = useQuery({
  queryKey: queryKeys.access.members(selectedCompanyId!),
  queryFn: () => accessApi.listMembers(selectedCompanyId!),
  enabled: !!selectedCompanyId,
  });

  const userLabel = useCallback(
    (userId: string | null | undefined): string | null => {
      if (!userId) return null;
      if (userId !== currentUserId && userId !== "local-board") {
        const member = (members ?? []).find((m) => m.user?.id === userId);
        if (member?.user?.name) return member.user.name;
      }
      return formatAssigneeUserLabel(userId, currentUserId);
    },
    [members, currentUserId],
  );

  // Scope the storage key per company so folding/view state is independent across companies.
  const scopedKey = selectedCompanyId ? `${viewStateKey}:${selectedCompanyId}` : viewStateKey;

  const [viewState, setViewState] = useState<IssueViewState>(() => {
    if (initialAssignees) {
      return { ...defaultViewState, assignees: initialAssignees, statuses: [] };
    }
    return getViewState(scopedKey);
  });
  const [assigneePickerIssueId, setAssigneePickerIssueId] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState(initialSearch ?? "");
  const [debouncedIssueSearch, setDebouncedIssueSearch] = useState(issueSearch);
  const normalizedIssueSearch = debouncedIssueSearch.trim();
  const [highlightIssueId, setHighlightIssueId] = useState<string | null>(null);
  const [newBadgeIssueId, setNewBadgeIssueId] = useState<string | null>(null);
  const focusHandledRef = useRef<string | null>(null);

  useEffect(() => {
    setIssueSearch(initialSearch ?? "");
  }, [initialSearch]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedIssueSearch(issueSearch);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [issueSearch]);

  // Reload view state from localStorage when company changes (scopedKey changes).
  const prevScopedKey = useRef(scopedKey);
  useEffect(() => {
    if (prevScopedKey.current !== scopedKey) {
      prevScopedKey.current = scopedKey;
      setViewState(initialAssignees
        ? { ...defaultViewState, assignees: initialAssignees, statuses: [] }
        : getViewState(scopedKey));
    }
  }, [scopedKey, initialAssignees]);

  const updateView = useCallback((patch: Partial<IssueViewState>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      saveViewState(scopedKey, next);
      return next;
    });
  }, [scopedKey]);

  const { data: searchedIssues = [] } = useQuery({
    queryKey: [
      ...queryKeys.issues.search(selectedCompanyId!, normalizedIssueSearch, projectId),
      searchFilters ?? {},
    ],
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: normalizedIssueSearch, projectId, ...searchFilters }),
    enabled: !!selectedCompanyId && normalizedIssueSearch.length > 0,
  });

  const { data: hiddenIssues = [], isLoading: hiddenLoading } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "hidden"],
    queryFn: async () => {
      const all = await issuesApi.list(selectedCompanyId!, { includeHidden: true });
      return all.filter((i) => i.hiddenAt != null);
    },
    enabled: !!selectedCompanyId && viewState.showHidden,
  });

  const agentName = useCallback((id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  }, [agents]);

  const filtered = useMemo(() => {
    if (viewState.showHidden) {
      return sortIssues(hiddenIssues, viewState);
    }
    const sourceIssues = normalizedIssueSearch.length > 0 ? searchedIssues : issues;
    const filteredByControls = applyFilters(sourceIssues, viewState, currentUserId);
    return sortIssues(filteredByControls, viewState);
  }, [issues, searchedIssues, hiddenIssues, viewState, normalizedIssueSearch, currentUserId]);

  useEffect(() => {
    focusHandledRef.current = null;
  }, [selectedCompanyId]);

  useLayoutEffect(() => {
    if (isLoading || !selectedCompanyId) return;
    const pending = readFocusAfterIssueCreate();
    if (!pending || pending.companyId !== selectedCompanyId) return;
    if (focusHandledRef.current === pending.issueId) return;

    const issue = issues.find((i) => i.id === pending.issueId);
    if (!issue) return;

    const sourceForFilter = normalizedIssueSearch.length > 0 ? searchedIssues : issues;
    const passesFilters = applyFilters(sourceForFilter, viewState, currentUserId).some(
      (i) => i.id === pending.issueId,
    );

    if (!passesFilters) {
      focusHandledRef.current = pending.issueId;
      clearFocusAfterIssueCreate();
      const ref = pending.identifier ?? pending.issueId.slice(0, 8);
      pushToast({
        title: `Created ${ref}`,
        body: "This task is hidden by your current filters or search. Adjust them to see it in the list.",
        tone: "info",
        ttlMs: 15_000,
      });
      return;
    }

    focusHandledRef.current = pending.issueId;
    clearFocusAfterIssueCreate();

    if (viewState.groupBy !== "none") {
      let groupKey: string;
      if (viewState.groupBy === "status") groupKey = issue.status;
      else if (viewState.groupBy === "priority") groupKey = issue.priority;
      else groupKey = issueRowGroupKey(issue);
      if (viewState.collapsedGroups.includes(groupKey)) {
        updateView({ collapsedGroups: viewState.collapsedGroups.filter((k) => k !== groupKey) });
      }
    }

    if (!forceListView && viewState.viewMode !== "board") {
      updateView({ viewMode: "board" });
    }

    setHighlightIssueId(pending.issueId);
    setNewBadgeIssueId(pending.issueId);
  }, [
    isLoading,
    selectedCompanyId,
    issues,
    searchedIssues,
    normalizedIssueSearch,
    viewState,
    currentUserId,
    forceListView,
    pushToast,
    updateView,
  ]);

  useLayoutEffect(() => {
    if (!highlightIssueId) return;

    let alive = true;
    const scrollToTask = () => {
      if (!alive) return;
      const el = document.getElementById(`issue-surface-${highlightIssueId}`);
      if (!el) return;
      el.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    };

    scrollToTask();
    const outerRaf = requestAnimationFrame(() => {
      requestAnimationFrame(scrollToTask);
    });
    const retryTimer = window.setTimeout(scrollToTask, 280);
    return () => {
      alive = false;
      cancelAnimationFrame(outerRaf);
      window.clearTimeout(retryTimer);
    };
  }, [highlightIssueId, viewState.viewMode, viewState.collapsedGroups, filtered]);

  useEffect(() => {
    if (!highlightIssueId) return;
    const t = window.setTimeout(() => setHighlightIssueId(null), 4500);
    return () => window.clearTimeout(t);
  }, [highlightIssueId]);

  useEffect(() => {
    if (!newBadgeIssueId) return;
    const t = window.setTimeout(() => setNewBadgeIssueId(null), NEW_ISSUE_BADGE_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [newBadgeIssueId]);

  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(selectedCompanyId!),
    queryFn: () => issuesApi.listLabels(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Build a flat list of human members with id + name for the Kanban board
  const humanMembers = useMemo(
    () =>
      (companyMembers ?? [])
        .filter((m) => m.principalType === "user" && m.user)
        .map((m) => ({ id: m.user!.id, name: m.user!.name })),
    [companyMembers]
  );

  // Build the ordered assignee strip: humans first, then agents
  const boardAssignees = useMemo(() => {
    const humans = humanMembers.map((m) => ({
      id: m.id,
      label: m.name,
      kind: "user" as const,
      initial: m.name.trim()[0]?.toUpperCase() ?? "?",
    }));
    const agentItems = (agents ?? []).map((a) => ({
      id: a.id,
      label: a.name,
      kind: "agent" as const,
      initial: a.name.trim()[0]?.toUpperCase() ?? "?",
    }));
    return [...humans, ...agentItems];
  }, [humanMembers, agents]);

  const activeFilterCount = countActiveFilters(viewState);

  const groupedContent = useMemo(() => {
    if (viewState.groupBy === "none") {
      return [{ key: "__all", label: null as string | null, items: filtered }];
    }
    if (viewState.groupBy === "status") {
      const groups = groupBy(filtered, (i) => i.status);
      return statusOrder
        .filter((s) => groups[s]?.length)
        .map((s) => ({ key: s, label: statusLabel(s), items: groups[s]! }));
    }
    if (viewState.groupBy === "priority") {
      const groups = groupBy(filtered, (i) => i.priority);
      return priorityOrder
        .filter((p) => groups[p]?.length)
        .map((p) => ({ key: p, label: statusLabel(p), items: groups[p]! }));
    }
    // assignee
    const groups = groupBy(
      filtered,
      (issue) => issue.assigneeAgentId ?? (issue.assigneeUserId ? `__user:${issue.assigneeUserId}` : "__unassigned"),
    );
    return Object.keys(groups).map((key) => ({
      key,
      label:
        key === "__unassigned"
          ? "Unassigned"
          : key.startsWith("__user:")
            ? (userLabel(key.slice("__user:".length)) ?? "User")
            : (agentName(key) ?? key.slice(0, 8)),
      items: groups[key]!,
    }));
  }, [filtered, viewState.groupBy, agents, agentName, currentUserId, userLabel]);

  const newIssueDefaults = (groupKey?: string) => {
    const defaults: Record<string, string> = {};
    if (projectId) defaults.projectId = projectId;
    if (groupKey) {
      if (viewState.groupBy === "status") defaults.status = groupKey;
      else if (viewState.groupBy === "priority") defaults.priority = groupKey;
      else if (viewState.groupBy === "assignee" && groupKey !== "__unassigned") {
        if (groupKey.startsWith("__user:")) defaults.assigneeUserId = groupKey.slice("__user:".length);
        else defaults.assigneeAgentId = groupKey;
      }
    }
    return defaults;
  };

  const assignIssue = (issueId: string, assigneeAgentId: string | null, assigneeUserId: string | null = null) => {
    onUpdateIssue(issueId, { assigneeAgentId, assigneeUserId });
    setAssigneePickerIssueId(null);
    setAssigneeSearch("");
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="sticky top-0 z-[60] bg-background -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-5 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button size="sm" variant="outline" onClick={() => openNewIssue(newIssueDefaults())}>
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
          <div className="relative w-48 sm:w-64 md:w-80">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={issueSearch}
              onChange={(e) => {
                setIssueSearch(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder="Search tasks..."
              className="pl-7 text-xs sm:text-sm"
              aria-label="Search issues"
            />
          </div>
          {/* ── Assignee avatar filter strip + dropdown ── */}
          {boardAssignees.length > 0 && (
            <AssigneeFilterStrip
              boardAssignees={boardAssignees}
              activeIds={viewState.assignees}
              onToggle={(id) => updateView({ assignees: toggleInArray(viewState.assignees, id) })}
              onClear={() => updateView({ assignees: [] })}
            />
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* View mode toggle — hidden on the global Tasks page (forceListView), visible on project pages */}
          {!forceListView && (
            <div className="flex items-center border border-border rounded-md overflow-hidden mr-1">
              <button
                className={`p-1.5 transition-colors ${viewState.viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => updateView({ viewMode: "list" })}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                className={`p-1.5 transition-colors ${viewState.viewMode === "board" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => updateView({ viewMode: "board" })}
                title="Board view"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={`text-xs ${activeFilterCount > 0 ? "text-blue-600 dark:text-blue-400" : ""}`}>
                <Filter className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                <span className="hidden sm:inline">{activeFilterCount > 0 ? `Filters: ${activeFilterCount}` : "Filter"}</span>
                {activeFilterCount > 0 && (
                  <span className="sm:hidden text-[10px] font-medium ml-0.5">{activeFilterCount}</span>
                )}
                {activeFilterCount > 0 && (
                  <X
                    className="h-3 w-3 ml-1 hidden sm:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateView({ statuses: [], priorities: [], assignees: [], reporters: [], labels: [], projects: [] });
                    }}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(480px,calc(100vw-2rem))] p-0">
              <div className="p-3 space-y-3 max-h-[min(70vh,600px)] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Filters</span>
                  {activeFilterCount > 0 && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => updateView({ statuses: [], priorities: [], assignees: [], reporters: [], labels: [], projects: [] })}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Quick filters */}
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Quick filters</span>
                  <div className="flex flex-wrap gap-1.5">
                    {quickFilterPresets.map((preset) => {
                      const isActive = !viewState.showHidden && arraysEqual(viewState.statuses, preset.statuses);
                      return (
                        <button
                          key={preset.label}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                          }`}
                          onClick={() => updateView({ statuses: isActive ? [] : [...preset.statuses], showHidden: false })}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                    <button
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        viewState.showHidden
                          ? "bg-amber-500/10 text-amber-600 border-amber-400/50 dark:text-amber-400"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                      }`}
                      onClick={() => updateView({ showHidden: !viewState.showHidden, statuses: [] })}
                    >
                      <EyeOff className="h-3 w-3" />
                      Hidden
                    </button>
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Multi-column filter sections */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {/* Status */}
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <div className="space-y-0.5">
                      {(projectStatuses && projectStatuses.length > 0
                        ? projectStatuses.filter((s) => s.isActive).sort((a, b) => a.position - b.position)
                        : statusOrder.map((s) => ({ value: s, name: statusLabel(s), color: undefined }))
                      ).map((s) => (
                        <label key={s.value} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                          <Checkbox
                            checked={viewState.statuses.includes(s.value)}
                            onCheckedChange={() => updateView({ statuses: toggleInArray(viewState.statuses, s.value) })}
                          />
                          <StatusIcon status={s.value} projectStatuses={projectStatuses} />
                          <span className="text-sm">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Priority + Assignee stacked in right column */}
                  <div className="space-y-3">
                    {/* Priority */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Priority</span>
                      <div className="space-y-0.5">
                        {priorityOrder.map((p) => (
                          <label key={p} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.priorities.includes(p)}
                              onCheckedChange={() => updateView({ priorities: toggleInArray(viewState.priorities, p) })}
                            />
                            <PriorityIcon priority={p} />
                            <span className="text-sm">{statusLabel(p)}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Assignee */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Assignee</span>
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        <label className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                          <Checkbox
                            checked={viewState.assignees.includes("__unassigned")}
                            onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, "__unassigned") })}
                          />
                          <span className="text-sm">No assignee</span>
                        </label>
                        {currentUserId && (
                          <label className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.assignees.includes("__me")}
                              onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, "__me") })}
                            />
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">Me</span>
                          </label>
                        )}
                        {(agents ?? []).map((agent) => (
                          <label key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.assignees.includes(agent.id)}
                              onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, agent.id) })}
                            />
                            <span className="text-sm">{agent.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Reporter */}
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Reporter</span>
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {currentUserId && (
                          <label className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.reporters.includes("__me")}
                              onCheckedChange={() => updateView({ reporters: toggleInArray(viewState.reporters, "__me") })}
                            />
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">Me</span>
                          </label>
                        )}
                        {humanMembers
                          .filter((m) => m.id !== currentUserId)
                          .map((member) => (
                          <label key={member.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.reporters.includes(member.id)}
                              onCheckedChange={() => updateView({ reporters: toggleInArray(viewState.reporters, member.id) })}
                            />
                            <span className="text-sm">{member.name}</span>
                          </label>
                        ))}
                        {(agents ?? []).map((agent) => (
                          <label key={agent.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                            <Checkbox
                              checked={viewState.reporters.includes(agent.id)}
                              onCheckedChange={() => updateView({ reporters: toggleInArray(viewState.reporters, agent.id) })}
                            />
                            <span className="text-sm">{agent.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {labels && labels.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Labels</span>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {labels.map((label) => (
                            <label key={label.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                              <Checkbox
                                checked={viewState.labels.includes(label.id)}
                                onCheckedChange={() => updateView({ labels: toggleInArray(viewState.labels, label.id) })}
                              />
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                              <span className="text-sm">{label.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {projects && projects.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Project</span>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {projects.map((project) => (
                            <label key={project.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 cursor-pointer">
                              <Checkbox
                                checked={viewState.projects.includes(project.id)}
                                onCheckedChange={() => updateView({ projects: toggleInArray(viewState.projects, project.id) })}
                              />
                              <span className="text-sm">{project.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Sort (list view only) */}
          {(forceListView || viewState.viewMode === "list") && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                  <span className="hidden sm:inline">Sort</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-0">
                <div className="p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["title", "Title"],
                    ["created", "Created"],
                    ["updated", "Updated"],
                  ] as const).map(([field, label]) => (
                    <button
                      key={field}
                      className={`flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm ${
                        viewState.sortField === field ? "bg-accent/50 text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                      }`}
                      onClick={() => {
                        if (viewState.sortField === field) {
                          updateView({ sortDir: viewState.sortDir === "asc" ? "desc" : "asc" });
                        } else {
                          updateView({ sortField: field, sortDir: "asc" });
                        }
                      }}
                    >
                      <span>{label}</span>
                      {viewState.sortField === field && (
                        <span className="text-xs text-muted-foreground">
                          {viewState.sortDir === "asc" ? "\u2191" : "\u2193"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Group (list view only) */}
          {(forceListView || viewState.viewMode === "list") && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs">
                  <Layers className="h-3.5 w-3.5 sm:h-3 sm:w-3 sm:mr-1" />
                  <span className="hidden sm:inline">Group</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-0">
                <div className="p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["assignee", "Assignee"],
                    ["none", "None"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={`flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm ${
                        viewState.groupBy === value ? "bg-accent/50 text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                      }`}
                      onClick={() => updateView({ groupBy: value })}
                    >
                      <span>{label}</span>
                      {viewState.groupBy === value && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {(isLoading || (viewState.showHidden && hiddenLoading)) && <PageSkeleton variant="issues-list" />}
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {viewState.showHidden && !hiddenLoading && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300/50 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-400">
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          <span>Showing <strong>{filtered.length}</strong> hidden task{filtered.length !== 1 ? "s" : ""}. Click <strong>Unhide</strong> on any task to restore it.</span>
        </div>
      )}

      {!(isLoading || (viewState.showHidden && hiddenLoading)) && filtered.length === 0 && (forceListView || viewState.viewMode === "list") && (
        <EmptyState
          icon={viewState.showHidden ? EyeOff : CircleDot}
          message={viewState.showHidden ? "No hidden tasks." : "No tasks match the current filters or search."}
          action={viewState.showHidden ? undefined : "Create Task"}
          onAction={viewState.showHidden ? undefined : () => openNewIssue(newIssueDefaults())}
        />
      )}

      {!isLoading && filtered.length > 0 && (forceListView || viewState.viewMode === "list") && (
        <div className="hidden sm:flex items-center gap-2 border-b border-border bg-muted/30 py-1.5 pl-1 pr-3 text-xs font-medium text-muted-foreground select-none">
          <span className="w-3.5 shrink-0" />
          <span className="h-4 w-4 shrink-0" />
          <span className="shrink-0">ID</span>
          <span className="min-w-0 flex-1">Title</span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden md:block">Labels</span>
            <span className="w-[180px] px-2">Assignee</span>
            <span>Created</span>
          </span>
        </div>
      )}

      {!forceListView && viewState.viewMode === "board" ? (
        <KanbanBoard
          issues={filtered}
          agents={agents}
          members={humanMembers}
          liveIssueIds={liveIssueIds}
          onUpdateIssue={onUpdateIssue}
          projectStatuses={projectStatuses}
          issueLinkState={issueLinkState}
          highlightIssueId={highlightIssueId}
          newBadgeIssueId={newBadgeIssueId}
        />
      ) : (
        groupedContent.map((group) => (
          <Collapsible
            key={group.key}
            open={!viewState.collapsedGroups.includes(group.key)}
            onOpenChange={(open) => {
              updateView({
                collapsedGroups: open
                  ? viewState.collapsedGroups.filter((k) => k !== group.key)
                  : [...viewState.collapsedGroups, group.key],
              });
            }}
          >
            {group.label && (
              <div className="flex items-center py-1.5 pl-1 pr-3">
                <CollapsibleTrigger className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90" />
                  <span className="text-sm font-semibold uppercase tracking-wide">
                    {group.label}
                  </span>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto text-muted-foreground"
                  onClick={() => openNewIssue(newIssueDefaults(group.key))}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CollapsibleContent>
              {group.items.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  issueLinkState={issueLinkState}
                  showNewBadge={newBadgeIssueId === issue.id}
                  className={
                    highlightIssueId === issue.id
                      ? "relative z-[1] ring-2 ring-inset ring-primary/80 bg-primary/[0.06] motion-safe:animate-[kanban-new-card_1.2s_ease-out_1]"
                      : undefined
                  }
                  desktopLeadingSpacer
                  mobileLeading={(
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <StatusIcon
                        status={issue.status}
                        onChange={(s) => onUpdateIssue(issue.id, { status: s })}
                        projectStatuses={projectStatuses}
                      />
                    </span>
                  )}
                  desktopMetaLeading={(
                    <>
                      <span
                        className="hidden shrink-0 sm:inline-flex"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <StatusIcon
                          status={issue.status}
                          onChange={(s) => onUpdateIssue(issue.id, { status: s })}
                          projectStatuses={projectStatuses}
                        />
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {issue.identifier ?? issue.id.slice(0, 8)}
                      </span>
                      {liveIssueIds?.has(issue.id) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 sm:gap-1.5 sm:px-2">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                          </span>
                          <span className="hidden text-[11px] font-medium text-blue-600 dark:text-blue-400 sm:inline">
                            Live
                          </span>
                        </span>
                      )}
                    </>
                  )}
                  mobileMeta={timeAgo(issue.updatedAt)}
                  desktopTrailing={(
                    <>
                      {(issue.labels ?? []).length > 0 && (
                        <span className="hidden items-center gap-1 overflow-hidden md:flex md:max-w-[240px]">
                          {(issue.labels ?? []).slice(0, 3).map((label) => (
                            <span
                              key={label.id}
                              className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                borderColor: label.color,
                                color: pickTextColorForPillBg(label.color, 0.12),
                                backgroundColor: `${label.color}1f`,
                              }}
                            >
                              {label.name}
                            </span>
                          ))}
                          {(issue.labels ?? []).length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{(issue.labels ?? []).length - 3}
                            </span>
                          )}
                        </span>
                      )}
                      <Popover
                        open={assigneePickerIssueId === issue.id}
                        onOpenChange={(open) => {
                          setAssigneePickerIssueId(open ? issue.id : null);
                          if (!open) setAssigneeSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            className="flex w-[180px] shrink-0 items-center rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            {issue.assigneeAgentId && agentName(issue.assigneeAgentId) ? (
                              <Identity name={agentName(issue.assigneeAgentId)!} size="sm" />
                            ) : issue.assigneeUserId ? (
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                                  <User className="h-3 w-3" />
                                </span>
                                {humanMembers.find((m) => m.id === issue.assigneeUserId)?.name
                                  ?? userLabel(issue.assigneeUserId)
                                  ?? "User"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                                  <User className="h-3 w-3" />
                                </span>
                                Assignee
                              </span>
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-56 p-1"
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDownOutside={() => setAssigneeSearch("")}
                        >
                          <input
                            className="mb-1 w-full border-b border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
                            placeholder="Search assignees..."
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            autoFocus
                          />
                          <div className="max-h-48 overflow-y-auto overscroll-contain">
                            <button
                              className={cn(
                                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50",
                                !issue.assigneeAgentId && !issue.assigneeUserId && "bg-accent",
                              )}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                assignIssue(issue.id, null, null);
                              }}
                            >
                              No assignee
                            </button>
                            {currentUserId && (
                              <button
                                className={cn(
                                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                                  issue.assigneeUserId === currentUserId && "bg-accent",
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  assignIssue(issue.id, null, currentUserId);
                                }}
                              >
                                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span>Me</span>
                              </button>
                            )}
                            {(agents ?? [])
                              .filter((agent) => {
                                if (!assigneeSearch.trim()) return true;
                                return agent.name
                                  .toLowerCase()
                                  .includes(assigneeSearch.toLowerCase());
                              })
                              .map((agent) => (
                                <button
                                  key={agent.id}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                                    issue.assigneeAgentId === agent.id && "bg-accent",
                                  )}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    assignIssue(issue.id, agent.id, null);
                                  }}
                                >
                                  <Identity name={agent.name} size="sm" className="min-w-0" />
                                </button>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </>
                  )}
                  trailingMeta={viewState.showHidden ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(issue.createdAt)}</span>
                      <button
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                        title="Unhide this task"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onUpdateIssue(issue.id, { hiddenAt: null });
                        }}
                      >
                        <Eye className="h-3 w-3" />
                        Unhide
                      </button>
                    </span>
                  ) : formatDate(issue.createdAt)}
                  projectStatuses={projectStatuses}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
    </div>
  );
}
