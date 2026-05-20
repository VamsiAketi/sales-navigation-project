import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { costEvents } from "./cost_events.js";

export const companyWalletReservations = pgTable(
  "company_wallet_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    heartbeatRunId: uuid("heartbeat_run_id")
      .notNull()
      .references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    estimatedCents: integer("estimated_cents").notNull(),
    status: text("status").notNull().default("active"),
    settledCents: integer("settled_cents"),
    costEventId: uuid("cost_event_id").references(() => costEvents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runUniqueIdx: uniqueIndex("company_wallet_reservations_run_unique_idx").on(table.heartbeatRunId),
    companyStatusIdx: index("company_wallet_reservations_company_status_idx").on(table.companyId, table.status),
  }),
);
