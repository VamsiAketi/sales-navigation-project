import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  rotateProjectSecretSchema,
  updateProjectSecretSchema,
  type ProjectPermissionKey,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo, projectAuthActorFromRequest } from "./authz.js";
import { accessService, logActivity, projectSecretService } from "../services/index.js";
import { forbidden } from "../errors.js";

export function projectSecretMutationsRoutes(db: Db) {
  const router = Router();
  const svc = projectSecretService(db);
  const access = accessService(db);

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

  router.post("/project-secrets/:secretId/rotate", validate(rotateProjectSecretSchema), async (req, res) => {
    const secretId = req.params.secretId as string;
    const existing = await svc.getById(secretId);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, existing.projectId, "project:edit configuration");

    const rotated = await svc.rotate(
      secretId,
      {
        value: req.body.value,
        externalRef: req.body.externalRef,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: rotated.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project_secret.rotated",
      entityType: "project_secret",
      entityId: rotated.id,
      details: { version: rotated.latestVersion, projectId: rotated.projectId },
    });

    res.json(rotated);
  });

  router.patch("/project-secrets/:secretId", validate(updateProjectSecretSchema), async (req, res) => {
    const secretId = req.params.secretId as string;
    const existing = await svc.getById(secretId);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, existing.projectId, "project:edit configuration");

    const updated = await svc.update(secretId, {
      name: req.body.name,
      description: req.body.description,
      externalRef: req.body.externalRef,
    });

    if (!updated) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: updated.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project_secret.updated",
      entityType: "project_secret",
      entityId: updated.id,
      details: { name: updated.name, projectId: updated.projectId },
    });

    res.json(updated);
  });

  router.delete("/project-secrets/:secretId", async (req, res) => {
    const secretId = req.params.secretId as string;
    const existing = await svc.getById(secretId);
    if (!existing) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await requireProjectPermission(req, existing.companyId, existing.projectId, "project:edit configuration");

    const removed = await svc.remove(secretId);
    if (!removed) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: removed.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project_secret.deleted",
      entityType: "project_secret",
      entityId: removed.id,
      details: { name: removed.name, projectId: removed.projectId },
    });

    res.json({ ok: true });
  });

  return router;
}
