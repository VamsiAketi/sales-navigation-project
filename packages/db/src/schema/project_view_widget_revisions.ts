import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectViews } from "./project_views.js";
import { projectViewWidgets } from "./project_view_widgets.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectViewWidgetRevisions = pgTable(
  "project_view_widget_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectViewId: uuid("project_view_id").notNull().references(() => projectViews.id, { onDelete: "cascade" }),
    projectViewWidgetId: uuid("project_view_widget_id")
      .notNull()
      .references(() => projectViewWidgets.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    type: text("type").notNull(),
    queryRef: jsonb("query_ref").$type<Record<string, unknown> | null>(),
    config: jsonb("config").$type<Record<string, unknown> | null>(),
    layout: jsonb("layout").$type<Record<string, unknown> | null>(),
    changeSource: text("change_source").notNull().default("human"),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    widgetRevisionUq: uniqueIndex("project_view_widget_revisions_widget_revision_uq").on(
      table.projectViewWidgetId,
      table.revisionNumber,
    ),
    companyProjectViewWidgetCreatedIdx: index("project_view_widget_revisions_company_project_view_widget_created_idx").on(
      table.companyId,
      table.projectId,
      table.projectViewId,
      table.projectViewWidgetId,
      table.createdAt,
    ),
  }),
);
