/**
 * Optional demo seed for a defense-industrial supply chain company (sub-tier / specialty metals / compliance).
 *
 * Run against the same database your Paperclip instance uses:
 *
 *   export DATABASE_URL='postgres://…'
 *   pnpm db:seed
 *
 * With embedded PostgreSQL (default dev), start the app once and use the logged port, e.g.
 * `postgres://paperclip:paperclip@127.0.0.1:<port>/paperclip`.
 *
 * Safe to run once: if the demo company issue prefix already exists, the script exits without inserting.
 */
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import {
  companies,
  agents,
  goals,
  projects,
  issues,
  projectGoals,
  projectIssueStatuses,
} from "./schema/index.js";
import {
  DEFAULT_PROJECT_ISSUE_STATUSES,
  isBoardPinnedHiddenProjectIssueStatusValue,
} from "@paperclipai/shared";

const DEMO_COMPANY_ISSUE_PREFIX = "SDSUP";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (use the connection string for your Paperclip database).");
  process.exit(1);
}

const db = createDb(url);

async function seedProjectIssueStatuses(projectId: string, companyId: string) {
  const values = DEFAULT_PROJECT_ISSUE_STATUSES.map((s) => ({
    projectId,
    companyId,
    name: s.name,
    value: s.value,
    color: s.color,
    position: s.position,
    isActive: !isBoardPinnedHiddenProjectIssueStatusValue(s.value),
  }));
  await db.insert(projectIssueStatuses).values(values);
}

async function linkProjectGoals(projectId: string, companyId: string, goalIds: string[]) {
  if (goalIds.length === 0) return;
  await db.insert(projectGoals).values(
    goalIds.map((goalId) => ({ projectId, goalId, companyId })),
  );
}

console.log("Seeding defense supplier demo (if not already present)...");

const [existing] = await db
  .select({ id: companies.id })
  .from(companies)
  .where(eq(companies.issuePrefix, DEMO_COMPANY_ISSUE_PREFIX))
  .limit(1);

if (existing) {
  console.log(`Demo company with issue prefix ${DEMO_COMPANY_ISSUE_PREFIX} already exists. Nothing to do.`);
  process.exit(0);
}

const processAdapter = { command: "echo", args: ["paperclip-seed"] } as const;

const [company] = await db
  .insert(companies)
  .values({
    name: "Stratum Defense Supply Group",
    description:
      "Sample sub-tier supplier: strategic sourcing for defense programs, DFARS/ITAR flow-down, AS9100 supplier quality, and CMMC-aligned operations.",
    status: "active",
    budgetMonthlyCents: 500_000,
    issuePrefix: DEMO_COMPANY_ISSUE_PREFIX,
  })
  .returning();

const companyId = company!.id;

const [programLead] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Morgan Vale",
    role: "pm",
    title: "Program Lead — Prime Interfaces",
    status: "idle",
    adapterType: "process",
    adapterConfig: processAdapter,
    budgetMonthlyCents: 40_000_00,
  })
  .returning();

const [supplyChain] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Ravi Okonkwo",
    role: "engineer",
    title: "Supply Chain & Sub-tier Development",
    status: "idle",
    reportsTo: programLead!.id,
    adapterType: "process",
    adapterConfig: processAdapter,
    budgetMonthlyCents: 35_000_00,
  })
  .returning();

const [quality] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Elena Park",
    role: "qa",
    title: "AS9100 Supplier Quality",
    status: "idle",
    reportsTo: programLead!.id,
    adapterType: "process",
    adapterConfig: processAdapter,
    budgetMonthlyCents: 30_000_00,
  })
  .returning();

const [contracts] = await db
  .insert(agents)
  .values({
    companyId,
    name: "Daniel Frost",
    role: "researcher",
    title: "Contracts & Export Compliance",
    status: "idle",
    reportsTo: programLead!.id,
    adapterType: "process",
    adapterConfig: processAdapter,
    budgetMonthlyCents: 25_000_00,
  })
  .returning();

const [goalSourcing] = await db
  .insert(goals)
  .values({
    companyId,
    title: "Source and certify defense-grade materials",
    description:
      "Qualify new mills and distributors; maintain traceability, heat lots, and material test reports for flight-critical alloys.",
    level: "company",
    status: "active",
    ownerAgentId: supplyChain!.id,
  })
  .returning();

const [goalCompliance] = await db
  .insert(goals)
  .values({
    companyId,
    title: "Strengthen DFARS, ITAR, and CMMC posture",
    description:
      "Close POA&M items, segment CUI enclaves, and align vendor attestations with prime flow-down requirements.",
    level: "company",
    status: "planned",
    ownerAgentId: contracts!.id,
  })
  .returning();

const [goalDelivery] = await db
  .insert(goals)
  .values({
    companyId,
    title: "On-time delivery to prime programs",
    description:
      "Hit OTIF targets for long-lead forgings and castings; de-risk sole-source dependencies with second-source plans.",
    level: "company",
    status: "active",
    ownerAgentId: programLead!.id,
  })
  .returning();

const [projSourcing] = await db
  .insert(projects)
  .values({
    companyId,
    goalId: goalSourcing!.id,
    name: "Strategic sourcing & second source",
    description: "Dual-source nickel superalloys and titanium bar; negotiate LTAs aligned to LRIP/FRP ramps.",
    status: "in_progress",
    leadAgentId: supplyChain!.id,
    issuePrefix: "SDSRC",
    issueCounter: 0,
    color: "#2563eb",
  })
  .returning();

const [projDfars] = await db
  .insert(projects)
  .values({
    companyId,
    goalId: goalCompliance!.id,
    name: "DFARS / ITAR flow-down",
    description: "Map clauses to POs, collect vendor representations, and track counterfeit avoidance (DFARS 252.246-7008).",
    status: "planned",
    leadAgentId: contracts!.id,
    issuePrefix: "SDDFR",
    issueCounter: 0,
    color: "#7c3aed",
  })
  .returning();

const [projQuality] = await db
  .insert(projects)
  .values({
    companyId,
    goalId: goalSourcing!.id,
    name: "Supplier quality (AS9100)",
    description: "Source inspection planning, SCAR/CAPA backlog, and NADCAP special process oversight.",
    status: "in_progress",
    leadAgentId: quality!.id,
    issuePrefix: "SDQMS",
    issueCounter: 0,
    color: "#059669",
  })
  .returning();

await linkProjectGoals(projSourcing!.id, companyId, [goalSourcing!.id, goalDelivery!.id]);
await linkProjectGoals(projDfars!.id, companyId, [goalCompliance!.id]);
await linkProjectGoals(projQuality!.id, companyId, [goalSourcing!.id]);

await seedProjectIssueStatuses(projSourcing!.id, companyId);
await seedProjectIssueStatuses(projDfars!.id, companyId);
await seedProjectIssueStatuses(projQuality!.id, companyId);

type IssueSeed = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeAgentId?: string;
  createdByAgentId: string;
  goalId: string;
  issueNumber: number;
};

function issueRows(
  projectId: string,
  companyId: string,
  prefix: string,
  items: IssueSeed[],
): (typeof issues.$inferInsert)[] {
  const now = new Date();
  return items.map((item) => {
    const row: typeof issues.$inferInsert = {
      companyId,
      projectId,
      goalId: item.goalId,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      assigneeAgentId: item.assigneeAgentId ?? null,
      createdByAgentId: item.createdByAgentId,
      issueNumber: item.issueNumber,
      identifier: `${prefix}-${item.issueNumber}`,
      originKind: "manual",
    };
    if (item.status === "in_progress") row.startedAt = now;
    if (item.status === "done") row.completedAt = now;
    return row;
  });
}

const sourcingIssues: IssueSeed[] = [
  {
    title: "Qualify second source for Inconel 718 bar (AMS 5662)",
    description: "Mill survey, MTR review, and first article inspection plan for Lot 14 LRIP.",
    status: "in_progress",
    priority: "high",
    assigneeAgentId: supplyChain!.id,
    createdByAgentId: programLead!.id,
    goalId: goalSourcing!.id,
    issueNumber: 1,
  },
  {
    title: "Negotiate LTA with distributor for titanium 6Al-4V",
    description: "Index pricing to LME/V sponge; secure cut-to-length lead times under 8 weeks ARO.",
    status: "todo",
    priority: "medium",
    assigneeAgentId: supplyChain!.id,
    createdByAgentId: programLead!.id,
    goalId: goalSourcing!.id,
    issueNumber: 2,
  },
  {
    title: "Obtain DFARS material country of melt documentation",
    description: "Collect smelt/melt certificates for specialty metals on BOM line 3.2.",
    status: "blocked",
    priority: "critical",
    assigneeAgentId: contracts!.id,
    createdByAgentId: supplyChain!.id,
    goalId: goalSourcing!.id,
    issueNumber: 3,
  },
  {
    title: "Reduce sole-source exposure on forgings",
    description: "RFP package for closed-die forge house; include NADCAP heat treat scope.",
    status: "backlog",
    priority: "medium",
    createdByAgentId: programLead!.id,
    goalId: goalDelivery!.id,
    issueNumber: 4,
  },
];

const dfarsIssues: IssueSeed[] = [
  {
    title: "Refresh vendor DFARS 252.204-7012 representations",
    description: "Quarterly attestation for CUI handling and incident reporting contacts.",
    status: "todo",
    priority: "high",
    assigneeAgentId: contracts!.id,
    createdByAgentId: programLead!.id,
    goalId: goalCompliance!.id,
    issueNumber: 1,
  },
  {
    title: "ITAR technical data package access review",
    description: "Re-baseline who may receive export-controlled drawings from the prime portal.",
    status: "in_review",
    priority: "high",
    assigneeAgentId: contracts!.id,
    createdByAgentId: quality!.id,
    goalId: goalCompliance!.id,
    issueNumber: 2,
  },
  {
    title: "CMMC Level 2 POA&M — segmentation",
    description: "Document VLAN boundaries between ERP and engineering workstations handling CUI.",
    status: "backlog",
    priority: "medium",
    createdByAgentId: contracts!.id,
    goalId: goalCompliance!.id,
    issueNumber: 3,
  },
];

const qualityIssues: IssueSeed[] = [
  {
    title: "SCAR-2026-014 — plating thickness variance",
    description: "8D response due Friday; containment at receiving inspection.",
    status: "in_progress",
    priority: "critical",
    assigneeAgentId: quality!.id,
    createdByAgentId: programLead!.id,
    goalId: goalSourcing!.id,
    issueNumber: 1,
  },
  {
    title: "Annual re-survey of NADCAP heat treat special processor",
    description: "Schedule on-site audit window with prime SQE concurrence.",
    status: "todo",
    priority: "medium",
    assigneeAgentId: quality!.id,
    createdByAgentId: quality!.id,
    goalId: goalSourcing!.id,
    issueNumber: 2,
  },
  {
    title: "First article for new EDM vendor",
    description: "Compare CMM results to drawing GD&T for housing PN-4481.",
    status: "done",
    priority: "low",
    assigneeAgentId: quality!.id,
    createdByAgentId: supplyChain!.id,
    goalId: goalSourcing!.id,
    issueNumber: 3,
  },
];

await db.insert(issues).values([
  ...issueRows(projSourcing!.id, companyId, "SDSRC", sourcingIssues),
  ...issueRows(projDfars!.id, companyId, "SDDFR", dfarsIssues),
  ...issueRows(projQuality!.id, companyId, "SDQMS", qualityIssues),
]);

await db
  .update(projects)
  .set({ issueCounter: 4, updatedAt: new Date() })
  .where(eq(projects.id, projSourcing!.id));
await db
  .update(projects)
  .set({ issueCounter: 3, updatedAt: new Date() })
  .where(eq(projects.id, projDfars!.id));
await db
  .update(projects)
  .set({ issueCounter: 3, updatedAt: new Date() })
  .where(eq(projects.id, projQuality!.id));

console.log(
  `Seed complete: company "${company!.name}" (${company!.id}) with goals, projects, workflow statuses, and tasks.`,
);
process.exit(0);
