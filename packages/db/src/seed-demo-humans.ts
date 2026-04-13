/**
 * Idempotent demo human users for company directory, assignments, and access UI.
 * Does not create password accounts — use normal sign-up for loginable users, or
 * attach credentials via Better Auth if you need password sign-in for these rows.
 *
 *   export DATABASE_URL='postgres://…'
 *   pnpm db:seed:humans
 *
 * Adds users to the `user` table and an active `company_memberships` row per company.
 */
import { and, eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { authUsers, companies, companyMemberships } from "./schema/index.js";

const DEMO_HUMANS = [
  { id: "paperclip_demo_human_01", name: "Alex Chen", email: "alex.chen.demo@paperclip.local" },
  { id: "paperclip_demo_human_02", name: "Jordan Malik", email: "jordan.malik.demo@paperclip.local" },
  { id: "paperclip_demo_human_03", name: "Samira Okonkwo", email: "samira.okonkwo.demo@paperclip.local" },
  { id: "paperclip_demo_human_04", name: "Taylor Brooks", email: "taylor.brooks.demo@paperclip.local" },
  { id: "paperclip_demo_human_05", name: "Riley Nakamura", email: "riley.nakamura.demo@paperclip.local" },
  { id: "paperclip_demo_human_06", name: "Casey Alvarez", email: "casey.alvarez.demo@paperclip.local" },
] as const;

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
      membershipRole: "member",
    });
    membershipsInserted++;
  }
}

console.log(
  `Done. Inserted ${usersInserted} new user(s); added ${membershipsInserted} company membership(s) across ${companyRows.length} compan${companyRows.length === 1 ? "y" : "ies"}.`,
);
process.exit(0);
