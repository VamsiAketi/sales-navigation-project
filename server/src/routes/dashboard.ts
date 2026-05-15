import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import { accessService } from "../services/access.js";
import { forbidden, unauthorized } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);
  const access = accessService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden();
      const allowed = await access.hasPermission(companyId, "agent", req.actor.agentId, "command_center.read");
      if (!allowed) throw forbidden("Missing permission: command_center.read");
    } else if (req.actor.type === "board") {
      if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
        const allowed = await access.canUser(companyId, req.actor.userId, "command_center.read");
        if (!allowed) throw forbidden("Missing permission: command_center.read");
      }
    } else {
      throw unauthorized();
    }
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  return router;
}
