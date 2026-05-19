import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, sql } from "drizzle-orm";
import { joinRequests } from "@paperclipai/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { accessService } from "../services/access.js";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();
  const svc = sidebarBadgeService(db);
  const access = accessService(db);
  const dashboard = dashboardService(db);

  router.get("/companies/:companyId/sidebar-badges", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    let canApproveJoins = false;
    if (req.actor.type === "board") {
      canApproveJoins =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "joins:approve"));
    } else if (req.actor.type === "agent" && req.actor.agentId) {
      canApproveJoins = await access.hasPermission(companyId, "agent", req.actor.agentId, "joins:approve");
    }

    const joinRequestCount = canApproveJoins
      ? await db
        .select({ count: sql<number>`count(*)` })
        .from(joinRequests)
        .where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.status, "pending_approval")))
        .then((rows) => Number(rows[0]?.count ?? 0))
      : 0;

    const badges = await svc.get(companyId, {
      joinRequests: joinRequestCount,
    });
    let canReadCommandCenter = false;
  let canReadTasks = false;
  let canCreateTasks = false;
  let canCreateProjects = false;
    let canReadHybridOrg = false;
    let canEditHybridOrg = false;
    let canImportHybridOrg = false;
    let canExportHybridOrg = false;
    let canReadSkills = false;
    let canEditSkills = false;
    let canReadGoals = false;
    let canWriteGoals = false;
    let canReadCosts = false;
    let canReadBilling = false;
    let canReadBillingInvoices = false;
    let canManageBillingPayments = false;
    let canReadAttentionQueue = false;
    let canReadTeams = false;
    let canEditTeams = false;
    let canReadAgents = false;
    let canEditAgents = false;
    let canReadAuditLogs = false;
    let canReadCompanySettings = false;
    let canManageCompanySettingsGeneral = false;
    let canManageCompanySettingsAppearance = false;
    let canManageCompanySettingsSecurityAccess = false;
    let canManageCompanySettingsHiring = false;
    let canManageCompanySettingsInvites = false;
    let canManageCompanySettingsSecrets = false;
    let canManageCompanySettingsPackages = false;
    let canReadConnectors = false;
    let canManageConnectors = false;
    let canManageConnectorBindings = false;
    if (req.actor.type === "board") {
      canReadCommandCenter =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "command_center.read"));
      canReadTasks =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "tasks.read"));
      canCreateTasks =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "tasks.create"));
      canCreateProjects =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "projects.create"));
      canReadHybridOrg =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "hybrid_org.read"));
      canEditHybridOrg =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "hybrid_org.edit"));
      canImportHybridOrg =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "hybrid_org.import"));
      canExportHybridOrg =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "hybrid_org.export"));
      canReadSkills =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "skills.read"));
      canEditSkills =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "skills.edit"));
      canReadGoals =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "goals.read"));
      canWriteGoals =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "goals.write"));
      canReadCosts =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "costs.read"));
      canReadBilling =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "billing.read"));
      canReadBillingInvoices =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "billing.invoices.read"));
      canManageBillingPayments =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "billing.payments.manage"));
      canReadAttentionQueue =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "attention_queue.read"));
      canReadTeams =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "teams.read")) ||
        (await access.canUser(companyId, req.actor.userId, "users:manage_permissions")) ||
        (await access.canUser(companyId, req.actor.userId, "users:invite")) ||
        (await access.canUser(companyId, req.actor.userId, "users:reset_password")) ||
        (await access.canUser(companyId, req.actor.userId, "users:deactivate")) ||
        (await access.canUser(companyId, req.actor.userId, "users:delete")) ||
        (await access.canUser(companyId, req.actor.userId, "teams.title_assign")) ||
        (await access.canUser(companyId, req.actor.userId, "teams.title_create")) ||
        (await access.canUser(companyId, req.actor.userId, "teams.title_manage"));
      canEditTeams =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "users:manage_permissions"));
      canReadAgents =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "agents.read")) ||
        (await access.canUser(companyId, req.actor.userId, "agents:create"));
      canEditAgents =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "agents.edit")) ||
        (await access.canUser(companyId, req.actor.userId, "agents:create"));
      canReadAuditLogs =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "audit_logs.read"));
      canReadCompanySettings =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.read"));
      canManageCompanySettingsGeneral =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.general"));
      canManageCompanySettingsAppearance =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.appearance"));
      canManageCompanySettingsSecurityAccess =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.security_access"));
      canManageCompanySettingsHiring =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.hiring"));
      canManageCompanySettingsInvites =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.invites"));
      canManageCompanySettingsSecrets =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.secrets"));
      canManageCompanySettingsPackages =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "company_settings.packages"));
      canReadConnectors =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "connectors.read"));
      canManageConnectors =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "connectors.manage"));
      canManageConnectorBindings =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "connectors.bindings.manage"));
    } else if (req.actor.type === "agent" && req.actor.agentId) {
      canReadCommandCenter = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "command_center.read",
      );
      canReadTasks = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "tasks.read",
      );
      canCreateTasks = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "tasks.create",
      );
      canCreateProjects = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "projects.create",
      );
      canReadHybridOrg = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "hybrid_org.read",
      );
      canEditHybridOrg = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "hybrid_org.edit",
      );
      canImportHybridOrg = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "hybrid_org.import",
      );
      canExportHybridOrg = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "hybrid_org.export",
      );
      canReadSkills = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "skills.read",
      );
      canEditSkills = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "skills.edit",
      );
      canReadGoals = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "goals.read",
      );
      canWriteGoals = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "goals.write",
      );
      canReadCosts = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "costs.read",
      );
      canReadBilling = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "billing.read",
      );
      canReadBillingInvoices = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "billing.invoices.read",
      );
      canManageBillingPayments = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "billing.payments.manage",
      );
      canReadAttentionQueue = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "attention_queue.read",
      );
      canReadTeams = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "teams.read",
      );
      canEditTeams = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "users:manage_permissions",
      );
      canReadAgents =
        (await access.hasPermission(
          companyId,
          "agent",
          req.actor.agentId,
          "agents.read",
        )) ||
        (await access.hasPermission(
          companyId,
          "agent",
          req.actor.agentId,
          "agents:create",
        ));
      canEditAgents =
        (await access.hasPermission(
          companyId,
          "agent",
          req.actor.agentId,
          "agents.edit",
        )) ||
        (await access.hasPermission(
          companyId,
          "agent",
          req.actor.agentId,
          "agents:create",
        ));
      canReadAuditLogs = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "audit_logs.read",
      );
      canReadCompanySettings = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.read",
      );
      canManageCompanySettingsGeneral = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.general",
      );
      canManageCompanySettingsAppearance = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.appearance",
      );
      canManageCompanySettingsSecurityAccess = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.security_access",
      );
      canManageCompanySettingsHiring = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.hiring",
      );
      canManageCompanySettingsInvites = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.invites",
      );
      canManageCompanySettingsSecrets = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.secrets",
      );
      canManageCompanySettingsPackages = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "company_settings.packages",
      );
      canReadConnectors = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "connectors.read",
      );
      canManageConnectors = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "connectors.manage",
      );
      canManageConnectorBindings = await access.hasPermission(
        companyId,
        "agent",
        req.actor.agentId,
        "connectors.bindings.manage",
      );
    }
    const summary = await dashboard.summary(companyId);
    const hasFailedRuns = badges.failedRuns > 0;
    const alertsCount =
      (summary.agents.error > 0 && !hasFailedRuns ? 1 : 0) +
      (summary.costs.monthBudgetCents > 0 && summary.costs.monthUtilizationPercent >= 80 ? 1 : 0);
    badges.inbox = badges.failedRuns + alertsCount + joinRequestCount + badges.approvals;
    badges.canReadCommandCenter = canReadCommandCenter;
    badges.canReadTasks = canReadTasks;
    badges.canCreateTasks = canCreateTasks;
    badges.canCreateProjects = canCreateProjects;
    badges.canReadHybridOrg = canReadHybridOrg;
    badges.canEditHybridOrg = canEditHybridOrg;
    badges.canImportHybridOrg = canImportHybridOrg;
    badges.canExportHybridOrg = canExportHybridOrg;
    badges.canReadSkills = canReadSkills;
    badges.canEditSkills = canEditSkills;
    badges.canReadGoals = canReadGoals;
    badges.canWriteGoals = canWriteGoals;
    badges.canReadCosts = canReadCosts;
    badges.canReadBilling = canReadBilling;
    badges.canReadBillingInvoices = canReadBillingInvoices;
    badges.canManageBillingPayments = canManageBillingPayments;
    badges.canReadAttentionQueue = canReadAttentionQueue;
    badges.canReadTeams = canReadTeams;
    badges.canEditTeams = canEditTeams;
    badges.canReadAgents = canReadAgents;
    badges.canEditAgents = canEditAgents;
    badges.canReadAuditLogs = canReadAuditLogs;
    badges.canReadCompanySettings = canReadCompanySettings;
    badges.canManageCompanySettingsGeneral = canManageCompanySettingsGeneral;
    badges.canManageCompanySettingsAppearance = canManageCompanySettingsAppearance;
    badges.canManageCompanySettingsSecurityAccess = canManageCompanySettingsSecurityAccess;
    badges.canManageCompanySettingsHiring = canManageCompanySettingsHiring;
    badges.canManageCompanySettingsInvites = canManageCompanySettingsInvites;
    badges.canManageCompanySettingsSecrets = canManageCompanySettingsSecrets;
    badges.canManageCompanySettingsPackages = canManageCompanySettingsPackages;
    badges.canReadConnectors = canReadConnectors;
    badges.canManageConnectors = canManageConnectors;
    badges.canManageConnectorBindings = canManageConnectorBindings;

    res.json(badges);
  });

  return router;
}
