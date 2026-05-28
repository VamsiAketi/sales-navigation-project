import type { SalesNavGraph, SalesNavInsights } from "@paperclipai/shared";
import { findOptimalRoute, SALES_NAV_CONTACT_LEVELS } from "@paperclipai/shared";

const LEVEL_RANK = {
  warm_intro: 0,
  internal_champion: 1,
  influencer: 2,
  technical_evaluator: 3,
  decision_maker: 4,
  procurement: 5,
} as const;

function emptyInsights(): SalesNavInsights {
  return {
    nextBestAccountId: null,
    nextBestAccountName: null,
    recommendedContactId: null,
    recommendedContactName: null,
    recommendedReason: null,
    strongestWarmPath: null,
    averageRelationshipStrength: 0,
    verifiedConnectionCount: 0,
    warmIntroOpportunityCount: 0,
    highProbabilityDealCount: 0,
    blockerContactIds: [],
    missingGapSummary: null,
    accountRankings: [],
  };
}

export function analyzeSalesNavGraph(graph: SalesNavGraph): SalesNavInsights {
  if (graph.accounts.length === 0) return emptyInsights();

  const accountRankings = graph.accounts
    .map((account) => {
      const contacts = graph.contacts.filter((c) => c.accountId === account.id);
      const warmPaths = contacts.filter((c) => c.level === "warm_intro").length;
      const champions = contacts.filter((c) => c.level === "internal_champion").length;
      const decisionMakers = contacts.filter((c) => c.level === "decision_maker").length;
      const avgStrength =
        contacts.length === 0
          ? 0
          : contacts.reduce((sum, c) => sum + c.relationshipStrength, 0) / contacts.length;
      const engaged = contacts.filter((c) =>
        ["contacted", "meeting_scheduled", "warm_intro_complete"].includes(c.status),
      ).length;
      const score = Math.min(
        100,
        Math.round(
          account.priorityScore * 0.25 +
            account.intentScore * 0.2 +
            avgStrength * 0.25 +
            warmPaths * 8 +
            champions * 10 +
            decisionMakers * 12 +
            engaged * 4,
        ),
      );
      return { accountId: account.id, accountName: account.name, score };
    })
    .sort((a, b) => b.score - a.score);

  const nextAccount = accountRankings[0] ?? null;
  const accountContacts = nextAccount
    ? graph.contacts.filter((c) => c.accountId === nextAccount.accountId)
    : [];

  const actionable = accountContacts
    .filter((c) => !["closed_won", "closed_lost"].includes(c.status))
    .sort((a, b) => {
      const levelDiff = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
      if (levelDiff !== 0) return levelDiff;
      return b.relationshipStrength - a.relationshipStrength;
    });

  const recommended =
    actionable.find((c) => ["unverified", "verified", "contacted"].includes(c.status)) ??
    actionable[0] ??
    null;

  const strongestWarmPath = nextAccount ? findOptimalRoute(graph, nextAccount.accountId) : null;

  const strengths = graph.contacts.map((c) => c.relationshipStrength);
  const averageRelationshipStrength =
    strengths.length === 0 ? 0 : Math.round(strengths.reduce((a, b) => a + b, 0) / strengths.length);

  const verifiedConnectionCount = graph.contacts.filter((c) => c.verified).length;
  const warmIntroOpportunityCount = graph.contacts.filter((c) => c.level === "warm_intro").length;
  const highProbabilityDealCount = accountRankings.filter((a) => a.score >= 70).length;

  const blockerContactIds = graph.contacts
    .filter((c) => {
      const hasPath = graph.edges.some((e) => e.fromContactId === c.id || e.toContactId === c.id);
      return c.level === "decision_maker" && c.relationshipStrength < 45 && !hasPath;
    })
    .map((c) => c.id);

  const missingLevels = SALES_NAV_CONTACT_LEVELS.filter(
    (level) => !graph.contacts.some((c) => c.level === level),
  );
  const missingGapSummary =
    missingLevels.length > 0
      ? `Missing coverage: ${missingLevels.map((l) => l.replace(/_/g, " ")).join(", ")}`
      : null;

  let recommendedReason: string | null = null;
  if (recommended) {
    if (recommended.level === "warm_intro") {
      recommendedReason = "Highest-probability warm entry point on the top-ranked account.";
    } else if (recommended.level === "internal_champion") {
      recommendedReason = "Internal champion can accelerate the climb to the decision maker.";
    } else {
      recommendedReason = "Next logical contact in the buying committee progression.";
    }
  }

  return {
    nextBestAccountId: nextAccount?.accountId ?? null,
    nextBestAccountName: nextAccount?.accountName ?? null,
    recommendedContactId: recommended?.id ?? null,
    recommendedContactName: recommended?.name ?? null,
    recommendedReason,
    strongestWarmPath,
    averageRelationshipStrength,
    verifiedConnectionCount,
    warmIntroOpportunityCount,
    highProbabilityDealCount,
    blockerContactIds,
    missingGapSummary,
    accountRankings,
  };
}
