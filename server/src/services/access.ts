import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  authAccounts,
  authPasskeys,
  authSessions,
  authUsers,
  boardApiKeys,
  companies,
  companyMemberships,
  deletedUserEmails,
  instanceUserRoles,
  issues,
  issueComments,
  projectIssueStatuses,
  projectPrincipalGrants,
  projects,
  activityLog,
  principalPermissionGrants,
} from "@paperclipai/db";
import {
  PERMISSION_KEYS,
  PROJECT_PERMISSION_KEYS,
  type PermissionKey,
  type PrincipalType,
  type ProjectAuthActor,
  type ProjectPermissionKey,
} from "@paperclipai/shared";
import { badRequest } from "../errors.js";
import { isOwnerMembershipRole, normalizeMembershipRole } from "../lib/membership-role.js";

type MembershipRow = typeof companyMemberships.$inferSelect;
type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};
const PROJECT_READ_PERMISSION = "project:read" as const;
const PROJECT_READ_DEPENDENCIES: Partial<Record<ProjectPermissionKey, typeof PROJECT_READ_PERMISSION>> = {
  "project:edit tickets": PROJECT_READ_PERMISSION,
  "project:hide tickets": PROJECT_READ_PERMISSION,
  "project:edit configuration": PROJECT_READ_PERMISSION,
  "project:edit Workflow": PROJECT_READ_PERMISSION,
  "project:edit Budget": PROJECT_READ_PERMISSION,
  "project:archive": PROJECT_READ_PERMISSION,
  "members:manage": PROJECT_READ_PERMISSION,
};

const GRANT_READ_DEPENDENCIES: Partial<Record<PermissionKey, PermissionKey>> = {
  "agents:create": "agents.read",
  "agents.edit": "agents.read",
  "tasks.create": "tasks.read",
  "tasks:assign": "tasks.read",
  "tasks:assign_scope": "tasks.read",
  "skills.edit": "skills.read",
  "goals.write": "goals.read",
  "hybrid_org.edit": "hybrid_org.read",
  "hybrid_org.import": "hybrid_org.read",
  "hybrid_org.export": "hybrid_org.read",
  "teams.edit": "teams.read",
  "users:invite": "teams.read",
  "joins:approve": "teams.read",
  "users:manage_permissions": "teams.read",
  "company_settings.general": "company_settings.read",
  "company_settings.appearance": "company_settings.read",
  "company_settings.security_access": "company_settings.read",
  "company_settings.hiring": "company_settings.read",
  "company_settings.invites": "company_settings.read",
  "company_settings.secrets": "company_settings.read",
  "company_settings.packages": "company_settings.read",
};

function normalizeGrantsWithReadDependencies(grants: GrantInput[]): GrantInput[] {
  const byPermission = new Map<PermissionKey, GrantInput>();
  for (const grant of grants) {
    byPermission.set(grant.permissionKey, {
      permissionKey: grant.permissionKey,
      scope: grant.scope ?? null,
    });
  }

  for (const [permissionKey, readPermissionKey] of Object.entries(
    GRANT_READ_DEPENDENCIES,
  ) as Array<[PermissionKey, PermissionKey]>) {
    if (!byPermission.has(permissionKey)) continue;
    if (!byPermission.has(readPermissionKey)) {
      byPermission.set(readPermissionKey, {
        permissionKey: readPermissionKey,
        scope: null,
      });
    }
  }

  return PERMISSION_KEYS.filter((permissionKey) => byPermission.has(permissionKey)).map(
    (permissionKey) => byPermission.get(permissionKey)!,
  );
}

function normalizeProjectPermissionKeys(
  keys: readonly ProjectPermissionKey[],
): ProjectPermissionKey[] {
  const next = new Set<ProjectPermissionKey>(keys);
  for (const [actionKey, readKey] of Object.entries(PROJECT_READ_DEPENDENCIES) as Array<
    [ProjectPermissionKey, ProjectPermissionKey]
  >) {
    if (next.has(actionKey)) next.add(readKey);
  }
  return PROJECT_PERMISSION_KEYS.filter((key) => next.has(key));
}

export function accessService(db: Db) {
  function makeDeletedEmailTombstone(userId: string, now: Date): string {
    return `deleted+${userId}.${now.getTime()}@deleted.invalid`;
  }

  function isDeletedEmailTombstone(email: string): boolean {
    return email.toLowerCase().endsWith("@deleted.invalid");
  }

  async function isInstanceAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const row = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function getInstanceOwnerUserId(): Promise<string | null> {
    const row = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .orderBy(sql`${authUsers.createdAt} asc`, sql`${authUsers.id} asc`)
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row?.id ?? null;
  }

  async function assertOwnerAssignmentAllowed(
    principalType: PrincipalType,
    principalId: string,
    membershipRole: string | null | undefined,
  ): Promise<void> {
    if (principalType !== "user") return;
    if (!isOwnerMembershipRole(membershipRole)) return;
    const instanceOwnerUserId = await getInstanceOwnerUserId();
    // Local implicit board uses a synthetic user id; keep local-trusted behavior unchanged.
    if (!instanceOwnerUserId || principalId === "local-board") return;
    if (principalId !== instanceOwnerUserId) {
      throw badRequest("Owner role can only be assigned to the first instance user.");
    }
  }

  async function getMembership(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<MembershipRow | null> {
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, principalType),
          eq(companyMemberships.principalId, principalId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function hasPermission(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    const membership = await getMembership(companyId, principalType, principalId);
    if (!membership || membership.status !== "active") return false;
    const grant = await db
      .select({ id: principalPermissionGrants.id })
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);
    return Boolean(grant);
  }

  async function canUser(
    companyId: string,
    userId: string | null | undefined,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    if (!userId) return false;
    if (await isInstanceAdmin(userId)) return true;
    return hasPermission(companyId, "user", userId, permissionKey);
  }

  async function listMembers(companyId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          // "deleted" is the soft-delete sentinel — never expose to callers
          sql`${companyMemberships.status} != 'deleted'`,
        ),
      )
      .orderBy(sql`${companyMemberships.createdAt} desc`);
  }

  async function updateMemberStatus(
    companyId: string,
    memberId: string,
    status: "active" | "suspended",
  ): Promise<MembershipRow | null> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .update(companyMemberships)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(companyMemberships.id, memberId),
            eq(companyMemberships.companyId, companyId),
            sql`${companyMemberships.status} != 'deleted'`,
          ),
        )
        .returning();
      const updated = rows[0] ?? null;
      if (!updated) return null;
      if (status === "suspended" && updated.principalType === "user") {
        await reassignIssuesForUserOffboarding(tx, companyId, updated.principalId, now, "deactivated");
      }
      return updated;
    });
  }

  async function reassignIssuesForUserOffboarding(
    tx: any,
    companyId: string,
    offboardedUserId: string,
    now: Date,
    reason: "deleted" | "deactivated",
  ) {
    const assignedIssues = (await tx
      .select({
        issueId: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        projectId: issues.projectId,
        status: issues.status,
        createdByUserId: issues.createdByUserId,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.assigneeUserId, offboardedUserId),
        ),
      )) as Array<{
        issueId: string;
        identifier: string;
        title: string;
        projectId: string | null;
        status: string;
        createdByUserId: string | null;
      }>;
    if (assignedIssues.length === 0) return;

    const projectIds: string[] = Array.from(
      new Set(assignedIssues.map((issue) => issue.projectId).filter((id): id is string => !!id)),
    );
    const statusDefaults = projectIds.length > 0
      ? (await tx
          .select({
            projectId: projectIssueStatuses.projectId,
            statusValue: projectIssueStatuses.value,
            defaultAssigneeUserId: projectIssueStatuses.defaultAssigneeUserId,
            defaultAssigneeAgentId: projectIssueStatuses.defaultAssigneeAgentId,
          })
          .from(projectIssueStatuses)
          .where(inArray(projectIssueStatuses.projectId, projectIds))) as Array<{
            projectId: string;
            statusValue: string;
            defaultAssigneeUserId: string | null;
            defaultAssigneeAgentId: string | null;
          }>
      : [];
    const statusDefaultMap = new Map<string, { userId: string | null; agentId: string | null }>();
    for (const row of statusDefaults) {
      statusDefaultMap.set(`${row.projectId}::${row.statusValue}`, {
        userId: row.defaultAssigneeUserId ?? null,
        agentId: row.defaultAssigneeAgentId ?? null,
      });
    }

    const candidateUserIds: string[] = Array.from(
      new Set(
        [
          ...assignedIssues.map((issue) => issue.createdByUserId),
          ...statusDefaults.map((row) => row.defaultAssigneeUserId),
        ].filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );
    const activeUserIds = candidateUserIds.length > 0
      ? new Set(
          (
            await tx
              .select({ principalId: companyMemberships.principalId })
              .from(companyMemberships)
              .where(
                and(
                  eq(companyMemberships.companyId, companyId),
                  eq(companyMemberships.principalType, "user"),
                  eq(companyMemberships.status, "active"),
                  inArray(companyMemberships.principalId, candidateUserIds),
                ),
              )
          ).map((row: { principalId: string }) => row.principalId),
        )
      : new Set<string>();

    const candidateAgentIds: string[] = Array.from(
      new Set(
        statusDefaults
          .map((row) => row.defaultAssigneeAgentId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );
    const activeAgentIds = candidateAgentIds.length > 0
      ? new Set(
          (
            await tx
              .select({ id: agents.id })
              .from(agents)
              .where(
                and(
                  eq(agents.companyId, companyId),
                  inArray(agents.id, candidateAgentIds),
                  sql`${agents.status} NOT IN ('terminated', 'pending_approval')`,
                ),
              )
          ).map((row: { id: string }) => row.id),
        )
      : new Set<string>();

    const reassigned: Array<{
      issueId: string;
      targetUserId: string | null;
      targetAgentId: string | null;
      strategy: "status_default_user" | "status_default_agent" | "creator_fallback";
    }> = [];
    const backlogFallback: Array<{ issueId: string }> = [];

    for (const issue of assignedIssues) {
      let targetUserId: string | null = null;
      let targetAgentId: string | null = null;
      let strategy: "status_default_user" | "status_default_agent" | "creator_fallback" | null = null;

      if (issue.projectId) {
        const defaultAssignee = statusDefaultMap.get(`${issue.projectId}::${issue.status}`) ?? null;
        if (
          defaultAssignee?.userId &&
          defaultAssignee.userId !== offboardedUserId &&
          activeUserIds.has(defaultAssignee.userId)
        ) {
          targetUserId = defaultAssignee.userId;
          strategy = "status_default_user";
        } else if (defaultAssignee?.agentId && activeAgentIds.has(defaultAssignee.agentId)) {
          targetAgentId = defaultAssignee.agentId;
          strategy = "status_default_agent";
        }
      }

      if (!strategy && issue.createdByUserId && issue.createdByUserId !== offboardedUserId && activeUserIds.has(issue.createdByUserId)) {
        targetUserId = issue.createdByUserId;
        strategy = "creator_fallback";
      }

      if (strategy) {
        await tx
          .update(issues)
          .set({
            assigneeUserId: targetUserId,
            assigneeAgentId: targetAgentId,
            updatedAt: now,
          })
          .where(eq(issues.id, issue.issueId));
        reassigned.push({
          issueId: issue.issueId,
          targetUserId,
          targetAgentId,
          strategy,
        });
      } else {
        await tx
          .update(issues)
          .set({
            assigneeUserId: null,
            assigneeAgentId: null,
            status: "backlog",
            updatedAt: now,
          })
          .where(eq(issues.id, issue.issueId));
        backlogFallback.push({ issueId: issue.issueId });
      }
    }

    const reassignedUserIds = Array.from(
      new Set(reassigned.map((entry) => entry.targetUserId).filter((value): value is string => !!value)),
    );
    const reassignedUserNames =
      reassignedUserIds.length > 0
        ? await tx
            .select({ id: authUsers.id, name: authUsers.name })
            .from(authUsers)
            .where(inArray(authUsers.id, reassignedUserIds))
            .then((rows: Array<{ id: string; name: string | null }>) => new Map(rows.map((row) => [row.id, row.name ?? null])))
        : new Map<string, string | null>();

    const offboardingAction = reason === "deleted" ? "issue.reassigned_on_user_delete" : "issue.reassigned_on_user_deactivate";
    const fallbackAction = reason === "deleted" ? "issue.unassigned_on_user_delete" : "issue.unassigned_on_user_deactivate";

    if (reassigned.length > 0) {
      await tx.insert(activityLog).values(
        reassigned.map((entry) => ({
          companyId,
          actorType: "system" as const,
          actorId: "system",
          action: offboardingAction,
          entityType: "issue",
          entityId: entry.issueId,
          agentId: null,
          runId: null,
          details: {
            offboardedUserId,
            reassignedToUserId: entry.targetUserId,
            reassignedToAgentId: entry.targetAgentId,
            reassignedToName: entry.targetUserId ? (reassignedUserNames.get(entry.targetUserId) ?? null) : null,
            strategy: entry.strategy,
          },
          createdAt: now,
        })),
      );
      await tx.insert(issueComments).values(
        reassigned.map((entry) => ({
          companyId,
          issueId: entry.issueId,
          authorAgentId: null,
          authorUserId: null,
          createdByRunId: null,
          body:
            entry.targetAgentId
              ? "Assignee was offboarded, so this issue was reassigned to the default assignee for the current status."
              : `Assignee was offboarded, so this issue was reassigned to ${String(
                  (entry.targetUserId ? reassignedUserNames.get(entry.targetUserId) : null) ?? "the ticket creator",
                )}.`,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    if (backlogFallback.length > 0) {
      await tx.insert(activityLog).values(
        backlogFallback.map((entry) => ({
          companyId,
          actorType: "system" as const,
          actorId: "system",
          action: fallbackAction,
          entityType: "issue",
          entityId: entry.issueId,
          agentId: null,
          runId: null,
          details: {
            offboardedUserId,
            movedToStatus: "backlog",
          },
          createdAt: now,
        })),
      );
      await tx.insert(issueComments).values(
        backlogFallback.map((entry) => ({
          companyId,
          issueId: entry.issueId,
          authorAgentId: null,
          authorUserId: null,
          createdByRunId: null,
          body: "Assignee was offboarded and no valid reassignment target was available, so this issue was moved to Backlog and left unassigned.",
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
  }

  async function softDeleteMember(
    companyId: string,
    memberId: string,
  ): Promise<MembershipRow | null> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .update(companyMemberships)
        .set({ status: "deleted", updatedAt: now })
        .where(
          and(
            eq(companyMemberships.id, memberId),
            eq(companyMemberships.companyId, companyId),
          ),
        )
        .returning();
      const deleted = rows[0] ?? null;
      if (!deleted || deleted.principalType !== "user") return deleted;

      const hasOtherMemberships = await tx
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, deleted.principalId),
            sql`${companyMemberships.status} != 'deleted'`,
          ),
        )
        .then((entries) => (entries[0] ?? null) !== null);
      if (hasOtherMemberships) return deleted;

      const authUser = await tx
        .select({ id: authUsers.id, email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, deleted.principalId))
        .then((entries) => entries[0] ?? null);
      if (!authUser || isDeletedEmailTombstone(authUser.email)) return deleted;

      await tx.insert(deletedUserEmails).values({
        userId: authUser.id,
        originalEmail: authUser.email,
        deletedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(authUsers)
        .set({
          email: makeDeletedEmailTombstone(authUser.id, now),
          emailVerified: false,
          updatedAt: now,
        })
        .where(eq(authUsers.id, authUser.id));

      await reassignIssuesForUserOffboarding(tx, companyId, authUser.id, now, "deleted");

      await tx.delete(authSessions).where(eq(authSessions.userId, authUser.id));
      await tx.delete(authAccounts).where(eq(authAccounts.userId, authUser.id));
      await tx.delete(authPasskeys).where(eq(authPasskeys.userId, authUser.id));
      await tx
        .update(boardApiKeys)
        .set({ revokedAt: now })
        .where(eq(boardApiKeys.userId, authUser.id));

      return deleted;
    });
  }

  async function listActiveUserMemberships(companyId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      )
      .orderBy(sql`${companyMemberships.createdAt} asc`);
  }

  async function setMemberPermissions(
    companyId: string,
    memberId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    const member = await db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId)))
      .then((rows) => rows[0] ?? null);
    if (!member) return null;

    await db.transaction(async (tx) => {
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, member.principalType),
            eq(principalPermissionGrants.principalId, member.principalId),
          ),
        );
      const normalizedGrants = isOwnerMembershipRole(member.membershipRole)
        ? PERMISSION_KEYS.map((permissionKey) => ({ permissionKey, scope: null }))
        : normalizeGrantsWithReadDependencies(grants);
      if (normalizedGrants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          normalizedGrants.map((grant) => ({
            companyId,
            principalType: member.principalType,
            principalId: member.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
      }
    });

    return member;
  }

  async function promoteInstanceAdmin(userId: string) {
    const existing = await db
      .select()
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;
    return db
      .insert(instanceUserRoles)
      .values({
        userId,
        role: "instance_admin",
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function demoteInstanceAdmin(userId: string) {
    return db
      .delete(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function listUserCompanyAccess(userId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)))
      .orderBy(sql`${companyMemberships.createdAt} desc`);
  }

  async function setUserCompanyAccess(userId: string, companyIds: string[]) {
    const existing = await listUserCompanyAccess(userId);
    const existingByCompany = new Map(existing.map((row) => [row.companyId, row]));
    const target = new Set(companyIds);

    await db.transaction(async (tx) => {
      const toDelete = existing.filter((row) => !target.has(row.companyId)).map((row) => row.id);
      if (toDelete.length > 0) {
        await tx.delete(companyMemberships).where(inArray(companyMemberships.id, toDelete));
      }

      for (const companyId of target) {
        if (existingByCompany.has(companyId)) continue;
        await tx.insert(companyMemberships).values({
          companyId,
          principalType: "user",
          principalId: userId,
          status: "active",
          membershipRole: "member",
        });
      }
    });

    return listUserCompanyAccess(userId);
  }

  async function ensureMembership(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    membershipRole: string | null = "member",
    status: "pending" | "active" | "suspended" = "active",
  ) {
    const normalizedMembershipRole = normalizeMembershipRole(membershipRole);
    await assertOwnerAssignmentAllowed(principalType, principalId, normalizedMembershipRole);
    const existing = await getMembership(companyId, principalType, principalId);
    if (existing) {
      if (existing.status !== status || existing.membershipRole !== normalizedMembershipRole) {
        const updated = await db
          .update(companyMemberships)
          .set({ status, membershipRole: normalizedMembershipRole, updatedAt: new Date() })
          .where(eq(companyMemberships.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null);
        return updated ?? existing;
      }
      return existing;
    }

    return db
      .insert(companyMemberships)
      .values({
        companyId,
        principalType,
        principalId,
        status,
        membershipRole: normalizedMembershipRole,
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function setPrincipalGrants(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    await db.transaction(async (tx) => {
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
          ),
        );
      if (grants.length === 0) return;
      await tx.insert(principalPermissionGrants).values(
        grants.map((grant) => ({
          companyId,
          principalType,
          principalId,
          permissionKey: grant.permissionKey,
          scope: grant.scope ?? null,
          grantedByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    });
  }

  async function copyActiveUserMemberships(sourceCompanyId: string, targetCompanyId: string) {
    const sourceMemberships = await listActiveUserMemberships(sourceCompanyId);
    for (const membership of sourceMemberships) {
      await ensureMembership(
        targetCompanyId,
        "user",
        membership.principalId,
        membership.membershipRole,
        "active",
      );
    }
    return sourceMemberships;
  }

  async function listPrincipalGrants(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
  ) {
    return db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
        ),
      )
      .orderBy(principalPermissionGrants.permissionKey);
  }

  async function setPrincipalPermission(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
    enabled: boolean,
    grantedByUserId: string | null,
    scope: Record<string, unknown> | null = null,
  ) {
    if (!enabled) {
      await db
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
            eq(principalPermissionGrants.permissionKey, permissionKey),
          ),
        );
      return;
    }

    await ensureMembership(companyId, principalType, principalId, "member", "active");

    const existing = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(principalPermissionGrants)
        .set({
          scope,
          grantedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(principalPermissionGrants.id, existing.id));
      return;
    }

    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType,
      principalId,
      permissionKey,
      scope,
      grantedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function companyUsesRestrictedProjectAccess(companyId: string): Promise<boolean> {
    const row = await db
      .select({ mode: companies.projectAccessMode })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    return row?.mode === "restricted";
  }

  async function hasProjectGrant(
    companyId: string,
    projectId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: ProjectPermissionKey,
  ): Promise<boolean> {
    const row = await db
      .select({ id: projectPrincipalGrants.id })
      .from(projectPrincipalGrants)
      .where(
        and(
          eq(projectPrincipalGrants.companyId, companyId),
          eq(projectPrincipalGrants.projectId, projectId),
          eq(projectPrincipalGrants.principalType, principalType),
          eq(projectPrincipalGrants.principalId, principalId),
          eq(projectPrincipalGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function satisfiesProjectPermission(
    companyId: string,
    projectId: string,
    permission: ProjectPermissionKey,
    actor: ProjectAuthActor,
  ): Promise<boolean> {
    if (!(await companyUsesRestrictedProjectAccess(companyId))) return true;
    if (actor.kind === "none") return false;
    if (actor.kind === "local_implicit_board") return true;
    if (actor.kind === "user") {
      if (actor.isInstanceAdmin) return true;
      const membership = await getMembership(companyId, "user", actor.userId);
      if (!membership || membership.status !== "active") return false;
      if (isOwnerMembershipRole(membership.membershipRole)) return true;
      return hasProjectGrant(companyId, projectId, "user", actor.userId, permission);
    }
    if (actor.kind === "agent") {
      const membership = await getMembership(companyId, "agent", actor.agentId);
      if (!membership || membership.status !== "active") return false;
      return hasProjectGrant(companyId, projectId, "agent", actor.agentId, permission);
    }
    return false;
  }

  /**
   * When project access is restricted, returns project IDs the principal may see (`project:read`).
   * Returns `null` when the full company project list is allowed (open mode or unrestricted actor).
   */
  async function listProjectIdsVisibleToActor(
    companyId: string,
    actor: ProjectAuthActor,
  ): Promise<string[] | null> {
    if (!(await companyUsesRestrictedProjectAccess(companyId))) return null;
    if (actor.kind === "none") return [];
    if (actor.kind === "local_implicit_board") return null;
    if (actor.kind === "user" && actor.isInstanceAdmin) return null;
    if (actor.kind === "user") {
      const membership = await getMembership(companyId, "user", actor.userId);
      if (!membership || membership.status !== "active") return [];
      if (isOwnerMembershipRole(membership.membershipRole)) return null;
      const rows = await db
        .select({ projectId: projectPrincipalGrants.projectId })
        .from(projectPrincipalGrants)
        .where(
          and(
            eq(projectPrincipalGrants.companyId, companyId),
            eq(projectPrincipalGrants.principalType, "user"),
            eq(projectPrincipalGrants.principalId, actor.userId),
            eq(projectPrincipalGrants.permissionKey, "project:read"),
          ),
        );
      return Array.from(new Set(rows.map((r) => r.projectId)));
    }
    if (actor.kind === "agent") {
      const membership = await getMembership(companyId, "agent", actor.agentId);
      if (!membership || membership.status !== "active") return [];
      const rows = await db
        .select({ projectId: projectPrincipalGrants.projectId })
        .from(projectPrincipalGrants)
        .where(
          and(
            eq(projectPrincipalGrants.companyId, companyId),
            eq(projectPrincipalGrants.principalType, "agent"),
            eq(projectPrincipalGrants.principalId, actor.agentId),
            eq(projectPrincipalGrants.permissionKey, "project:read"),
          ),
        );
      return Array.from(new Set(rows.map((r) => r.projectId)));
    }
    return [];
  }

  async function listProjectPrincipalGrants(projectId: string, companyId: string) {
    return db
      .select()
      .from(projectPrincipalGrants)
      .where(
        and(
          eq(projectPrincipalGrants.projectId, projectId),
          eq(projectPrincipalGrants.companyId, companyId),
        ),
      )
      .orderBy(projectPrincipalGrants.principalType, projectPrincipalGrants.principalId, projectPrincipalGrants.permissionKey);
  }

  async function setProjectPrincipalGrantsForPrincipal(
    companyId: string,
    projectId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKeys: ProjectPermissionKey[],
    grantedByUserId: string | null,
  ): Promise<boolean> {
    const projectRow = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!projectRow) return false;

    const normalizedPermissionKeys = normalizeProjectPermissionKeys(permissionKeys);
    const effectivePermissionKeys =
      principalType === "user"
        ? await db
            .select({ membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
            .from(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, companyId),
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, principalId),
              ),
            )
            .then((rows) => {
              const row = rows[0] ?? null;
              const isOwner = row?.status === "active" && isOwnerMembershipRole(row.membershipRole);
              return isOwner ? [...PROJECT_PERMISSION_KEYS] : normalizedPermissionKeys;
            })
        : normalizedPermissionKeys;

    await db.transaction(async (tx) => {
      await tx
        .delete(projectPrincipalGrants)
        .where(
          and(
            eq(projectPrincipalGrants.projectId, projectId),
            eq(projectPrincipalGrants.principalType, principalType),
            eq(projectPrincipalGrants.principalId, principalId),
          ),
        );
      const now = new Date();
      if (effectivePermissionKeys.length > 0) {
        await tx.insert(projectPrincipalGrants).values(
          effectivePermissionKeys.map((permissionKey) => ({
            companyId,
            projectId,
            principalType,
            principalId,
            permissionKey,
            grantedByUserId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });
    return true;
  }

  async function seedFullProjectGrantsForUser(
    companyId: string,
    projectId: string,
    userId: string,
    grantedByUserId: string | null,
  ) {
    await setProjectPrincipalGrantsForPrincipal(
      companyId,
      projectId,
      "user",
      userId,
      [...PROJECT_PERMISSION_KEYS],
      grantedByUserId,
    );
  }

  async function principalHasAnyProjectPermission(
    companyId: string,
    actor: ProjectAuthActor,
    permission: ProjectPermissionKey,
  ): Promise<boolean> {
    if (!(await companyUsesRestrictedProjectAccess(companyId))) return true;
    if (actor.kind === "none") return false;
    if (actor.kind === "local_implicit_board") return true;
    if (actor.kind === "user" && actor.isInstanceAdmin) return true;
    if (actor.kind === "user") {
      const membership = await getMembership(companyId, "user", actor.userId);
      if (!membership || membership.status !== "active") return false;
      if (isOwnerMembershipRole(membership.membershipRole)) return true;
      const row = await db
        .select({ id: projectPrincipalGrants.id })
        .from(projectPrincipalGrants)
        .where(
          and(
            eq(projectPrincipalGrants.companyId, companyId),
            eq(projectPrincipalGrants.principalType, "user"),
            eq(projectPrincipalGrants.principalId, actor.userId),
            eq(projectPrincipalGrants.permissionKey, permission),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return Boolean(row);
    }
    if (actor.kind === "agent") {
      const membership = await getMembership(companyId, "agent", actor.agentId);
      if (!membership || membership.status !== "active") return false;
      const row = await db
        .select({ id: projectPrincipalGrants.id })
        .from(projectPrincipalGrants)
        .where(
          and(
            eq(projectPrincipalGrants.companyId, companyId),
            eq(projectPrincipalGrants.principalType, "agent"),
            eq(projectPrincipalGrants.principalId, actor.agentId),
            eq(projectPrincipalGrants.permissionKey, permission),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return Boolean(row);
    }
    return false;
  }

  return {
    isInstanceAdmin,
    canUser,
    hasPermission,
    getMembership,
    ensureMembership,
    getInstanceOwnerUserId,
    listMembers,
    listActiveUserMemberships,
    copyActiveUserMemberships,
    setMemberPermissions,
    updateMemberStatus,
    softDeleteMember,
    promoteInstanceAdmin,
    demoteInstanceAdmin,
    listUserCompanyAccess,
    setUserCompanyAccess,
    setPrincipalGrants,
    listPrincipalGrants,
    setPrincipalPermission,
    companyUsesRestrictedProjectAccess,
    satisfiesProjectPermission,
    listProjectIdsVisibleToActor,
    listProjectPrincipalGrants,
    setProjectPrincipalGrantsForPrincipal,
    seedFullProjectGrantsForUser,
    principalHasAnyProjectPermission,
  };
}
