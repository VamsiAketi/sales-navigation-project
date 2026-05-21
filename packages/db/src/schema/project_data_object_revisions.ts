import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectDataObjects } from "./project_data_objects.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const projectDataObjectRevisions = pgTable(
  "project_data_object_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectDataObjectId: uuid("project_data_object_id")
      .notNull()
      .references(() => projectDataObjects.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
    changeSource: text("change_source").notNull().default("human"),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    objectRevisionUq: uniqueIndex("project_data_object_revisions_object_revision_uq").on(
      table.projectDataObjectId,
      table.revisionNumber,
    ),
    companyProjectObjectCreatedIdx: index("project_data_object_revisions_company_project_object_created_idx").on(
      table.companyId,
      table.projectId,
      table.projectDataObjectId,
      table.createdAt,
    ),
  }),
);
