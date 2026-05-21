import { and, asc, desc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, agents, companies, companyWalletTransactions, costEvents, issues, projects } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";
import { budgetService, type BudgetServiceHooks } from "./budgets.js";
import { calculateModelCostCents } from "./model-pricing.js";
import { hasActiveWalletReservation, settleWalletReservationInTx } from "./wallet-reservations.js";

export interface CostDateRange {
  from?: Date;
  to?: Date;
}

const METERED_BILLING_TYPE = "metered_api";
const SUBSCRIPTION_BILLING_TYPES = ["subscription_included", "subscription_overage"] as const;

function currentUtcMonthWindow(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
}

async function getMonthlySpendTotal(
  db: Pick<Db, "select">,
  scope: { companyId: string; agentId?: string | null },
) {
  const { start, end } = currentUtcMonthWindow();
  const conditions = [
    eq(costEvents.companyId, scope.companyId),
    gte(costEvents.occurredAt, start),
    lt(costEvents.occurredAt, end),
  ];
  if (scope.agentId) {
    conditions.push(eq(costEvents.agentId, scope.agentId));
  }
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::bigint`,
    })
    .from(costEvents)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

/** `spent_monthly_cents` columns are INT4; clamp aggregated totals before persisting. */
function toPgIntColumnValue(value: number): number {
  const n = Math.trunc(value);
  if (n > 2_147_483_647) return 2_147_483_647;
  if (n < -2_147_483_648) return -2_147_483_648;
  return n;
}

export function costService(db: Db, budgetHooks: BudgetServiceHooks = {}) {
  const budgets = budgetService(db, budgetHooks);
  return {
    /** Sum of `model_cost_cents` for every company (instance-wide operational estimate). */
    totalModelCostCentsAllCompanies: async (): Promise<number> => {
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
        })
        .from(costEvents);
      return Number(row?.total ?? 0);
    },
    totalModelCostCentsByCompany: async (companyId: string): Promise<number> => {
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
        })
        .from(costEvents)
        .where(eq(costEvents.companyId, companyId));
      return Number(row?.total ?? 0);
    },

    createEvent: async (companyId: string, data: Omit<typeof costEvents.$inferInsert, "companyId">) => {
      const event = await db.transaction(async (tx) => {
        const agent = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, data.agentId))
          .then((rows) => rows[0] ?? null);

        if (!agent) throw notFound("Agent not found");
        if (agent.companyId !== companyId) {
          throw unprocessable("Agent does not belong to company");
        }

        const eventRow = await tx
          .insert(costEvents)
          .values({
            ...data,
            companyId,
            biller: data.biller ?? data.provider,
            billingType: data.billingType ?? "unknown",
            cachedInputTokens: data.cachedInputTokens ?? 0,
            modelCostCents:
              typeof data.modelCostCents === "number"
                ? data.modelCostCents
                : calculateModelCostCents(
                    data.model,
                    data.inputTokens ?? 0,
                    data.cachedInputTokens ?? 0,
                    data.outputTokens ?? 0,
                  ),
          })
          .returning()
          .then((rows) => rows[0]);

        const [agentMonthSpend, companyMonthSpend] = await Promise.all([
          getMonthlySpendTotal(tx, { companyId, agentId: eventRow.agentId }),
          getMonthlySpendTotal(tx, { companyId }),
        ]);

        await tx
          .update(agents)
          .set({
            spentMonthlyCents: toPgIntColumnValue(agentMonthSpend),
            updatedAt: new Date(),
          })
          .where(eq(agents.id, eventRow.agentId));

        await tx
          .update(companies)
          .set({
            spentMonthlyCents: toPgIntColumnValue(companyMonthSpend),
            updatedAt: new Date(),
          })
          .where(eq(companies.id, companyId));

        const modelCostCents = eventRow.modelCostCents ?? 0;
        const reservedForRun = await hasActiveWalletReservation(tx, eventRow.heartbeatRunId);
        if (reservedForRun && eventRow.heartbeatRunId) {
          await settleWalletReservationInTx(tx, {
            heartbeatRunId: eventRow.heartbeatRunId,
            actualCents: modelCostCents,
            costEventId: eventRow.id,
          });
        } else if (modelCostCents > 0) {
          await tx
            .insert(companyWalletTransactions)
            .values({
              companyId,
              amountCents: modelCostCents,
              currency: "usd",
              direction: "debit",
              sourceType: "cost_event_model_debit",
              sourceId: eventRow.id,
              metadataJson: {
                costEventId: eventRow.id,
                biller: eventRow.biller,
                model: eventRow.model,
              },
            })
            .onConflictDoNothing();
        }
        return eventRow;
      }).catch((error) => {
        const err = error as { code?: string; message?: string };
        if (err.code === "23505" && String(err.message ?? "").includes("cost_events_company_idempotency_key_unique_idx")) {
          throw conflict("Duplicate cost event idempotency key");
        }
        throw error;
      });

      await budgets.evaluateCostEvent(event);
      return event;
    },

    summary: async (companyId: string, range?: CostDateRange) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      const [{ modelTotal }] = await db
        .select({
          modelTotal: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::bigint`,
        })
        .from(costEvents)
        .where(and(...conditions));

      const modelSpendCents = Number(modelTotal ?? 0);
      const spendCents = modelSpendCents;
      const utilization =
        company.budgetMonthlyCents > 0
          ? (modelSpendCents / company.budgetMonthlyCents) * 100
          : 0;

      return {
        companyId,
        spendCents,
        modelSpendCents,
        budgetCents: company.budgetMonthlyCents,
        utilizationPercent: Number(utilization.toFixed(2)),
      };
    },

    byAgent: async (companyId: string, range?: CostDateRange) => {
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      return db
        .select({
          agentId: costEvents.agentId,
          agentName: agents.name,
          agentStatus: agents.status,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
          apiRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} = ${METERED_BILLING_TYPE} then ${costEvents.heartbeatRunId} end)::int`,
          subscriptionRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.heartbeatRunId} end)::int`,
          subscriptionCachedInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.cachedInputTokens} else 0 end), 0)::int`,
          subscriptionInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.inputTokens} else 0 end), 0)::int`,
          subscriptionOutputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.outputTokens} else 0 end), 0)::int`,
        })
        .from(costEvents)
        .leftJoin(agents, eq(costEvents.agentId, agents.id))
        .where(and(...conditions))
        .groupBy(costEvents.agentId, agents.name, agents.status)
        .orderBy(desc(sql`coalesce(sum(${costEvents.modelCostCents}), 0)::int`));
    },

    byProvider: async (companyId: string, range?: CostDateRange) => {
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      return db
        .select({
          provider: costEvents.provider,
          biller: costEvents.biller,
          billingType: costEvents.billingType,
          model: costEvents.model,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
          apiRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} = ${METERED_BILLING_TYPE} then ${costEvents.heartbeatRunId} end)::int`,
          subscriptionRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.heartbeatRunId} end)::int`,
          subscriptionCachedInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.cachedInputTokens} else 0 end), 0)::int`,
          subscriptionInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.inputTokens} else 0 end), 0)::int`,
          subscriptionOutputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.outputTokens} else 0 end), 0)::int`,
        })
        .from(costEvents)
        .where(and(...conditions))
        .groupBy(costEvents.provider, costEvents.biller, costEvents.billingType, costEvents.model)
        .orderBy(desc(sql`coalesce(sum(${costEvents.modelCostCents}), 0)::int`));
    },

    byBiller: async (companyId: string, range?: CostDateRange) => {
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      return db
        .select({
          biller: costEvents.biller,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
          apiRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} = ${METERED_BILLING_TYPE} then ${costEvents.heartbeatRunId} end)::double precision`,
          subscriptionRunCount:
            sql<number>`count(distinct case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.heartbeatRunId} end)::double precision`,
          subscriptionCachedInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.cachedInputTokens} else 0 end), 0)::double precision`,
          subscriptionInputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.inputTokens} else 0 end), 0)::double precision`,
          subscriptionOutputTokens:
            sql<number>`coalesce(sum(case when ${costEvents.billingType} in (${sql.join(SUBSCRIPTION_BILLING_TYPES.map((value) => sql`${value}`), sql`, `)}) then ${costEvents.outputTokens} else 0 end), 0)::double precision`,
          providerCount: sql<number>`count(distinct ${costEvents.provider})::double precision`,
          modelCount: sql<number>`count(distinct ${costEvents.model})::double precision`,
        })
        .from(costEvents)
        .where(and(...conditions))
        .groupBy(costEvents.biller)
        .orderBy(desc(sql`coalesce(sum(${costEvents.modelCostCents}), 0)::double precision`));
    },

    /**
     * aggregates cost_events by provider for each of three rolling windows:
     * last 5 hours, last 24 hours, last 7 days.
     * purely internal consumption data, no external rate-limit sources.
     */
    windowSpend: async (companyId: string) => {
      const windows = [
        { label: "5h", hours: 5 },
        { label: "24h", hours: 24 },
        { label: "7d", hours: 168 },
      ] as const;

      const results = await Promise.all(
        windows.map(async ({ label, hours }) => {
          const since = new Date(Date.now() - hours * 60 * 60 * 1000);
          const rows = await db
            .select({
              provider: costEvents.provider,
              biller: sql<string>`case when count(distinct ${costEvents.biller}) = 1 then min(${costEvents.biller}) else 'mixed' end`,
              costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
              modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
              inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
              cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
              outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
            })
            .from(costEvents)
            .where(
              and(
                eq(costEvents.companyId, companyId),
                gte(costEvents.occurredAt, since),
              ),
            )
            .groupBy(costEvents.provider)
            .orderBy(desc(sql`coalesce(sum(${costEvents.modelCostCents}), 0)::int`));

          return rows.map((row) => ({
            provider: row.provider,
            biller: row.biller,
            window: label as string,
            windowHours: hours,
            costCents: row.costCents,
            modelCostCents: row.modelCostCents,
            inputTokens: row.inputTokens,
            cachedInputTokens: row.cachedInputTokens,
            outputTokens: row.outputTokens,
          }));
        }),
      );

      return results.flat();
    },

    byAgentModel: async (companyId: string, range?: CostDateRange) => {
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      // single query: group by agent + provider + model.
      // the (companyId, agentId, occurredAt) composite index covers this well.
      // order by provider + model for stable db-level ordering; cost-desc sort
      // within each agent's sub-rows is done client-side in the ui memo.
      return db
        .select({
          agentId: costEvents.agentId,
          agentName: agents.name,
          provider: costEvents.provider,
          biller: costEvents.biller,
          billingType: costEvents.billingType,
          model: costEvents.model,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
        })
        .from(costEvents)
        .leftJoin(agents, eq(costEvents.agentId, agents.id))
        .where(and(...conditions))
        .groupBy(
          costEvents.agentId,
          agents.name,
          costEvents.provider,
          costEvents.biller,
          costEvents.billingType,
          costEvents.model,
        )
        .orderBy(costEvents.provider, costEvents.biller, costEvents.billingType, costEvents.model);
    },

    /** One row per UTC calendar day; `model_cost_cents` matches server pricing at event insert time. */
    dailyTotals: async (companyId: string, range: CostDateRange) => {
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range.to) conditions.push(lte(costEvents.occurredAt, range.to));

      const utcDay = sql<string>`to_char((${costEvents.occurredAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

      return db
        .select({
          day: utcDay,
          costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
          modelCostCents: sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::double precision`,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::double precision`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::double precision`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::double precision`,
        })
        .from(costEvents)
        .where(and(...conditions))
        .groupBy(utcDay)
        .orderBy(asc(utcDay));
    },

    byProject: async (companyId: string, range?: CostDateRange) => {
      const issueIdAsText = sql<string>`${issues.id}::text`;
      const runProjectLinks = db
        .selectDistinctOn([activityLog.runId, issues.projectId], {
          runId: activityLog.runId,
          projectId: issues.projectId,
        })
        .from(activityLog)
        .innerJoin(
          issues,
          and(
            eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, issueIdAsText),
          ),
        )
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(issues.companyId, companyId),
            isNotNull(activityLog.runId),
            isNotNull(issues.projectId),
          ),
        )
        .orderBy(activityLog.runId, issues.projectId, desc(activityLog.createdAt))
        .as("run_project_links");

      const effectiveProjectId = sql<string | null>`coalesce(${costEvents.projectId}, ${issues.projectId}, ${runProjectLinks.projectId})`;
      const conditions: ReturnType<typeof eq>[] = [eq(costEvents.companyId, companyId)];
      if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
      if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

      const costCentsExpr = sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`;
      const modelCostCentsExpr = sql<number>`coalesce(sum(${costEvents.modelCostCents}), 0)::int`;

      return db
        .select({
          projectId: effectiveProjectId,
          projectName: projects.name,
          costCents: costCentsExpr,
          modelCostCents: modelCostCentsExpr,
          inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
        })
        .from(costEvents)
        .leftJoin(
          issues,
          and(
            eq(costEvents.issueId, issues.id),
            eq(issues.companyId, companyId),
          ),
        )
        .leftJoin(runProjectLinks, eq(costEvents.heartbeatRunId, runProjectLinks.runId))
        .innerJoin(projects, sql`${projects.id} = ${effectiveProjectId}`)
        .where(and(...conditions, sql`${effectiveProjectId} is not null`))
        .groupBy(effectiveProjectId, projects.name)
        .orderBy(desc(modelCostCentsExpr));
    },
  };
}
