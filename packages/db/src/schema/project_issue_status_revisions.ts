import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectIssueStatuses } from "./project_issue_statuses.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectIssueStatusRevisions = pgTable(
  "project_issue_status_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectIssueStatusId: uuid("project_issue_status_id")
      .notNull()
      .references(() => projectIssueStatuses.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    description: text("description"),
    agentInstructions: text("agent_instructions"),
    agentCapabilityTags: jsonb("agent_capability_tags").$type<string[]>().notNull().default([]),
    changeSource: text("change_source").notNull().default("agent_sync"),
    sourceContentHash: text("source_content_hash"),
    changeSummary: text("change_summary"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusRevisionUq: uniqueIndex("project_issue_status_revisions_status_revision_uq").on(
      table.projectIssueStatusId,
      table.revisionNumber,
    ),
    companyProjectStatusCreatedIdx: index("project_issue_status_revisions_company_project_status_created_idx").on(
      table.companyId,
      table.projectId,
      table.projectIssueStatusId,
      table.createdAt,
    ),
  }),
);
