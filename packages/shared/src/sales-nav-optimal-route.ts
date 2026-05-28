import type {
  SalesNavContact,
  SalesNavContactLevel,
  SalesNavContactStatus,
  SalesNavGraph,
  SalesNavWarmPath,
} from "./types/sales-navigation.js";

const LEVEL_RANK: Record<SalesNavContactLevel, number> = {
  warm_intro: 0,
  internal_champion: 1,
  influencer: 2,
  technical_evaluator: 2,
  decision_maker: 3,
  procurement: 3,
};

const STATUS_ROUTE_MULT: Partial<Record<SalesNavContactStatus, number>> = {
  not_contacted: 1,
  unverified: 0.92,
  verified: 1.02,
  connected: 1.06,
  outreach_sent: 1.04,
  contacted: 1.08,
  meeting_scheduled: 1.12,
  warm_intro_complete: 1.1,
  in_progress: 1.05,
  in_discussion: 1.1,
  converted: 1.15,
  closed_won: 1.2,
  closed_lost: 0,
};

type Hop = { to: string; strength: number; edgeId: string };

function statusMult(status: SalesNavContactStatus): number {
  return STATUS_ROUTE_MULT[status] ?? 1;
}

function effectiveEdgeStrength(
  edgeStrength: number,
  to: SalesNavContact,
  edgeType: string,
): number {
  if (edgeType === "blocked") return 0;
  if (to.status === "closed_lost") return 0;
  return edgeStrength * statusMult(to.status);
}

function buildForwardHops(graph: SalesNavGraph, contacts: SalesNavContact[]): Map<string, Hop[]> {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const hops = new Map<string, Hop[]>();

  const addHop = (fromId: string, hop: Hop) => {
    const list = hops.get(fromId) ?? [];
    if (!list.some((h) => h.to === hop.to)) list.push(hop);
    hops.set(fromId, list);
  };

  for (const edge of graph.edges) {
    const from = byId.get(edge.fromContactId);
    const to = byId.get(edge.toContactId);
    if (!from || !to) continue;
    if (LEVEL_RANK[to.level] < LEVEL_RANK[from.level]) continue;
    addHop(from.id, { to: to.id, strength: edge.strength, edgeId: edge.id });
  }

  for (const contact of contacts) {
    if (!contact.reportsToContactId) continue;
    const manager = byId.get(contact.reportsToContactId);
    if (!manager) continue;
    if (LEVEL_RANK[manager.level] < LEVEL_RANK[contact.level]) continue;
    addHop(contact.id, {
      to: manager.id,
      strength: Math.max(40, Math.round(contact.relationshipStrength * 0.65)),
      edgeId: `hier-${contact.id}`,
    });
  }

  return hops;
}

function scoreRoute(pathIds: string[], contacts: SalesNavContact[], hops: Map<string, Hop[]>): number {
  if (pathIds.length < 2) {
    const only = contacts.find((c) => c.id === pathIds[0]);
    return only ? only.relationshipStrength : 0;
  }

  const edgeStrengths: number[] = [];
  for (let i = 0; i < pathIds.length - 1; i++) {
    const fromId = pathIds[i]!;
    const toId = pathIds[i + 1]!;
    const to = contacts.find((c) => c.id === toId);
    if (!to) continue;
    const hop = (hops.get(fromId) ?? []).find((h) => h.to === toId);
    const raw = hop?.strength ?? Math.min(
      contacts.find((c) => c.id === fromId)?.relationshipStrength ?? 50,
      to.relationshipStrength,
    );
    edgeStrengths.push(effectiveEdgeStrength(raw, to, "strong"));
  }

  if (edgeStrengths.length === 0 || edgeStrengths.some((s) => s <= 0)) return 0;
  const bottleneck = Math.min(...edgeStrengths);
  const average = edgeStrengths.reduce((a, b) => a + b, 0) / edgeStrengths.length;
  const levelBonus = (pathIds.length - 1) * 4;
  return Math.round(Math.min(100, bottleneck * 0.55 + average * 0.35 + levelBonus));
}

function buildSummary(path: SalesNavWarmPath, routeScore: number): string {
  if (path.steps.length < 2) {
    return `Direct focus on ${path.targetContactName} (route strength ${routeScore}/100).`;
  }
  const via = path.steps
    .slice(0, -1)
    .map((s) => s.contactName)
    .join(" → ");
  return `Climb from ${via} to reach ${path.targetContactName}. Weakest hop scores ${routeScore}/100 — strengthen that link first.`;
}

function dijkstraPath(
  startId: string,
  targetId: string,
  hops: Map<string, Hop[]>,
  contacts: SalesNavContact[],
): string[] | null {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const queue: string[] = [startId];
  dist.set(startId, 0);
  prev.set(startId, null);

  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const current = queue.shift()!;
    if (current === targetId) break;

    for (const hop of hops.get(current) ?? []) {
      const to = byId.get(hop.to);
      if (!to) continue;
      const eff = effectiveEdgeStrength(hop.strength, to, "strong");
      if (eff <= 0) continue;
      const stepCost = 100 - eff;
      const nextCost = (dist.get(current) ?? 0) + stepCost;
      if (nextCost < (dist.get(hop.to) ?? Infinity)) {
        dist.set(hop.to, nextCost);
        prev.set(hop.to, current);
        if (!queue.includes(hop.to)) queue.push(hop.to);
      }
    }
  }

  if (!prev.has(targetId)) return null;
  const path: string[] = [];
  let cursor: string | null = targetId;
  while (cursor) {
    path.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  return path.length >= 2 ? path : null;
}

function resolveTarget(contacts: SalesNavContact[], targetContactId?: string | null): SalesNavContact | null {
  if (targetContactId) {
    return contacts.find((c) => c.id === targetContactId) ?? null;
  }
  return (
    contacts
      .filter((c) => c.level === "decision_maker" || c.level === "procurement")
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength)[0] ?? null
  );
}

/** Suggest the highest-scoring climb path from internal connectors to the target buyer. */
export function findOptimalRoute(
  graph: SalesNavGraph,
  accountId: string,
  targetContactId?: string | null,
): SalesNavWarmPath | null {
  const account = graph.accounts.find((a) => a.id === accountId);
  if (!account) return null;

  const contacts = graph.contacts.filter((c) => c.accountId === accountId);
  const target = resolveTarget(contacts, targetContactId);
  if (!target) return null;

  const starts = contacts.filter((c) => c.level === "warm_intro");
  if (starts.length === 0) return null;

  const hops = buildForwardHops(graph, contacts);
  let bestPath: string[] | null = null;
  let bestScore = -1;

  for (const start of starts) {
    const path = dijkstraPath(start.id, target.id, hops, contacts);
    if (!path) continue;
    const routeScore = scoreRoute(path, contacts, hops);
    if (routeScore > bestScore) {
      bestScore = routeScore;
      bestPath = path;
    }
  }

  if (!bestPath) return null;

  const steps = bestPath.map((id) => {
    const contact = contacts.find((c) => c.id === id)!;
    return {
      contactId: contact.id,
      contactName: contact.name,
      level: contact.level,
      strength: contact.relationshipStrength,
    };
  });

  const routeScore = scoreRoute(bestPath, contacts, hops);
  const warmPath: SalesNavWarmPath = {
    accountId,
    accountName: account.name,
    targetContactId: target.id,
    targetContactName: target.name,
    steps,
    totalStrength: routeScore,
    routeScore,
    summary: "",
  };
  warmPath.summary = buildSummary(warmPath, routeScore);
  return warmPath;
}

export function listRouteTargets(graph: SalesNavGraph, accountId: string): SalesNavContact[] {
  return graph.contacts
    .filter((c) => c.accountId === accountId && (c.level === "decision_maker" || c.level === "procurement"))
    .sort((a, b) => b.relationshipStrength - a.relationshipStrength);
}
