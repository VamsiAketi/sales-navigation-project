import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const billingAlerts = pgTable(
  "billing_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    severity: text("severity").notNull().default("warning"),
    alertType: text("alert_type").notNull(),
    message: text("message").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
  },
  (table) => ({
    dedupeIdx: index("billing_alerts_company_dedupe_idx").on(table.companyId, table.dedupeKey),
    createdIdx: index("billing_alerts_company_created_idx").on(table.companyId, table.createdAt),
  }),
);
