/** Buying-committee level used for battle-map columns (root accounts are separate). */
export const SALES_NAV_CONTACT_LEVELS = [
  "warm_intro",
  "internal_champion",
  "influencer",
  "technical_evaluator",
  "decision_maker",
  "procurement",
] as const;

export type SalesNavContactLevel = (typeof SALES_NAV_CONTACT_LEVELS)[number];

export const SALES_NAV_CONTACT_STATUSES = [
  "not_contacted",
  "unverified",
  "verified",
  "connected",
  "outreach_sent",
  "contacted",
  "meeting_scheduled",
  "warm_intro_complete",
  "in_progress",
  "in_discussion",
  "converted",
  "closed_won",
  "closed_lost",
] as const;

export type SalesNavContactStatus = (typeof SALES_NAV_CONTACT_STATUSES)[number];

export const SALES_NAV_EDGE_TYPES = ["strong", "medium", "weak", "indirect", "blocked"] as const;
export type SalesNavEdgeType = (typeof SALES_NAV_EDGE_TYPES)[number];

export type SalesNavAccount = {
  id: string;
  name: string;
  priorityScore: number;
  intentScore: number;
  ownerLabel: string | null;
  notes: string | null;
};

export type SalesNavContact = {
  id: string;
  accountId: string;
  name: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string | null;
  level: SalesNavContactLevel;
  status: SalesNavContactStatus;
  relationshipStrength: number;
  verified: boolean;
  outreachNotes: string | null;
  warmIntroPath: string | null;
  reportsToContactId: string | null;
  teamOwner: string | null;
};

export type SalesNavEdge = {
  id: string;
  fromContactId: string;
  toContactId: string;
  type: SalesNavEdgeType;
  strength: number;
  label: string | null;
};

export type SalesNavOutreachEvent = {
  id: string;
  contactId: string;
  at: string;
  summary: string;
};

export type SalesNavGraph = {
  accounts: SalesNavAccount[];
  contacts: SalesNavContact[];
  edges: SalesNavEdge[];
  outreachHistory: SalesNavOutreachEvent[];
};

export type SalesNavPathStep = {
  contactId: string;
  contactName: string;
  level: SalesNavContactLevel;
  strength: number;
};

export type SalesNavWarmPath = {
  accountId: string;
  accountName: string;
  targetContactId: string;
  targetContactName: string;
  steps: SalesNavPathStep[];
  /** @deprecated Prefer routeScore — kept for older persisted insights payloads. */
  totalStrength: number;
  /** 0–100 climb quality (bottleneck hops + engagement). */
  routeScore?: number;
  /** Human-readable explanation of why this route was chosen. */
  summary?: string;
};

export type SalesNavInsights = {
  nextBestAccountId: string | null;
  nextBestAccountName: string | null;
  recommendedContactId: string | null;
  recommendedContactName: string | null;
  recommendedReason: string | null;
  strongestWarmPath: SalesNavWarmPath | null;
  averageRelationshipStrength: number;
  verifiedConnectionCount: number;
  warmIntroOpportunityCount: number;
  highProbabilityDealCount: number;
  blockerContactIds: string[];
  missingGapSummary: string | null;
  accountRankings: Array<{ accountId: string; accountName: string; score: number }>;
};

export type SalesNavState = {
  companyId: string;
  sourceFileName: string | null;
  importedAt: string | null;
  graph: SalesNavGraph;
  insights: SalesNavInsights;
  updatedAt: string;
};

export const SALES_NAV_LEVEL_LABELS: Record<SalesNavContactLevel, string> = {
  warm_intro: "Warm Introductions",
  internal_champion: "1st Level Connection",
  influencer: "Influencers",
  technical_evaluator: "Technical Evaluators",
  decision_maker: "Decision Makers",
  procurement: "Procurement / Budget",
};

export const SALES_NAV_STATUS_LABELS: Record<SalesNavContactStatus, string> = {
  not_contacted: "Not Contacted",
  unverified: "Unverified",
  verified: "Verified",
  connected: "Connected",
  outreach_sent: "Outreach Sent",
  contacted: "Contacted",
  meeting_scheduled: "Meeting Scheduled",
  warm_intro_complete: "Warm Intro Complete",
  in_progress: "In Progress",
  in_discussion: "In Discussion",
  converted: "Converted",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};
