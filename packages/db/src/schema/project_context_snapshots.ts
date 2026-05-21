import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectContextSnapshots = pgTable(
  "project_context_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    changeSource: text("change_source").notNull().default("agent_sync"),
    sourceContentHash: text("source_content_hash"),
    changeSummary: text("change_summary"),
    generatedByAgentId: uuid("generated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    generatedByRunId: uuid("generated_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectKindRevisionUq: uniqueIndex("project_context_snapshots_project_kind_revision_uq").on(
      table.projectId,
      table.kind,
      table.revisionNumber,
    ),
    companyProjectCreatedIdx: index("project_context_snapshots_company_project_created_idx").on(
      table.companyId,
      table.projectId,
      table.createdAt,
    ),
    companyProjectKindCreatedIdx: index("project_context_snapshots_company_project_kind_created_idx").on(
      table.companyId,
      table.projectId,
      table.kind,
      table.createdAt,
    ),
  }),
);
