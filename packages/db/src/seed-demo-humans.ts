/**
 * Idempotent demo human users for company directory, assignments, and access UI.
 * Does not create password accounts — use normal sign-up for loginable users, or
 * attach credentials via Better Auth if you need password sign-in for these rows.
 *
 * Inserts an executive chain at the top of the org (CEO → COO → VPs), then a team
 * of operators who report to the CEO. Re-run to repair hierarchy if needed.
 *
 *   export DATABASE_URL='postgres://…'
 *   pnpm db:seed:humans
 *
 * Adds users to the `user` table and an active `company_memberships` row per company.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "./client.js";
import { authUsers, companies, companyMemberships } from "./schema/index.js";

/** Human org roles (metadata); executives first, then team reporting to CEO. */
const DEMO_HUMANS: {
  id: string;
  name: string;
  email: string;
  membershipRole: string;
  /** Principal id of human manager, or null for root (board / company leadership). */
  reportsToPrincipalId: string | null;
}[] = [
  {
    id: "paperclip_demo_human_ex01",
    name: "Katherine Wells",
    email: "katherine.wells.exec@paperclip.local",
    membershipRole: "ceo",
    reportsToPrincipalId: null,
  },
  {
    id: "paperclip_demo_human_ex02",
    name: "James Okonkwo",
    email: "james.okonkwo.exec@paperclip.local",
    membershipRole: "coo",
    reportsToPrincipalId: "paperclip_demo_human_ex01",
  },
  {
    id: "paperclip_demo_human_ex03",
    name: "Sasha Park",
    email: "sasha.park.exec@paperclip.local",
    membershipRole: "vp_product",
    reportsToPrincipalId: "paperclip_demo_human_ex02",
  },
  {
    id: "paperclip_demo_human_ex04",
    name: "Omar Haddad",
    email: "omar.haddad.exec@paperclip.local",
    membershipRole: "vp_engineering",
    reportsToPrincipalId: "paperclip_demo_human_ex02",
  },
  { id: "paperclip_demo_human_01", name: "Alex Chen", email: "alex.chen.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_02", name: "Jordan Malik", email: "jordan.malik.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_03", name: "Samira Okonkwo", email: "samira.okonkwo.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_04", name: "Taylor Brooks", email: "taylor.brooks.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_05", name: "Riley Nakamura", email: "riley.nakamura.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_06", name: "Casey Alvarez", email: "casey.alvarez.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_07", name: "Morgan Reeves", email: "morgan.reeves.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_08", name: "Priya Desai", email: "priya.desai.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_09", name: "Diego Fernández", email: "diego.fernandez.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_10", name: "Amina Hassan", email: "amina.hassan.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
  { id: "paperclip_demo_human_11", name: "Chris O'Brien", email: "chris.obrien.demo@paperclip.local", membershipRole: "member", reportsToPrincipalId: "paperclip_demo_human_ex01" },
];

const DEMO_HUMAN_IDS = DEMO_HUMANS.map((h) => h.id);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (use the connection string for your Paperclip database).");
  process.exit(1);
}

const db = createDb(url);
const now = new Date();

console.log("Seeding demo human users (idempotent)...");

let usersInserted = 0;
for (const u of DEMO_HUMANS) {
  const [existing] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, u.id)).limit(1);
  if (existing) continue;
  await db.insert(authUsers).values({
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  usersInserted++;
}

const companyRows = await db.select({ id: companies.id }).from(companies);
if (companyRows.length === 0) {
  console.log("No companies found; user rows only. Create a company in the UI, then re-run to add memberships.");
  console.log(`Done. Inserted ${usersInserted} new user(s), 0 memberships.`);
  process.exit(0);
}

let membershipsInserted = 0;
for (const company of companyRows) {
  for (const u of DEMO_HUMANS) {
    const [m] = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, company.id),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, u.id),
        ),
      )
      .limit(1);
    if (m) continue;
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: u.id,
      status: "active",
      membershipRole: u.membershipRole,
    });
    membershipsInserted++;
  }
}

let orgRowsUpdated = 0;
for (const company of companyRows) {
  const rows = await db
    .select({ id: companyMemberships.id, principalId: companyMemberships.principalId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, company.id),
        eq(companyMemberships.principalType, "user"),
        inArray(companyMemberships.principalId, DEMO_HUMAN_IDS),
      ),
    );
  const membershipIdByPrincipal = new Map(rows.map((r) => [r.principalId, r.id]));

  for (const human of DEMO_HUMANS) {
    const membershipId = membershipIdByPrincipal.get(human.id);
    if (!membershipId) continue;

    let reportsToMembershipId: string | null = null;
    if (human.reportsToPrincipalId) {
      reportsToMembershipId = membershipIdByPrincipal.get(human.reportsToPrincipalId) ?? null;
      if (!reportsToMembershipId) {
        console.warn(
          `No membership for manager ${human.reportsToPrincipalId}; clearing reports-to for ${human.id} in company ${company.id}`,
        );
      }
    }

    await db
      .update(companyMemberships)
      .set({
        membershipRole: human.membershipRole,
        reportsToMembershipId,
        updatedAt: new Date(),
      })
      .where(eq(companyMemberships.id, membershipId));
    orgRowsUpdated++;
  }
}

console.log(
  `Done. Inserted ${usersInserted} new user(s); added ${membershipsInserted} company membership(s); applied org hierarchy to ${orgRowsUpdated} membership row(s) across ${companyRows.length} compan${companyRows.length === 1 ? "y" : "ies"}.`,
);
process.exit(0);
