import { pgTable, uuid, text, timestamp, date, boolean, index, uniqueIndex, jsonb, integer } from "drizzle-orm/pg-core";
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
    /** Postgres schema name used for project-scoped operational tables/views (e.g. prj_ab12cd). */
    dataSchemaName: text("data_schema_name"),
    envConfig: jsonb("env_config").$type<Record<string, unknown> | null>(),
    /** Env var name -> project secret name (resolved at agent runtime within this project). */
    projectEnvConfig: jsonb("project_env_config").$type<Record<string, unknown> | null>(),
    notificationConfig: jsonb("notification_config").$type<Record<string, unknown> | null>(),
    /** Short uppercase key used as the prefix for issue identifiers (e.g. "AIH" → "AIH-1"). */
    issuePrefix: text("issue_prefix"),
    /** Per-project counter; incremented atomically on each new issue in this project. */
    issueCounter: integer("issue_counter").notNull().default(0),
    /**
     * Done/Cancelled tasks stay on the board only if closed within this many full days
     * (uses completed_at / cancelled_at). Older tasks appear under the project Archive tab. Minimum 1; default 7.
     */
    boardClosedRetentionDays: integer("board_closed_retention_days").notNull().default(7),
    /**
     * When true, heartbeat runs for issues in this project merge all decrypted project secrets
     * into adapter env under keys derived from each secret name (explicit agent env wins on clashes).
     */
    exposeProjectSecretsOnIssueRuns: boolean("expose_project_secrets_on_issue_runs").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("projects_company_idx").on(table.companyId),
    // Issue identifiers are globally unique (issues_identifier_idx has no company scope),
    // so project prefixes must be globally unique too — no company_id scoping here.
    issuePrefixUniqueIdx: uniqueIndex("projects_issue_prefix_company_idx").on(table.issuePrefix),
  }),
);
