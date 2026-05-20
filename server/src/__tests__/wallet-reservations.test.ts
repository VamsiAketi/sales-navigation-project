import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyWalletReservations,
  companyWalletTransactions,
  costEvents,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { costService } from "../services/costs.js";
import {
  getWalletAvailability,
  WALLET_RESERVATION_STATUS,
  walletReservationService,
} from "../services/wallet-reservations.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping wallet reservation tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("walletReservationService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wallet-reservations-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(companyWalletReservations);
    await db.delete(companyWalletTransactions);
    await db.delete(costEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyWithCredit(creditCents: number) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `W${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Wallet Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    if (creditCents > 0) {
      await db.insert(companyWalletTransactions).values({
        companyId,
        amountCents: creditCents,
        currency: "usd",
        direction: "credit",
        sourceType: "test_credit",
        sourceId: randomUUID(),
      });
    }

    return { companyId, agentId };
  }

  async function seedRun(companyId: string, agentId: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "queued",
      invocationSource: "on_demand",
    });
    return runId;
  }

  it("serializes reserves: A holds 60, B cannot take 50 until A releases (100 wallet)", async () => {
    const { companyId, agentId } = await seedCompanyWithCredit(100);
    const runA = await seedRun(companyId, agentId);
    const runB = await seedRun(companyId, agentId);
    const runC = await seedRun(companyId, agentId);

    const reservations = walletReservationService(db);

    await reservations.tryReserve({ companyId, heartbeatRunId: runA, estimateCents: 60 });
    const afterA = await getWalletAvailability(db, companyId);
    expect(afterA).toMatchObject({ netCents: 100, reservedCents: 60, availableCents: 40 });

    await expect(
      reservations.tryReserve({ companyId, heartbeatRunId: runB, estimateCents: 50 }),
    ).rejects.toMatchObject({ status: 402 } satisfies Partial<HttpError>);

    await reservations.release(runA);
    const afterRelease = await getWalletAvailability(db, companyId);
    expect(afterRelease).toMatchObject({ netCents: 100, reservedCents: 0, availableCents: 100 });

    await reservations.tryReserve({ companyId, heartbeatRunId: runB, estimateCents: 50 });
    await reservations.tryReserve({ companyId, heartbeatRunId: runC, estimateCents: 50 });

    const finalAvailability = await getWalletAvailability(db, companyId);
    expect(finalAvailability).toMatchObject({ reservedCents: 100, availableCents: 0 });
  });

  it("settle debits once via reservation path (no duplicate cost_event_model_debit)", async () => {
    const { companyId, agentId } = await seedCompanyWithCredit(10_000);
    const runId = await seedRun(companyId, agentId);
    const reservations = walletReservationService(db);

    await reservations.tryReserve({ companyId, heartbeatRunId: runId, estimateCents: 500 });

    const costs = costService(db);
    const event = await costs.createEvent(companyId, {
      heartbeatRunId: runId,
      agentId,
      provider: "test",
      biller: "test",
      billingType: "metered_api",
      model: "gpt-test",
      inputTokens: 1000,
      outputTokens: 500,
      costCents: 42,
      modelCostCents: 42,
      occurredAt: new Date(),
    });

    const debits = await db
      .select()
      .from(companyWalletTransactions)
      .where(
        eq(companyWalletTransactions.companyId, companyId),
      );
    const modelDebits = debits.filter((row) => row.sourceType === "cost_event_model_debit");
    expect(modelDebits).toHaveLength(1);
    expect(modelDebits[0]).toMatchObject({
      amountCents: 42,
      direction: "debit",
      sourceId: event.id,
    });

    const reservation = await db
      .select()
      .from(companyWalletReservations)
      .where(eq(companyWalletReservations.heartbeatRunId, runId))
      .then((rows) => rows[0]);
    expect(reservation?.status).toBe(WALLET_RESERVATION_STATUS.settled);
    expect(reservation?.settledCents).toBe(42);
    expect(reservation?.costEventId).toBe(event.id);

    const availability = await getWalletAvailability(db, companyId);
    expect(availability.netCents).toBe(10_000 - 42);
    expect(availability.reservedCents).toBe(0);
  });

  it("settle debits full actual cents when usage exceeds the reservation estimate", async () => {
    const { companyId, agentId } = await seedCompanyWithCredit(10_000);
    const runId = await seedRun(companyId, agentId);
    const reservations = walletReservationService(db);

    await reservations.tryReserve({ companyId, heartbeatRunId: runId, estimateCents: 200 });

    const costs = costService(db);
    await costs.createEvent(companyId, {
      heartbeatRunId: runId,
      agentId,
      provider: "test",
      biller: "test",
      billingType: "metered_api",
      model: "gpt-test",
      inputTokens: 1000,
      outputTokens: 500,
      costCents: 260,
      modelCostCents: 260,
      occurredAt: new Date(),
    });

    const availability = await getWalletAvailability(db, companyId);
    expect(availability.netCents).toBe(10_000 - 260);
    expect(availability.reservedCents).toBe(0);

    const reservation = await db
      .select()
      .from(companyWalletReservations)
      .where(eq(companyWalletReservations.heartbeatRunId, runId))
      .then((rows) => rows[0]);
    expect(reservation?.settledCents).toBe(260);
  });

  it("release returns held capacity without debiting the wallet", async () => {
    const { companyId, agentId } = await seedCompanyWithCredit(200);
    const runId = await seedRun(companyId, agentId);
    const reservations = walletReservationService(db);

    await reservations.tryReserve({ companyId, heartbeatRunId: runId, estimateCents: 150 });
    await reservations.release(runId);

    const availability = await getWalletAvailability(db, companyId);
    expect(availability).toMatchObject({ netCents: 200, reservedCents: 0, availableCents: 200 });

    const debits = await db
      .select()
      .from(companyWalletTransactions)
      .where(eq(companyWalletTransactions.companyId, companyId));
    expect(debits.filter((row) => row.direction === "debit")).toHaveLength(0);
  });
});
