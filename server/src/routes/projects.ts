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
  type ProjectPermissionKey,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  projectService,
  projectIssueStatusService,
  projectSecretService,
  logActivity,
} from "../services/index.js";
import { conflict, forbidden } from "../errors.js";
import { assertCompanyAccess, getActorInfo, projectAuthActorFromRequest } from "./authz.js";

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);
  const statusSvc = projectIssueStatusService(db);
  const projectSecretsSvc = projectSecretService(db);
  const access = accessService(db);
  const configuredDefaultSecretProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  const defaultSecretProvider = (
    configuredDefaultSecretProvider && SECRET_PROVIDERS.includes(configuredDefaultSecretProvider as SecretProvider)
      ? configuredDefaultSecretProvider
      : "local_encrypted"
  ) as SecretProvider;

  async function requireProjectPermission(
    req: Request,
    companyId: string,
    projectId: string,
    permission: ProjectPermissionKey,
  ) {
    const actor = projectAuthActorFromRequest(req);
    if (!(await access.satisfiesProjectPermission(companyId, projectId, permission, actor))) {
      throw forbidden("Project permission denied");
    }
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
    res.status(201).json(status);
  });

  router.patch("/projects/:id/issue-statuses/:statusId", validate(updateProjectIssueStatusSchema), async (req, res) => {
    const id = req.params.id as string;
    const statusId = req.params.statusId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
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
    res.json(status);
  });

  router.post("/projects/:id/issue-statuses/reorder", validate(reorderProjectIssueStatusesSchema), async (req, res) => {
    const id = req.params.id as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
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
    res.json(statuses);
  });

  router.delete("/projects/:id/issue-statuses/:statusId", async (req, res) => {
    const id = req.params.id as string;
    const statusId = req.params.statusId as string;
    const project = await svc.getById(id);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    assertCompanyAccess(req, project.companyId);
    await requireProjectPermission(req, project.companyId, id, "project:edit Workflow");
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
