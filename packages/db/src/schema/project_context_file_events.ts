import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectContextFiles } from "./project_context_files.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectContextFileEvents = pgTable(
  "project_context_file_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectContextFileId: uuid("project_context_file_id")
      .notNull()
      .references(() => projectContextFiles.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    details: jsonb("details").$type<Record<string, unknown> | null>(),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectCreatedIdx: index("project_context_file_events_company_project_created_idx").on(
      table.companyId,
      table.projectId,
      table.createdAt,
    ),
    fileCreatedIdx: index("project_context_file_events_file_created_idx").on(table.projectContextFileId, table.createdAt),
  }),
);
