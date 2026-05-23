import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, sql } from "drizzle-orm";
import { joinRequests } from "@paperclipai/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { accessService } from "../services/access.js";
import { dashboardService } from "../services/dashboard.js";
import { buildSidebarAccessFlags } from "../lib/sidebar-access-flags.js";
import { assertCompanyAccess } from "./authz.js";

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();
  const svc = sidebarBadgeService(db);
  const access = accessService(db);
  const dashboard = dashboardService(db);

  router.get("/companies/:companyId/sidebar-badges", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const permissionPrincipal =
      req.actor.type === "board" &&
      (req.actor.source === "local_implicit" || Boolean(req.actor.isInstanceAdmin))
        ? ({ kind: "full_access" } as const)
        : req.actor.type === "board" && req.actor.userId
          ? ({ kind: "user", userId: req.actor.userId } as const)
          : req.actor.type === "agent" && req.actor.agentId
            ? ({ kind: "agent", agentId: req.actor.agentId } as const)
            : null;

    const [hasPermission, alertSignals] = await Promise.all([
      permissionPrincipal
        ? access.resolveCompanyPermissions(companyId, permissionPrincipal)
        : Promise.resolve(() => false),
      dashboard.alertSignals(companyId),
    ]);

    const canApproveJoins = hasPermission("joins:approve");

    const [joinRequestCount, badges] = await Promise.all([
      canApproveJoins
        ? db
          .select({ count: sql<number>`count(*)` })
          .from(joinRequests)
          .where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.status, "pending_approval")))
          .then((rows) => Number(rows[0]?.count ?? 0))
        : Promise.resolve(0),
      svc.get(companyId, {
        joinRequests: 0,
      }),
    ]);

    const hasFailedRuns = badges.failedRuns > 0;
    const alertsCount =
      (alertSignals.agentsInError > 0 && !hasFailedRuns ? 1 : 0) +
      (alertSignals.monthBudgetCents > 0 && alertSignals.monthUtilizationPercent >= 80 ? 1 : 0);

    const accessPrincipalKind: "board" | "agent" =
      permissionPrincipal?.kind === "agent" ? "agent" : "board";

    res.json({
      ...badges,
      joinRequests: joinRequestCount,
      inbox: badges.failedRuns + alertsCount + joinRequestCount + badges.approvals,
      ...buildSidebarAccessFlags(hasPermission, accessPrincipalKind),
    });
  });

  return router;
}
