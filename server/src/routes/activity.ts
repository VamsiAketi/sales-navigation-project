import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { isIssueIdentifierLike } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { activityService } from "../services/activity.js";
import { accessService } from "../services/access.js";
import { forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess, projectAuthActorFromRequest } from "./authz.js";
import { issueService } from "../services/index.js";
import { sanitizeRecord } from "../redaction.js";

const createActivitySchema = z.object({
  actorType: z.enum(["agent", "user", "system"]).optional().default("system"),
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  agentId: z.string().uuid().optional().nullable(),
  details: z.record(z.unknown()).optional().nullable(),
});

export function activityRoutes(db: Db) {
  const router = Router();
  const svc = activityService(db);
  const issueSvc = issueService(db);
  const access = accessService(db);

  async function resolveIssueByRef(rawId: string) {
    if (isIssueIdentifierLike(rawId)) {
      return issueSvc.getByIdentifier(rawId);
    }
    return issueSvc.getById(rawId);
  }

  router.get("/companies/:companyId/activity", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
        const allowed = await access.canUser(companyId, req.actor.userId, "audit_logs.read");
        if (!allowed) throw forbidden("Missing permission: audit_logs.read");
      }
    } else if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");
      const allowed = await access.hasPermission(companyId, "agent", req.actor.agentId, "audit_logs.read");
      if (!allowed) throw forbidden("Missing permission: audit_logs.read");
    }

    const filters = {
      companyId,
      agentId: req.query.agentId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      visibleProjectIds: await access.listProjectIdsVisibleToActor(
        companyId,
        projectAuthActorFromRequest(req),
      ),
    };
    const result = await svc.list(filters);
    res.json(result);
  });

  router.post("/companies/:companyId/activity", validate(createActivitySchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    const event = await svc.create({
      companyId,
      ...req.body,
      details: req.body.details ? sanitizeRecord(req.body.details) : null,
    });
    res.status(201).json(event);
  });

  router.get("/issues/:id/activity", async (req, res) => {
    const rawId = req.params.id as string;
    const issue = await resolveIssueByRef(rawId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const result = await svc.forIssue(issue.id);
    res.json(result);
  });

  router.get("/issues/:id/runs", async (req, res) => {
    const rawId = req.params.id as string;
    const issue = await resolveIssueByRef(rawId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const result = await svc.runsForIssue(issue.companyId, issue.id);
    res.json(result);
  });

  router.get("/heartbeat-runs/:runId/issues", async (req, res) => {
    const runId = req.params.runId as string;
    const result = await svc.issuesForRun(runId);
    res.json(result);
  });

  return router;
}
