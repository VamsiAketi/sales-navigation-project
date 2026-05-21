import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectViews = pgTable(
  "project_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    layout: jsonb("layout").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectNameUq: uniqueIndex("project_views_company_project_name_uq").on(
      table.companyId,
      table.projectId,
      table.normalizedName,
    ),
    companyProjectUpdatedIdx: index("project_views_company_project_updated_idx").on(
      table.companyId,
      table.projectId,
      table.updatedAt,
    ),
  }),
);
