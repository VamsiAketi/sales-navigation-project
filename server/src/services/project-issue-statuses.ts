import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companyMemberships, projectIssueStatuses, projects } from "@paperclipai/db";
import {
  DEFAULT_PROJECT_ISSUE_STATUSES,
  isBoardPinnedHiddenProjectIssueStatusValue,
  isFixedNameProjectIssueStatusValue,
  isMandatoryProjectIssueStatusValue,
  isProjectIssueStatusAllowedActors,
  type ProjectIssueStatus,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";

type StatusRow = typeof projectIssueStatuses.$inferSelect;

function toProjectIssueStatus(row: StatusRow): ProjectIssueStatus {
  const allowed = row.allowedActors ?? "human_and_agent";
  const nextVals = (row.allowedNextStatusValues as string[] | null) ?? [];
  return {
    id: row.id,
    projectId: row.projectId,
    companyId: row.companyId,
    name: row.name,
    value: row.value,
    color: row.color,
    position: row.position,
    isActive: row.isActive,
    isHumanApproval: row.isHumanApproval,
    approverUserIds: (row.approverUserIds as string[]) ?? [],
    allowedActors: isProjectIssueStatusAllowedActors(allowed) ? allowed : "human_and_agent",
    defaultAssigneeUserId: row.defaultAssigneeUserId ?? null,
    defaultAssigneeAgentId: row.defaultAssigneeAgentId ?? null,
    allowedNextStatusValues: Array.isArray(nextVals) ? nextVals : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertAllowedNextStatusValuesForProject(
  db: Db,
  projectId: string,
  selfValue: string,
  allowed: string[],
) {
  if (allowed.length === 0) return;
  const rows = await db
    .select({ value: projectIssueStatuses.value })
    .from(projectIssueStatuses)
    .where(eq(projectIssueStatuses.projectId, projectId));
  const valueSet = new Set(rows.map((r) => r.value));
  for (const v of allowed) {
    if (!valueSet.has(v)) {
      throw unprocessable(`Allowed next status "${v}" is not a workflow stage in this project.`);
    }
    if (v === selfValue) {
      throw unprocessable("Allowed next statuses cannot include this stage itself.");
    }
  }
}

function assertDefaultAssigneesMatchAllowedActors(
  allowedActors: string,
  defaultAssigneeUserId: string | null,
  defaultAssigneeAgentId: string | null,
) {
  if (defaultAssigneeUserId && defaultAssigneeAgentId) {
    throw unprocessable("Choose at most one default assignee for this status.");
  }
  if (allowedActors === "human_only" && defaultAssigneeAgentId) {
    throw unprocessable("Human-only statuses cannot use a default AI assignee.");
  }
  if (allowedActors === "agent_only" && defaultAssigneeUserId) {
    throw unprocessable("AI-only statuses cannot use a default human assignee.");
  }
}

async function assertApproverUserIdsInCompany(db: Db, companyId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const rows = await db
    .select({ principalId: companyMemberships.principalId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
        inArray(companyMemberships.principalId, unique),
      ),
    );
  if (rows.length !== unique.length) {
    throw unprocessable("Each approver must be an active member of this company.");
  }
}

async function assertDefaultAssigneesInCompany(
  db: Db,
  companyId: string,
  defaultAssigneeUserId: string | null | undefined,
  defaultAssigneeAgentId: string | null | undefined,
) {
  if (defaultAssigneeUserId) {
    const membership = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, defaultAssigneeUserId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!membership) {
      throw unprocessable("Default human assignee must be an active member of this company.");
    }
  }
  if (defaultAssigneeAgentId) {
    const agent = await db
      .select({ id: agents.id, companyId: agents.companyId, status: agents.status })
      .from(agents)
      .where(eq(agents.id, defaultAssigneeAgentId))
      .then((rows) => rows[0] ?? null);
    if (!agent || agent.companyId !== companyId) {
      throw unprocessable("Default agent assignee must belong to this company.");
    }
    if (agent.status === "terminated" || agent.status === "pending_approval") {
      throw unprocessable("Default agent assignee must be an active agent.");
    }
  }
}

export function projectIssueStatusService(db: Db) {
  async function list(projectId: string): Promise<ProjectIssueStatus[]> {
    const rows = await db
      .select()
      .from(projectIssueStatuses)
      .where(eq(projectIssueStatuses.projectId, projectId))
      .orderBy(asc(projectIssueStatuses.position), asc(projectIssueStatuses.createdAt));
    return rows.map(toProjectIssueStatus);
  }

  async function getById(id: string): Promise<ProjectIssueStatus | null> {
    const rows = await db
      .select()
      .from(projectIssueStatuses)
      .where(eq(projectIssueStatuses.id, id));
    return rows[0] ? toProjectIssueStatus(rows[0]) : null;
  }

  async function create(
    projectId: string,
    companyId: string,
    data: {
      name: string;
      value: string;
      color: string;
      position?: number;
      isHumanApproval?: boolean;
      approverUserIds?: string[];
      allowedActors?: string;
      defaultAssigneeUserId?: string | null;
      defaultAssigneeAgentId?: string | null;
      allowedNextStatusValues?: string[];
    },
  ): Promise<ProjectIssueStatus> {
    // Resolve position: use provided or max+1
    let position = data.position;
    if (position === undefined) {
      const maxResult = await db
        .select({ maxPos: max(projectIssueStatuses.position) })
        .from(projectIssueStatuses)
        .where(eq(projectIssueStatuses.projectId, projectId));
      position = (maxResult[0]?.maxPos ?? -1) + 1;
    }

    const isHumanApproval = data.isHumanApproval ?? false;
    let allowedActors = data.allowedActors ?? "human_and_agent";
    let defaultAssigneeUserId = data.defaultAssigneeUserId ?? null;
    let defaultAssigneeAgentId = data.defaultAssigneeAgentId ?? null;
    const approverUserIds = data.approverUserIds ?? [];

    if (isHumanApproval) {
      allowedActors = "human_only";
      defaultAssigneeAgentId = null;
      if (approverUserIds.length < 1) {
        throw unprocessable("Human approval stages require at least one approver.");
      }
      await assertApproverUserIdsInCompany(db, companyId, approverUserIds);
    }

    assertDefaultAssigneesMatchAllowedActors(allowedActors, defaultAssigneeUserId, defaultAssigneeAgentId);
    await assertDefaultAssigneesInCompany(db, companyId, defaultAssigneeUserId, defaultAssigneeAgentId);

    const allowedNext = data.allowedNextStatusValues ?? [];
    await assertAllowedNextStatusValuesForProject(db, projectId, data.value, allowedNext);

    try {
      const [row] = await db
        .insert(projectIssueStatuses)
        .values({
          projectId,
          companyId,
          name: data.name,
          value: data.value,
          color: data.color,
          position,
          isHumanApproval,
          approverUserIds,
          allowedActors,
          defaultAssigneeUserId,
          defaultAssigneeAgentId,
          allowedNextStatusValues: allowedNext,
        })
        .returning();
      return toProjectIssueStatus(row!);
    } catch (err: unknown) {
      // Unique constraint violation: (projectId, value)
      if (err instanceof Error && err.message.includes("proj_statuses_project_value_idx")) {
        throw conflict(`A status with value "${data.value}" already exists for this project`);
      }
      throw err;
    }
  }

  async function update(
    id: string,
    projectId: string,
    data: {
      name?: string;
      color?: string;
      position?: number;
      isActive?: boolean;
      isHumanApproval?: boolean;
      approverUserIds?: string[];
      allowedActors?: string;
      defaultAssigneeUserId?: string | null;
      defaultAssigneeAgentId?: string | null;
      allowedNextStatusValues?: string[];
    },
  ): Promise<ProjectIssueStatus> {
    const existing = await getById(id);
    if (!existing || existing.projectId !== projectId) throw notFound("Status not found");

    if (
      data.name !== undefined &&
      data.name !== existing.name &&
      isFixedNameProjectIssueStatusValue(existing.value)
    ) {
      throw conflict("The display names for Backlog and Done cannot be changed.");
    }

    if (
      data.position !== undefined &&
      isBoardPinnedHiddenProjectIssueStatusValue(existing.value)
    ) {
      throw conflict("Backlog stays first in workflow order; use reorder to change other statuses.");
    }

    let nextAllowedActors = data.allowedActors ?? existing.allowedActors ?? "human_and_agent";
    let nextDefaultUser =
      data.defaultAssigneeUserId !== undefined ? data.defaultAssigneeUserId : existing.defaultAssigneeUserId;
    let nextDefaultAgent =
      data.defaultAssigneeAgentId !== undefined ? data.defaultAssigneeAgentId : existing.defaultAssigneeAgentId;
    const nextApprovers =
      data.approverUserIds !== undefined ? data.approverUserIds : (existing.approverUserIds ?? []);

    if (existing.isHumanApproval) {
      if (data.allowedActors !== undefined && data.allowedActors !== "human_only") {
        throw unprocessable("Human approval stages are always human-only for assignment.");
      }
      nextAllowedActors = "human_only";
      nextDefaultAgent = null;
      if (nextApprovers.length < 1) {
        throw unprocessable("Human approval stages require at least one approver.");
      }
      if (data.approverUserIds !== undefined) {
        await assertApproverUserIdsInCompany(db, existing.companyId, nextApprovers);
      }
    }

    assertDefaultAssigneesMatchAllowedActors(nextAllowedActors, nextDefaultUser, nextDefaultAgent);
    await assertDefaultAssigneesInCompany(db, existing.companyId, nextDefaultUser, nextDefaultAgent);

    if (data.allowedNextStatusValues !== undefined) {
      await assertAllowedNextStatusValuesForProject(db, projectId, existing.value, data.allowedNextStatusValues);
    }

    const patch: Partial<StatusRow> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.position !== undefined) patch.position = data.position;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.isHumanApproval !== undefined) patch.isHumanApproval = data.isHumanApproval;
    if (data.approverUserIds !== undefined) patch.approverUserIds = data.approverUserIds;
    if (data.allowedActors !== undefined) patch.allowedActors = data.allowedActors;
    if (data.defaultAssigneeUserId !== undefined) patch.defaultAssigneeUserId = data.defaultAssigneeUserId;
    if (data.defaultAssigneeAgentId !== undefined) patch.defaultAssigneeAgentId = data.defaultAssigneeAgentId;
    if (existing.isHumanApproval) {
      patch.allowedActors = "human_only";
      patch.defaultAssigneeAgentId = null;
    }
    if (data.allowedNextStatusValues !== undefined) patch.allowedNextStatusValues = data.allowedNextStatusValues;

    if (isBoardPinnedHiddenProjectIssueStatusValue(existing.value)) {
      if (data.isActive === true) {
        throw conflict("Backlog is always hidden from the board and cannot be shown there.");
      }
      patch.isActive = false;
    }

    const [row] = await db
      .update(projectIssueStatuses)
      .set(patch)
      .where(and(eq(projectIssueStatuses.id, id), eq(projectIssueStatuses.projectId, projectId)))
      .returning();
    return toProjectIssueStatus(row!);
  }

  async function reorder(projectId: string, orderedIds: string[]): Promise<ProjectIssueStatus[]> {
    const allRows = await db
      .select({ id: projectIssueStatuses.id, value: projectIssueStatuses.value })
      .from(projectIssueStatuses)
      .where(eq(projectIssueStatuses.projectId, projectId));
    const backlogRow = allRows.find((r) => isBoardPinnedHiddenProjectIssueStatusValue(r.value));
    const idSet = new Set(orderedIds);
    if (idSet.size !== orderedIds.length) {
      throw unprocessable("Status reorder list cannot contain duplicate IDs");
    }
    if (orderedIds.length !== allRows.length) {
      throw unprocessable("All status IDs must belong to this project");
    }
    for (const id of orderedIds) {
      if (!allRows.some((r) => r.id === id)) {
        throw unprocessable("All status IDs must belong to this project");
      }
    }

    const finalIds =
      backlogRow != null
        ? (() => {
            if (!orderedIds.includes(backlogRow.id)) {
              throw unprocessable("Backlog must be included when reordering workflow statuses");
            }
            return [backlogRow.id, ...orderedIds.filter((id) => id !== backlogRow.id)];
          })()
        : orderedIds;

    await db.transaction(async (tx) => {
      for (let i = 0; i < finalIds.length; i++) {
        await tx
          .update(projectIssueStatuses)
          .set({ position: i, updatedAt: new Date() })
          .where(and(eq(projectIssueStatuses.id, finalIds[i]!), eq(projectIssueStatuses.projectId, projectId)));
      }
    });

    return list(projectId);
  }

  async function remove(id: string, projectId: string): Promise<ProjectIssueStatus> {
    const existing = await getById(id);
    if (!existing || existing.projectId !== projectId) throw notFound("Status not found");
    if (isMandatoryProjectIssueStatusValue(existing.value)) {
      throw conflict(
        "Backlog, Todo, Done, and Cancelled are required for every project and cannot be deleted.",
      );
    }
    const [row] = await db
      .delete(projectIssueStatuses)
      .where(and(eq(projectIssueStatuses.id, id), eq(projectIssueStatuses.projectId, projectId)))
      .returning();
    return toProjectIssueStatus(row!);
  }

  async function seedDefaults(projectId: string, companyId: string): Promise<void> {
    const values = DEFAULT_PROJECT_ISSUE_STATUSES.map((s) => ({
      projectId,
      companyId,
      name: s.name,
      value: s.value,
      color: s.color,
      position: s.position,
      isActive: !isBoardPinnedHiddenProjectIssueStatusValue(s.value),
    }));
    await db.insert(projectIssueStatuses).values(values).onConflictDoNothing();
  }

  return { list, getById, create, update, reorder, remove, seedDefaults };
}
