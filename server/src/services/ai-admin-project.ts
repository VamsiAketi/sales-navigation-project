import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projects } from "@paperclipai/db";
import { isAgentCreationIssueTitle, isAiAdminProject } from "@paperclipai/shared";
import { conflict, unprocessable } from "../errors.js";

export function assertAiAdminProjectNotArchived(
  project: { name: string },
  nextArchivedAt: Date | null | undefined,
) {
  if (!isAiAdminProject(project)) return;
  if (nextArchivedAt) {
    throw conflict("The AI-Admin Project cannot be archived.");
  }
}

export function assertAiAdminProjectWorkflowEditable(project: { name: string }) {
  if (isAiAdminProject(project)) {
    throw conflict("Workflow stages for the AI-Admin Project cannot be changed.");
  }
}

export function assertAiAdminProjectWorkflowMaintenanceAllowed(
  project: { name: string },
  maintenanceType: string,
) {
  if (isAiAdminProject(project) && maintenanceType === "workflow") {
    throw conflict("Workflow maintenance is not allowed on the AI-Admin Project.");
  }
}

export function assertAiAdminProjectWorkflowDocumentEditable(project: { name: string }, documentKey: string) {
  if (isAiAdminProject(project) && documentKey === "workflow") {
    throw conflict("The workflow document for the AI-Admin Project cannot be edited.");
  }
}

export async function assertAgentCreationIssueOnAiAdminProject(
  db: Db,
  companyId: string,
  projectId: string | null | undefined,
  title: string,
) {
  if (!isAgentCreationIssueTitle(title)) return;

  if (!projectId) {
    throw unprocessable("Agent creation tasks must belong to the AI-Admin Project.", {
      field: "projectId",
    });
  }

  const project = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
    .then((rows) => rows[0] ?? null);

  if (!project || !isAiAdminProject(project)) {
    throw unprocessable("Agent creation tasks can only be created in the AI-Admin Project.", {
      field: "projectId",
    });
  }
}

export async function assertAgentCreationIssueUpdateAllowed(
  db: Db,
  companyId: string,
  existing: { title: string; projectId: string | null },
  patch: { title?: string; projectId?: string | null | undefined },
) {
  const nextTitle = patch.title ?? existing.title;
  const nextProjectId = patch.projectId !== undefined ? patch.projectId : existing.projectId;
  if (!isAgentCreationIssueTitle(existing.title) && !isAgentCreationIssueTitle(nextTitle)) {
    return;
  }
  await assertAgentCreationIssueOnAiAdminProject(db, companyId, nextProjectId, nextTitle);
}
