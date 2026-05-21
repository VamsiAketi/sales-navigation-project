import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
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
    isHumanApproval: boolean("is_human_approval").notNull().default(false),
    approverUserIds: jsonb("approver_user_ids").$type<string[]>().notNull().default([]),
    /** Who may work the task in this stage: human, agent, or both. */
    allowedActors: text("allowed_actors").notNull().default("human_and_agent"),
    /** Human-readable description for this stage's purpose. */
    description: text("description"),
    /** Agent-facing playbook for how to operate in this stage. */
    agentInstructions: text("agent_instructions"),
    /** Optional capability tags associated with this stage. */
    agentCapabilityTags: jsonb("agent_capability_tags").$type<string[]>().notNull().default([]),
    defaultAssigneeUserId: text("default_assignee_user_id"),
    defaultAssigneeAgentId: uuid("default_assignee_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    /** Latest playbook revision row id (for restore/audit navigation). */
    latestPlaybookRevisionId: uuid("latest_playbook_revision_id"),
    latestPlaybookRevisionNumber: integer("latest_playbook_revision_number"),
    /** When set, sync should not overwrite playbook fields automatically. */
    playbookLockedByUserId: text("playbook_locked_by_user_id"),
    /** When non-empty, issues may only leave this status for listed `value` keys. Empty = no restriction. */
    allowedNextStatusValues: jsonb("allowed_next_status_values").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectValueIdx: uniqueIndex("proj_statuses_project_value_idx").on(table.projectId, table.value),
    projectActivePosIdx: index("proj_statuses_project_active_pos_idx").on(table.projectId, table.isActive, table.position),
    companyIdx: index("proj_statuses_company_idx").on(table.companyId),
  }),
);
