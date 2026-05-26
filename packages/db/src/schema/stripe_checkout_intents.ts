import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const stripeCheckoutIntents = pgTable(
  "stripe_checkout_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    checkoutSessionId: text("checkout_session_id").notNull(),
    /** Client-supplied key; safe to retry checkout creation for the same top-up attempt. */
    idempotencyKey: text("idempotency_key"),
    paymentIntentId: text("payment_intent_id"),
    stripeCustomerId: text("stripe_customer_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status").notNull().default("created"),
    webhookEventId: text("webhook_event_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  },
  (table) => ({
    companyIdempotencyKeyUniqueIdx: uniqueIndex("stripe_checkout_intents_company_idempotency_key_unique_idx")
      .on(table.companyId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    sessionUniqueIdx: uniqueIndex("stripe_checkout_intents_session_unique_idx").on(table.checkoutSessionId),
    paymentIntentUniqueIdx: uniqueIndex("stripe_checkout_intents_payment_intent_unique_idx").on(table.paymentIntentId),
    companyStatusCreatedIdx: index("stripe_checkout_intents_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
  }),
);
