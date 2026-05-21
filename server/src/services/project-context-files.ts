import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, projectContextFileEvents, projectContextFiles, projects } from "@paperclipai/db";
import type { ProjectContextFileExtractionStatusValue } from "@paperclipai/shared";
import { notFound } from "../errors.js";

export function projectContextFileService(db: Db) {
  async function getProjectScope(projectId: string) {
    const project = await db
      .select({ id: projects.id, companyId: projects.companyId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
    if (!project) throw notFound("Project not found");
    return project;
  }

  return {
    list: async (projectId: string, limit = 50, offset = 0) => {
      return db
        .select()
        .from(projectContextFiles)
        .where(eq(projectContextFiles.projectId, projectId))
        .orderBy(desc(projectContextFiles.createdAt))
        .limit(limit)
        .offset(offset);
    },

    getById: async (projectId: string, fileId: string) => {
      return db
        .select()
        .from(projectContextFiles)
        .where(and(eq(projectContextFiles.projectId, projectId), eq(projectContextFiles.id, fileId)))
        .then((rows) => rows[0] ?? null);
    },

    createFromAsset: async (input: {
      projectId: string;
      assetId: string;
      title: string;
      uploadedByUserId?: string | null;
      uploadedByAgentId?: string | null;
      runId?: string | null;
    }) => {
      const project = await getProjectScope(input.projectId);
      const asset = await db
        .select()
        .from(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.companyId, project.companyId)))
        .then((rows) => rows[0] ?? null);
      if (!asset) throw notFound("Asset not found");
      const [created] = await db
        .insert(projectContextFiles)
        .values({
          companyId: project.companyId,
          projectId: input.projectId,
          assetId: asset.id,
          title: input.title,
          originalFilename: asset.originalFilename ?? "file",
          contentType: asset.contentType,
          byteSize: asset.byteSize,
          extractionStatus: "pending",
          uploadedByUserId: input.uploadedByUserId ?? null,
          uploadedByAgentId: input.uploadedByAgentId ?? null,
        })
        .returning();
      await db.insert(projectContextFileEvents).values({
        companyId: project.companyId,
        projectId: input.projectId,
        projectContextFileId: created!.id,
        eventType: "uploaded",
        details: { assetId: asset.id, title: input.title },
        createdByUserId: input.uploadedByUserId ?? null,
        createdByAgentId: input.uploadedByAgentId ?? null,
        createdByRunId: input.runId ?? null,
      });
      return created!;
    },

    setExtractionStatus: async (input: {
      projectId: string;
      fileId: string;
      status: ProjectContextFileExtractionStatusValue;
      extractedText?: string | null;
      extractionError?: string | null;
      eventDetails?: Record<string, unknown>;
      actorUserId?: string | null;
      actorAgentId?: string | null;
      runId?: string | null;
    }) => {
      const file = await db
        .select()
        .from(projectContextFiles)
        .where(and(eq(projectContextFiles.projectId, input.projectId), eq(projectContextFiles.id, input.fileId)))
        .then((rows) => rows[0] ?? null);
      if (!file) throw notFound("Project context file not found");
      const [updated] = await db
        .update(projectContextFiles)
        .set({
          extractionStatus: input.status,
          extractedText:
            Object.prototype.hasOwnProperty.call(input, "extractedText")
              ? input.extractedText ?? null
              : file.extractedText,
          extractionError: input.extractionError ?? null,
          updatedAt: new Date(),
        })
        .where(eq(projectContextFiles.id, file.id))
        .returning();
      await db.insert(projectContextFileEvents).values({
        companyId: file.companyId,
        projectId: input.projectId,
        projectContextFileId: file.id,
        eventType: "extraction_status_changed",
        details: {
          from: file.extractionStatus,
          to: input.status,
          extractionError: input.extractionError ?? null,
          ...(input.eventDetails ?? {}),
        },
        createdByUserId: input.actorUserId ?? null,
        createdByAgentId: input.actorAgentId ?? null,
        createdByRunId: input.runId ?? null,
      });
      return updated!;
    },

    listEvents: async (projectId: string, fileId: string) => {
      return db
        .select()
        .from(projectContextFileEvents)
        .where(and(eq(projectContextFileEvents.projectId, projectId), eq(projectContextFileEvents.projectContextFileId, fileId)))
        .orderBy(asc(projectContextFileEvents.createdAt));
    },

    remove: async (projectId: string, fileId: string, actor: { userId?: string | null; agentId?: string | null; runId?: string | null }) => {
      const [deleted] = await db
        .delete(projectContextFiles)
        .where(and(eq(projectContextFiles.projectId, projectId), eq(projectContextFiles.id, fileId)))
        .returning();
      if (!deleted) return null;
      await db.insert(projectContextFileEvents).values({
        companyId: deleted.companyId,
        projectId,
        projectContextFileId: deleted.id,
        eventType: "deleted",
        details: { title: deleted.title },
        createdByUserId: actor.userId ?? null,
        createdByAgentId: actor.agentId ?? null,
        createdByRunId: actor.runId ?? null,
      });
      return deleted;
    },
  };
}
