import { pgTable, text, timestamp, uuid, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyWalletTransactions = pgTable(
  "company_wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    direction: text("direction").notNull().default("credit"),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    stripeEventId: text("stripe_event_id"),
    checkoutSessionId: text("checkout_session_id"),
    paymentIntentId: text("payment_intent_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("company_wallet_transactions_company_created_idx").on(table.companyId, table.createdAt),
    sourceUniqueIdx: uniqueIndex("company_wallet_transactions_source_unique_idx").on(
      table.companyId,
      table.sourceType,
      table.sourceId,
    ),
    stripeEventUniqueIdx: uniqueIndex("company_wallet_transactions_stripe_event_unique_idx").on(table.stripeEventId),
  }),
);
