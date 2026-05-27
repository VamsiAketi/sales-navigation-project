import {
  type SalesNavContact,
  type SalesNavContactLevel,
  type SalesNavEdge,
  type SalesNavGraph,
} from "@paperclipai/shared";

export type GraphNodeLayout = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contact: SalesNavContact;
  level: SalesNavContactLevel;
};

export type GraphEdgeLayout = {
  edge: SalesNavEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  onPath: boolean;
};

const NODE_W = 200;
const NODE_H = 104;
const H_PAD = 24;
const V_PAD = 20;
const STAGE_GAP = 34;
const NODE_GAP_X = 24;
const HEADER_H = 24;
const TOP_ACCOUNT_H = 0;

type ClimbStage = "target_buyer" | "influencers" | "mutual_routes" | "start";

const STAGE_LABELS: Record<ClimbStage, string> = {
  target_buyer: "Target buyer (top)",
  influencers: "Influencers",
  mutual_routes: "Mutual routes",
  start: "Start (bottom)",
};

function stageForLevel(level: SalesNavContactLevel): ClimbStage {
  if (level === "decision_maker" || level === "procurement") return "target_buyer";
  if (level === "influencer" || level === "technical_evaluator") return "influencers";
  if (level === "internal_champion") return "mutual_routes";
  return "start";
}

function sortForClimbRow(contacts: SalesNavContact[]): SalesNavContact[] {
  return [...contacts].sort((a, b) => b.relationshipStrength - a.relationshipStrength || a.name.localeCompare(b.name));
}

export function layoutRelationshipGraph(
  graph: SalesNavGraph,
  accountId: string,
  pathContactIds: Set<string>,
): {
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
  width: number;
  height: number;
  stageLabels: Array<{ stage: ClimbStage; y: number; label: string }>;
} {
  const contacts = graph.contacts.filter((c) => c.accountId === accountId);
  const byStage = new Map<ClimbStage, SalesNavContact[]>([
    ["target_buyer", []],
    ["influencers", []],
    ["mutual_routes", []],
    ["start", []],
  ]);
  for (const contact of contacts) {
    byStage.get(stageForLevel(contact.level))?.push(contact);
  }

  const stageOrder: ClimbStage[] = ["target_buyer", "influencers", "mutual_routes", "start"];
  const maxAcrossStage = Math.max(1, ...stageOrder.map((stage) => (byStage.get(stage) ?? []).length));
  const width = H_PAD * 2 + maxAcrossStage * NODE_W + Math.max(0, maxAcrossStage - 1) * NODE_GAP_X;

  const totalRows = stageOrder.length;
  const stageHeight = NODE_H;
  const gridHeight = totalRows * stageHeight + (totalRows - 1) * STAGE_GAP;
  const height = HEADER_H + V_PAD + gridHeight + V_PAD;

  const nodes: GraphNodeLayout[] = [];
  const stageLabels: Array<{ stage: ClimbStage; y: number; label: string }> = [];
  const contactIds = new Set(contacts.map((c) => c.id));

  stageOrder.forEach((stage, rowIndex) => {
    const y = HEADER_H + V_PAD + rowIndex * (stageHeight + STAGE_GAP);
    stageLabels.push({ stage, y: y + stageHeight / 2, label: STAGE_LABELS[stage] });
    const rowContacts = sortForClimbRow(byStage.get(stage) ?? []);
    const rowWidth = rowContacts.length * NODE_W + Math.max(0, rowContacts.length - 1) * NODE_GAP_X;
    const startX = H_PAD + Math.max(0, (width - H_PAD * 2 - rowWidth) / 2);
    rowContacts.forEach((contact, colIndex) => {
      nodes.push({
        id: contact.id,
        x: startX + colIndex * (NODE_W + NODE_GAP_X),
        y,
        width: NODE_W,
        height: NODE_H,
        contact,
        level: contact.level,
      });
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdgeLayout[] = [];

  for (const edge of graph.edges) {
    if (!contactIds.has(edge.fromContactId) || !contactIds.has(edge.toContactId)) continue;
    const from = nodeById.get(edge.fromContactId);
    const to = nodeById.get(edge.toContactId);
    if (!from || !to) continue;
    edges.push({
      edge,
      x1: from.x + from.width / 2,
      y1: from.y + from.height / 2,
      x2: to.x + to.width / 2,
      y2: to.y + to.height / 2,
      onPath: pathContactIds.has(edge.fromContactId) && pathContactIds.has(edge.toContactId),
    });
  }

  for (const contact of contacts) {
    if (!contact.reportsToContactId || !contactIds.has(contact.reportsToContactId)) continue;
    const from = nodeById.get(contact.id);
    const to = nodeById.get(contact.reportsToContactId);
    if (!from || !to) continue;
    const exists = edges.some(
      (e) =>
        (e.edge.fromContactId === contact.id && e.edge.toContactId === contact.reportsToContactId) ||
        (e.edge.fromContactId === contact.reportsToContactId && e.edge.toContactId === contact.id),
    );
    if (exists) continue;
    edges.push({
      edge: {
        id: `hier-${contact.id}`,
        fromContactId: contact.id,
        toContactId: contact.reportsToContactId,
        type: "medium",
        strength: contact.relationshipStrength,
        label: "Reports to",
      },
      x1: from.x + from.width / 2,
      y1: from.y + from.height / 2,
      x2: to.x + to.width / 2,
      y2: to.y + to.height / 2,
      onPath: pathContactIds.has(contact.id) && pathContactIds.has(contact.reportsToContactId),
    });
  }

  return { nodes, edges, width, height, stageLabels };
}

export { NODE_W, NODE_H, TOP_ACCOUNT_H };
