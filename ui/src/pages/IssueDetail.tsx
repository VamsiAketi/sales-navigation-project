import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { Link, useLocation, useNavigate, useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { activityApi } from "../api/activity";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { accessApi } from "../api/access";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { usePanel } from "../context/PanelContext";
import { useToast } from "../context/ToastContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { assigneeValueFromSelection, sortHumanMembersForPicker, suggestedCommentAssigneeValue } from "../lib/assignees";
import { queryKeys } from "../lib/queryKeys";
import {
  createIssueDetailPath,
  mergeIssueModalLocationState,
  readIssueDetailBreadcrumb,
  readIssueDetailBreadcrumbChain,
} from "../lib/issueDetailBreadcrumb";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { useProjectIssueStatuses } from "../hooks/useProjectIssueStatuses";
import { relativeTime, cn } from "../lib/utils";
import { InlineEditor, type InlineEditorRef } from "../components/InlineEditor";
import { CommentThread } from "../components/CommentThread";
import { IssueAttachmentsJiraGallery } from "../components/IssueAttachmentsJiraGallery";
import { IssueDocumentsSection } from "../components/IssueDocumentsSection";
import { IssueProperties } from "../components/IssueProperties";
import { IssueLink } from "../components/IssueLink";
import { LiveRunWidget } from "../components/LiveRunWidget";
import type { MentionOption } from "../components/MarkdownEditor";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { PluginSlotMount, PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity as ActivityIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Hexagon,
  ListTree,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Repeat,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { INBOX_MINE_ISSUE_STATUS_FILTER, type ActivityEvent, type Agent } from "@paperclipai/shared";
import { getRecentTouchedIssues } from "../lib/inbox";
import { buildAttachmentOriginMap, extractAttachmentIdsFromMarkdown } from "../lib/issue-attachment-markdown-refs";
import {
  ISSUE_ATTACHMENT_FILE_INPUT_ACCEPT,
  markdownTokenForUploadedIssueFile,
} from "../lib/issue-attachment-file-accept";

type CommentReassignment = {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "issue.created": "created this task",
  "issue.updated": "updated this task",
  "issue.checked_out": "picked up this task for work",
  "issue.released": "stopped work on this task",
  "issue.read_marked": "marked this task as read",
  "issue.comment_added": "added a comment",
  "issue.attachment_added": "added an attachment",
  "issue.attachment_removed": "removed an attachment",
  "issue.document_created": "created a document",
  "issue.document_updated": "updated a document",
  "issue.document_deleted": "deleted a document",
  "issue.work_product_created": "created a work product",
  "issue.work_product_updated": "updated a work product",
  "issue.work_product_deleted": "deleted a work product",
  "issue.approval_linked": "linked an approval",
  "issue.approval_unlinked": "unlinked an approval",
  "issue.checkout_lock_adopted": "took over ongoing work",
  "issue.deleted": "deleted this task",
  "agent.created": "created an agent",
  "agent.updated": "updated the agent",
  "agent.paused": "paused the agent",
  "agent.resumed": "resumed the agent",
  "agent.terminated": "terminated the agent",
  "heartbeat.invoked": "invoked a heartbeat",
  "heartbeat.cancelled": "cancelled a heartbeat",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function resolveAssigneeName(
  payload: Record<string, unknown>,
  agentMap: Map<string, Agent>,
  userNameMap: Map<string, string>,
): string | null {
  const assigneeAgentId = typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : null;
  if (assigneeAgentId) {
    return agentMap.get(assigneeAgentId)?.name ?? `agent ${shortId(assigneeAgentId)}`;
  }
  const assigneeUserId = typeof payload.assigneeUserId === "string" ? payload.assigneeUserId : null;
  if (!assigneeUserId) return null;
  const assigneeUserName = typeof payload.assigneeUserName === "string" ? payload.assigneeUserName : null;
  if (assigneeUserName) return assigneeUserName;
  if (assigneeUserId === "local-board") return "Board";
  return userNameMap.get(assigneeUserId) ?? `user ${shortId(assigneeUserId)}`;
}

function resolvePreviousAssigneeName(
  details: Record<string, unknown>,
  previous: Record<string, unknown>,
  agentMap: Map<string, Agent>,
  userNameMap: Map<string, string>,
): string | null {
  const previousAssigneeAgentId = typeof previous.assigneeAgentId === "string" ? previous.assigneeAgentId : null;
  if (previousAssigneeAgentId) {
    return agentMap.get(previousAssigneeAgentId)?.name ?? `agent ${shortId(previousAssigneeAgentId)}`;
  }
  const previousAssigneeUserId = typeof previous.assigneeUserId === "string" ? previous.assigneeUserId : null;
  if (!previousAssigneeUserId) return null;
  const previousAssigneeUserName = typeof details.previousAssigneeUserName === "string"
    ? details.previousAssigneeUserName
    : null;
  if (previousAssigneeUserName) return previousAssigneeUserName;
  if (previousAssigneeUserId === "local-board") return "Board";
  return userNameMap.get(previousAssigneeUserId) ?? `user ${shortId(previousAssigneeUserId)}`;
}

function renderLabelList(labelIds: string[], labelNameMap: Map<string, string>): string {
  return labelIds
    .map((labelId) => labelNameMap.get(labelId) ?? `label ${shortId(labelId)}`)
    .join(", ");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function formatAction(
  action: string,
  details: Record<string, unknown> | null | undefined,
  agentMap: Map<string, Agent>,
  userNameMap: Map<string, string>,
  labelNameMap: Map<string, string>,
): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    if (details.status !== undefined) {
      const from = previous.status;
      parts.push(
        from
          ? `changed the status from ${humanizeValue(from)} to ${humanizeValue(details.status)}`
          : `changed the status to ${humanizeValue(details.status)}`
      );
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      parts.push(
        from
          ? `changed the priority from ${humanizeValue(from)} to ${humanizeValue(details.priority)}`
          : `changed the priority to ${humanizeValue(details.priority)}`
      );
    }
    if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
      const nextAssignee = resolveAssigneeName(details, agentMap, userNameMap);
      const previousAssignee = resolvePreviousAssigneeName(details, previous, agentMap, userNameMap);
      if (previousAssignee && nextAssignee) {
        parts.push(`reassigned from ${previousAssignee} to ${nextAssignee}`);
      } else if (nextAssignee) {
        parts.push(`assigned to ${nextAssignee}`);
      } else if (previousAssignee) {
        parts.push(`unassigned (was ${previousAssignee})`);
      } else {
        parts.push("updated assignee");
      }
    }

    if (details.labelIds !== undefined) {
      const nextLabels = asStringArray(details.labelIds);
      const previousLabels = asStringArray(previous.labelIds);
      const addedLabels = nextLabels.filter((id) => !previousLabels.includes(id));
      const removedLabels = previousLabels.filter((id) => !nextLabels.includes(id));
      if (addedLabels.length > 0 && removedLabels.length > 0) {
        parts.push(`updated labels (+${renderLabelList(addedLabels, labelNameMap)}; -${renderLabelList(removedLabels, labelNameMap)})`);
      } else if (addedLabels.length > 0) {
        parts.push(`added labels ${renderLabelList(addedLabels, labelNameMap)}`);
      } else if (removedLabels.length > 0) {
        parts.push(`removed labels ${renderLabelList(removedLabels, labelNameMap)}`);
      }
    }
    if (details.title !== undefined) parts.push("updated the title");
    if (details.description !== undefined) parts.push("updated the description");

    if (parts.length > 0) return parts.join(", ");
  }
  if (
    (action === "issue.document_created" || action === "issue.document_updated" || action === "issue.document_deleted") &&
    details
  ) {
    const key = typeof details.key === "string" ? details.key : "document";
    const title = typeof details.title === "string" && details.title ? ` (${details.title})` : "";
    return `${ACTION_LABELS[action] ?? action} ${key}${title}`;
  }
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ").replace(/\s+/g, " ").trim().replace("issue", "task");
}

function ActorIdentity({ evt, agentMap, userNameMap }: { evt: ActivityEvent; agentMap: Map<string, Agent>; userNameMap: Map<string, string> }) {
  const id = evt.actorId;
  if (evt.actorType === "agent") {
    const agent = agentMap.get(id);
    return <Identity name={agent?.name ?? id.slice(0, 8)} size="sm" />;
  }
  if (evt.actorType === "system") return <Identity name="System" size="sm" />;
  if (evt.actorType === "user") {
    const resolved = userNameMap.get(id) ?? (id === "local-board" ? "Board" : id.slice(0, 8));
    return <Identity name={resolved} size="sm" />;
  }
  return <Identity name={id || "Unknown"} size="sm" />;
}

export function IssueDetail({ fullWidth }: { fullWidth?: boolean } = {}) {
  const { issueId } = useParams<{ issueId: string }>();
  const { selectedCompanyId } = useCompany();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { pushToast } = useToast();
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("comments");
  const [secondaryOpen, setSecondaryOpen] = useState({
    approvals: false,
  });
  const lastMarkedReadIssueIdRef = useRef<string | null>(null);
  const descriptionEditorRef = useRef<InlineEditorRef>(null);
  const descriptionAttachInputRef = useRef<HTMLInputElement>(null);
  const [descriptionAttachBusy, setDescriptionAttachBusy] = useState(false);

  const { data: issue, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.detail(issueId!),
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId,
  });
  const resolvedCompanyId = issue?.companyId ?? selectedCompanyId;
  const projectIssueStatuses = useProjectIssueStatuses(issue?.projectId ?? null);

  const { data: comments } = useQuery({
    queryKey: queryKeys.issues.comments(issueId!),
    queryFn: () => issuesApi.listComments(issueId!),
    enabled: !!issueId,
  });

  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId!),
    queryFn: () => issuesApi.listAttachments(issueId!),
    enabled: !!issueId,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.issues.activity(issueId!),
    queryFn: () => activityApi.forIssue(issueId!),
    enabled: !!issueId,
  });

  const { data: linkedRuns } = useQuery({
    queryKey: queryKeys.issues.runs(issueId!),
    queryFn: () => activityApi.runsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: linkedApprovals } = useQuery({
    queryKey: queryKeys.issues.approvals(issueId!),
    queryFn: () => issuesApi.listApprovals(issueId!),
    enabled: !!issueId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId!),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId!),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const hasLiveRuns = (liveRuns ?? []).length > 0 || !!activeRun;
  const sourceBreadcrumbs = useMemo(() => {
    const chain = readIssueDetailBreadcrumbChain(location.state);
    if (chain) return chain;
    const single = readIssueDetailBreadcrumb(location.state);
    return [single ?? { label: "Tasks", href: "/issues" }];
  }, [location.state]);

  const { data: inboxTouchedIssuesRaw = [] } = useQuery({
    queryKey: queryKeys.issues.listTouchedByMe(resolvedCompanyId!),
    queryFn: () =>
      issuesApi.list(resolvedCompanyId!, {
        touchedByUserId: "me",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
      }),
    enabled: !!resolvedCompanyId,
  });

  const nextUnreadIssue = useMemo(() => {
    if (!issue) return null;
    const ordered = getRecentTouchedIssues(inboxTouchedIssuesRaw);
    const start = ordered.findIndex((i) => i.id === issue.id);
    if (start < 0) return null;
    for (let j = start + 1; j < ordered.length; j++) {
      const row = ordered[j];
      if (row?.isUnreadForMe) return row;
    }
    return null;
  }, [issue, inboxTouchedIssuesRaw]);

  const goToNextUnreadIssue = useCallback(() => {
    if (!nextUnreadIssue) return;
    const pathId = nextUnreadIssue.identifier ?? nextUnreadIssue.id;
    const navigationState = mergeIssueModalLocationState(location.state, location);
    navigate(createIssueDetailPath(pathId, navigationState), { state: navigationState });
  }, [nextUnreadIssue, navigate, location]);

  // Filter out runs already shown by the live widget to avoid duplication
  const timelineRuns = useMemo(() => {
    const liveIds = new Set<string>();
    for (const r of liveRuns ?? []) liveIds.add(r.id);
    if (activeRun) liveIds.add(activeRun.id);
    if (liveIds.size === 0) return linkedRuns ?? [];
    return (linkedRuns ?? []).filter((r) => !liveIds.has(r.runId));
  }, [linkedRuns, liveRuns, activeRun]);

  const { data: allIssues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(resolvedCompanyId!),
    queryFn: () => issuesApi.listLabels(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { orderedProjects } = useProjectOrder({
    projects: projects ?? [],
    companyId: selectedCompanyId,
    userId: currentUserId,
  });
  const { slots: issuePluginDetailSlots } = usePluginSlots({
    slotTypes: ["detailTab"],
    entityType: "issue",
    companyId: resolvedCompanyId,
    enabled: !!resolvedCompanyId,
  });
  const issuePluginTabItems = useMemo(
    () => issuePluginDetailSlots.map((slot) => ({
      value: `plugin:${slot.pluginKey}:${slot.id}`,
      label: slot.displayName,
      slot,
    })),
    [issuePluginDetailSlots],
  );
  const activePluginTab = issuePluginTabItems.find((item) => item.value === detailTab) ?? null;

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      if (member.principalType === "user" && member.user) {
        map.set(member.user.id, member.user.name);
      }
    }
    return map;
  }, [members]);

  const labelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const label of labels ?? []) {
      map.set(label.id, label.name);
    }
    return map;
  }, [labels]);

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const options: MentionOption[] = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({
        id: `agent:${agent.id}`,
        name: agent.name,
        kind: "agent",
        agentId: agent.id,
        agentIcon: agent.icon,
      });
    }
    const sortedHumans = sortHumanMembersForPicker(
      (members ?? [])
        .filter((member) => member.principalType === "user" && member.user)
        .map((member) => member.user!),
      currentUserId,
    );
    for (const user of sortedHumans) {
      options.push({
        id: `user:${user.id}`,
        name: user.name,
        kind: "human",
        userId: user.id,
      });
    }
    return options;
  }, [agents, members, currentUserId]);

  const childIssues = useMemo(() => {
    if (!allIssues || !issue) return [];
    return allIssues
      .filter((i) => i.parentId === issue.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [allIssues, issue]);

  const commentReassignOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; searchText?: string }> = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({ id: `agent:${agent.id}`, label: agent.name });
    }
    const sortedHumans = sortHumanMembersForPicker(
      (members ?? [])
        .filter((member) => member.principalType === "user" && member.user)
        .map((member) => member.user!),
      currentUserId,
    );
    for (const user of sortedHumans) {
      options.push({ id: `user:${user.id}`, label: user.name });
    }
    return options;
  }, [agents, currentUserId, members]);

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      if (member.principalType === "user" && member.user) {
        map.set(member.user.id, member.user.name);
      }
    }
    return map;
  }, [members]);

  const actualAssigneeValue = useMemo(
    () => assigneeValueFromSelection(issue ?? {}),
    [issue],
  );

  const suggestedAssigneeValue = useMemo(
    () => suggestedCommentAssigneeValue(issue ?? {}, comments, currentUserId),
    [issue, comments, currentUserId],
  );

  const commentsWithRunMeta = useMemo(() => {
    const runMetaByCommentId = new Map<string, { runId: string; runAgentId: string | null }>();
    const agentIdByRunId = new Map<string, string>();
    for (const run of linkedRuns ?? []) {
      agentIdByRunId.set(run.runId, run.agentId);
    }
    for (const evt of activity ?? []) {
      if (evt.action !== "issue.comment_added" || !evt.runId) continue;
      const details = evt.details ?? {};
      const commentId = typeof details["commentId"] === "string" ? details["commentId"] : null;
      if (!commentId || runMetaByCommentId.has(commentId)) continue;
      runMetaByCommentId.set(commentId, {
        runId: evt.runId,
        runAgentId: evt.agentId ?? agentIdByRunId.get(evt.runId) ?? null,
      });
    }
    return (comments ?? []).map((comment) => {
      const meta = runMetaByCommentId.get(comment.id);
      return meta ? { ...comment, ...meta } : comment;
    });
  }, [activity, comments, linkedRuns]);

  const attachmentOriginById = useMemo(
    () => buildAttachmentOriginMap(issue?.description, comments, attachments ?? []),
    [issue?.description, comments, attachments],
  );

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.approvals(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId!) });
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
    }
  };

  const markIssueRead = useMutation({
    mutationFn: (id: string) => issuesApi.markRead(id),
    onSuccess: () => {
      if (selectedCompanyId) {
        // Inbox / Attention Queue lists use listMineByMe — refresh after mark read.
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.listUnreadTouchedByMe(selectedCompanyId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId) });
      }
    },
  });

  const updateIssue = useMutation({
    mutationFn: (data: Record<string, unknown>) => issuesApi.update(issueId!, data),
    onSuccess: () => {
      invalidateIssue();
    },
  });

  const addComment = useMutation({
    mutationFn: ({ body, reopen }: { body: string; reopen?: boolean }) =>
      issuesApi.addComment(issueId!, body, reopen),
    onSuccess: () => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
    },
  });

  const addCommentAndReassign = useMutation({
    mutationFn: ({
      body,
      reopen,
      reassignment,
    }: {
      body: string;
      reopen?: boolean;
      reassignment: CommentReassignment;
    }) =>
      issuesApi.update(issueId!, {
        comment: body,
        assigneeAgentId: reassignment.assigneeAgentId,
        assigneeUserId: reassignment.assigneeUserId,
        ...(reopen ? { status: "todo" } : {}),
      }),
    onSuccess: () => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
    },
  });

  const uploadIssueAttachment = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return issuesApi.uploadAttachment(selectedCompanyId, issueId!, file);
    },
    onSuccess: () => {
      invalidateIssue();
    },
    onError: (err) => {
      pushToast({
        title: "Upload failed",
        body: err instanceof Error ? err.message : "Could not upload file",
        tone: "error",
      });
    },
  });

  const handleDescriptionToolbarFiles = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files;
      if (!picked?.length || !selectedCompanyId || !issueId) return;
      // Snapshot before clearing the input: clearing `value` can empty the live `FileList` in some browsers.
      const fileList = Array.from(picked);
      e.target.value = "";
      setDescriptionAttachBusy(true);
      try {
        for (const file of fileList) {
          const att = await uploadIssueAttachment.mutateAsync(file);
          const token = markdownTokenForUploadedIssueFile(file, att.contentPath);
          descriptionEditorRef.current?.appendMarkdown(token);
        }
      } catch (err) {
        pushToast({
          title: "Upload failed",
          body: err instanceof Error ? err.message : "Could not upload file",
          tone: "error",
        });
      } finally {
        setDescriptionAttachBusy(false);
      }
    },
    [selectedCompanyId, issueId, uploadIssueAttachment, pushToast],
  );

  const issueDescriptionUploadExtraActions = useMemo(
    () => (
      <>
        <input
          ref={descriptionAttachInputRef}
          type="file"
          multiple
          className="hidden"
          accept={ISSUE_ATTACHMENT_FILE_INPUT_ACCEPT}
          onChange={handleDescriptionToolbarFiles}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={descriptionAttachBusy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => descriptionAttachInputRef.current?.click()}
        >
          {descriptionAttachBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Upload attachment</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </>
    ),
    [handleDescriptionToolbarFiles, descriptionAttachBusy],
  );

  const saveDescriptionWithAttachmentPrune = useCallback(
    async (description: string) => {
      if (!issueId || !issue) {
        await updateIssue.mutateAsync({ description });
        return;
      }
      const prev = issue.description ?? "";
      const boardUserId = session?.user?.id ?? session?.session?.userId ?? null;
      if (boardUserId) {
        const prevIds = extractAttachmentIdsFromMarkdown(prev);
        const nextIds = extractAttachmentIdsFromMarkdown(description);
        const removed = [...prevIds].filter((id) => !nextIds.has(id));
        if (removed.length > 0) {
          const stillInComments = new Set<string>();
          for (const c of comments ?? []) {
            for (const id of extractAttachmentIdsFromMarkdown(c.body)) {
              stillInComments.add(id);
            }
          }
          const byLower = new Map((attachments ?? []).map((a) => [a.id.toLowerCase(), a]));
          for (const low of removed) {
            if (stillInComments.has(low)) continue;
            const att = byLower.get(low);
            if (!att) continue;
            try {
              await issuesApi.deleteAttachment(att.id);
            } catch (err) {
              pushToast({
                title: "Could not remove orphaned file",
                body: err instanceof Error ? err.message : "Delete failed",
                tone: "error",
              });
            }
          }
          await queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId) });
        }
      }
      await updateIssue.mutateAsync({ description });
    },
    [
      issueId,
      issue,
      session?.user?.id,
      session?.session?.userId,
      comments,
      attachments,
      updateIssue,
      pushToast,
      queryClient,
    ],
  );

  useEffect(() => {
    const titleLabel = issue?.title ?? issueId ?? "Task";
    setBreadcrumbs([
      ...sourceBreadcrumbs,
      { label: hasLiveRuns ? `🔵 ${titleLabel}` : titleLabel },
    ]);
  }, [setBreadcrumbs, sourceBreadcrumbs, issue, issueId, hasLiveRuns]);

  // Redirect to identifier-based URL if navigated via UUID
  useEffect(() => {
    if (issue?.identifier && issueId !== issue.identifier) {
      navigate(`/issues/${issue.identifier}`, { replace: true, state: location.state });
    }
  }, [issue, issueId, navigate, location.state]);

  useEffect(() => {
    if (!issue?.id) return;
    if (lastMarkedReadIssueIdRef.current === issue.id) return;
    lastMarkedReadIssueIdRef.current = issue.id;
    markIssueRead.mutate(issue.id);
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (issue) {
      openPanel(
        <IssueProperties issue={issue} onUpdate={(data) => updateIssue.mutateAsync(data)} />
      );
    }
    return () => closePanel();
  }, [issue]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyIssueToClipboard = async () => {
    if (!issue) return;
    const url = `${window.location.origin}${window.location.pathname.split("/issues/")[0]}/issues/${issueId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    pushToast({ title: "Link copied to clipboard", tone: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!issue) return null;

  // Ancestors are returned oldest-first from the server (root at end, immediate parent at start)
  const ancestors = issue.ancestors ?? [];

  return (
    <div className={fullWidth ? "space-y-6 pt-4" : "max-w-2xl space-y-6 pt-4"}>
      {/* Parent chain breadcrumb */}
      {ancestors.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
          {[...ancestors].reverse().map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
              <IssueLink
                issuePathId={ancestor.identifier ?? ancestor.id}
                issueLinkState={location.state}
                className="hover:text-foreground transition-colors truncate max-w-[200px]"
                title={ancestor.title}
              >
                {ancestor.title}
              </IssueLink>
            </span>
          ))}
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="text-foreground/60 truncate max-w-[200px]">{issue.title}</span>
        </nav>
      )}

      {issue.hiddenAt && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <EyeOff className="h-4 w-4 shrink-0" />
          This issue is hidden
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusIcon
            status={issue.status}
            onChange={(status) => updateIssue.mutate({ status })}
            projectStatuses={projectIssueStatuses.length > 0 ? projectIssueStatuses : undefined}
          />
          <PriorityIcon
            priority={issue.priority}
            onChange={(priority) => updateIssue.mutate({ priority })}
          />
          <span className="text-sm font-mono text-muted-foreground shrink-0">{issue.identifier ?? issue.id.slice(0, 8)}</span>

          {hasLiveRuns && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
              </span>
              Live
            </span>
          )}

          {issue.originKind === "routine_execution" && issue.originId && (
            <Link
              to={`/routines/${issue.originId}`}
              className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400 shrink-0 hover:bg-violet-500/20 transition-colors"
            >
              <Repeat className="h-3 w-3" />
              Routine
            </Link>
          )}

          {issue.projectId ? (
            <Link
              to={`/projects/${issue.projectId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 -mx-1 py-0.5 min-w-0"
            >
              <Hexagon className="h-3 w-3 shrink-0" />
              <span className="truncate">{(projects ?? []).find((p) => p.id === issue.projectId)?.name ?? issue.projectId.slice(0, 8)}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-50 px-1 -mx-1 py-0.5">
              <Hexagon className="h-3 w-3 shrink-0" />
              No project
            </span>
          )}

          {(issue.labels ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {(issue.labels ?? []).slice(0, 4).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: label.color,
                    color: pickTextColorForPillBg(label.color, 0.12),
                    backgroundColor: `${label.color}1f`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {(issue.labels ?? []).length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{(issue.labels ?? []).length - 4}</span>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-0.5 md:hidden shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyIssueToClipboard}
              title="Copy link to ticket"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setMobilePropsOpen(true)}
              title="Properties"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>

          <div className="hidden md:flex items-center md:ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyIssueToClipboard}
              title="Copy link to ticket"
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "shrink-0 transition-opacity duration-200",
                panelVisible ? "opacity-0 pointer-events-none w-0 overflow-hidden" : "opacity-100",
              )}
              onClick={() => setPanelVisible(true)}
              title="Show properties"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>

            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="end">
              {issue.hiddenAt ? (
                <button
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-amber-600 dark:text-amber-400"
                  onClick={() => {
                    updateIssue.mutate(
                      { hiddenAt: null },
                      { onSuccess: () => navigate("/issues/all") },
                    );
                    setMoreOpen(false);
                  }}
                >
                  <Eye className="h-3 w-3" />
                  Unhide this Task
                </button>
              ) : (
                <button
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-destructive"
                  onClick={() => {
                    updateIssue.mutate(
                      { hiddenAt: new Date().toISOString() },
                      { onSuccess: () => navigate("/issues/all") },
                    );
                    setMoreOpen(false);
                  }}
                >
                  <EyeOff className="h-3 w-3" />
                  Hide this Task
                </button>
              )}
            </PopoverContent>
            </Popover>
            {!fullWidth ? (
              <Link to={sourceBreadcrumbs[0].href}>
                <Button variant="ghost" size="icon-xs" title={`Back to ${sourceBreadcrumbs[0].label}`}>
                  <X className="h-4 w-4" />
                </Button>
              </Link>
            ) : null}
          </div>
        </div>

        <InlineEditor
          value={issue.title}
          onSave={(title) => updateIssue.mutateAsync({ title })}
          as="h2"
          className="text-xl font-bold"
        />

        <InlineEditor
          ref={descriptionEditorRef}
          value={issue.description ?? ""}
          onSave={saveDescriptionWithAttachmentPrune}
          as="p"
          className="text-[15px] leading-7 text-foreground"
          placeholder="Add a description..."
          multiline
          mentions={mentionOptions}
          imageUploadHandler={async (file) => {
            const attachment = await uploadIssueAttachment.mutateAsync(file);
            return attachment.contentPath;
          }}
        />
      </div>

      <PluginSlotOutlet
        slotTypes={["toolbarButton", "contextMenuItem"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
        missingBehavior="placeholder"
      />

      <PluginLauncherOutlet
        placementZones={["toolbarButton"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="flex flex-wrap gap-2"
        itemClassName="inline-flex"
      />

      <PluginSlotOutlet
        slotTypes={["taskDetailView"]}
        entityType="issue"
        context={{
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          entityId: issue.id,
          entityType: "issue",
        }}
        className="space-y-3"
        itemClassName="rounded-lg border border-border p-3"
        missingBehavior="placeholder"
      />

      <IssueDocumentsSection
        issue={issue}
        canDeleteDocuments={Boolean(session?.user?.id)}
        mentions={mentionOptions}
        extraActions={issueDescriptionUploadExtraActions}
        imageUploadHandler={async (file) => {
          const attachment = await uploadIssueAttachment.mutateAsync(file);
          return attachment.contentPath;
        }}
      />

      <IssueAttachmentsJiraGallery
        attachments={attachments ?? []}
        originById={attachmentOriginById}
        isUploading={uploadIssueAttachment.isPending}
        onAddFiles={(files) => {
          for (const file of Array.from(files)) {
            uploadIssueAttachment.mutate(file);
          }
        }}
        onRefresh={() => {
          void queryClient.refetchQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
        }}
      />

      <Separator />

      <Tabs value={detailTab} onValueChange={setDetailTab} className="space-y-3">
        <TabsList variant="line" className="w-full justify-start gap-1">
          <TabsTrigger value="comments" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Comments
          </TabsTrigger>
          <TabsTrigger value="subissues" className="gap-1.5">
            <ListTree className="h-3.5 w-3.5" />
            Sub-tasks
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5" />
            Audit Log
          </TabsTrigger>
          {issuePluginTabItems.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="comments">
          <CommentThread
            comments={commentsWithRunMeta}
            linkedRuns={timelineRuns}
            companyId={issue.companyId}
            projectId={issue.projectId}
            issueStatus={issue.status}
            agentMap={agentMap}
            userMap={userMap}
            currentUserId={currentUserId}
            draftKey={`paperclip:issue-comment-draft:${issue.id}`}
            enableReassign
            reassignOptions={commentReassignOptions}
            currentAssigneeValue={actualAssigneeValue}
            suggestedAssigneeValue={suggestedAssigneeValue}
            mentions={mentionOptions}
            onAdd={async (body, reopen, reassignment) => {
              if (reassignment) {
                await addCommentAndReassign.mutateAsync({ body, reopen, reassignment });
                return;
              }
              await addComment.mutateAsync({ body, reopen });
            }}
            imageUploadHandler={async (file) => {
              const att = await issuesApi.uploadAttachment(issue.companyId, issue.id, file);
              return att.contentPath;
            }}
            liveRunSlot={<LiveRunWidget issueId={issueId!} companyId={issue.companyId} />}
          />
        </TabsContent>

        <TabsContent value="subissues">
          {childIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sub-tasks yet.</p>
          ) : (
            <div className="border border-border rounded-lg divide-y divide-border">
              {childIssues.map((child) => (
                <IssueLink
                  key={child.id}
                  issuePathId={child.identifier ?? child.id}
                  issueLinkState={location.state}
                  className="flex items-center justify-between px-3 py-2 text-sm hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusIcon status={child.status} />
                    <PriorityIcon priority={child.priority} />
                    <span className="font-mono text-muted-foreground shrink-0">
                      {child.identifier ?? child.id.slice(0, 8)}
                    </span>
                    <span className="truncate">{child.title}</span>
                  </div>
                  {child.assigneeAgentId && (() => {
                    const name = agentMap.get(child.assigneeAgentId)?.name;
                    return name
                      ? <Identity name={name} size="sm" />
                      : <span className="text-muted-foreground font-mono">{child.assigneeAgentId.slice(0, 8)}</span>;
                  })()}
                </IssueLink>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {!activity || activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 20).map((evt) => (
                <div key={evt.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ActorIdentity evt={evt} agentMap={agentMap} userNameMap={userNameMap} />
                  <span>{formatAction(evt.action, evt.details, agentMap, userNameMap, labelNameMap)}</span>
                  <span className="ml-auto shrink-0">{relativeTime(evt.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {activePluginTab && (
          <TabsContent value={activePluginTab.value}>
            <PluginSlotMount
              slot={activePluginTab.slot}
              context={{
                companyId: issue.companyId,
                projectId: issue.projectId ?? null,
                entityId: issue.id,
                entityType: "issue",
              }}
              missingBehavior="placeholder"
            />
          </TabsContent>
        )}
      </Tabs>

      {linkedApprovals && linkedApprovals.length > 0 && (
        <Collapsible
          open={secondaryOpen.approvals}
          onOpenChange={(open) => setSecondaryOpen((prev) => ({ ...prev, approvals: open }))}
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">
              Linked Approvals ({linkedApprovals.length})
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", secondaryOpen.approvals && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border divide-y divide-border">
              {linkedApprovals.map((approval) => (
                <Link
                  key={approval.id}
                  to={`/approvals/${approval.id}`}
                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge status={approval.status} />
                    <span className="font-medium">
                      {approval.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className="font-mono text-muted-foreground">{approval.id.slice(0, 8)}</span>
                  </div>
                  <span className="text-muted-foreground">{relativeTime(approval.createdAt)}</span>
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}


      {/* Mobile properties drawer */}
      <Sheet open={mobilePropsOpen} onOpenChange={setMobilePropsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle className="text-sm">Properties</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <IssueProperties issue={issue} onUpdate={(data) => updateIssue.mutateAsync(data)} inline />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

    </div>
  );
}
