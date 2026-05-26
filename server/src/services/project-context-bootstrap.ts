import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projects } from "@paperclipai/db";
import { HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { documentService } from "./documents.js";
import { projectContextService } from "./project-context.js";
import { projectContextSyncService } from "./project-context-sync.js";
import { projectDataService } from "./project-data.js";

const DEFAULT_BACKFILL_BATCH_SIZE = Math.max(1, Number(process.env.PAPERCLIP_PROJECT_CONTEXT_BACKFILL_BATCH_SIZE ?? 100));

async function enqueueInitialContextSync(db: Db, projectId: string) {
  const context = projectContextService(db);
  const sync = projectContextSyncService(db);
  let created = false;
  try {
    await context.createMaintenanceRequest({
      projectId,
      actorUserId: null,
      payload: {
        type: "context_summary",
        description: "Initial project context sync",
        contextRef: { source: "bootstrap" },
      },
    });
    created = true;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 409) {
      throw error;
    }
  }
  if (created) {
    await sync.dispatchPendingForProject(projectId);
  }
}

export function projectContextBootstrapService(db: Db) {
  const docs = documentService(db);
  const data = projectDataService(db);

  async function ensureDefaultDocuments(projectId: string) {
    const existing = await docs.listProjectDocuments(projectId);
    const byKey = new Set(existing.map((doc) => doc.key));

    if (!byKey.has("brief")) {
      await docs.upsertProjectDocument({
        projectId,
        key: "brief",
        title: "Brief",
        format: "markdown",
        body: "",
        changeSummary: "Seeded default project brief",
      });
    }
    if (!byKey.has("summary")) {
      await docs.upsertProjectDocument({
        projectId,
        key: "summary",
        title: "Summary",
        format: "markdown",
        body: "",
        changeSummary: "Seeded default project summary",
      });
    }
  }

  async function initializeProjectContext(projectId: string, input?: { enqueueSync?: boolean }) {
    await data.ensureProjectSchema(projectId);
    await ensureDefaultDocuments(projectId);
    if (input?.enqueueSync !== false) {
      await enqueueInitialContextSync(db, projectId);
    }
  }

  async function backfillExistingProjects(input?: { batchSize?: number; enqueueSync?: boolean }) {
    const batchSize = input?.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE;
    let initialized = 0;
    let scanned = 0;
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;

    while (true) {
      let rows: Array<{ id: string; createdAt: Date }>;
      if (cursorCreatedAt && cursorId) {
        rows = await db
          .select({ id: projects.id, createdAt: projects.createdAt })
          .from(projects)
          .where(
            or(
              gt(projects.createdAt, cursorCreatedAt),
              and(eq(projects.createdAt, cursorCreatedAt), gt(projects.id, cursorId)),
            ),
          )
          .orderBy(asc(projects.createdAt), asc(projects.id))
          .limit(batchSize);
      } else {
        rows = await db
          .select({ id: projects.id, createdAt: projects.createdAt })
          .from(projects)
          .orderBy(asc(projects.createdAt), asc(projects.id))
          .limit(batchSize);
      }
      if (rows.length === 0) break;

      for (const row of rows) {
        scanned += 1;
        try {
          await initializeProjectContext(row.id, { enqueueSync: input?.enqueueSync !== false });
          initialized += 1;
        } catch (error) {
          logger.error({ err: error, projectId: row.id }, "project context backfill failed for project");
        }
      }

      const last = rows[rows.length - 1];
      cursorCreatedAt = last?.createdAt ?? null;
      cursorId = last?.id ?? null;
      if (rows.length < batchSize) break;
    }
    return { scanned, initialized };
  }

  return {
    initializeProjectContext,
    backfillExistingProjects,
  };
}
