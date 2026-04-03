import { z } from "zod";

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color (e.g. #3b82f6)");
const statusValueSchema = z.string().regex(/^[a-z0-9_]+$/, "Value must be lowercase letters, digits, or underscores").min(1).max(32);

export const createProjectIssueStatusSchema = z.object({
  name: z.string().min(1).max(64),
  value: statusValueSchema,
  color: hexColorSchema,
  position: z.number().int().nonnegative().optional(),
  isHumanApproval: z.boolean().optional(),
  approverUserIds: z.array(z.string().uuid()).optional(),
});

export type CreateProjectIssueStatus = z.infer<typeof createProjectIssueStatusSchema>;

export const updateProjectIssueStatusSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: hexColorSchema.optional(),
  position: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isHumanApproval: z.boolean().optional(),
  approverUserIds: z.array(z.string().uuid()).optional(),
});

export type UpdateProjectIssueStatus = z.infer<typeof updateProjectIssueStatusSchema>;

export const reorderProjectIssueStatusesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type ReorderProjectIssueStatuses = z.infer<typeof reorderProjectIssueStatusesSchema>;
