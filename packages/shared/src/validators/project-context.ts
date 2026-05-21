import { z } from "zod";
import {
  PROJECT_CONTEXT_FILE_EXTRACTION_STATUSES,
  PROJECT_MAINTENANCE_REQUEST_STATUSES,
  PROJECT_MAINTENANCE_REQUEST_TYPES,
  PROJECT_MAINTENANCE_RISK_CLASSES,
  PROJECT_DATA_OBJECT_KINDS,
  PROJECT_VIEW_WIDGET_TYPES,
} from "../constants.js";

export const projectDocumentFormatSchema = z.enum(["markdown"]);
export type ProjectDocumentFormat = z.infer<typeof projectDocumentFormatSchema>;

export const projectDocumentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]{0,63}$/, "Document key must start with a lowercase letter and use a-z, 0-9, _ or -");

export const upsertProjectDocumentSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  format: projectDocumentFormatSchema,
  body: z.string().max(52428800),
  changeSummary: z.string().trim().max(1000).nullable().optional(),
});
export type UpsertProjectDocument = z.infer<typeof upsertProjectDocumentSchema>;

export const projectMaintenanceContextRefSchema = z.record(z.unknown()).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 8192,
  "contextRef must be <= 8192 bytes",
);

export const createProjectMaintenanceRequestSchema = z.object({
  type: z.enum(PROJECT_MAINTENANCE_REQUEST_TYPES),
  description: z.string().trim().min(20).max(4000),
  contextRef: projectMaintenanceContextRefSchema.optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});
export type CreateProjectMaintenanceRequest = z.infer<typeof createProjectMaintenanceRequestSchema>;

export const patchProjectMaintenanceRequestSchema = z.object({
  status: z.enum(PROJECT_MAINTENANCE_REQUEST_STATUSES).optional(),
  changeRiskClass: z.enum(PROJECT_MAINTENANCE_RISK_CLASSES).optional(),
  riskReasons: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  changeSummary: z.string().trim().max(1000).nullable().optional(),
  failureReason: z.string().trim().max(2000).nullable().optional(),
});
export type PatchProjectMaintenanceRequest = z.infer<typeof patchProjectMaintenanceRequestSchema>;

export const approveProjectMaintenanceRequestSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});
export type ApproveProjectMaintenanceRequest = z.infer<typeof approveProjectMaintenanceRequestSchema>;

export const rejectProjectMaintenanceRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectProjectMaintenanceRequest = z.infer<typeof rejectProjectMaintenanceRequestSchema>;

export const projectScopedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9_]{0,62}$/, "Must start with a lowercase letter and use a-z, 0-9, _ only");

export const projectDataColumnTypeSchema = z.enum([
  "text",
  "int",
  "bigint",
  "numeric",
  "bool",
  "uuid",
  "timestamptz",
  "jsonb",
]);

export const projectDataColumnSchema = z.object({
  name: projectScopedIdentifierSchema,
  type: projectDataColumnTypeSchema,
  nullable: z.boolean().optional().default(true),
  default: z.string().trim().max(500).optional().nullable(),
});

export const projectDataForeignKeySchema = z.object({
  columns: z.array(projectScopedIdentifierSchema).min(1).max(8),
  references: z.object({
    table: projectScopedIdentifierSchema,
    columns: z.array(projectScopedIdentifierSchema).min(1).max(8),
  }),
  onDelete: z.enum(["cascade", "restrict", "set null"]).optional().default("restrict"),
});

export const createProjectDataTableSchema = z.object({
  name: projectScopedIdentifierSchema,
  columns: z.array(projectDataColumnSchema).min(1).max(128),
  primaryKey: z.array(projectScopedIdentifierSchema).min(1).max(8),
  foreignKeys: z.array(projectDataForeignKeySchema).max(64).optional().default([]),
});
export type CreateProjectDataTable = z.infer<typeof createProjectDataTableSchema>;

export const addProjectDataColumnSchema = z.object({
  name: projectScopedIdentifierSchema,
  type: projectDataColumnTypeSchema,
  nullable: z.boolean().optional().default(true),
  default: z.string().trim().max(500).optional().nullable(),
});
export type AddProjectDataColumn = z.infer<typeof addProjectDataColumnSchema>;

export const projectDataRefSchema = z.object({
  kind: z.enum(PROJECT_DATA_OBJECT_KINDS),
  name: projectScopedIdentifierSchema,
});

export const projectDataFilterSchema = z.object({
  column: z.string().trim().min(1).max(120),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "is_null", "like"]),
  value: z.unknown().optional(),
});

export const projectDataQuerySchema = z.object({
  ref: projectDataRefSchema,
  filters: z.array(projectDataFilterSchema).max(50).optional().default([]),
  orderBy: z
    .array(
      z.object({
        column: z.string().trim().min(1).max(120),
        direction: z.enum(["asc", "desc"]).optional().default("asc"),
      }),
    )
    .max(20)
    .optional()
    .default([]),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).max(10000).optional().default(0),
});
export type ProjectDataQuery = z.infer<typeof projectDataQuerySchema>;

export const createProjectViewSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  layout: z.record(z.unknown()).nullable().optional(),
});
export type CreateProjectView = z.infer<typeof createProjectViewSchema>;

export const createProjectViewWidgetSchema = z.object({
  title: z.string().trim().min(1).max(120).optional().nullable(),
  type: z.enum(PROJECT_VIEW_WIDGET_TYPES),
  position: z.number().int().min(0).max(10000).optional(),
  queryRef: z.record(z.unknown()).optional().nullable(),
  config: z.record(z.unknown()).optional().nullable(),
  layout: z.record(z.unknown()).optional().nullable(),
});
export type CreateProjectViewWidget = z.infer<typeof createProjectViewWidgetSchema>;

export const updateProjectViewWidgetSchema = createProjectViewWidgetSchema.partial();
export type UpdateProjectViewWidget = z.infer<typeof updateProjectViewWidgetSchema>;

export const projectContextFileExtractionStatusSchema = z.enum(PROJECT_CONTEXT_FILE_EXTRACTION_STATUSES);
export type ProjectContextFileExtractionStatusValue = z.infer<typeof projectContextFileExtractionStatusSchema>;
