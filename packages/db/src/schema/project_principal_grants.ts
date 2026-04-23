import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectPrincipalGrants = pgTable(
  "project_principal_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueGrant: uniqueIndex("project_principal_grants_unique_idx").on(
      table.projectId,
      table.principalType,
      table.principalId,
      table.permissionKey,
    ),
    projectIdx: index("project_principal_grants_project_idx").on(table.projectId),
    companyPrincipalIdx: index("project_principal_grants_company_principal_idx").on(
      table.companyId,
      table.principalType,
      table.principalId,
    ),
  }),
);
