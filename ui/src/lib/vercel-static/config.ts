import type { Company } from "@paperclipai/shared";
import type { SidebarBadges } from "@paperclipai/shared";

export const isVercelStaticMode = import.meta.env.VITE_VERCEL_STATIC === "true";

export const VERCEL_DEFAULT_COMPANY_ID = "vercel-local-company";

export const VERCEL_DEFAULT_COMPANY: Company = {
  id: VERCEL_DEFAULT_COMPANY_ID,
  name: "Sales Navigation",
  description: null,
  status: "active",
  pauseReason: null,
  pausedAt: null,
  issuePrefix: "SN",
  issueCounter: 0,
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  requireBoardApprovalForNewAgents: false,
  feedbackDataSharingEnabled: false,
  feedbackDataSharingConsentAt: null,
  feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null,
  brandColor: null,
  logoAssetId: null,
  logoUrl: null,
  projectAccessMode: "open",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const VERCEL_STATIC_SIDEBAR_BADGES: SidebarBadges = {
  inbox: 0,
  approvals: 0,
  failedRuns: 0,
  joinRequests: 0,
  canReadGoals: true,
  canWriteGoals: true,
};
