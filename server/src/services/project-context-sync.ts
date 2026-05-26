import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, projectMaintenanceRequests, projects } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "./heartbeat.js";
import {
  cancelMaintenanceRequestForHeartbeatRun,
  reconcileMaintenanceRequestForFinishedRun,
} from "./project-maintenance-queue.js";
import { formatProjectDashboardAgentGuidance } from "./project-data-api-guide.js";

const RETRY_BACKOFF_BASE_MS = Number(process.env.PAPERCLIP_CONTEXT_SYNC_RETRY_BACKOFF_MS ?? 15_000);

type MaintenanceRow = typeof projectMaintenanceRequests.$inferSelect;

function normalizeMaxRetries(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 2;
  return Math.floor(value);
}

function buildBackoffMs(retryAttempt: number) {
  const exponent = Math.max(0, retryAttempt - 1);
  const base = RETRY_BACKOFF_BASE_MS * Math.pow(2, exponent);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return base + jitter;
}

function wakeReasonForRequest(row: MaintenanceRow) {
  return row.type === "context_summary" ? "project_context_sync" : "project_maintenance_request";
}

/** How agents should write `documents/summary` (business context for humans and agents). */
const SUMMARY_DOCUMENT_AGENT_GUIDANCE = [
  "Project summary document (`documents/summary`) rules:",
  "- Audience: humans and agents on this project. Write operational business context they need before touching tasks.",
  "- Lead with what the project is for: customer/problem, outcomes, success metrics, and current priorities.",
  "- Capture goals, key decisions (with rationale when known), open risks/blockers, and timeline or milestone context.",
  "- Include standard operating procedures when source material has them: human SOPs, agent runbooks, checklists, escalation paths, compliance or quality bars.",
  "- Add glossary, key entities, stakeholders/roles, tools or systems (by business name), and constraints agents must respect.",
  "- Synthesize from uploaded files and project state; do not paste raw extracts or duplicate the full workflow playbook (that belongs in documents/workflow).",
  "- Do NOT include API paths, JSON, issue-status field names, maintenance request IDs, or other technical implementation detail.",
].join("\n");

/** How agents should write `documents/workflow` (playbook for task work, not board config). */
const WORKFLOW_DOCUMENT_AGENT_GUIDANCE = [
  "Workflow document (`documents/workflow`) rules:",
  "- Audience: agents doing project work. Write business rules and stage context they must follow.",
  "- Per stage (use the same names as the pipeline): purpose, who owns it, entry criteria, what done means, when to advance, handoffs, human approvals, and common exceptions.",
  "- Add a short intro for cross-cutting rules (SLAs, data quality, compliance, escalation) when relevant.",
  "- Do NOT include API paths, JSON, or technical config (allowedNextStatusValues, allowedActors, PATCH/POST, reorder payloads). Configure the board via issue-status APIs; keep the document in plain business language.",
].join("\n");

function wakePromptForRequest(row: MaintenanceRow) {
  const maintenanceDoneStep =
    `Patch /api/projects/${row.projectId}/maintenance-requests/${row.id} to completed with a concise changeSummary, or failed with failureReason.`;

  if (row.type === "context_summary") {
    return [
      "Run one-shot project context sync.",
      `Project: ${row.projectId}`,
      `Maintenance request id: ${row.id}`,
      "Refresh summary/workflow context using latest project documents, workflow state, and extracted project file content.",
      "Required steps:",
      `1) Read /api/projects/${row.projectId}/context for current summary/workflow, workflowStatuses, and pending request state.`,
      `2) Read /api/projects/${row.projectId}/context-files and use extractedText from files with extractionStatus=complete as source material.`,
      "3) Compare workflowStatuses to documents/workflow. If the pipeline changed, the workflow summary is empty, stale, or overly technical, upsert documents/workflow from the current stages (business playbook only).",
      "4) Upsert documents/summary when file or project state warrants it — business context and SOPs for humans/agents, not a technical dump.",
      SUMMARY_DOCUMENT_AGENT_GUIDANCE,
      WORKFLOW_DOCUMENT_AGENT_GUIDANCE,
      "Do not leave summary empty when extracted file content exists.",
      `5) ${maintenanceDoneStep}`,
    ].join("\n");
  }

  if (row.type === "workflow") {
    return [
      "Run one-shot project workflow maintenance request.",
      `Project: ${row.projectId}`,
      `Maintenance request id: ${row.id}`,
      `User request: ${row.description}`,
      "",
      "Important: updating allowedNextStatusValues alone is NOT sufficient. Review and update the workflow holistically when the user asks to set up or change a process (e.g. sales pipeline).",
      "",
      "Required checklist:",
      `1) GET /api/projects/${row.projectId}/issue-statuses — inventory every stage (name, value, position, allowedNextStatusValues, allowedActors, default assignees, approval flags).`,
      `2) GET /api/projects/${row.projectId}/context — read workflow summary/documents and maintenance request status.`,
      `3) Gap analysis vs the user request: missing stages, wrong order, broken transitions, missing handoffs/assignees, missing human approval gates.`,
      "3b) Custom pipeline stage values (required for sales/custom workflows):",
      "   - Do NOT only rename default stages while keeping template value keys (todo, in_progress, in_review) for different business meanings.",
      "   - Add stages with explicit value keys: lead_generation, qualified, email_draft, proposal, negotiation, contract_approval, etc. (snake_case, lowercase).",
      "   - Keep mandatory system values backlog, todo, done, cancelled (cannot delete); hide them from the board when custom stages replace them and wire transitions through the custom values.",
      "   - After setup, no column should show one business name while agents PATCH a generic key with a different meaning (e.g. display Qualified but value in_progress).",
      "   - Populate agentInstructions on each active stage with exit criteria (when to advance, forbidden mistaken keys).",
      "4) Apply substantive workflow changes via project workflow APIs (maintainer one-shots may use project:edit Workflow):",
      `   - POST /api/projects/${row.projectId}/issue-statuses for missing stages`,
      `   - PATCH /api/projects/${row.projectId}/issue-statuses/:statusId to fix names, transitions, actors, default assignees, colors, isActive`,
      `   - POST /api/projects/${row.projectId}/issue-statuses/reorder when pipeline order should change`,
      "   - DELETE non-mandatory obsolete stages; PATCH isActive:false when delete is not allowed (see step 4b)",
      "4b) Standing instruction — retire obsolete stages before completing:",
      "   After creating/editing the stages the user asked for, disable or remove template/default stages that are no longer part of the process.",
      "   - Re-read issue-statuses and compare to the final pipeline you built.",
      "   - DELETE stages that are not mandatory (backlog, todo, done, cancelled cannot be deleted) and are not used by open issues — e.g. generic in_progress, in_review, blocked when replaced by custom stages.",
      "   - PATCH isActive:false for mandatory stages that must stay in the system but should not appear on the board (e.g. todo when intake is a custom stage). Backlog is always board-hidden.",
      "   - Do not leave generic Todo / In Progress / In Review columns visible alongside a custom pipeline unless the user explicitly wants them.",
      "   - Remove retired stage values from allowedNextStatusValues on stages that still point at them.",
      "   - List in changeSummary which stages were deleted vs hidden.",
      `5) Mandatory — upsert /api/projects/${row.projectId}/documents/workflow in this same run:`,
      "   - Required if you made ANY issue-status change in step 4 (POST/PATCH/reorder/DELETE).",
      "   - Rewrite the full business playbook from the final pipeline; do not leave a stale or technical summary.",
      WORKFLOW_DOCUMENT_AGENT_GUIDANCE,
      "   - Do not PATCH this maintenance request to completed until documents/workflow is updated (server rejects stale completions).",
      `6) ${maintenanceDoneStep} List stages created/updated/reordered/deactivated (technical); workflow doc change should be noted in plain language.`,
      "",
      "Major overhaul governance:",
      "- Targeted fixes (add stage, fix handoff, adjust transitions): implement now.",
      "- Full pipeline redesign or removing/renaming many stages: if high impact, do NOT apply destructive edits yet. Complete the request with changeSummary starting with \"REVIEW REQUIRED:\" and bullet the proposed stage plan for user confirmation in a follow-up request.",
      "- If this request status is pending_approval, wait for approval before destructive edits; document the intended plan in changeSummary.",
    ].join("\n");
  }

  if (row.type === "dashboards") {
    return [
      "Run one-shot project dashboard maintenance request.",
      `Project: ${row.projectId}`,
      `Maintenance request id: ${row.id}`,
      `User request: ${row.description}`,
      "",
      "Important: dataSchemaName is internal — never put it in API URLs. Use the project UUID and registered table names.",
      "",
      "Audience: dashboards are for **business users** on the project Context tab — operational insight only.",
      formatProjectDashboardAgentGuidance(),
      "",
      "Required steps:",
      `1) GET /api/projects/${row.projectId}/context — read projectDataApi + projectDashboardApi summaries (tables, columns, existing dashboards).`,
      `2) GET /api/projects/${row.projectId}/data/objects — full table/view definitions if you need to create tables or queryRef payloads.`,
      `3) GET /api/projects/${row.projectId}/views — inventory dashboards; GET .../views/{viewId}/widgets for widget layout.`,
      "4) Create or update dashboards/widgets to match the user request:",
      `   - POST /api/projects/${row.projectId}/views — body: { name, description? }`,
      `   - POST /api/projects/${row.projectId}/views/{viewId}/widgets — types: kpi, table, chart, markdown; set queryRef to a POST .../data/query payload (ref.kind table|view, name, limit, offset).`,
      `   - PATCH /api/projects/${row.projectId}/views/{viewId}/widgets/{widgetId} — adjust title, queryRef, layout.`,
      `   - GET /api/projects/${row.projectId}/views/{viewId}/widgets/data — verify widget output after changes.`,
      "5) If the request needs new operational tables first:",
      `   - POST /api/projects/${row.projectId}/data/tables — then POST .../data/{tableName}/rows for seed/backfill rows.`,
      `6) ${maintenanceDoneStep}`,
    ].join("\n");
  }

  return [
    "Run one-shot project maintenance request.",
    `Project: ${row.projectId}`,
    `Maintenance request id: ${row.id}`,
    `Request type: ${row.type}`,
    `Request description: ${row.description}`,
    maintenanceDoneStep,
  ].join("\n");
}

export function projectContextSyncService(db: Db) {
  const heartbeat = heartbeatService(db);

  async function resolveCompanyMaintainerChain(companyId: string) {
    const rows = await db
      .select({
        id: agents.id,
        role: agents.role,
        reportsTo: agents.reportsTo,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          inArray(agents.status, ["idle", "running", "error"]),
        ),
      )
      .orderBy(asc(agents.createdAt));
    const ceo = rows.filter((row) => row.role === "ceo");
    const rootCeo = ceo.find((row) => row.reportsTo === null);
    const prioritized = [
      ...(rootCeo ? [rootCeo] : []),
      ...ceo.filter((row) => row.id !== rootCeo?.id),
      ...rows.filter((row) => row.role !== "ceo"),
    ];
    return prioritized.map((row) => row.id);
  }

  async function setRequestRetry(row: MaintenanceRow, reason: string) {
    const maxRetries = normalizeMaxRetries(row.maxRetries);
    const nextRetryCount = (row.retryCount ?? 0) + 1;
    if (nextRetryCount > maxRetries) {
      await db
        .update(projectMaintenanceRequests)
        .set({
          status: "failed",
          failureReason: reason,
          completedAt: new Date(),
          updatedAt: new Date(),
          heartbeatRunId: null,
          nextRetryAt: null,
        })
        .where(eq(projectMaintenanceRequests.id, row.id));
      return { terminal: true };
    }
    const nextRetryAt = new Date(Date.now() + buildBackoffMs(nextRetryCount));
    await db
      .update(projectMaintenanceRequests)
      .set({
        status: "pending",
        retryCount: nextRetryCount,
        failureReason: reason,
        nextRetryAt,
        heartbeatRunId: null,
        updatedAt: new Date(),
      })
      .where(eq(projectMaintenanceRequests.id, row.id));
    return { terminal: false, nextRetryAt };
  }

  const dispatchRequestById = async (requestId: string) => {
      const request = await db
        .select()
        .from(projectMaintenanceRequests)
        .where(eq(projectMaintenanceRequests.id, requestId))
        .then((rows) => rows[0] ?? null);
      if (!request) return null;
      if (request.status !== "pending") return null;
      if (request.nextRetryAt && request.nextRetryAt.getTime() > Date.now()) return null;

      const inProgressOnProject = await db
        .select({ id: projectMaintenanceRequests.id })
        .from(projectMaintenanceRequests)
        .where(
          and(
            eq(projectMaintenanceRequests.projectId, request.projectId),
            eq(projectMaintenanceRequests.status, "in_progress"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (inProgressOnProject && inProgressOnProject.id !== request.id) {
        return null;
      }

      const project = await db
        .select({ id: projects.id, companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, request.projectId))
        .then((rows) => rows[0] ?? null);
      if (!project) return null;

      const maintainers = await resolveCompanyMaintainerChain(project.companyId);
      if (maintainers.length === 0) {
        await setRequestRetry(request, "No eligible company maintainer agent available");
        return null;
      }

      const wakeReason = wakeReasonForRequest(request);
      const wakeupPrompt = wakePromptForRequest(request);
      for (const maintainerAgentId of maintainers) {
        try {
          const run = await heartbeat.wakeup(maintainerAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: wakeReason,
            requestedByActorType: "system",
            requestedByActorId: "project_context_sync_service",
            payload: {
              prompt: wakeupPrompt,
              projectId: request.projectId,
              maintenanceRequestId: request.id,
              maintenanceRequestType: request.type,
            },
            contextSnapshot: {
              wakeReason,
              wakeSource: "automation",
              wakeupPrompt,
              eventRunMode: "one_shot",
              projectId: request.projectId,
              maintenanceRequestId: request.id,
              maintenanceRequestType: request.type,
              taskKey: `one-shot:${wakeReason}:${request.projectId}:${request.id}`,
            },
          });
          if (!run) continue;
          await db
            .update(projectMaintenanceRequests)
            .set({
              status: "in_progress",
              heartbeatRunId: run.id,
              nextRetryAt: null,
              updatedAt: new Date(),
            })
            .where(eq(projectMaintenanceRequests.id, request.id));
          return { requestId: request.id, runId: run.id, agentId: maintainerAgentId };
        } catch (error) {
          logger.warn(
            { err: error, requestId: request.id, maintainerAgentId },
            "failed to dispatch project maintenance one-shot to maintainer",
          );
        }
      }

      await setRequestRetry(request, "Unable to dispatch one-shot run to any maintainer");
      return null;
  };

  const dispatchPendingForProject = async (projectId: string) => {
    const active = await db
      .select({ id: projectMaintenanceRequests.id, status: projectMaintenanceRequests.status })
      .from(projectMaintenanceRequests)
      .where(
        and(
          eq(projectMaintenanceRequests.projectId, projectId),
          inArray(projectMaintenanceRequests.status, ["pending_approval", "pending", "in_progress"]),
        ),
      )
      .orderBy(asc(projectMaintenanceRequests.createdAt));

    if (active.every((row) => row.status !== "pending")) {
      if (active.length === 0 || active.every((row) => row.status !== "in_progress" && row.status !== "pending_approval")) {
        const queued = await db
          .select()
          .from(projectMaintenanceRequests)
          .where(and(eq(projectMaintenanceRequests.projectId, projectId), eq(projectMaintenanceRequests.status, "queued")))
          .orderBy(asc(projectMaintenanceRequests.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        if (queued) {
          const nextStatus = queued.changeRiskClass === "destructive" ? "pending_approval" : "pending";
          await db
            .update(projectMaintenanceRequests)
            .set({ status: nextStatus, updatedAt: new Date() })
            .where(eq(projectMaintenanceRequests.id, queued.id));
        }
      }
    }

    const now = new Date();
    const pending = await db
      .select()
      .from(projectMaintenanceRequests)
      .where(
        and(
          eq(projectMaintenanceRequests.projectId, projectId),
          eq(projectMaintenanceRequests.status, "pending"),
          lte(projectMaintenanceRequests.nextRetryAt, now),
        ),
      )
      .orderBy(asc(projectMaintenanceRequests.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const fallbackPending = !pending
      ? await db
          .select()
          .from(projectMaintenanceRequests)
          .where(
            and(
              eq(projectMaintenanceRequests.projectId, projectId),
              eq(projectMaintenanceRequests.status, "pending"),
            ),
          )
          .orderBy(asc(projectMaintenanceRequests.createdAt))
          .limit(1)
          .then((rows) => rows.find((row) => row.nextRetryAt === null) ?? null)
      : pending;

    if (!fallbackPending) return null;
    return dispatchRequestById(fallbackPending.id);
  };

  const recoverPendingQueueStateOnStartup = async () => {
    const activeRows = await db
      .select()
      .from(projectMaintenanceRequests)
      .where(inArray(projectMaintenanceRequests.status, ["queued", "pending", "in_progress"]));

    for (const row of activeRows) {
      if (row.status !== "in_progress" || !row.heartbeatRunId) continue;
      const run = await heartbeat.getRun(row.heartbeatRunId);
      if (!run) {
        await reconcileMaintenanceRequestForFinishedRun(
          db,
          row.heartbeatRunId,
          "failed",
          "Linked heartbeat run not found during startup recovery",
        );
        continue;
      }
      if (run.status === "queued" || run.status === "running") continue;
      await reconcileMaintenanceRequestForFinishedRun(
        db,
        row.heartbeatRunId,
        run.status as "succeeded" | "failed" | "cancelled" | "timed_out",
        run.error ?? null,
      );
    }

    const projectIds = [...new Set(activeRows.map((row) => row.projectId))];
    for (const projectId of projectIds) {
      await dispatchPendingForProject(projectId);
    }
  };

  const reconcileInProgressRequests = async () => {
    const inProgressRows = await db
      .select()
      .from(projectMaintenanceRequests)
      .where(eq(projectMaintenanceRequests.status, "in_progress"));

    if (inProgressRows.length === 0) return 0;

    let recovered = 0;
    const affectedProjectIds = new Set<string>();

    for (const row of inProgressRows) {
      if (!row.heartbeatRunId) {
        await db
          .update(projectMaintenanceRequests)
          .set({
            status: "pending",
            updatedAt: new Date(),
          })
          .where(eq(projectMaintenanceRequests.id, row.id));
        recovered += 1;
        affectedProjectIds.add(row.projectId);
        continue;
      }

      const run = await heartbeat.getRun(row.heartbeatRunId);
      if (run && (run.status === "queued" || run.status === "running")) continue;

      const result = await reconcileMaintenanceRequestForFinishedRun(
        db,
        row.heartbeatRunId,
        run
          ? (run.status as "succeeded" | "failed" | "cancelled" | "timed_out")
          : "failed",
        run?.error ?? "Linked heartbeat run not found",
      );
      if (!result || result.action === "unchanged") continue;
      if (result.action !== "cancelled") {
        recovered += 1;
      }
      affectedProjectIds.add(row.projectId);
    }

    for (const projectId of affectedProjectIds) {
      await dispatchPendingForProject(projectId);
    }

    return recovered;
  };

  const tickRetryQueue = async (now = new Date()) => {
    // Recover in-progress rows whose one-shot run ended without patching status.
    await reconcileInProgressRequests();

    const due = await db
      .select({ id: projectMaintenanceRequests.id, projectId: projectMaintenanceRequests.projectId })
      .from(projectMaintenanceRequests)
      .where(
        and(
          eq(projectMaintenanceRequests.status, "pending"),
          lte(projectMaintenanceRequests.nextRetryAt, now),
        ),
      )
      .orderBy(asc(projectMaintenanceRequests.nextRetryAt), asc(projectMaintenanceRequests.createdAt))
      .limit(50);

    const projectIds = [...new Set(due.map((row) => row.projectId))];
    for (const projectId of projectIds) {
      await dispatchPendingForProject(projectId);
    }
    return due.length;
  };

  return {
    dispatchRequestById,

    dispatchPendingForProject,

    recoverPendingQueueStateOnStartup,
    reconcileInProgressRequests,
    cancelMaintenanceRequestForRun: (runId: string, reason: string) =>
      cancelMaintenanceRequestForHeartbeatRun(db, runId, reason),

    tickRetryQueue,
  };
}
