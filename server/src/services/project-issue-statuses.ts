import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectIssueStatuses, projects } from "@paperclipai/db";
import { DEFAULT_PROJECT_ISSUE_STATUSES, type ProjectIssueStatus } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";

type StatusRow = typeof projectIssueStatuses.$inferSelect;

function toProjectIssueStatus(row: StatusRow): ProjectIssueStatus {
  return {
    id: row.id,
    projectId: row.projectId,
    companyId: row.companyId,
    name: row.name,
    value: row.value,
    color: row.color,
    position: row.position,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
    data: { name: string; value: string; color: string; position?: number },
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

    try {
      const [row] = await db
        .insert(projectIssueStatuses)
        .values({ projectId, companyId, name: data.name, value: data.value, color: data.color, position })
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
    data: { name?: string; color?: string; position?: number; isActive?: boolean },
  ): Promise<ProjectIssueStatus> {
    const existing = await getById(id);
    if (!existing || existing.projectId !== projectId) throw notFound("Status not found");

    const patch: Partial<StatusRow> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.position !== undefined) patch.position = data.position;
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    const [row] = await db
      .update(projectIssueStatuses)
      .set(patch)
      .where(and(eq(projectIssueStatuses.id, id), eq(projectIssueStatuses.projectId, projectId)))
      .returning();
    return toProjectIssueStatus(row!);
  }

  async function reorder(projectId: string, orderedIds: string[]): Promise<ProjectIssueStatus[]> {
    // Verify all IDs belong to this project
    const existing = await db
      .select({ id: projectIssueStatuses.id })
      .from(projectIssueStatuses)
      .where(and(eq(projectIssueStatuses.projectId, projectId), inArray(projectIssueStatuses.id, orderedIds)));

    if (existing.length !== orderedIds.length) {
      throw unprocessable("All status IDs must belong to this project");
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(projectIssueStatuses)
          .set({ position: i, updatedAt: new Date() })
          .where(and(eq(projectIssueStatuses.id, orderedIds[i]!), eq(projectIssueStatuses.projectId, projectId)));
      }
    });

    return list(projectId);
  }

  async function remove(id: string, projectId: string): Promise<ProjectIssueStatus> {
    const existing = await getById(id);
    if (!existing || existing.projectId !== projectId) throw notFound("Status not found");
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
    }));
    await db.insert(projectIssueStatuses).values(values).onConflictDoNothing();
  }

  return { list, getById, create, update, reorder, remove, seedDefaults };
}
