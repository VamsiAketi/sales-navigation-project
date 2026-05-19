import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { connectorConnections } from "./connector_connections.js";
import { connectorEventBindings } from "./connector_event_bindings.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const connectorEventDeliveries = pgTable(
  "connector_event_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connectorConnections.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").references(() => connectorEventBindings.id, { onDelete: "set null" }),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("received"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyConnectionIdx: index("connector_event_deliveries_company_connection_idx").on(
      table.companyId,
      table.connectionId,
    ),
    bindingIdx: index("connector_event_deliveries_binding_idx").on(table.bindingId),
    dedupeIdx: uniqueIndex("connector_event_deliveries_dedupe_idx").on(
      table.connectionId,
      table.bindingId,
      table.externalEventId,
    ),
  }),
);
