import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectIssueStatuses = pgTable(
  "project_issue_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: text("value").notNull(),
    color: text("color").notNull(),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectValueIdx: uniqueIndex("proj_statuses_project_value_idx").on(table.projectId, table.value),
    projectActivePosIdx: index("proj_statuses_project_active_pos_idx").on(table.projectId, table.isActive, table.position),
    companyIdx: index("proj_statuses_company_idx").on(table.companyId),
  }),
);
