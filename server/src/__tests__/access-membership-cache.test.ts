import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, companyMemberships, createDb } from "@paperclipai/db";
import { accessRequestCacheMiddleware } from "../middleware/access-request-cache.js";
import { accessService } from "../services/access.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres access membership cache tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function runWithAccessCache<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    accessRequestCacheMiddleware({}, {}, () => {
      fn().then(resolve).catch(reject);
    });
  });
}

describeEmbeddedPostgres("access membership request cache", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-access-membership-cache-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allows ensureMembership twice in the same request after a negative cache lookup", async () => {
    const access = accessService(db);
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: `Cache Test ${companyId.slice(0, 8)}`,
      issuePrefix: `CT${companyId.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
    });

    await runWithAccessCache(async () => {
      await access.ensureMembership(companyId, "agent", agentId, "member", "active");
      await access.ensureMembership(companyId, "agent", agentId, "member", "active");
    });

    const rows = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.principalId, agentId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.companyId).toBe(companyId);
    expect(rows[0]?.principalType).toBe("agent");
  });
});
