import type { PermissionKey, SidebarBadges } from "@paperclipai/shared";

export type SidebarAccessFlags = Pick<
  SidebarBadges,
  | "canReadCommandCenter"
  | "canReadTasks"
  | "canCreateTasks"
  | "canCreateProjects"
  | "canReadHybridOrg"
  | "canEditHybridOrg"
  | "canImportHybridOrg"
  | "canExportHybridOrg"
  | "canReadSkills"
  | "canEditSkills"
  | "canReadGoals"
  | "canWriteGoals"
  | "canReadCosts"
  | "canReadBilling"
  | "canReadBillingInvoices"
  | "canManageBillingPayments"
  | "canReadAttentionQueue"
  | "canReadTeams"
  | "canEditTeams"
  | "canReadAgents"
  | "canEditAgents"
  | "canReadAuditLogs"
  | "canReadCompanySettings"
  | "canManageCompanySettingsGeneral"
  | "canManageCompanySettingsAppearance"
  | "canManageCompanySettingsSecurityAccess"
  | "canManageCompanySettingsHiring"
  | "canManageCompanySettingsInvites"
  | "canManageCompanySettingsSecrets"
  | "canManageCompanySettingsPackages"
  | "canReadConnectors"
  | "canManageConnectors"
  | "canManageConnectorBindings"
>;

function canReadTeams(
  has: (permission: PermissionKey) => boolean,
  principalKind: "board" | "agent",
): boolean {
  if (principalKind === "agent") {
    return has("teams.read");
  }
  return (
    has("teams.read") ||
    has("users:manage_permissions") ||
    has("users:invite") ||
    has("users:reset_password") ||
    has("users:deactivate") ||
    has("users:delete") ||
    has("teams.title_assign") ||
    has("teams.title_create") ||
    has("teams.title_manage")
  );
}

/** Map a batched permission checker to sidebar nav access flags. */
export function buildSidebarAccessFlags(
  has: (permission: PermissionKey) => boolean,
  principalKind: "board" | "agent" = "board",
): SidebarAccessFlags {
  return {
    canReadCommandCenter: has("command_center.read"),
    canReadTasks: has("tasks.read"),
    canCreateTasks: has("tasks.create"),
    canCreateProjects: has("projects.create"),
    canReadHybridOrg: has("hybrid_org.read"),
    canEditHybridOrg: has("hybrid_org.edit"),
    canImportHybridOrg: has("hybrid_org.import"),
    canExportHybridOrg: has("hybrid_org.export"),
    canReadSkills: has("skills.read"),
    canEditSkills: has("skills.edit"),
    canReadGoals: has("goals.read"),
    canWriteGoals: has("goals.write"),
    canReadCosts: has("costs.read"),
    canReadBilling: has("billing.read"),
    canReadBillingInvoices: has("billing.invoices.read"),
    canManageBillingPayments: has("billing.payments.manage"),
    canReadAttentionQueue: has("attention_queue.read"),
    canReadTeams: canReadTeams(has, principalKind),
    canEditTeams: has("users:manage_permissions"),
    canReadAgents: has("agents.read") || has("agents:create"),
    canEditAgents: has("agents.edit") || has("agents:create"),
    canReadAuditLogs: has("audit_logs.read"),
    canReadCompanySettings: has("company_settings.read"),
    canManageCompanySettingsGeneral: has("company_settings.general"),
    canManageCompanySettingsAppearance: has("company_settings.appearance"),
    canManageCompanySettingsSecurityAccess: has("company_settings.security_access"),
    canManageCompanySettingsHiring: has("company_settings.hiring"),
    canManageCompanySettingsInvites: has("company_settings.invites"),
    canManageCompanySettingsSecrets: has("company_settings.secrets"),
    canManageCompanySettingsPackages: has("company_settings.packages"),
    canReadConnectors: has("connectors.read"),
    canManageConnectors: has("connectors.manage"),
    canManageConnectorBindings: has("connectors.bindings.manage"),
  };
}
