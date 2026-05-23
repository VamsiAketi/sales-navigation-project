import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  SECRET_PROVIDERS,
  type SecretProvider,
  createProjectSecretSchema,
  rotateProjectSecretSchema,
  updateProjectSecretSchema,
  createProjectSchema,
  createProjectWorkspaceSchema,
  createProjectIssueStatusSchema,
  updateProjectIssueStatusSchema,
  reorderProjectIssueStatusesSchema,
  isUuidLike,
  updateProjectSchema,
  updateProjectWorkspaceSchema,
  upsertProjectDocumentSchema,
  createProjectMaintenanceRequestSchema,
  patchProjectMaintenanceRequestSchema,
  approveProjectMaintenanceRequestSchema,
  rejectProjectMaintenanceRequestSchema,
  createProjectDataTableSchema,
  addProjectDataColumnSchema,
  projectDataQuerySchema,
  createProjectViewSchema,
  createProjectViewWidgetSchema,
  updateProjectViewWidgetSchema,
  type ProjectPermissionKey,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  projectService,
  projectIssueStatusService,
  projectContextService,
  projectContextFileService,
  projectContextBootstrapService,
  projectContextSyncService,
  heartbeatService,
  projectDataService,
  documentService,
  projectSecretService,
  logActivity,
} from "../services/index.js";
import { HttpError, conflict, forbidden } from "../errors.js";
import {
  assertAiAdminProjectNotArchived,
  assertAiAdminProjectWorkflowEditable,
  assertAiAdminProjectWorkflowDocumentEditable,
  assertAiAdminProjectWorkflowMaintenanceAllowed,
} from "../services/ai-admin-project.js";
import { assertCompanyAccess, getActorInfo, projectAuthActorFromRequest } from "./authz.js";
import { logger } from "../middleware/logger.js";

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);
  const statusSvc = projectIssueStatusService(db);
  const projectContextSvc = projectContextService(db);
  const projectContextFilesSvc = projectContextFileService(db);
  const projectContextBootstrapSvc = projectContextBootstrapService(db);
  const projectContextSyncSvc = projectContextSyncService(db);
  const heartbeatSvc = heartbeatService(db);
  const projectDataSvc = projectDataService(db);
  const documentsSvc = documentService(db);
  const projectSecretsSvc = projectSecretService(db);
  const access = accessService(db);
  const configuredDefaultSecretProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  const defaultSecretProvider = (
    configuredDefaultSecretProvider && SECRET_PROVIDERS.includes(configuredDefaultSecretProvider as SecretProvider)
      ? configuredDefaultSecretProvider
      : "local_encrypted"
  ) as SecretProvider;

  const ONE_SHOT_BYPASS_PERMISSIONS = new Set<ProjectPermissionKey>([
    "project:read",
    "project:edit configuration",
    "project:edit Workflow",
  ]);

  async function requireProjectPermission(
    req: Request,
    companyId: string,
    projectId: string,
    permission: ProjectPermissionKey,
  ) {
    const actor = projectAuthActorFromRequest(req);
    if (await access.satisfiesProjectPermission(companyId, projectId, permission, actor)) {
      return;
    }

    if (req.actor.type === "agent" && req.actor.agentId && req.actor.runId) {
      const run = await heartbeatSvc.getRun(req.actor.runId);
      const snapshot = (run?.contextSnapshot ?? {}) as Record<string, unknown>;
      const wakeReason = typeof snapshot.wakeReason === "string" ? snapshot.wakeReason : "";
      const snapshotProjectId = typeof snapshot.projectId === "string" ? snapshot.projectId : "";
      const isMaintainerOneShot = wakeReason === "project_context_sync" || wakeReason === "project_maintenance_request";
      if (
        run &&
        run.companyId === companyId &&
        run.agentId === req.actor.agentId &&
        isMaintainerOneShot &&
        snapshotProjectId === projectId &&
        ONE_SHOT_BYPASS_PERMISSIONS.has(permission)
      ) {
        return;
      }
    }

    throw forbidden(`Missing project permission: ${permission}`);
  }

  async function assertCanCreateCompanyProject(req: Request, companyId: string) {
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      if (!(await access.canUser(companyId, req.actor.userId, "projects.create"))) {
        throw forbidden("Missing permission: projects.create");
      }
      return;
    }
    if (req.actor.type === "agent" && req.actor.agentId) {
      if (!(await access.hasPermission(companyId, "agent", req.actor.agentId, "projects.create"))) {
        throw forbidden("Missing permission: projects.create");
      }
      return;
    }
    throw forbidden("Missing permission: projects.create");
  }

  async function queueProjectContextSync(projectId: string, actorUserId: string | null) {
    try {
      const created = await projectContextSvc.createMaintenanceRequest({
        projectId,
        actorUserId,
        payload: {
          type: "context_summary",
          // Keep payload stable so bursts of project changes collapse into one active sync request.
          description: "Refresh project context from project updates",
          contextRef: null,
        },
      });
      if (created.request.status === "pending") {
        await projectContextSyncSvc.dispatchRequestById(created.request.id);
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) return;
      throw error;
    }
  }

  async function resolveCompanyIdForProjectReference(req: Request) {
    const companyIdQuery = req.query.companyId;
    const requestedCompanyId =
      typeof companyIdQuery === "string" && companyIdQuery.trim().length > 0
        ? companyIdQuery.trim()
        : null;
    if (requestedCompanyId) {
      assertCompanyAccess(req, requestedCompanyId);
      return requestedCompanyId;
    }
    if (req.actor.type === "agent" && req.actor.companyId) {
      return req.actor.companyId;
    }
    return null;
  }

  async function normalizeProjectReference(req: Request, rawId: string) {
    if (isUuidLike(rawId)) return rawId;
    const companyId = await resolveCompanyIdForProjectReference(req);
    if (!companyId) return rawId;
    const resolved = await svc.resolveByReference(companyId, rawId);
    if (resolved.ambiguous) {
      throw conflict("Project shortname is ambiguous in this company. Use the project ID.");
    }
    return resolved.project?.id ?? rawId;
  }

  router.param("id", async (req, _res, next, rawId) => {
    try {
      req.params.id = await normalizeProjectReference(req, rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/companies/:companyId/projects/nav", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = projectAuthActorFromRequest(req);
    const allowedIds = await access.listProjectIdsVisibleToActor(companyId, actor);
    const result = await svc.listNav(companyId);
    if (allowedIds !== null) {
      const allow = new Set(allowedIds);
      res.json(result.filter((p) => allow.has(p.id)));
      return;
    }
    res.json(result);
  });

  router.get("/companies/:companyId/projects", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = projectAuthActorFromRequest(req);
    const allowedIds = await access.listProjectIdsVisibleToActor(companyId, actor);
    const result = await svc.list(companyId);
    if (allowedIds !== null) {
      const allow = new Set(allowedIds);
      res.json(result.filter((p) => allow.has(p.id)));
      return;
    }
    res.json(result);
  });

  router.get("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, project.id, "project:read");
    res.json(project);
  });

  router.get("/projects/:id/context", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    const [documents, maintenanceRequests, statuses] = await Promise.all([
      documentsSvc.listProjectDocuments(id),
      projectContextSvc.listMaintenanceRequests(id, 20, 0),
      statusSvc.list(id),
    ]);
    res.json({
      projectId: id,
      dataSchemaName: project.dataSchemaName ?? null,
      summary: documents.find((doc) => doc.key === "summary") ?? null,
      workflowSummary: documents.find((doc) => doc.key === "workflow") ?? null,
      documents,
      maintenanceRequests,
      workflowStatuses: statuses,
    });
  });

  router.post("/projects/:id/context/sync", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const created = await projectContextSvc.createMaintenanceRequest({
      projectId: id,
      actorUserId: req.actor.userId ?? null,
      payload: {
        type: "context_summary",
        description: "Manual context sync requested.",
        contextRef: { source: "manual_sync" },
      },
    });
    if (created.request.status === "pending") {
      await projectContextSyncSvc.dispatchRequestById(created.request.id);
    }
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.sync_requested",
      entityType: "project_maintenance_request",
      entityId: created.request.id,
      details: { projectId: id, queued: created.queued },
    });
    res.status(202).json({
      requestId: created.request.id,
      status: created.request.status,
      queued: created.queued,
    });
  });

  router.get("/projects/:id/context-files", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.min(10000, Math.max(0, Number(req.query.offset ?? 0)));
    res.json(await projectContextFilesSvc.list(id, limit, offset));
  });

  router.post("/projects/:id/context-files", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const body = req.body as { assetId?: string; title?: string };
    if (typeof body.assetId !== "string" || body.assetId.trim().length === 0) {
      res.status(400).json({ error: "assetId is required" });
      return;
    }
    const title = typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim() : "Project context file";
    const actor = getActorInfo(req);
    const created = await projectContextFilesSvc.createFromAsset({
      projectId: id,
      assetId: body.assetId,
      title,
      uploadedByUserId: req.actor.userId ?? null,
      uploadedByAgentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.file.linked",
      entityType: "project_context_file",
      entityId: created.id,
      details: { projectId: id, assetId: created.assetId, title: created.title },
    });
    res.status(201).json(created);
  });

  router.patch("/projects/:id/context-files/:fileId/status", async (req, res) => {
    const id = req.params.id as string;
    const fileId = req.params.fileId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const body = req.body as { status?: string; extractedText?: string | null; extractionError?: string | null };
    if (!["pending", "processing", "complete", "failed", "skipped"].includes(String(body.status ?? ""))) {
      res.status(400).json({ error: "status must be one of pending|processing|complete|failed|skipped" });
      return;
    }
    const updated = await projectContextFilesSvc.setExtractionStatus({
      projectId: id,
      fileId,
      status: body.status as "pending" | "processing" | "complete" | "failed" | "skipped",
      extractedText: body.extractedText ?? null,
      extractionError: body.extractionError ?? null,
      actorUserId: req.actor.userId ?? null,
      actorAgentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
    });
    if (updated.extractionStatus === "complete") {
      await queueProjectContextSync(id, req.actor.userId ?? null);
    }
    res.json(updated);
  });

  router.get("/projects/:id/context-files/:fileId/events", async (req, res) => {
    const id = req.params.id as string;
    const fileId = req.params.fileId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await projectContextFilesSvc.listEvents(id, fileId));
  });

  router.delete("/projects/:id/context-files/:fileId", async (req, res) => {
    const id = req.params.id as string;
    const fileId = req.params.fileId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const removed = await projectContextFilesSvc.remove(id, fileId, {
      userId: req.actor.userId ?? null,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
    });
    if (!removed) {
      res.status(404).json({ error: "Project context file not found" });
      return;
    }
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.file.deleted",
      entityType: "project_context_file",
      entityId: removed.id,
      details: { projectId: id, assetId: removed.assetId },
    });
    res.json(removed);
  });

  router.get("/projects/:id/documents", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await documentsSvc.listProjectDocuments(id));
  });

  router.get("/projects/:id/documents/:key", async (req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    const document = await documentsSvc.getProjectDocumentByKey(id, key);
    if (!document) { res.status(404).json({ error: "Document not found" }); return; }
    res.json(document);
  });

  router.put("/projects/:id/documents/:key", validate(upsertProjectDocumentSchema), async (req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    assertAiAdminProjectWorkflowDocumentEditable(project, key);
    const actor = getActorInfo(req);
    const result = await documentsSvc.upsertProjectDocument({
      projectId: id,
      key,
      title: req.body.title ?? null,
      format: req.body.format,
      body: req.body.body,
      changeSummary: req.body.changeSummary ?? null,
      baseRevisionId: (req.body.baseRevisionId as string | null | undefined) ?? null,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: req.actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: result.created ? "project_context.document.created" : "project_context.document.updated",
      entityType: "project_document",
      entityId: result.document.id,
      details: { projectId: id, key: result.document.key, latestRevisionId: result.document.latestRevisionId },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.status(result.created ? 201 : 200).json(result);
  });

  router.delete("/projects/:id/documents/:key", async (req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const removed = await documentsSvc.deleteProjectDocument(id, key);
    if (!removed) { res.status(404).json({ error: "Document not found" }); return; }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.document.deleted",
      entityType: "project_document",
      entityId: removed.id,
      details: { projectId: id, key: removed.key },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.json(removed);
  });

  router.get("/projects/:id/documents/:key/revisions", async (req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await documentsSvc.listProjectDocumentRevisions(id, key));
  });

  router.post("/projects/:id/documents/:key/revisions/:revisionId/restore", async (req, res) => {
    const id = req.params.id as string;
    const key = req.params.key as string;
    const revisionId = req.params.revisionId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const restored = await documentsSvc.restoreProjectDocumentRevision({
      projectId: id,
      key,
      revisionId,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: req.actor.userId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.document.restored",
      entityType: "project_document",
      entityId: restored.document.id,
      details: { projectId: id, key, restoredFromRevisionId: restored.restoredFromRevisionId },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.json(restored);
  });

  router.get("/projects/:id/maintenance-requests", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.min(10000, Math.max(0, Number(req.query.offset ?? 0)));
    res.json(await projectContextSvc.listMaintenanceRequests(id, limit, offset));
  });

  router.post("/projects/:id/maintenance-requests", validate(createProjectMaintenanceRequestSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    assertAiAdminProjectWorkflowMaintenanceAllowed(project, req.body.type);
    const actor = getActorInfo(req);
    const created = await projectContextSvc.createMaintenanceRequest({
      projectId: id,
      actorUserId: req.actor.userId ?? null,
      payload: req.body,
    });
    if (!created.queued) {
      await projectContextSyncSvc.dispatchRequestById(created.request.id);
    }
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.maintenance_request.created",
      entityType: "project_maintenance_request",
      entityId: created.request.id,
      details: {
        projectId: id,
        type: created.request.type,
        queued: created.queued,
        changeRiskClass: created.request.changeRiskClass,
        riskReasons: created.request.riskReasons ?? [],
      },
    });
    res.status(201).json({ requestId: created.request.id, runId: created.request.heartbeatRunId ?? null, queued: created.queued });
  });

  router.patch("/projects/:id/maintenance-requests/:requestId", validate(patchProjectMaintenanceRequestSchema), async (req, res) => {
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const updated = await projectContextSvc.patchMaintenanceRequest({ projectId: id, requestId, patch: req.body });
    if (updated.status === "completed" || updated.status === "failed" || updated.status === "cancelled") {
      await projectContextSyncSvc.dispatchPendingForProject(id);
    } else if (updated.status === "pending") {
      await projectContextSyncSvc.dispatchRequestById(updated.id);
    }
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_context.maintenance_request.updated",
      entityType: "project_maintenance_request",
      entityId: updated.id,
      details: { projectId: id, status: updated.status },
    });
    res.json(updated);
  });

  router.post(
    "/projects/:id/maintenance-requests/:requestId/approve",
    validate(approveProjectMaintenanceRequestSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const requestId = req.params.requestId as string;
      const project = await svc.getById(id);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      assertCompanyAccess(req, project.companyId);
      await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
      const actor = getActorInfo(req);
      const updated = await projectContextSvc.approveMaintenanceRequest({
        projectId: id,
        requestId,
        approvedByUserId: req.actor.userId ?? null,
        note: req.body.note ?? null,
      });
      await projectContextSyncSvc.dispatchRequestById(updated.id);
      await logActivity(db, {
        companyId: project.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "project_context.maintenance_request.approved",
        entityType: "project_maintenance_request",
        entityId: updated.id,
        details: {
          projectId: id,
          note: req.body.note ?? null,
          changeRiskClass: updated.changeRiskClass,
          riskReasons: updated.riskReasons ?? [],
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/projects/:id/maintenance-requests/:requestId/reject",
    validate(rejectProjectMaintenanceRequestSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const requestId = req.params.requestId as string;
      const project = await svc.getById(id);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      assertCompanyAccess(req, project.companyId);
      await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
      const actor = getActorInfo(req);
      const updated = await projectContextSvc.rejectMaintenanceRequest({
        projectId: id,
        requestId,
        rejectedByUserId: req.actor.userId ?? null,
        reason: req.body.reason,
      });
      await projectContextSyncSvc.dispatchPendingForProject(id);
      await logActivity(db, {
        companyId: project.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "project_context.maintenance_request.rejected",
        entityType: "project_maintenance_request",
        entityId: updated.id,
        details: {
          projectId: id,
          reason: req.body.reason,
          changeRiskClass: updated.changeRiskClass,
          riskReasons: updated.riskReasons ?? [],
        },
      });
      res.json(updated);
    },
  );

  router.get("/projects/:id/data/objects", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await projectDataSvc.listDataObjects(id));
  });

  router.post("/projects/:id/data/tables", validate(createProjectDataTableSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const created = await projectDataSvc.createTable({
      projectId: id,
      payload: req.body,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: req.actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_data.table.created",
      entityType: "project_data_object",
      entityId: created.id,
      details: { projectId: id, name: created.name, kind: created.kind },
    });
    res.status(201).json(created);
  });

  router.post("/projects/:id/data/tables/:tableName/columns", validate(addProjectDataColumnSchema), async (req, res) => {
    const id = req.params.id as string;
    const tableName = req.params.tableName as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const result = await projectDataSvc.addTableColumn({
      projectId: id,
      tableName,
      payload: req.body,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: req.actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_data.table.column_added",
      entityType: "project",
      entityId: id,
      details: { projectId: id, tableName, column: result.column.name, type: result.column.type },
    });
    res.status(201).json(result);
  });

  router.post("/projects/:id/data/views", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const payload = req.body as Record<string, unknown> & { name?: string };
    if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
      res.status(400).json({ error: "View payload.name is required" });
      return;
    }
    const actor = getActorInfo(req);
    const created = await projectDataSvc.createViewObject({
      projectId: id,
      payload: { ...payload, name: payload.name },
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: req.actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
    });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_data.view.created",
      entityType: "project_data_object",
      entityId: created.id,
      details: { projectId: id, name: created.name, kind: created.kind },
    });
    res.status(201).json(created);
  });

  router.post("/projects/:id/data/query", validate(projectDataQuerySchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await projectDataSvc.queryData({ projectId: id, payload: req.body }));
  });

  router.post("/projects/:id/data/:table/rows", async (req, res) => {
    const id = req.params.id as string;
    const table = req.params.table as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit tickets");
    const rows = (req.body as { rows?: Record<string, unknown>[] }).rows;
    const inserted = await projectDataSvc.insertRows({ projectId: id, table, rows: Array.isArray(rows) ? rows : [] });
    res.status(201).json({ count: inserted.length, rows: inserted });
  });

  router.patch("/projects/:id/data/:table/rows", async (req, res) => {
    const id = req.params.id as string;
    const table = req.params.table as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit tickets");
    const payload = req.body as { primaryKey?: Record<string, unknown>; patch?: Record<string, unknown> };
    const updated = await projectDataSvc.updateRowByPk({
      projectId: id,
      table,
      primaryKey: payload.primaryKey ?? {},
      patch: payload.patch ?? {},
    });
    res.json(updated);
  });

  router.delete("/projects/:id/data/:table/rows", async (req, res) => {
    const id = req.params.id as string;
    const table = req.params.table as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit tickets");
    const payload = req.body as { primaryKey?: Record<string, unknown> };
    const deleted = await projectDataSvc.deleteRowByPk({
      projectId: id,
      table,
      primaryKey: payload.primaryKey ?? {},
    });
    res.json(deleted);
  });

  router.get("/projects/:id/views", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await projectDataSvc.listViews(id));
  });

  router.post("/projects/:id/views", validate(createProjectViewSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const created = await projectDataSvc.createView({ projectId: id, payload: req.body });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_view.created",
      entityType: "project_view",
      entityId: created.id,
      details: { projectId: id, name: created.name },
    });
    res.status(201).json(created);
  });

  router.get("/projects/:id/views/:viewId/widgets", async (req, res) => {
    const id = req.params.id as string;
    const viewId = req.params.viewId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    res.json(await projectDataSvc.listWidgets(id, viewId));
  });

  router.get("/projects/:id/views/:viewId/widgets/data", async (req, res) => {
    const id = req.params.id as string;
    const viewId = req.params.viewId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    const widgets = await projectDataSvc.listWidgets(id, viewId);

    const widgetData = await Promise.all(
      widgets.map(async (widget) => {
        if (!widget.queryRef || widget.type === "markdown") {
          return {
            widgetId: widget.id,
            type: widget.type,
            title: widget.title,
            data: null,
            error: null,
          };
        }

        const parsedQuery = projectDataQuerySchema.safeParse(widget.queryRef);
        if (!parsedQuery.success) {
          return {
            widgetId: widget.id,
            type: widget.type,
            title: widget.title,
            data: null,
            error: "Invalid widget queryRef configuration",
          };
        }

        try {
          const result = await projectDataSvc.queryData({ projectId: id, payload: parsedQuery.data });
          return {
            widgetId: widget.id,
            type: widget.type,
            title: widget.title,
            data: result,
            error: null,
          };
        } catch (error) {
          return {
            widgetId: widget.id,
            type: widget.type,
            title: widget.title,
            data: null,
            error: error instanceof Error ? error.message : "Widget query failed",
          };
        }
      }),
    );

    res.json({ viewId, widgets: widgetData });
  });

  router.post("/projects/:id/views/:viewId/widgets", validate(createProjectViewWidgetSchema), async (req, res) => {
    const id = req.params.id as string;
    const viewId = req.params.viewId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const created = await projectDataSvc.createWidget({ projectId: id, viewId, payload: req.body });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_view.widget_created",
      entityType: "project_view_widget",
      entityId: created.id,
      details: { projectId: id, viewId },
    });
    res.status(201).json(created);
  });

  router.patch("/projects/:id/views/:viewId/widgets/:widgetId", validate(updateProjectViewWidgetSchema), async (req, res) => {
    const id = req.params.id as string;
    const viewId = req.params.viewId as string;
    const widgetId = req.params.widgetId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const updated = await projectDataSvc.updateWidget({ projectId: id, viewId, widgetId, payload: req.body });
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_view.widget_updated",
      entityType: "project_view_widget",
      entityId: widgetId,
      details: { projectId: id, viewId, changedKeys: Object.keys(req.body).sort() },
    });
    res.json(updated);
  });

  router.delete("/projects/:id/views/:viewId/widgets/:widgetId", async (req, res) => {
    const id = req.params.id as string;
    const viewId = req.params.viewId as string;
    const widgetId = req.params.widgetId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit configuration");
    const actor = getActorInfo(req);
    const deleted = await projectDataSvc.deleteWidget(id, viewId, widgetId);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project_view.widget_deleted",
      entityType: "project_view_widget",
      entityId: widgetId,
      details: { projectId: id, viewId },
    });
    res.json(deleted);
  });

  router.post("/companies/:companyId/projects", validate(createProjectSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertCanCreateCompanyProject(req, companyId);
    type CreateProjectPayload = Parameters<typeof svc.create>[1] & {
      workspace?: Parameters<typeof svc.createWorkspace>[1];
    };

    const { workspace, ...insertPayload } = req.body as CreateProjectPayload;

    const project = await svc.create(companyId, insertPayload);
    await statusSvc.seedDefaults(project.id, companyId);
    try {
      // Defer sync dispatch so project create returns immediately (onboarding/e2e must not block on agent wake).
      await projectContextBootstrapSvc.initializeProjectContext(project.id, { enqueueSync: false });
    } catch (err) {
      logger.error(
        { err, projectId: project.id, companyId },
        "project context bootstrap failed after project create",
      );
    }
    let createdWorkspaceId: string | null = null;
    if (workspace) {
      const createdWorkspace = await svc.createWorkspace(project.id, workspace);
      if (!createdWorkspace) {
        await svc.remove(project.id);
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }
      createdWorkspaceId = createdWorkspace.id;
    }
    let hydratedProject = workspace ? await svc.getById(project.id) : project;

    if (
      req.actor.type === "board"
      && req.actor.userId
      && (await access.companyUsesRestrictedProjectAccess(companyId))
    ) {
      // Seed creator grants for every board session (including local_implicit). Implicit-trust
      // sessions still bypass enforcement, but rows keep the Access UI truthful and match
      // non-local behavior if that bypass is ever narrowed.
      await access.seedFullProjectGrantsForUser(companyId, project.id, req.actor.userId, req.actor.userId);
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      details: {
        name: project.name,
        workspaceId: createdWorkspaceId,
      },
    });
    res.status(201).json(hydratedProject ?? project);
  });

  router.patch("/projects/:id", validate(updateProjectSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const body = { ...req.body };
    const touchesArchive = Object.prototype.hasOwnProperty.call(body, "archivedAt");
    await requireProjectPermission(
      req,
      existing.companyId,
      id,
      touchesArchive ? "project:archive" : "project:edit configuration",
    );
    if (typeof body.archivedAt === "string") {
      body.archivedAt = new Date(body.archivedAt);
    }
    if (touchesArchive) {
      assertAiAdminProjectNotArchived(existing, body.archivedAt ?? null);
    }
    const project = await svc.update(id, body);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      details: req.body,
    });

    res.json(project);
  });

  router.get("/projects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:read");
    const workspaces = await svc.listWorkspaces(id);
    res.json(workspaces);
  });

  router.post("/projects/:id/workspaces", validate(createProjectWorkspaceSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:edit configuration");
    const workspace = await svc.createWorkspace(id, req.body);
    if (!workspace) {
      res.status(422).json({ error: "Invalid project workspace payload" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_created",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        isPrimary: workspace.isPrimary,
      },
    });

    res.status(201).json(workspace);
  });

  router.patch(
    "/projects/:id/workspaces/:workspaceId",
    validate(updateProjectWorkspaceSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const workspaceId = req.params.workspaceId as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      await requireProjectPermission(req, existing.companyId, id, "project:edit configuration");
      const workspaceExists = (await svc.listWorkspaces(id)).some((workspace) => workspace.id === workspaceId);
      if (!workspaceExists) {
        res.status(404).json({ error: "Project workspace not found" });
        return;
      }
      const workspace = await svc.updateWorkspace(id, workspaceId, req.body);
      if (!workspace) {
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "project.workspace_updated",
        entityType: "project",
        entityId: id,
        details: {
          workspaceId: workspace.id,
          changedKeys: Object.keys(req.body).sort(),
        },
      });

      res.json(workspace);
    },
  );

  router.delete("/projects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:edit configuration");
    const workspace = await svc.removeWorkspace(id, workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_deleted",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
      },
    });

    res.json(workspace);
  });

  // ── Issue status routes ──────────────────────────────────────────────────

  router.get("/projects/:id/issue-statuses", async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:read");
    // Seed defaults lazily if none exist yet (handles projects created before this migration)
    const statuses = await statusSvc.list(id);
    if (statuses.length === 0) {
      await statusSvc.seedDefaults(id, project.companyId);
      res.json(await statusSvc.list(id));
    } else {
      res.json(statuses);
    }
  });

  router.post("/projects/:id/issue-statuses", validate(createProjectIssueStatusSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
    assertAiAdminProjectWorkflowEditable(project);
    const status = await statusSvc.create(id, project.companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project.status_created",
      entityType: "project",
      entityId: id,
      details: {
        statusId: status.id,
        name: status.name,
      },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.status(201).json(status);
  });

  router.patch("/projects/:id/issue-statuses/:statusId", validate(updateProjectIssueStatusSchema), async (req, res) => {
    const id = req.params.id as string;
    const statusId = req.params.statusId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
    assertAiAdminProjectWorkflowEditable(project);
    const status = await statusSvc.update(statusId, id, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project.status_updated",
      entityType: "project",
      entityId: id,
      details: {
        statusId,
        changedKeys: Object.keys(req.body).sort(),
      },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.json(status);
  });

  router.post("/projects/:id/issue-statuses/reorder", validate(reorderProjectIssueStatusesSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
    assertAiAdminProjectWorkflowEditable(project);
    const statuses = await statusSvc.reorder(id, req.body.orderedIds);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project.statuses_reordered",
      entityType: "project",
      entityId: id,
      details: {
        orderedIds: req.body.orderedIds,
      },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.json(statuses);
  });

  router.delete("/projects/:id/issue-statuses/:statusId", async (req, res) => {
    const id = req.params.id as string;
    const statusId = req.params.statusId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
    assertAiAdminProjectWorkflowEditable(project);
    const status = await statusSvc.remove(statusId, id);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project.status_deleted",
      entityType: "project",
      entityId: id,
      details: {
        statusId: status.id,
        name: status.name,
      },
    });
    await queueProjectContextSync(id, req.actor.userId ?? null);
    res.json(status);
  });

  router.get("/projects/:id/project-secrets", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:edit configuration");
    const secrets = await projectSecretsSvc.list(existing.companyId, id);
    res.json(secrets);
  });

  router.post("/projects/:id/project-secrets", validate(createProjectSecretSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:edit configuration");

    const created = await projectSecretsSvc.create(
      existing.companyId,
      id,
      {
        name: req.body.name,
        provider: req.body.provider ?? defaultSecretProvider,
        value: req.body.value,
        description: req.body.description,
        externalRef: req.body.externalRef,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project_secret.created",
      entityType: "project_secret",
      entityId: created.id,
      details: { name: created.name, projectId: id, provider: created.provider },
    });

    res.status(201).json(created);
  });

  router.delete("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, id, "project:archive");
    const project = await svc.remove(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.deleted",
      entityType: "project",
      entityId: project.id,
    });

    res.json(project);
  });

  return router;
}
