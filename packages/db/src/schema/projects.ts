import { pgTable, uuid, text, timestamp, date, index, uniqueIndex, jsonb, integer } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    goalId: uuid("goal_id").references(() => goals.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("backlog"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id),
    targetDate: date("target_date"),
    color: text("color"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    executionWorkspacePolicy: jsonb("execution_workspace_policy").$type<Record<string, unknown>>(),
    envConfig: jsonb("env_config").$type<Record<string, unknown> | null>(),
    notificationConfig: jsonb("notification_config").$type<Record<string, unknown> | null>(),
    /** Short uppercase key used as the prefix for issue identifiers (e.g. "AIH" → "AIH-1"). */
    issuePrefix: text("issue_prefix"),
    /** Per-project counter; incremented atomically on each new issue in this project. */
    issueCounter: integer("issue_counter").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("projects_company_idx").on(table.companyId),
    issuePrefixCompanyUniqueIdx: uniqueIndex("projects_issue_prefix_company_idx").on(table.companyId, table.issuePrefix),
  }),
);
