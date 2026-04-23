export interface SidebarBadges {
  inbox: number;
  approvals: number;
  failedRuns: number;
  joinRequests: number;
  canReadCommandCenter?: boolean;
  canReadHybridOrg?: boolean;
  canEditHybridOrg?: boolean;
  canImportHybridOrg?: boolean;
  canExportHybridOrg?: boolean;
  canReadSkills?: boolean;
  canEditSkills?: boolean;
  canReadGoals?: boolean;
  canWriteGoals?: boolean;
  canReadCosts?: boolean;
  canReadAttentionQueue?: boolean;
  canReadTeams?: boolean;
  canEditTeams?: boolean;
  canReadAgents?: boolean;
  canEditAgents?: boolean;
}
