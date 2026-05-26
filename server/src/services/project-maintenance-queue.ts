import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectMaintenanceRequests } from "@paperclipai/db";

const ACTIVE_MAINTENANCE_STATUSES = ["queued", "pending_approval", "pending", "in_progress"] as const;

export async function projectHasActiveMaintenanceDispatch(
  db: Db,
  projectId: string,
  excludeRequestId?: string,
) {
  const conditions = [
    eq(projectMaintenanceRequests.projectId, projectId),
    inArray(projectMaintenanceRequests.status, Array.from(ACTIVE_MAINTENANCE_STATUSES)),
  ];
  if (excludeRequestId) {
    conditions.push(ne(projectMaintenanceRequests.id, excludeRequestId));
  }
  const row = await db
    .select({ id: projectMaintenanceRequests.id, status: projectMaintenanceRequests.status })
    .from(projectMaintenanceRequests)
    .where(and(...conditions))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row;
}

export async function cancelMaintenanceRequestForHeartbeatRun(
  db: Db,
  runId: string,
  reason: string,
) {
  const now = new Date();
  const rows = await db
    .update(projectMaintenanceRequests)
    .set({
      status: "cancelled",
      heartbeatRunId: null,
      failureReason: reason,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(projectMaintenanceRequests.heartbeatRunId, runId),
        eq(projectMaintenanceRequests.status, "in_progress"),
      ),
    )
    .returning({ id: projectMaintenanceRequests.id, projectId: projectMaintenanceRequests.projectId });
  return rows;
}

export async function clearMaintenanceRequestRunLink(
  db: Db,
  requestId: string,
) {
  await db
    .update(projectMaintenanceRequests)
    .set({
      heartbeatRunId: null,
      updatedAt: new Date(),
    })
    .where(eq(projectMaintenanceRequests.id, requestId));
}

export type HeartbeatRunTerminalStatus = "succeeded" | "failed" | "cancelled" | "timed_out";

/** Map a finished heartbeat run to the correct maintenance-request state (no re-dispatch for user cancel). */
export async function reconcileMaintenanceRequestForFinishedRun(
  db: Db,
  runId: string,
  runStatus: HeartbeatRunTerminalStatus,
  runError: string | null,
): Promise<{ requestId: string; projectId: string; action: "cancelled" | "pending_retry" | "unchanged" } | null> {
  const row = await db
    .select()
    .from(projectMaintenanceRequests)
    .where(
      and(
        eq(projectMaintenanceRequests.heartbeatRunId, runId),
        eq(projectMaintenanceRequests.status, "in_progress"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!row) return null;

  const now = new Date();

  if (runStatus === "cancelled") {
    await db
      .update(projectMaintenanceRequests)
      .set({
        status: "cancelled",
        heartbeatRunId: null,
        failureReason: runError ?? "Cancelled by operator",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(projectMaintenanceRequests.id, row.id));
    return { requestId: row.id, projectId: row.projectId, action: "cancelled" };
  }

  if (runStatus === "succeeded") {
    // Agent must PATCH the request to completed; leave in_progress until then.
    return { requestId: row.id, projectId: row.projectId, action: "unchanged" };
  }

  await db
    .update(projectMaintenanceRequests)
    .set({
      status: "pending",
      heartbeatRunId: null,
      failureReason: runError ?? `Run ended with status ${runStatus}`,
      updatedAt: now,
    })
    .where(eq(projectMaintenanceRequests.id, row.id));
  return { requestId: row.id, projectId: row.projectId, action: "pending_retry" };
}
