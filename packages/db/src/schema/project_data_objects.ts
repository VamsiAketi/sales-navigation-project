import { pgTable, uuid, text, jsonb, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectDataObjects = pgTable(
  "project_data_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    schemaName: text("schema_name"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
    latestRevisionNumber: integer("latest_revision_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectNameUq: uniqueIndex("project_data_objects_company_project_name_uq").on(
      table.companyId,
      table.projectId,
      table.normalizedName,
    ),
    companyProjectKindIdx: index("project_data_objects_company_project_kind_idx").on(
      table.companyId,
      table.projectId,
      table.kind,
    ),
    companyProjectUpdatedIdx: index("project_data_objects_company_project_updated_idx").on(
      table.companyId,
      table.projectId,
      table.updatedAt,
    ),
  }),
);
