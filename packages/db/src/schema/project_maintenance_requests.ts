import { pgTable, uuid, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectMaintenanceRequests = pgTable(
  "project_maintenance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    description: text("description").notNull(),
    contextRef: jsonb("context_ref").$type<Record<string, unknown> | null>(),
    normalizedDescription: text("normalized_description"),
    dedupeHash: text("dedupe_hash"),
    status: text("status").notNull().default("pending"),
    changeRiskClass: text("change_risk_class").notNull().default("non_destructive"),
    riskReasons: jsonb("risk_reasons").$type<string[]>().notNull().default([]),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(2),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    requestedByUserId: text("requested_by_user_id"),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: text("rejected_by_user_id"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectCreatedIdx: index("project_maintenance_requests_company_project_created_idx").on(
      table.companyId,
      table.projectId,
      table.createdAt,
    ),
    companyProjectStatusCreatedIdx: index("project_maintenance_requests_company_project_status_created_idx").on(
      table.companyId,
      table.projectId,
      table.status,
      table.createdAt,
    ),
    companyProjectDedupeIdx: index("project_maintenance_requests_company_project_dedupe_idx").on(
      table.companyId,
      table.projectId,
      table.dedupeHash,
      table.status,
    ),
  }),
);
