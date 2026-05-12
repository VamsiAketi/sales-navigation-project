import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { connectorConnections } from "./connector_connections.js";
import { projects } from "./projects.js";

export const connectorEventBindings = pgTable(
  "connector_event_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connectorConnections.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyConnectionIdx: index("connector_event_bindings_company_connection_idx").on(
      table.companyId,
      table.connectionId,
    ),
    companyAgentIdx: index("connector_event_bindings_company_agent_idx").on(table.companyId, table.agentId),
    connectionEventIdx: index("connector_event_bindings_connection_event_idx").on(
      table.connectionId,
      table.eventType,
      table.enabled,
    ),
  }),
);
