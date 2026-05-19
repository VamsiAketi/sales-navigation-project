import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const connectorConnections = pgTable(
  "connector_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectorTypeKey: text("connector_type_key").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    inboundPublicId: text("inbound_public_id").notNull(),
    inboundSecretId: uuid("inbound_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    lastError: text("last_error"),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("connector_connections_company_status_idx").on(table.companyId, table.status),
    companyTypeIdx: index("connector_connections_company_type_idx").on(table.companyId, table.connectorTypeKey),
    inboundPublicIdx: uniqueIndex("connector_connections_inbound_public_idx").on(table.inboundPublicId),
  }),
);
