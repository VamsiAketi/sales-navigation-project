import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectViews } from "./project_views.js";

export const projectViewWidgets = pgTable(
  "project_view_widgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectViewId: uuid("project_view_id").notNull().references(() => projectViews.id, { onDelete: "cascade" }),
    title: text("title"),
    normalizedTitle: text("normalized_title"),
    type: text("type").notNull(),
    position: integer("position").notNull().default(0),
    queryRef: jsonb("query_ref").$type<Record<string, unknown> | null>(),
    config: jsonb("config").$type<Record<string, unknown> | null>(),
    layout: jsonb("layout").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyViewPositionIdx: index("project_view_widgets_company_view_position_idx").on(
      table.companyId,
      table.projectViewId,
      table.position,
    ),
    companyViewTitleUq: uniqueIndex("project_view_widgets_company_view_title_uq").on(
      table.companyId,
      table.projectViewId,
      table.normalizedTitle,
    ),
    companyProjectCreatedIdx: index("project_view_widgets_company_project_created_idx").on(
      table.companyId,
      table.projectId,
      table.createdAt,
    ),
  }),
);
