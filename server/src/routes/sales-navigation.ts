import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { importSalesNavSchema, updateSalesNavContactSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, logActivity, salesNavigationService } from "../services/index.js";
import { resolveLinkedInAvatar } from "../services/linkedin-avatar.js";
import { forbidden, badRequest } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { isAllowedLinkedInProfileUrl } from "../lib/linkedin-profile.js";

export function salesNavigationRoutes(db: Db) {
  const router = Router();
  const svc = salesNavigationService(db);
  const access = accessService(db);

  async function assertSalesNavPermission(
    req: Request,
    companyId: string,
    permissionKey: "goals.read" | "goals.write",
  ) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId, permissionKey);
      if (!allowed) throw forbidden(`Missing permission: ${permissionKey}`);
      return;
    }
    if (!req.actor.agentId) throw forbidden("Agent authentication required");
    const allowed = await access.hasPermission(companyId, "agent", req.actor.agentId, permissionKey);
    if (!allowed) throw forbidden(`Missing permission: ${permissionKey}`);
  }

  router.get("/companies/:companyId/sales-navigation", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertSalesNavPermission(req, companyId, "goals.read");
    const state = await svc.get(companyId);
    res.json(state);
  });

  router.get("/companies/:companyId/sales-navigation/linkedin-avatar", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertSalesNavPermission(req, companyId, "goals.read");
    const profileUrl = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!profileUrl || !isAllowedLinkedInProfileUrl(profileUrl)) {
      throw badRequest("A valid linkedin.com/in/… profile URL is required");
    }
    const avatar = await resolveLinkedInAvatar(profileUrl);
    if (!avatar) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", avatar.contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(avatar.body);
  });

  router.post(
    "/companies/:companyId/sales-navigation/import",
    validate(importSalesNavSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertSalesNavPermission(req, companyId, "goals.write");
      const { sourceFileName, graph } = req.body;
      const state = await svc.importGraph(companyId, sourceFileName, graph);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "sales_navigation.imported",
        entityType: "company",
        entityId: companyId,
        details: { sourceFileName, contactCount: graph.contacts.length, accountCount: graph.accounts.length },
      });
      res.json(state);
    },
  );

  router.delete("/companies/:companyId/sales-navigation", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertSalesNavPermission(req, companyId, "goals.write");
    const state = await svc.clear(companyId);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "sales_navigation.cleared",
      entityType: "company",
      entityId: companyId,
      details: {},
    });
    res.json(state);
  });

  router.patch(
    "/companies/:companyId/sales-navigation/contacts/:contactId",
    validate(updateSalesNavContactSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const contactId = req.params.contactId as string;
      await assertSalesNavPermission(req, companyId, "goals.write");
      const state = await svc.updateContact(companyId, contactId, req.body);
      res.json(state);
    },
  );

  return router;
}
