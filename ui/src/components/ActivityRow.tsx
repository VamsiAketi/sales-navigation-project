import { Link } from "@/lib/router";
import { Identity } from "./Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { deriveProjectUrlKey, type ActivityEvent, type Agent } from "@paperclipai/shared";

const ACTION_VERBS: Record<string, string> = {
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.checked_out": "checked out",
  "issue.released": "released",
  "issue.comment_added": "commented on",
  "issue.attachment_added": "attached file to",
  "issue.attachment_removed": "removed attachment from",
  "issue.document_created": "created document for",
  "issue.document_updated": "updated document on",
  "issue.document_deleted": "deleted document from",
  "issue.work_product_created": "created work product for",
  "issue.work_product_updated": "updated work product on",
  "issue.work_product_deleted": "deleted work product from",
  "issue.approval_linked": "linked approval to",
  "issue.approval_unlinked": "unlinked approval from",
  "issue.checkout_lock_adopted": "adopted checkout lock for",
  "issue.read_marked": "marked task as read",
  "issue.commented": "commented on",
  "issue.deleted": "deleted",
  "agent.created": "created",
  "agent.updated": "updated",
  "agent.deleted": "deleted",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.terminated": "terminated",
  "agent.key_created": "created API key for",
  "agent.budget_updated": "updated budget for",
  "agent.runtime_session_reset": "reset session for",
  "agent.skills_synced": "synced skills for",
  "agent.config_rolled_back": "rolled back config for",
  "agent.permissions_updated": "updated permissions for",
  "agent.instructions_path_updated": "updated instructions path for",
  "agent.instructions_bundle_updated": "updated instructions bundle for",
  "agent.instructions_file_updated": "updated instructions file for",
  "agent.instructions_file_deleted": "deleted instructions file for",
  "agent.updated_from_join_replay": "updated from join replay",
  "heartbeat.invoked": "invoked heartbeat for",
  "heartbeat.cancelled": "cancelled heartbeat for",
  "approval.created": "requested",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "approval.comment_added": "commented on",
  "approval.revision_requested": "requested revision for",
  "approval.resubmitted": "resubmitted",
  "approval.requester_wakeup_queued": "queued requester wakeup for",
  "approval.requester_wakeup_failed": "requester wakeup failed for",
  "label.created": "created",
  "label.deleted": "deleted",
  "routine.created": "created",
  "routine.updated": "updated",
  "routine.trigger_created": "created trigger for",
  "routine.trigger_updated": "updated trigger for",
  "routine.trigger_deleted": "deleted trigger for",
  "routine.trigger_secret_rotated": "rotated trigger secret for",
  "routine.run_triggered": "triggered run for",
  "project.created": "created",
  "project.updated": "updated",
  "project.workspace_created": "created workspace for",
  "project.workspace_updated": "updated workspace for",
  "project.workspace_deleted": "deleted workspace for",
  "project.deleted": "deleted",
  "goal.created": "created",
  "goal.updated": "updated",
  "goal.deleted": "deleted",
  "cost.reported": "reported cost for",
  "cost.recorded": "recorded cost for",
  "finance_event.reported": "recorded finance event for",
  "secret.created": "created",
  "secret.updated": "updated",
  "secret.rotated": "rotated",
  "secret.deleted": "deleted",
  "asset.created": "uploaded",
  "board_api_key.created": "created",
  "board_api_key.revoked": "revoked",
  "agent_api_key.claimed": "claimed",
  "invite.created": "created",
  "invite.revoked": "revoked",
  "invite.openclaw_prompt_created": "created OpenClaw prompt for",
  "user.invited": "invited user via",
  "join.approved": "approved",
  "join.rejected": "rejected",
  "budget.policy_upserted": "updated budget policy for",
  "budget.soft_threshold_crossed": "reached soft budget threshold for",
  "budget.hard_threshold_crossed": "reached hard budget threshold for",
  "budget.incident_resolved": "resolved budget incident for",
  "execution_workspace.updated": "updated execution workspace for",
  "instance.settings.general_updated": "updated general settings for",
  "instance.settings.experimental_updated": "updated experimental settings for",
  "hire_hook.succeeded": "completed hire hook for",
  "hire_hook.failed": "failed hire hook for",
  "hire_hook.error": "errored hire hook for",
  "company.created": "created",
  "company.updated": "updated",
  "company.imported": "imported",
  "company.branding_updated": "updated branding for",
  "company.archived": "archived",
  "company.budget_updated": "updated budget for",
  "company.skill_created": "created skill for",
  "company.skill_deleted": "deleted skill from",
  "company.skill_file_updated": "updated skill file for",
  "company.skill_update_installed": "installed skill update for",
  "company.skills_imported": "imported skills for",
  "company.skills_scanned": "scanned skills for",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function humanizeEntityType(entityType: string): string {
  return titleCaseWords(entityType.replace(/[._]/g, " ").replace(/\s+/g, " ").trim()).toLowerCase();
}

function shortEntityId(entityId: string): string {
  return entityId.length > 8 ? entityId.slice(0, 8) : entityId;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function resolveAssigneeName(
  payload: Record<string, unknown>,
  agentMap: Map<string, Agent>,
  userNameMap?: Map<string, string>,
): string | null {
  const assigneeAgentId = typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : null;
  if (assigneeAgentId) {
    return agentMap.get(assigneeAgentId)?.name ?? `agent ${shortEntityId(assigneeAgentId)}`;
  }

  const assigneeUserId = typeof payload.assigneeUserId === "string" ? payload.assigneeUserId : null;
  if (!assigneeUserId) return null;
  const assigneeUserName = typeof payload.assigneeUserName === "string" ? payload.assigneeUserName : null;
  if (assigneeUserName) return assigneeUserName;
  if (assigneeUserId === "local-board") return "Board";
  return userNameMap?.get(assigneeUserId) ?? `user ${shortEntityId(assigneeUserId)}`;
}

function resolvePreviousAssigneeName(
  details: Record<string, unknown>,
  previous: Record<string, unknown>,
  agentMap: Map<string, Agent>,
  userNameMap?: Map<string, string>,
): string | null {
  const previousAssigneeAgentId =
    typeof previous.assigneeAgentId === "string" ? previous.assigneeAgentId : null;
  if (previousAssigneeAgentId) {
    return agentMap.get(previousAssigneeAgentId)?.name ?? `agent ${shortEntityId(previousAssigneeAgentId)}`;
  }

  const previousAssigneeUserId =
    typeof previous.assigneeUserId === "string" ? previous.assigneeUserId : null;
  if (!previousAssigneeUserId) return null;
  const previousAssigneeUserName =
    typeof details.previousAssigneeUserName === "string" ? details.previousAssigneeUserName : null;
  if (previousAssigneeUserName) return previousAssigneeUserName;
  if (previousAssigneeUserId === "local-board") return "Board";
  return userNameMap?.get(previousAssigneeUserId) ?? `user ${shortEntityId(previousAssigneeUserId)}`;
}

function renderLabelList(labelIds: string[], labelNameMap?: Map<string, string>): string {
  return labelIds
    .map((labelId) => labelNameMap?.get(labelId) ?? `label ${shortEntityId(labelId)}`)
    .join(", ");
}

function formatVerb(
  action: string,
  details: Record<string, unknown> | null | undefined,
  agentMap: Map<string, Agent>,
  userNameMap?: Map<string, string>,
  labelNameMap?: Map<string, string>,
): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const changes: string[] = [];

    const assigneeChanged = details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined;
    if (assigneeChanged) {
      const nextName = resolveAssigneeName(details, agentMap, userNameMap);
      const previousName = resolvePreviousAssigneeName(details, previous, agentMap, userNameMap);
      if (previousName && nextName) {
        changes.push(`reassigned from ${previousName} to ${nextName}`);
      } else if (nextName) {
        changes.push(`assigned to ${nextName}`);
      } else if (previousName) {
        changes.push(`unassigned (was ${previousName})`);
      } else {
        changes.push("updated assignee");
      }
    }

    if (details.labelIds !== undefined) {
      const nextLabels = asStringArray(details.labelIds);
      const previousLabels = asStringArray(previous.labelIds);
      const addedLabels = nextLabels.filter((id) => !previousLabels.includes(id));
      const removedLabels = previousLabels.filter((id) => !nextLabels.includes(id));
      if (addedLabels.length > 0 && removedLabels.length > 0) {
        changes.push(`updated labels (+${renderLabelList(addedLabels, labelNameMap)}; -${renderLabelList(removedLabels, labelNameMap)})`);
      } else if (addedLabels.length > 0) {
        changes.push(`added labels ${renderLabelList(addedLabels, labelNameMap)}`);
      } else if (removedLabels.length > 0) {
        changes.push(`removed labels ${renderLabelList(removedLabels, labelNameMap)}`);
      }
    }

    if (details.status !== undefined) {
      const from = previous.status;
      changes.push(
        from
          ? `changed status from ${humanizeValue(from)} to ${humanizeValue(details.status)}`
          : `changed status to ${humanizeValue(details.status)}`,
      );
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      changes.push(
        from
          ? `changed priority from ${humanizeValue(from)} to ${humanizeValue(details.priority)}`
          : `changed priority to ${humanizeValue(details.priority)}`,
      );
    }

    if (changes.length > 0) {
      return `${changes.join("; ")} on`;
    }
  }
  return (ACTION_VERBS[action] ?? action.replace(/[._]/g, " ").replace(/\s+/g, " ").trim()).replace("issue", "task");
}

function fallbackEntityName(entityType: string, entityId: string): string {
  const genericEntityTypes = new Set(["company", "instance_settings"]);
  const readableType = humanizeEntityType(entityType);
  if (genericEntityTypes.has(entityType)) {
    return readableType;
  }
  return `${readableType} ${shortEntityId(entityId)}`;
}

function entityLink(entityType: string, entityId: string, name?: string | null): string | null {
  switch (entityType) {
    case "issue": return `/issues/${name ?? entityId}`;
    case "agent": return `/agents/${entityId}`;
    case "project": return `/projects/${deriveProjectUrlKey(name, entityId)}`;
    case "goal": return `/goals/${entityId}`;
    case "approval": return `/approvals/${entityId}`;
    default: return null;
  }
}

interface ActivityRowProps {
  event: ActivityEvent;
  agentMap: Map<string, Agent>;
  userNameMap?: Map<string, string>;
  labelNameMap?: Map<string, string>;
  entityNameMap: Map<string, string>;
  entityTitleMap?: Map<string, string>;
  className?: string;
}

export function ActivityRow({
  event,
  agentMap,
  userNameMap,
  labelNameMap,
  entityNameMap,
  entityTitleMap,
  className,
}: ActivityRowProps) {
  const verb = formatVerb(event.action, event.details, agentMap, userNameMap, labelNameMap);
  const details = event.details as Record<string, unknown> | null;

  const isHeartbeatEvent = event.entityType === "heartbeat_run";
  const heartbeatAgentId = isHeartbeatEvent
    ? (event.details as Record<string, unknown> | null)?.agentId as string | undefined
    : undefined;

  const nameFromDetails = typeof details?.name === "string" && details.name.trim().length > 0
    ? details.name.trim()
    : null;
  const name = isHeartbeatEvent
    ? (heartbeatAgentId ? entityNameMap.get(`agent:${heartbeatAgentId}`) : null)
    : (entityNameMap.get(`${event.entityType}:${event.entityId}`) ?? nameFromDetails);

  const entityTitle = entityTitleMap?.get(`${event.entityType}:${event.entityId}`);

  const link = isHeartbeatEvent && heartbeatAgentId
    ? `/agents/${heartbeatAgentId}/runs/${event.entityId}`
    : entityLink(event.entityType, event.entityId, name);

  const actor = event.actorType === "agent" ? agentMap.get(event.actorId) : null;
  const actorName = actor?.name ??
    (event.actorType === "system"
      ? "System"
      : event.actorType === "user"
        ? (userNameMap?.get(event.actorId) ?? (event.actorId === "local-board" ? "Board" : event.actorId.slice(0, 8)))
        : event.actorId || "Unknown");

  const displayName = name ?? fallbackEntityName(event.entityType, event.entityId);

  const inner = (
    <div className="flex gap-3">
      <p className="flex-1 min-w-0 truncate">
        <Identity
          name={actorName}
          size="xs"
          className="align-baseline"
        />
        <span className="text-muted-foreground ml-1">
          {verb} {displayName}
          {entityTitle ? ` — ${entityTitle}` : ""}
        </span>
      </p>
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{timeAgo(event.createdAt)}</span>
    </div>
  );

  const classes = cn(
    "px-4 py-2 text-sm",
    link && "cursor-pointer hover:bg-accent/50 transition-colors",
    className,
  );

  if (link) {
    return (
      <Link to={link} className={cn(classes, "no-underline text-inherit block")}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={classes}>
      {inner}
    </div>
  );
}
