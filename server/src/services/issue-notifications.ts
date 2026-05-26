import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, authUsers, companies, companyMemberships, issues, projectIssueStatuses, projects, userNotificationPreferences } from "@paperclipai/db";
import {
  projectNotificationConfigSchema,
  userNotificationPreferencesSchema,
  type ProjectNotificationConfig,
  type ProjectNotificationEventType,
  type UserNotificationPreferences,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { sendSystemEmail } from "./human-invite-email.js";
import {
  buildHumanApprovalEmailBodies,
  buildIssueNotificationEmailBodies,
  issueCommentUrl,
} from "./system-email-templates.js";
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
      "issue.comment_mentioned": {
        enabled: true,
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

async function resolveActorLabel(
  db: Db,
  input: {
    actorType: "agent" | "user" | "system";
    actorId: string | null;
    actorLabel?: string | null;
  },
): Promise<string> {
  if (input.actorType === "user" && input.actorId) {
    const actorUser = await db
      .select({ name: authUsers.name })
      .from(authUsers)
      .where(eq(authUsers.id, input.actorId))
      .then((rows) => rows[0] ?? null);
    return actorUser?.name?.trim() || "A user";
  }
  if (input.actorType === "agent" && input.actorId) {
    const actorAgent = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, input.actorId))
      .then((rows) => rows[0] ?? null);
    return actorAgent?.name?.trim() || "An agent";
  }
  if (input.actorType === "system") return "System";
  const fallback = input.actorLabel?.trim();
  if (fallback) return fallback;
  return input.actorType;
}

function taskDisplayName(issueIdentifier: string | null, issueTitle: string): string {
  const title = issueTitle.trim();
  if (title) return title;
  const identifier = issueIdentifier?.trim();
  if (identifier) return identifier;
  return "Task";
}

function humanizeCommentSnippet(snippet: string | null | undefined): string | null {
  if (!snippet) return null;
  const normalizedMentions = snippet
    .replace(/\[@([^\]]+)\]\((?:user|agent|project):\/\/[^)]+\)/gi, "@$1")
    .replace(/\s+/g, " ")
    .trim();
  return normalizedMentions.length > 0 ? normalizedMentions : null;
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
          issuePrefix: companies.issuePrefix,
          companyName: companies.name,
          issueDescription: issues.description,
          issuePriority: issues.priority,
          issueStatus: issues.status,
          issueDueAt: issues.dueAt,
        })
        .from(issues)
        .innerJoin(companies, eq(companies.id, issues.companyId))
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
      const appBaseUrl =
        process.env.PAPERCLIP_PUBLIC_URL ??
        process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
        process.env.BETTER_AUTH_URL ??
        process.env.BETTER_AUTH_BASE_URL ??
        "http://localhost:3100";
      const normalizedAppBaseUrl = appBaseUrl.replace(/\/+$/, "");
      const issueUrl = `${normalizedAppBaseUrl}/${encodeURIComponent(issue.issuePrefix)}/issues/${encodeURIComponent(issue.id)}`;
      const boardUrl = `${normalizedAppBaseUrl}/${encodeURIComponent(issue.issuePrefix)}/projects/${encodeURIComponent(issue.projectId)}/issues`;

      const resolvedActorLabel = await resolveActorLabel(db, {
        actorType: input.actorType,
        actorId: input.actorId,
        actorLabel: input.payload.actorLabel,
      });
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
        const readableCommentSnippet = humanizeCommentSnippet(input.payload.commentSnippet);
        const inAppTitle = `[${project.name}] ${taskDisplayName(input.payload.issueIdentifier, input.payload.issueTitle)}`;
        const emailSubjectTitle = `[${project.name}] ${input.payload.issueIdentifier ?? input.payload.issueTitle}`;
        const actor = resolvedActorLabel ?? input.actorType;
        const inAppMessage =
          input.eventType === "issue.status_changed"
            ? `${actor} changed status from "${input.payload.oldStatus ?? "unknown"}" to "${input.payload.newStatus ?? "unknown"}".`
            : input.eventType === "issue.comment_added"
              ? `${actor} added a comment${readableCommentSnippet ? `: "${readableCommentSnippet}"` : "."}`
              : input.eventType === "issue.comment_mentioned"
                ? `${actor} mentioned you in a comment${readableCommentSnippet ? `: "${readableCommentSnippet}"` : "."}`
                : `${actor} assigned this task to ${resolvedAssignedUserName || "a user"}.`;
        const { textBody: message, htmlBody } = buildIssueNotificationEmailBodies({
          recipientName: recipient.name,
          issueIdentifier: input.payload.issueIdentifier,
          issueTitle: input.payload.issueTitle,
          eventType: input.eventType,
          actorType: input.actorType,
          actorLabel: resolvedActorLabel,
          oldStatus: input.payload.oldStatus,
          newStatus: input.payload.newStatus,
          changes: null,
          commentSnippet: readableCommentSnippet,
          assignedUserName: resolvedAssignedUserName,
          issueUrl,
          commentUrl: null,
          projectName: project.name,
          departmentPath: null,
          issueDescription: issue.issueDescription,
          priority: issue.issuePriority,
          currentStatus: input.payload.newStatus ?? issue.issueStatus,
          dueAt: issue.issueDueAt,
          boardUrl,
          occurredAt: new Date(),
        });
        const createdNotification = await notifications.create({
          userId: recipient.id,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: input.eventType,
          title: inAppTitle,
          message: inAppMessage,
          channel: "in_app",
          emailDeliveryStatus: "queued",
          payload: {
            issueIdentifier: input.payload.issueIdentifier,
            issueTitle: input.payload.issueTitle,
            oldStatus: input.payload.oldStatus ?? null,
            newStatus: input.payload.newStatus ?? null,
            commentSnippet: readableCommentSnippet,
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
          subject: `[AI-Harness] ${emailSubjectTitle}`,
          textBody: message,
          htmlBody,
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
        .select({
          id: issues.id,
          companyId: issues.companyId,
          projectId: issues.projectId,
          issuePrefix: companies.issuePrefix,
        })
        .from(issues)
        .innerJoin(companies, eq(companies.id, issues.companyId))
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

      const appBaseUrl =
        process.env.PAPERCLIP_PUBLIC_URL ??
        process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
        process.env.BETTER_AUTH_URL ??
        process.env.BETTER_AUTH_BASE_URL ??
        "http://localhost:3100";
      const normalizedAppBaseUrl = appBaseUrl.replace(/\/+$/, "");
      const issueUrl = `${normalizedAppBaseUrl}/${encodeURIComponent(issue.issuePrefix)}/issues/${encodeURIComponent(issue.id)}`;

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
      const inAppTitle = `[${project.name}] Human Approval Required: ${taskDisplayName(input.payload.issueIdentifier, input.payload.issueTitle)}`;
      const emailSubjectTitle = `[${project.name}] Human Approval Required: ${issueRef}`;

      for (const member of members) {
        if (input.actorType === "user" && input.actorId && member.id === input.actorId) continue;

        const { textBody, htmlBody } = buildHumanApprovalEmailBodies({
          recipientName: member.name,
          issueIdentifier: input.payload.issueIdentifier,
          issueTitle: input.payload.issueTitle,
          approvalStepName: approvalStatus.name,
          issueUrl,
          approveUrl: null,
          rejectUrl: null,
          decisionDeadline: null,
          governanceDescription: null,
          actorLabel: input.payload.actorLabel ?? null,
          actorType: input.actorType,
          projectName: project.name,
          departmentPath: null,
        });

        const createdNotification = await notifications.create({
          userId: member.id,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: "issue.status_changed",
          title: inAppTitle,
          message: `Human approval required: task moved to "${approvalStatus.name}".`,
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
          subject: `[AI-Harness] ${emailSubjectTitle}`,
          textBody,
          htmlBody,
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
          issuePrefix: companies.issuePrefix,
          companyName: companies.name,
        })
        .from(issues)
        .innerJoin(companies, eq(companies.id, issues.companyId))
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) return;

      let channels: string[] = ["email"];
      let notificationTitleScope = issue.companyName;

      if (issue.projectId) {
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
        const rule = config.rules?.["issue.comment_mentioned"];
        if (rule?.enabled === false) return;
        if (rule?.onlyIfActorIsAgent && input.actorType !== "agent") return;
        channels = rule?.channels ?? config.defaultChannels ?? ["email"];
        notificationTitleScope = project.name;
      }

      const appBaseUrl =
        process.env.PAPERCLIP_PUBLIC_URL ??
        process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
        process.env.BETTER_AUTH_URL ??
        process.env.BETTER_AUTH_BASE_URL ??
        "http://localhost:3100";
      const normalizedAppBaseUrl = appBaseUrl.replace(/\/+$/, "");
      const issueUrl = `${normalizedAppBaseUrl}/${encodeURIComponent(issue.issuePrefix)}/issues/${encodeURIComponent(issue.id)}`;

      const resolvedActorLabel = await resolveActorLabel(db, {
        actorType: input.actorType,
        actorId: input.actorId,
        actorLabel: input.payload.actorLabel,
      });

      const mentionSet = Array.from(new Set(input.mentionUserIds));
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
        .where(inArray(authUsers.id, mentionSet));

      const actor = resolvedActorLabel ?? input.actorType;
      const inAppTitle = `[${notificationTitleScope}] Mentioned in ${taskDisplayName(input.payload.issueIdentifier, input.payload.issueTitle)}`;
      const emailSubjectTitle = `[${notificationTitleScope}] Mentioned in ${input.payload.issueIdentifier ?? input.payload.issueTitle}`;

      for (const recipient of recipients) {
        if (input.actorType === "user" && input.actorId && recipient.id === input.actorId) continue;

        const parsedUserPrefs = userNotificationPreferencesSchema.safeParse(recipient.notificationPreferences);
        const userPrefs = parsedUserPrefs.success ? parsedUserPrefs.data : defaultUserPreferences();
        if (userPrefs.enabled === false) continue;
        const userEventPrefs = userPrefs.events["issue.comment_mentioned"];
        if (userEventPrefs?.enabled === false) continue;
        const readableCommentSnippet = humanizeCommentSnippet(input.payload.commentSnippet);

        const inAppMessage = `${actor} mentioned you in a comment${readableCommentSnippet ? `: "${readableCommentSnippet}"` : "."}`;
        const commentUrl = issueCommentUrl(issueUrl, input.commentId);
        const { textBody: emailText, htmlBody } = buildIssueNotificationEmailBodies({
          recipientName: recipient.name,
          issueIdentifier: input.payload.issueIdentifier,
          issueTitle: input.payload.issueTitle,
          eventType: "issue.comment_mentioned",
          actorType: input.actorType,
          actorLabel: resolvedActorLabel,
          commentSnippet: readableCommentSnippet,
          issueUrl,
          commentUrl,
          projectName: notificationTitleScope,
          departmentPath: null,
          occurredAt: new Date(),
        });

        const createdNotification = await notifications.create({
          userId: recipient.id,
          companyId: issue.companyId,
          projectId: issue.projectId,
          issueId: issue.id,
          eventType: "issue.comment_mentioned",
          title: inAppTitle,
          message: inAppMessage,
          channel: "in_app",
          emailDeliveryStatus: "queued",
          payload: {
            issueIdentifier: input.payload.issueIdentifier,
            issueTitle: input.payload.issueTitle,
            commentId: input.commentId,
            commentSnippet: readableCommentSnippet,
            actorLabel: resolvedActorLabel,
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
          subject: `[AI-Harness] ${emailSubjectTitle}`,
          textBody: emailText,
          htmlBody,
        });
        await notifications.updateEmailDeliveryStatus(createdNotification.id, delivery.status);
        if (delivery.status === "failed") {
          logger.warn(
            { issueId: issue.id, projectId: issue.projectId, recipientUserId: recipient.id, message: delivery.message },
            "Failed to send comment @-mention notification email",
          );
        }
      }
    },
  };
}
