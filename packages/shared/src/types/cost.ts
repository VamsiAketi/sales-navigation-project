import type { BillingType } from "../constants.js";

export interface CostEvent {
  id: string;
  idempotencyKey?: string | null;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  heartbeatRunId: string | null;
  billingCode: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  modelCostCents: number;
  occurredAt: Date;
  createdAt: Date;
}

export interface CostSummary {
  companyId: string;
  spendCents: number;
  modelSpendCents: number;
  budgetCents: number;
  utilizationPercent: number;
}

/** Aggregated `cost_events` per calendar day (UTC), for charts and billing summaries. */
/** Instance prepaid credit vs cumulative model-based spend (all companies). */
export interface BillingPrepaidBalance {
  prepaidCents: number;
  /** Sum of `cost_events.model_cost_cents` for this company. */
  usedModelCents: number;
  remainingCents: number;
  deficitCents: number;
  /** Ledger net (credits minus debits), may be negative. */
  walletNetCents: number;
  /** Sum of active per-run wallet holds (`company_wallet_reservations`). */
  reservedCents: number;
  /** `walletNetCents` minus `reservedCents` — capacity for new agent runs. */
  availableCents: number;
}

export interface StripeBillingStatus {
  enabled: boolean;
  hasWebhookSecret: boolean;
}

export interface StripePortalSession {
  url: string;
}

export interface StripeCheckoutSession {
  sessionId: string;
  url: string;
}

export interface StripeCheckoutSessionStatus {
  sessionId: string;
  status: "paid" | "unpaid";
  paymentStatus: string | null;
}

/** Stripe Invoice summary for Billing UI (from `stripe.invoices.list`). */
export interface StripeInvoiceRow {
  id: string;
  number: string | null;
  /** Invoice or line-item description when Stripe provides it. */
  description: string | null;
  status: string | null;
  amountPaidCents: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface StripeInvoicesResponse {
  invoices: StripeInvoiceRow[];
}

export interface CostDailyTotal {
  /** `YYYY-MM-DD` (UTC) */
  day: string;
  costCents: number;
  /** Sum of `model_cost_cents` (token × pricing table estimate at write time). */
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface CostByAgent {
  agentId: string;
  agentName: string | null;
  agentStatus: string | null;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByProviderModel {
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}

export interface CostByBiller {
  biller: string;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionCachedInputTokens: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
  providerCount: number;
  modelCount: number;
}

/** per-agent breakdown by provider + model, for identifying token-hungry agents */
export interface CostByAgentModel {
  agentId: string;
  agentName: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** spend per provider for a fixed rolling time window */
export interface CostWindowSpendRow {
  provider: string;
  biller: string;
  /** duration label, e.g. "5h", "24h", "7d" */
  window: string;
  /** rolling window duration in hours */
  windowHours: number;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** cost attributed to a project via heartbeat run → activity log → issue → project chain */
export interface CostByProject {
  projectId: string | null;
  projectName: string | null;
  costCents: number;
  modelCostCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}
