import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { assets } from "./assets.js";
import { agents } from "./agents.js";

export const projectContextFiles = pgTable(
  "project_context_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    extractionStatus: text("extraction_status").notNull().default("pending"),
    extractedText: text("extracted_text"),
    extractionError: text("extraction_error"),
    uploadedByUserId: text("uploaded_by_user_id"),
    uploadedByAgentId: uuid("uploaded_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectCreatedIdx: index("project_context_files_company_project_created_idx").on(
      table.companyId,
      table.projectId,
      table.createdAt,
    ),
    companyProjectStatusIdx: index("project_context_files_company_project_status_idx").on(
      table.companyId,
      table.projectId,
      table.extractionStatus,
    ),
    companyAssetIdx: index("project_context_files_company_asset_idx").on(table.companyId, table.assetId),
  }),
);
