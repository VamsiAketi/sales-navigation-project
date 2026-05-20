export interface SidebarBadges {
  /**
   * Server-combined signal (approvals + join requests + failed runs + dashboard alert flags).
   * Does not include per-user unread touched tasks or client-dismissed inbox rows.
   * The Attention Queue sidebar badge uses the client `computeInboxBadgeData` total instead.
   */
  inbox: number;
  approvals: number;
  failedRuns: number;
  joinRequests: number;
  canReadCommandCenter?: boolean;
  canReadTasks?: boolean;
  canCreateTasks?: boolean;
  canCreateProjects?: boolean;
  canReadHybridOrg?: boolean;
  canEditHybridOrg?: boolean;
  canImportHybridOrg?: boolean;
  canExportHybridOrg?: boolean;
  canReadSkills?: boolean;
  canEditSkills?: boolean;
  canReadGoals?: boolean;
  canWriteGoals?: boolean;
  canReadCosts?: boolean;
  canReadBilling?: boolean;
  canReadBillingInvoices?: boolean;
  canManageBillingPayments?: boolean;
  canReadAttentionQueue?: boolean;
  canReadTeams?: boolean;
  canEditTeams?: boolean;
  canReadAgents?: boolean;
  canEditAgents?: boolean;
  canReadAuditLogs?: boolean;
  canReadCompanySettings?: boolean;
  canManageCompanySettingsGeneral?: boolean;
  canManageCompanySettingsAppearance?: boolean;
  canManageCompanySettingsSecurityAccess?: boolean;
  canManageCompanySettingsHiring?: boolean;
  canManageCompanySettingsInvites?: boolean;
  canManageCompanySettingsSecrets?: boolean;
  canManageCompanySettingsPackages?: boolean;
  canReadConnectors?: boolean;
  canManageConnectors?: boolean;
  canManageConnectorBindings?: boolean;
}
