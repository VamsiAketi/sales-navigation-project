import { z } from "zod";
import { BILLING_TYPES } from "../constants.js";

export const createCostEventSchema = z.object({
  idempotencyKey: z.string().min(1).max(200).optional(),
  agentId: z.string().uuid(),
  issueId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  heartbeatRunId: z.string().uuid().optional().nullable(),
  billingCode: z.string().optional().nullable(),
  provider: z.string().min(1),
  biller: z.string().min(1).optional(),
  billingType: z.enum(BILLING_TYPES).optional().default("unknown"),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().optional().default(0),
  cachedInputTokens: z.number().int().nonnegative().optional().default(0),
  outputTokens: z.number().int().nonnegative().optional().default(0),
  costCents: z.number().int().nonnegative(),
  /** Token/model-table estimate; omit to derive from model + token counts server-side */
  modelCostCents: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
}).transform((value) => ({
  ...value,
  biller: value.biller ?? value.provider,
}));

export type CreateCostEvent = z.infer<typeof createCostEventSchema>;

export const updateBudgetSchema = z.object({
  budgetMonthlyCents: z.number().int().nonnegative(),
});

export type UpdateBudget = z.infer<typeof updateBudgetSchema>;

export const createStripeCheckoutSessionSchema = z.object({
  amountCents: z.number().int().min(50).max(50_000_00),
  idempotencyKey: z.string().min(1).max(200).optional(),
  returnPath: z.string().startsWith("/").optional(),
});

export type CreateStripeCheckoutSession = z.infer<typeof createStripeCheckoutSessionSchema>;
