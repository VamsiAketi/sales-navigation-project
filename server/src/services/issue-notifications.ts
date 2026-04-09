import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, authUsers, companyMemberships, issues, projectIssueStatuses, projects, userNotificationPreferences } from "@paperclipai/db";
import {
  projectNotificationConfigSchema,
  userNotificationPreferencesSchema,
  type ProjectNotificationConfig,
  type ProjectNotificationEventType,
  type UserNotificationPreferences,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { sendSystemEmail } from "./human-invite-email.js";
import { notificationService } from "./notifications.js";

type IssueNotificationEventInput = {
  issueId: string;
  eventType: ProjectNotificationEventType;
  actorType: "agent" | "user" | "system";
  actorId: string | null;
  payload: {
    issueIdentifier: string | null;
    issueTitle: string;
    actorLabel?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    commentSnippet?: string | null;
    assignedUserId?: string | null;
    assignedUserName?: string | null;
  };
};

function defaultNotificationConfig(): ProjectNotificationConfig {
  return {
    enabled: true,
    defaultChannels: ["email"],
    rules: {
      "issue.status_changed": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
      "issue.comment_added": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
      "issue.assigned": {
        enabled: true,
        notifyRoles: ["issue_assignee_user", "issue_creator_user"],
      },
    },
  };
}

function mergeNotificationConfig(raw: unknown): ProjectNotificationConfig {
  const parsed = projectNotificationConfigSchema.safeParse(raw);
  if (!parsed.success) return defaultNotificationConfig();
  const defaults = defaultNotificationConfig();
  return {
    ...defaults,
    ...parsed.data,
    rules: {
      ...defaults.rules,
      ...parsed.data.rules,
    },
  };
}

function buildEmailBody(input: {
  recipientName: string;
  issueIdentifier: string | null;
  issueTitle: string;
  eventType: ProjectNotificationEventType;
  actorType: "agent" | "user" | "system";
  actorLabel?: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  commentSnippet?: string | null;
  assignedUserName?: string | null;
}) {
  const issueRef = input.issueIdentifier ?? input.issueTitle;
  const actor = input.actorLabel?.trim() || input.actorType;
  const lines = [`Hello ${input.recipientName},`, "", `Update on issue ${issueRef} (${input.issueTitle}):`, ""];
  if (input.eventType === "issue.status_changed" && input.newStatus) {
    lines.push(
      `${actor} changed status from "${input.oldStatus ?? "unknown"}" to "${input.newStatus}".`,
    );
  }
  if (input.eventType === "issue.comment_added") {
    lines.push(`${actor} added a comment.`);
    if (input.commentSnippet) {
      lines.push(`Comment: "${input.commentSnippet}"`);
    }
  }
  if (input.eventType === "issue.assigned") {
    const assignee = input.assignedUserName?.trim() || "a user";
    lines.push(`${actor} assigned this issue to ${assignee}.`);
  }
  lines.push("", "This email was sent by your project notification settings.");
  return lines.join("\n");
}

function defaultUserPreferences(): UserNotificationPreferences {
  return {
    enabled: true,
    defaultChannels: ["email"],
    channels: {
      email: { enabled: true, destination: null },
      sms: { enabled: false, destination: null },
      whatsapp: { enabled: false, destination: null },
    },
    events: {},
  };
}

export function issueNotificationService(db: Db) {
  const notifications = notificationService(db);
  return {
    notifyIssueEvent: async (input: IssueNotificationEventInput) => {
      const issue = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          projectId: issues.projectId,
          assigneeUserId: issues.assigneeUserId,
          createdByUserId: issues.createdByUserId,
        })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue || !issue.projectId) return;

      const project = await db
        .select({
          id: projects.id,
          name: projects.name,
          notificationConfig: projects.notificationConfig,
        })
        .from(projects)
        .where(and(eq(projects.id, issue.projectId), eq(projects.companyId, issue.companyId)))
        .then((rows) => rows[0] ?? null);
      if (!project) return;

      const config = mergeNotificationConfig(project.notificationConfig);
      if (config.enabled === false) return;
      const rule = config.rules?.[input.eventType];
      if (rule?.enabled === false) return;
      if (rule?.onlyIfActorIsAgent && input.actorType !== "agent") return;
      if (input.eventType === "issue.status_changed" && rule?.statuses?.length) {
        const next = input.payload.newStatus ?? "";
        if (!rule.statuses.includes(next)) return;
      }
      const channels = rule?.channels ?? config.defaultChannels ?? ["email"];

      let resolvedActorLabel = input.payload.actorLabel?.trim() || null;
      if (!resolvedActorLabel) {
        if (input.actorType === "user" && input.actorId) {
          const actorUser = await db
            .select({ name: authUsers.name })
            .from(authUsers)
            .where(eq(authUsers.id, input.actorId))
            .then((rows) => rows[0] ?? null);
          resolvedActorLabel = actorUser?.name?.trim() || "A user";
        } else if (input.actorType === "agent" && input.actorId) {
          const actorAgent = await db
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, input.actorId))
            .then((rows) => rows[0] ?? null);
          resolvedActorLabel = actorAgent?.name?.trim() || "An agent";
        } else {
          resolvedActorLabel = "System";
        }
      }
      let resolvedAssignedUserName = input.payload.assignedUserName?.trim() || null;
      if (!resolvedAssignedUserName && input.payload.assignedUserId) {
        const assigneeUser = await db
          .select({ name: authUsers.name })
          .from(authUsers)
          .where(eq(authUsers.id, input.payload.assignedUserId))
          .then((rows) => rows[0] ?? null);
        resolvedAssignedUserName = assigneeUser?.name?.trim() || null;
      }

      const notifyRoles = rule?.notifyRoles ?? ["issue_assignee_user", "issue_creator_user"];
      const recipientIds = new Set<string>();
      if (input.eventType === "issue.assigned" && input.payload.assignedUserId) {
        recipientIds.add(input.payload.assignedUserId);
      }
      if (notifyRoles.includes("issue_assignee_user") && issue.assigneeUserId) recipientIds.add(issue.assigneeUserId);
      if (notifyRoles.includes("issue_creator_user") && issue.createdByUserId) recipientIds.add(issue.createdByUserId);
      if (recipientIds.size === 0) return;

      const recipients = await db
        .select({
          id: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
          notificationPreferences: userNotificationPreferences.preferences,
        })
        .from(authUsers)
        .leftJoin(
          userNotificationPreferences,
          eq(userNotificationPreferences.userId, authUsers.id),
        )
        .innerJoin(
          companyMemberships,
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, authUsers.id),
            eq(companyMemberships.companyId, issue.companyId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .where(inArray(authUsers.id, Array.from(recipientIds)));

      for (const recipient of recipients) {
        if (input.actorType === "user" && input.actorId && recipient.id === input.actorId) {
          continue;
        }
        const parsedUserPrefs = userNotificationPreferencesSchema.safeParse(recipient.notificationPreferences);
        const userPrefs = parsedUserPrefs.success ? parsedUserPrefs.data : defaultUserPreferences();
        if (userPrefs.enabled === false) continue;
        const userEventPrefs = userPrefs.events[input.eventType];
        if (userEventPrefs?.enabled === false) continue;
        const title = `[${project.name}] ${input.payload.issueIdentifier ?? input.payload.issueTitle}`;
        const actor = resolvedActorLabel ?? input.actorType;
        const inAppMessage =
          input.eventType === "issue.status_changed"
            ? `${actor} changed status from "${input.payload.oldStatus ?? "unknown"}" to "${input.payload.newStatus ?? "unknown"}".`
            : input.eventType === "issue.comment_added"
              ? `${actor} added a comment${input.payload.commentSnippet ? `: "${input.payload.commentSnippet}"` : "."}`
              : `${actor} assigned this issue to ${resolvedAssignedUserName || "a user"}.`;
        const message = buildEmailBody({
          recipientName: recipient.name,
          issueIdentifier: input.payload.issueIdentifier,
          issueTitle: input.payload.issueTitle,
          eventType: input.eventType,
          actorType: input.actorType,
          actorLabel: resolvedActorLabel,
          oldStatus: input.payload.oldStatus,
          newStatus: input.payload.newStatus,
          commentSnippet: input.payload.commentSnippet,
          assignedUserName: resolvedAssignedUserName,
        });
        const createdNotification = await notifications.create({
          userId: recipient.id,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: input.eventType,
          title,
          message: inAppMessage,
          channel: "in_app",
          emailDeliveryStatus: "queued",
          payload: {
            issueIdentifier: input.payload.issueIdentifier,
            issueTitle: input.payload.issueTitle,
            oldStatus: input.payload.oldStatus ?? null,
            newStatus: input.payload.newStatus ?? null,
            commentSnippet: input.payload.commentSnippet ?? null,
            assignedUserId: input.payload.assignedUserId ?? null,
            actorLabel: resolvedActorLabel,
            assignedUserName: resolvedAssignedUserName,
          },
        });
        const userChannels = userEventPrefs?.channels ?? userPrefs.defaultChannels;
        const canEmail =
          channels.includes("email") &&
          userChannels.includes("email") &&
          userPrefs.channels.email.enabled &&
          Boolean(recipient.email);
        if (!canEmail) {
          await notifications.updateEmailDeliveryStatus(createdNotification.id, "skipped");
          continue;
        }
        const delivery = await sendSystemEmail({
          toEmail: recipient.email!,
          subject: `[AI-Harness] ${title}`,
          textBody: message,
        });
        await notifications.updateEmailDeliveryStatus(createdNotification.id, delivery.status);
        if (delivery.status === "failed") {
          logger.warn(
            { issueId: issue.id, projectId: project.id, recipientUserId: recipient.id, message: delivery.message },
            "Failed to send issue notification email",
          );
        }
      }
    },

    notifyHumanApprovalRequired: async (input: {
      issueId: string;
      newStatusValue: string;
      actorType: "agent" | "user" | "system";
      actorId: string | null;
      payload: {
        issueIdentifier: string | null;
        issueTitle: string;
        actorLabel?: string | null;
      };
    }) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId, projectId: issues.projectId })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue?.projectId) return;

      // Only proceed if the destination status is a human approval step with defined approvers
      const approvalStatus = await db
        .select({ id: projectIssueStatuses.id, name: projectIssueStatuses.name, approverUserIds: projectIssueStatuses.approverUserIds })
        .from(projectIssueStatuses)
        .where(
          and(
            eq(projectIssueStatuses.projectId, issue.projectId),
            eq(projectIssueStatuses.value, input.newStatusValue),
            eq(projectIssueStatuses.isHumanApproval, true),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!approvalStatus) return;

      const approverIds = (approvalStatus.approverUserIds as string[]) ?? [];
      if (approverIds.length === 0) return;

      const project = await db
        .select({ id: projects.id, name: projects.name, notificationConfig: projects.notificationConfig })
        .from(projects)
        .where(and(eq(projects.id, issue.projectId), eq(projects.companyId, issue.companyId)))
        .then((rows) => rows[0] ?? null);
      if (!project) return;

      const config = mergeNotificationConfig(project.notificationConfig);
      if (config.enabled === false) return;

      // Notify only the designated approvers for this step
      const members = await db
        .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
        .from(authUsers)
        .innerJoin(
          companyMemberships,
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, authUsers.id),
            eq(companyMemberships.companyId, issue.companyId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .where(and(isNotNull(authUsers.email), inArray(authUsers.id, approverIds)));

      const issueRef = input.payload.issueIdentifier ?? input.payload.issueTitle;
      const title = `[${project.name}] Human Approval Required: ${issueRef}`;

      for (const member of members) {
        if (input.actorType === "user" && input.actorId && member.id === input.actorId) continue;

        const textBody = [
          `Hello ${member.name},`,
          "",
          `Human approval is required for issue ${issueRef} (${input.payload.issueTitle}).`,
          "",
          `The issue has entered the "${approvalStatus.name}" step and is awaiting your review.`,
          "",
          "Please log in to review and take action.",
          "",
          "This email was sent by your project notification settings.",
        ].join("\n");

        const createdNotification = await notifications.create({
          userId: member.id,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: "issue.status_changed",
          title,
          message: `Human approval required: issue moved to "${approvalStatus.name}".`,
          channel: "in_app",
          emailDeliveryStatus: "queued",
          payload: {
            issueIdentifier: input.payload.issueIdentifier,
            issueTitle: input.payload.issueTitle,
            oldStatus: null,
            newStatus: input.newStatusValue,
            commentSnippet: null,
            assignedUserId: null,
            actorLabel: input.payload.actorLabel ?? null,
            assignedUserName: null,
          },
        });

        const delivery = await sendSystemEmail({
          toEmail: member.email,
          subject: `[AI-Harness] ${title}`,
          textBody,
        });
        await notifications.updateEmailDeliveryStatus(createdNotification.id, delivery.status);
        if (delivery.status === "failed") {
          logger.warn(
            { issueId: issue.id, projectId: project.id, recipientUserId: member.id, message: delivery.message },
            "Failed to send human approval notification email",
          );
        }
      }
    },

    notifyCommentMentions: async (input: {
      issueId: string;
      commentId: string;
      mentionUserIds: string[];
      actorType: "agent" | "user" | "system";
      actorId: string | null;
      payload: {
        issueIdentifier: string | null;
        issueTitle: string;
        actorLabel?: string | null;
        commentSnippet?: string | null;
      };
    }) => {
      if (input.mentionUserIds.length === 0) return;
      const issue = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          projectId: issues.projectId,
        })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) return;

      const projectName = issue.projectId
        ? await db
          .select({ name: projects.name })
          .from(projects)
          .where(and(eq(projects.id, issue.projectId), eq(projects.companyId, issue.companyId)))
          .then((rows) => rows[0]?.name ?? "Project")
        : "Project";

      let resolvedActorLabel = input.payload.actorLabel?.trim() || null;
      if (!resolvedActorLabel) {
        if (input.actorType === "user" && input.actorId) {
          const actorUser = await db
            .select({ name: authUsers.name })
            .from(authUsers)
            .where(eq(authUsers.id, input.actorId))
            .then((rows) => rows[0] ?? null);
          resolvedActorLabel = actorUser?.name?.trim() || "A user";
        } else if (input.actorType === "agent" && input.actorId) {
          const actorAgent = await db
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, input.actorId))
            .then((rows) => rows[0] ?? null);
          resolvedActorLabel = actorAgent?.name?.trim() || "An agent";
        } else {
          resolvedActorLabel = "System";
        }
      }

      const recipientRows = await db
        .select({
          userId: authUsers.id,
        })
        .from(authUsers)
        .innerJoin(
          companyMemberships,
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, authUsers.id),
            eq(companyMemberships.companyId, issue.companyId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .where(inArray(authUsers.id, Array.from(new Set(input.mentionUserIds))));

      const actor = resolvedActorLabel ?? input.actorType;
      const title = `[${projectName}] Mentioned in ${input.payload.issueIdentifier ?? input.payload.issueTitle}`;
      const message = `${actor} mentioned you in a comment${input.payload.commentSnippet ? `: "${input.payload.commentSnippet}"` : "."}`;

      for (const recipient of recipientRows) {
        if (input.actorType === "user" && input.actorId && recipient.userId === input.actorId) continue;
        await notifications.create({
          userId: recipient.userId,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: "issue.comment_mentioned",
          title,
          message,
          channel: "in_app",
          emailDeliveryStatus: "skipped",
          payload: {
            issueIdentifier: input.payload.issueIdentifier,
            issueTitle: input.payload.issueTitle,
            commentId: input.commentId,
            commentSnippet: input.payload.commentSnippet ?? null,
            actorLabel: resolvedActorLabel,
          },
        });
      }
    },
  };
}
