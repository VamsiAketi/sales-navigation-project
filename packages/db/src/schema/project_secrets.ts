import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";

export const projectSecrets = pgTable(
  "project_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("local_encrypted"),
    externalRef: text("external_ref"),
    latestVersion: integer("latest_version").notNull().default(1),
    description: text("description"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("project_secrets_project_idx").on(table.projectId),
    companyProjectIdx: index("project_secrets_company_project_idx").on(table.companyId, table.projectId),
    companyProviderIdx: index("project_secrets_company_provider_idx").on(table.companyId, table.provider),
    projectNameUq: uniqueIndex("project_secrets_project_name_uq").on(table.projectId, table.name),
  }),
);
