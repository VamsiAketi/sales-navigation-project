import { z } from "zod";
import { PROJECT_ISSUE_STATUS_ALLOWED_ACTORS } from "../constants.js";

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color (e.g. #3b82f6)");
const statusValueSchema = z.string().regex(/^[a-z0-9_]+$/, "Value must be lowercase letters, digits, or underscores").min(1).max(32);

const allowedNextStatusValuesSchema = z
  .array(statusValueSchema)
  .max(32, "At most 32 allowed next statuses");

const allowedActorsSchema = z.enum(PROJECT_ISSUE_STATUS_ALLOWED_ACTORS);

function refineStatusActorDefaults<T extends { allowedActors?: unknown; defaultAssigneeUserId?: unknown; defaultAssigneeAgentId?: unknown }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  const actors = (data.allowedActors ?? "human_and_agent") as string;
  if (actors === "human_only" && data.defaultAssigneeAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Human-only statuses cannot use a default AI assignee.",
      path: ["defaultAssigneeAgentId"],
    });
  }
  if (actors === "agent_only" && data.defaultAssigneeUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AI-only statuses cannot use a default human assignee.",
      path: ["defaultAssigneeUserId"],
    });
  }
  if (data.defaultAssigneeUserId && data.defaultAssigneeAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose at most one default assignee.",
      path: ["defaultAssigneeAgentId"],
    });
  }
}

export const createProjectIssueStatusSchema = z
  .object({
    name: z.string().min(1).max(64),
    value: statusValueSchema,
    color: hexColorSchema,
    position: z.number().int().nonnegative().optional(),
    isHumanApproval: z.boolean().optional(),
    approverUserIds: z.array(z.string().uuid()).optional(),
    allowedActors: allowedActorsSchema.optional(),
    defaultAssigneeUserId: z.string().optional().nullable(),
    defaultAssigneeAgentId: z.string().uuid().optional().nullable(),
    allowedNextStatusValues: allowedNextStatusValuesSchema.optional(),
  })
  .superRefine((data, ctx) => {
    refineStatusActorDefaults(data, ctx);
    if (data.isHumanApproval) {
      const ids = data.approverUserIds ?? [];
      if (ids.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select at least one approver for a human approval stage.",
          path: ["approverUserIds"],
        });
      }
      if (data.allowedActors != null && data.allowedActors !== "human_only") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Human approval stages must use human-only assignment.",
          path: ["allowedActors"],
        });
      }
    }
  });

export type CreateProjectIssueStatus = z.infer<typeof createProjectIssueStatusSchema>;

export const updateProjectIssueStatusSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: hexColorSchema.optional(),
  position: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isHumanApproval: z.boolean().optional(),
  approverUserIds: z.array(z.string().uuid()).optional(),
  allowedActors: allowedActorsSchema.optional(),
  defaultAssigneeUserId: z.string().optional().nullable(),
  defaultAssigneeAgentId: z.string().uuid().optional().nullable(),
  allowedNextStatusValues: allowedNextStatusValuesSchema.optional(),
});

export type UpdateProjectIssueStatus = z.infer<typeof updateProjectIssueStatusSchema>;

export const reorderProjectIssueStatusesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type ReorderProjectIssueStatuses = z.infer<typeof reorderProjectIssueStatusesSchema>;
