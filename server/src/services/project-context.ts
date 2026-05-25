import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectMaintenanceRequests, projects } from "@paperclipai/db";
import type {
  CreateProjectMaintenanceRequest,
  PatchProjectMaintenanceRequest,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { stableHash } from "../utils/stable-hash.js";
import { documentService } from "./documents.js";

const ACTIVE_DEDUPE_STATUSES = [
  "queued",
  "pending_approval",
  "pending",
  "in_progress",
] as const;

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function classifyMaintenanceRisk(input: { type: string; description: string; contextRef: Record<string, unknown> | null }) {
  const haystack = `${input.type} ${input.description} ${JSON.stringify(input.contextRef ?? {})}`.toLowerCase();
  const reasons: string[] = [];

  const destructivePatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\b(drop|delete|remove)\b.{0,40}\b(table|view|column|field|widget|dashboard|status|stage|transition)\b/, reason: "Contains remove/drop operation on existing project structure" },
    { pattern: /\brename\b.{0,40}\b(table|view|column|field|status|stage|workflow)\b/, reason: "Contains rename operation that may break downstream references" },
    { pattern: /\bnot\s+null\b/, reason: "Contains NOT NULL style schema tightening that can be destructive without backfill" },
    { pattern: /\balter\b.{0,40}\btype\b/, reason: "Contains schema type alteration that can be incompatible" },
    { pattern: /\bremove\b.{0,20}\ballowed\b.{0,20}\b(actor|transition)\b/, reason: "Contains workflow actor/transition restriction changes" },
  ];

  for (const candidate of destructivePatterns) {
    if (candidate.pattern.test(haystack)) {
      reasons.push(candidate.reason);
    }
  }

  if (reasons.length > 0) {
    return { changeRiskClass: "destructive" as const, riskReasons: Array.from(new Set(reasons)) };
  }

  return { changeRiskClass: "non_destructive" as const, riskReasons: [] as string[] };
}

function toMaintenanceRequest(row: typeof projectMaintenanceRequests.$inferSelect) {
  return {
    ...row,
    contextRef: (row.contextRef as Record<string, unknown> | null) ?? null,
    riskReasons: (row.riskReasons as string[] | null) ?? [],
    retryCount: row.retryCount ?? 0,
    maxRetries: row.maxRetries ?? 2,
  };
}

function isReviewOnlyWorkflowCompletion(changeSummary: string | null | undefined) {
  return (changeSummary ?? "").trim().startsWith("REVIEW REQUIRED:");
}

export function projectContextService(db: Db) {
  const docs = documentService(db);

  return {
    listMaintenanceRequests: async (projectId: string, limit = 50, offset = 0) => {
      const rows = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(eq(projectMaintenanceRequests.projectId, projectId))
        .orderBy(desc(projectMaintenanceRequests.createdAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toMaintenanceRequest);
    },

    getMaintenanceRequestById: async (projectId: string, requestId: string) => {
      const row = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.id, requestId),
            eq(projectMaintenanceRequests.projectId, projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      return row ? toMaintenanceRequest(row) : null;
    },

    createMaintenanceRequest: async (input: {
      projectId: string;
      actorUserId: string | null;
      payload: CreateProjectMaintenanceRequest;
    }) => {
      const project = await db
        .select({ id: projects.id, companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) throw notFound("Project not found");

      const normalizedDescription = normalizeDescription(input.payload.description);
      const contextRef = input.payload.contextRef ?? null;
      const classification = classifyMaintenanceRisk({
        type: input.payload.type,
        description: normalizedDescription,
        contextRef,
      });
      const dedupeHash =
        input.payload.type === "context_summary"
          ? stableHash({ type: input.payload.type, projectId: input.projectId })
          : stableHash({
              type: input.payload.type,
              description: normalizedDescription,
              contextRef,
              requestedByUserId: input.actorUserId ?? null,
            });

      const existing = await db
        .select({ id: projectMaintenanceRequests.id })
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.projectId, input.projectId),
            inArray(projectMaintenanceRequests.status, Array.from(ACTIVE_DEDUPE_STATUSES)),
            eq(projectMaintenanceRequests.dedupeHash, dedupeHash),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (existing) {
        throw conflict("Equivalent maintenance request already exists", {
          code: "duplicate_request",
          requestId: existing.id,
        });
      }

      const active = await db
        .select({ id: projectMaintenanceRequests.id })
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.projectId, input.projectId),
            inArray(projectMaintenanceRequests.status, ["pending_approval", "pending", "in_progress"]),
          ),
        )
        .then((rows) => rows[0] ?? null);

      const status = active
        ? "queued"
        : classification.changeRiskClass === "destructive"
          ? "pending_approval"
          : "pending";
      const [created] = await db
        .insert(projectMaintenanceRequests)
        .values({
          companyId: project.companyId,
          projectId: project.id,
          type: input.payload.type,
          description: input.payload.description,
          normalizedDescription,
          contextRef,
          status,
          changeRiskClass: classification.changeRiskClass,
          riskReasons: classification.riskReasons,
          dedupeHash,
          requestedByUserId: input.actorUserId,
          retryCount: 0,
          maxRetries: Number(process.env.PAPERCLIP_CONTEXT_SYNC_RETRY_MAX ?? 2),
        })
        .returning();

      return { request: toMaintenanceRequest(created!), queued: status === "queued" };
    },

    patchMaintenanceRequest: async (input: {
      projectId: string;
      requestId: string;
      patch: PatchProjectMaintenanceRequest;
    }) => {
      const existing = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.id, input.requestId),
            eq(projectMaintenanceRequests.projectId, input.projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Maintenance request not found");

      const nextStatus = input.patch.status ?? existing.status;
      if (existing.status === "completed" || existing.status === "failed" || existing.status === "cancelled") {
        throw unprocessable("Terminal maintenance request cannot be updated");
      }
      if (
        input.patch.status === "pending"
        && existing.status !== "pending_approval"
        && existing.status !== "queued"
      ) {
        throw unprocessable("Only pending_approval or queued requests can move to pending");
      }

      if (nextStatus === "completed" && existing.type === "workflow") {
        const changeSummary = input.patch.changeSummary ?? existing.changeSummary;
        if (!isReviewOnlyWorkflowCompletion(changeSummary)) {
          const workflowDoc = await docs.getProjectDocumentByKey(input.projectId, "workflow");
          const body = (workflowDoc?.body ?? "").trim();
          if (!body) {
            throw unprocessable(
              "Workflow maintenance cannot be completed without a workflow summary. Upsert documents/workflow in this run first.",
            );
          }
          const docUpdatedAt = workflowDoc?.updatedAt ? new Date(workflowDoc.updatedAt) : null;
          if (!docUpdatedAt || docUpdatedAt < existing.createdAt) {
            throw unprocessable(
              "Workflow summary is stale. Upsert documents/workflow to reflect pipeline changes before completing this request.",
            );
          }
        }
      }

      const now = new Date();
      const [updated] = await db
        .update(projectMaintenanceRequests)
        .set({
          status: nextStatus,
          changeRiskClass: input.patch.changeRiskClass ?? existing.changeRiskClass,
          riskReasons: input.patch.riskReasons ?? existing.riskReasons,
          changeSummary: input.patch.changeSummary ?? existing.changeSummary,
          failureReason: input.patch.failureReason ?? existing.failureReason,
          completedAt:
            nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled"
              ? now
              : existing.completedAt,
          updatedAt: now,
        })
        .where(eq(projectMaintenanceRequests.id, existing.id))
        .returning();
      return toMaintenanceRequest(updated!);
    },

    approveMaintenanceRequest: async (input: {
      projectId: string;
      requestId: string;
      approvedByUserId: string | null;
      note?: string | null;
    }) => {
      const existing = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.id, input.requestId),
            eq(projectMaintenanceRequests.projectId, input.projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Maintenance request not found");
      if (existing.status !== "pending_approval") {
        throw conflict("Only pending_approval requests can be approved");
      }
      const now = new Date();
      const [updated] = await db
        .update(projectMaintenanceRequests)
        .set({
          status: "pending",
          approvedByUserId: input.approvedByUserId,
          approvedAt: now,
          changeSummary: input.note ?? existing.changeSummary,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectMaintenanceRequests.id, existing.id),
            eq(projectMaintenanceRequests.projectId, input.projectId),
            eq(projectMaintenanceRequests.status, "pending_approval"),
          ),
        )
        .returning();
      if (!updated) {
        throw conflict("Maintenance request status changed during approval");
      }
      return toMaintenanceRequest(updated!);
    },

    rejectMaintenanceRequest: async (input: {
      projectId: string;
      requestId: string;
      rejectedByUserId: string | null;
      reason: string;
    }) => {
      const existing = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.id, input.requestId),
            eq(projectMaintenanceRequests.projectId, input.projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Maintenance request not found");
      if (existing.status !== "pending_approval") {
        throw conflict("Only pending_approval requests can be rejected");
      }
      const now = new Date();
      const [updated] = await db
        .update(projectMaintenanceRequests)
        .set({
          status: "cancelled",
          rejectedByUserId: input.rejectedByUserId,
          rejectedAt: now,
          completedAt: now,
          failureReason: input.reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectMaintenanceRequests.id, existing.id),
            eq(projectMaintenanceRequests.projectId, input.projectId),
            eq(projectMaintenanceRequests.status, "pending_approval"),
          ),
        )
        .returning();
      if (!updated) {
        throw conflict("Maintenance request status changed during rejection");
      }
      return toMaintenanceRequest(updated!);
    },

    dequeueNextMaintenanceRequest: async (projectId: string) => {
      const [next] = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(and(eq(projectMaintenanceRequests.projectId, projectId), eq(projectMaintenanceRequests.status, "queued")))
        .orderBy(asc(projectMaintenanceRequests.createdAt))
        .limit(1);
      if (!next) return null;
      const now = new Date();
      const [updated] = await db
        .update(projectMaintenanceRequests)
        .set({ status: "pending", updatedAt: now })
        .where(eq(projectMaintenanceRequests.id, next.id))
        .returning();
      return updated ? toMaintenanceRequest(updated) : null;
    },
  };
}
