import Stripe from "stripe";
import type { StripeCheckoutCreditResult } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { billingAlerts, companies, companyWalletTransactions, stripeCheckoutIntents, stripeProcessedEvents } from "@paperclipai/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logActivity } from "./activity-log.js";

const COMPANY_METADATA_KEY = "paperclip_company_id";

export function stripeSecretsFromEnv(): {
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
} {
  return {
    stripeSecretKey: process.env.PAPERCLIP_STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret:
      process.env.PAPERCLIP_STRIPE_WEBHOOK_SECRET?.trim() || process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
  };
}

export function stripeBillingBrandingFromEnv(): {
  businessName: string;
  businessDescription: string;
} {
  return {
    businessName: "AI-HARNESS",
    businessDescription: "Human-Led. AI-Powered. One Team.",
  };
}

export function findStripeCustomerByCompanyId(
  db: Db,
  stripe: Stripe,
  companyId: string,
): Promise<Stripe.Customer | null> {
  return db
    .select({ stripeCustomerId: companies.stripeCustomerId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .then(async (rows) => {
      const stripeCustomerId = rows[0]?.stripeCustomerId?.trim();
      if (stripeCustomerId) {
        try {
          const customer = await stripe.customers.retrieve(stripeCustomerId);
          if (!("deleted" in customer) || customer.deleted) {
            return null;
          }
          return customer;
        } catch {
          // fall through to metadata-based discovery and then create if still not found
        }
      }
      try {
        const escapedCompanyId = companyId.replace(/'/g, "\\'");
        const result = await stripe.customers.search({
          query: `metadata['${COMPANY_METADATA_KEY}']:'${escapedCompanyId}'`,
          limit: 1,
        });
        const found = result.data.find((customer) => !customer.deleted) ?? null;
        if (found) {
          await db
            .update(companies)
            .set({ stripeCustomerId: found.id, updatedAt: new Date() })
            .where(eq(companies.id, companyId));
          return found;
        }
      } catch {
        // search API can be unavailable for some accounts/regions; caller can still create
      }
      return null;
    });
}

export async function getOrCreateStripeCustomerForCompany(input: {
  db: Db;
  stripe: Stripe;
  companyId: string;
  companyName: string;
  companyDescription?: string | null;
  userEmail?: string;
}): Promise<Stripe.Customer> {
  const description = input.companyDescription?.trim()
    ? input.companyDescription.trim()
    : `Paperclip company: ${input.companyName}`;
  const existing = await findStripeCustomerByCompanyId(input.db, input.stripe, input.companyId);
  if (existing) {
    const shouldUpdate =
      existing.name !== input.companyName ||
      (existing.description ?? "") !== description ||
      (input.userEmail && existing.email !== input.userEmail);
    if (shouldUpdate) {
      return input.stripe.customers.update(existing.id, {
        name: input.companyName,
        description,
        email: input.userEmail ?? existing.email ?? undefined,
      });
    }
    await input.db
      .update(companies)
      .set({ stripeCustomerId: existing.id, updatedAt: new Date() })
      .where(eq(companies.id, input.companyId));
    return existing;
  }
  const created = await input.stripe.customers.create({
    name: input.companyName,
    description,
    email: input.userEmail,
    metadata: {
      [COMPANY_METADATA_KEY]: input.companyId,
    },
  });
  await input.db
    .update(companies)
    .set({ stripeCustomerId: created.id, updatedAt: new Date() })
    .where(eq(companies.id, input.companyId));
  return created;
}

function paymentIntentIdFromUnknown(value: Stripe.Checkout.Session["payment_intent"]): string | null {
  return typeof value === "string" ? value : null;
}

async function createBillingAlert(input: {
  db: Db;
  companyId: string;
  alertType: string;
  severity?: "warning" | "critical";
  message: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  await input.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: billingAlerts.id, count: billingAlerts.occurrenceCount })
      .from(billingAlerts)
      .where(and(eq(billingAlerts.companyId, input.companyId), eq(billingAlerts.dedupeKey, input.dedupeKey)))
      .orderBy(desc(billingAlerts.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (existing) {
      await tx
        .update(billingAlerts)
        .set({
          occurrenceCount: (existing.count ?? 1) + 1,
          metadataJson: input.metadata ?? null,
        })
        .where(eq(billingAlerts.id, existing.id));
      return;
    }
    await tx.insert(billingAlerts).values({
      companyId: input.companyId,
      severity: input.severity ?? "warning",
      alertType: input.alertType,
      message: input.message,
      dedupeKey: input.dedupeKey,
      metadataJson: input.metadata ?? null,
      createdAt: now,
    });
  });
}

async function upsertCheckoutIntentFromSession(db: Db, session: Stripe.Checkout.Session, status: string, webhookEventId?: string) {
  const companyId = session.metadata?.[COMPANY_METADATA_KEY]?.trim();
  if (!companyId) return;
  const amountCents = session.amount_total ?? 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return;
  const now = new Date();
  const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);
  await db
    .insert(stripeCheckoutIntents)
    .values({
      companyId,
      checkoutSessionId: session.id,
      paymentIntentId,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      amountCents,
      currency: (session.currency ?? "usd").toLowerCase(),
      status,
      webhookEventId: webhookEventId ?? null,
      updatedAt: now,
      metadataJson: {
        paymentStatus: session.payment_status ?? null,
      },
    })
    .onConflictDoUpdate({
      target: stripeCheckoutIntents.checkoutSessionId,
      set: {
        paymentIntentId,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
        amountCents,
        currency: (session.currency ?? "usd").toLowerCase(),
        status,
        webhookEventId: webhookEventId ?? null,
        updatedAt: now,
      },
    });
}

type DbExecutor = Pick<Db, "insert" | "update" | "select" | "transaction">;

async function creditWalletFromPaidCheckoutSession(
  db: DbExecutor,
  session: Stripe.Checkout.Session,
  audit: { stripeEventId: string; actorId: string; eventType?: string },
): Promise<StripeCheckoutCreditResult> {
  const companyId = session.metadata?.[COMPANY_METADATA_KEY]?.trim();
  if (!companyId) return "no_company";

  await upsertCheckoutIntentFromSession(db as Db, session, session.payment_status === "paid" ? "paid" : "created", audit.stripeEventId);
  if (session.payment_status !== "paid") return "not_paid";

  const amountCents = session.amount_total ?? 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return "invalid_amount";

  if (await hasWalletCreditForCheckoutSession(db as Db, companyId, session.id)) {
    return "already_credited";
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  await db.insert(companyWalletTransactions).values({
    companyId,
    amountCents,
    currency: (session.currency ?? "usd").toLowerCase(),
    direction: "credit",
    sourceType: "stripe_checkout",
    sourceId: session.id,
    stripeEventId: audit.stripeEventId,
    checkoutSessionId: session.id,
    paymentIntentId,
    metadataJson: {
      stripeEventType: audit.eventType ?? "checkout.session.completed",
      paymentStatus: session.payment_status,
      creditSource: audit.actorId,
    },
  }).onConflictDoNothing();

  await db
    .update(stripeCheckoutIntents)
    .set({
      status: "credited",
      webhookEventId: audit.stripeEventId,
      updatedAt: new Date(),
    })
    .where(eq(stripeCheckoutIntents.checkoutSessionId, session.id));

  return "credited";
}

async function logCheckoutWalletCredit(
  db: Db,
  session: Stripe.Checkout.Session,
  audit: { stripeEventId: string; actorId: string },
): Promise<void> {
  const companyId = session.metadata?.[COMPANY_METADATA_KEY]?.trim();
  if (!companyId) return;
  const amountCents = session.amount_total ?? 0;
  await logActivity(db, {
    companyId,
    actorType: "system",
    actorId: audit.actorId,
    action: "billing.prepaid_credit.added",
    entityType: "company_wallet_transaction",
    entityId: session.id,
    details: {
      stripeEventId: audit.stripeEventId,
      amountCents,
      currency: session.currency,
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status,
    },
  });
}

/** Apply wallet credit after Stripe redirect when webhooks have not reached the server yet (e.g. local dev). */
export async function syncStripeCheckoutSessionCredit(
  db: Db,
  session: Stripe.Checkout.Session,
): Promise<StripeCheckoutCreditResult> {
  const audit = {
    stripeEventId: `checkout_sync:${session.id}`,
    actorId: "stripe-checkout-sync",
    eventType: "checkout.session.completed",
  };
  const result = await creditWalletFromPaidCheckoutSession(db, session, audit);
  if (result === "credited") {
    await logCheckoutWalletCredit(db, session, audit);
  }
  return result;
}

export async function applyStripeCheckoutCreditFromEvent(db: Db, event: Stripe.CheckoutSessionCompletedEvent): Promise<void> {
  const session = event.data.object;
  const companyId = session.metadata?.[COMPANY_METADATA_KEY]?.trim();
  if (!companyId) return;

  let creditResult: StripeCheckoutCreditResult | null = null;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeProcessedEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
      })
      .onConflictDoNothing()
      .returning({ id: stripeProcessedEvents.id })
      .then((rows) => rows[0] ?? null);
    if (!inserted) return;

    creditResult = await creditWalletFromPaidCheckoutSession(tx, session, {
      stripeEventId: event.id,
      actorId: "stripe-webhook",
      eventType: event.type,
    });
  });

  if (creditResult === "credited") {
    await logCheckoutWalletCredit(db, session, { stripeEventId: event.id, actorId: "stripe-webhook" });
  } else if (creditResult === "already_credited") {
    await markCheckoutIntentLifecycle(db, session.id, "credited", event.id);
  }
}

export async function handleStripeInvoicePaidEvent(db: Db, event: Stripe.InvoicePaidEvent): Promise<void> {
  const invoice = event.data.object;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const companyId = await lookupCompanyIdByStripeCustomerId(db, customerId);
  if (!companyId) return;
  await markStripeEventProcessed(db, event.id, event.type);
  await db
    .update(stripeCheckoutIntents)
    .set({
      status: "reconciled",
      updatedAt: new Date(),
      reconciledAt: new Date(),
      webhookEventId: event.id,
    })
    .where(and(eq(stripeCheckoutIntents.companyId, companyId), eq(stripeCheckoutIntents.status, "credited")));
}

export async function handleStripeInvoicePaymentFailedEvent(db: Db, event: Stripe.InvoicePaymentFailedEvent): Promise<void> {
  const invoice = event.data.object;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const companyId = await lookupCompanyIdByStripeCustomerId(db, customerId);
  if (!companyId) return;
  await markStripeEventProcessed(db, event.id, event.type);
  await createBillingAlert({
    db,
    companyId,
    alertType: "invoice_payment_failed",
    severity: "critical",
    message: "Stripe invoice payment failed. Check billing account and retry payment.",
    dedupeKey: `invoice-payment-failed:${invoice.id}`,
    metadata: { invoiceId: invoice.id, stripeEventId: event.id },
  });
}

async function applyWalletDebitFromChargeLikeEvent(input: {
  db: Db;
  companyId: string;
  amountCents: number;
  currency: string | null | undefined;
  sourceType: string;
  sourceId: string;
  stripeEventId: string;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return;
  await input.db
    .insert(companyWalletTransactions)
    .values({
      companyId: input.companyId,
      amountCents: input.amountCents,
      currency: (input.currency ?? "usd").toLowerCase(),
      direction: "debit",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      stripeEventId: input.stripeEventId,
      metadataJson: input.metadata ?? null,
    })
    .onConflictDoNothing();
}

export async function handleStripeChargeRefundedEvent(db: Db, event: Stripe.ChargeRefundedEvent): Promise<void> {
  const charge = event.data.object;
  const customerId = typeof charge.customer === "string" ? charge.customer : null;
  if (!customerId) return;
  const companyId = await lookupCompanyIdByStripeCustomerId(db, customerId);
  if (!companyId) return;
  const processed = await markStripeEventProcessed(db, event.id, event.type);
  if (!processed) {
    await createBillingAlert({
      db,
      companyId,
      alertType: "duplicate_stripe_event_drop",
      message: "Duplicate Stripe event was dropped safely.",
      dedupeKey: `duplicate:${event.id}`,
      metadata: { stripeEventId: event.id, eventType: event.type },
    });
    return;
  }
  const refundAmount = charge.amount_refunded ?? 0;
  await applyWalletDebitFromChargeLikeEvent({
    db,
    companyId,
    amountCents: refundAmount,
    currency: charge.currency,
    sourceType: "stripe_refund",
    sourceId: charge.id,
    stripeEventId: event.id,
    metadata: { chargeId: charge.id, refundAmount },
  });
}

export async function handleStripeChargeDisputeCreatedEvent(db: Db, event: Stripe.ChargeDisputeCreatedEvent): Promise<void> {
  const dispute = event.data.object;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : null;
  if (!chargeId) return;
  const processed = await markStripeEventProcessed(db, event.id, event.type);
  if (!processed) return;
  const companyId = await lookupCompanyIdFromRecentCheckoutByPaymentIntent(db, dispute.payment_intent as string | null);
  if (!companyId) return;
  await applyWalletDebitFromChargeLikeEvent({
    db,
    companyId,
    amountCents: dispute.amount ?? 0,
    currency: dispute.currency,
    sourceType: "stripe_dispute",
    sourceId: dispute.id,
    stripeEventId: event.id,
    metadata: { chargeId, disputeId: dispute.id },
  });
  await createBillingAlert({
    db,
    companyId,
    alertType: "charge_dispute_created",
    severity: "critical",
    message: "Stripe charge dispute created. Wallet has been debited pending dispute resolution.",
    dedupeKey: `dispute:${dispute.id}`,
    metadata: { stripeEventId: event.id, disputeId: dispute.id },
  });
}

export async function lookupCompanyIdByStripeCustomerId(db: Db, stripeCustomerId: string): Promise<string | null> {
  const row = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.stripeCustomerId, stripeCustomerId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.id ?? null;
}

async function lookupCompanyIdFromRecentCheckoutByPaymentIntent(db: Db, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const row = await db
    .select({ companyId: stripeCheckoutIntents.companyId })
    .from(stripeCheckoutIntents)
    .where(eq(stripeCheckoutIntents.paymentIntentId, paymentIntentId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.companyId ?? null;
}

export async function getCompanyWalletCreditTotalCents(db: Db, companyId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`
        coalesce(
          sum(
            case
              when ${companyWalletTransactions.direction} = 'credit' then ${companyWalletTransactions.amountCents}
              else -${companyWalletTransactions.amountCents}
            end
          ),
          0
        )::bigint
      `,
    })
    .from(companyWalletTransactions)
    .where(eq(companyWalletTransactions.companyId, companyId));
  return Number(row?.total ?? 0);
}

export async function getCompanyWalletTotals(db: Db, companyId: string): Promise<{ creditCents: number; debitCents: number; netCents: number }> {
  const [row] = await db
    .select({
      creditCents: sql<number>`coalesce(sum(case when ${companyWalletTransactions.direction} = 'credit' then ${companyWalletTransactions.amountCents} else 0 end),0)::bigint`,
      debitCents: sql<number>`coalesce(sum(case when ${companyWalletTransactions.direction} = 'debit' then ${companyWalletTransactions.amountCents} else 0 end),0)::bigint`,
      netCents: sql<number>`coalesce(sum(case when ${companyWalletTransactions.direction} = 'credit' then ${companyWalletTransactions.amountCents} else -${companyWalletTransactions.amountCents} end),0)::bigint`,
    })
    .from(companyWalletTransactions)
    .where(eq(companyWalletTransactions.companyId, companyId));
  return {
    creditCents: Number(row?.creditCents ?? 0),
    debitCents: Number(row?.debitCents ?? 0),
    netCents: Number(row?.netCents ?? 0),
  };
}

export async function markStripeEventProcessed(db: Db, eventId: string, eventType: string): Promise<boolean> {
  const row = await db
    .insert(stripeProcessedEvents)
    .values({ stripeEventId: eventId, eventType })
    .onConflictDoNothing()
    .returning({ id: stripeProcessedEvents.id })
    .then((rows) => rows[0] ?? null);
  return Boolean(row);
}

export async function createCheckoutIntentRecord(input: {
  db: Db;
  companyId: string;
  checkoutSessionId: string;
  amountCents: number;
  currency: string;
  stripeCustomerId: string | null;
  paymentIntentId: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  await input.db
    .insert(stripeCheckoutIntents)
    .values({
      companyId: input.companyId,
      checkoutSessionId: input.checkoutSessionId,
      amountCents: input.amountCents,
      currency: input.currency.toLowerCase(),
      stripeCustomerId: input.stripeCustomerId,
      paymentIntentId: input.paymentIntentId,
      status: input.status ?? "created",
      metadataJson: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: stripeCheckoutIntents.checkoutSessionId,
      set: {
        amountCents: input.amountCents,
        currency: input.currency.toLowerCase(),
        stripeCustomerId: input.stripeCustomerId,
        paymentIntentId: input.paymentIntentId,
        status: input.status ?? "created",
        metadataJson: input.metadata ?? null,
        updatedAt: now,
      },
    });
}

export async function markCheckoutIntentLifecycle(
  db: Db,
  checkoutSessionId: string,
  status: "paid" | "credited" | "reconciled" | "failed",
  webhookEventId?: string,
): Promise<void> {
  await db
    .update(stripeCheckoutIntents)
    .set({
      status,
      webhookEventId: webhookEventId ?? null,
      updatedAt: new Date(),
      reconciledAt: status === "reconciled" ? new Date() : null,
    })
    .where(eq(stripeCheckoutIntents.checkoutSessionId, checkoutSessionId));
}

export async function runStripeBillingReconciliation(input: { db: Db; stripe: Stripe }): Promise<void> {
  const pending = await input.db
    .select()
    .from(stripeCheckoutIntents)
    .where(and(isNull(stripeCheckoutIntents.reconciledAt), eq(stripeCheckoutIntents.status, "credited")))
    .orderBy(desc(stripeCheckoutIntents.updatedAt))
    .limit(100);
  for (const intent of pending) {
    try {
      const session = await input.stripe.checkout.sessions.retrieve(intent.checkoutSessionId);
      const paid = session.payment_status === "paid";
      if (!paid) {
        await createBillingAlert({
          db: input.db,
          companyId: intent.companyId,
          alertType: "credit_drift",
          severity: "critical",
          message: "Checkout intent was credited but Stripe session is not paid.",
          dedupeKey: `credit-drift:${intent.checkoutSessionId}`,
          metadata: { checkoutSessionId: intent.checkoutSessionId, sessionPaymentStatus: session.payment_status },
        });
        continue;
      }
      await markCheckoutIntentLifecycle(input.db, intent.checkoutSessionId, "reconciled");
    } catch (error) {
      await createBillingAlert({
        db: input.db,
        companyId: intent.companyId,
        alertType: "reconciliation_failed",
        message: "Stripe reconciliation failed for checkout intent.",
        dedupeKey: `reconcile-failed:${intent.checkoutSessionId}`,
        metadata: { checkoutSessionId: intent.checkoutSessionId, error: String(error) },
      });
    }
  }

  const companiesWithWallet = await input.db
    .select({ id: companies.id })
    .from(companies);
  for (const company of companiesWithWallet) {
    const totals = await getCompanyWalletTotals(input.db, company.id);
    if (totals.netCents < 0) {
      await createBillingAlert({
        db: input.db,
        companyId: company.id,
        alertType: "negative_balance_threshold",
        severity: "critical",
        message: "Company wallet balance is negative.",
        dedupeKey: `negative-balance:${company.id}`,
        metadata: { netCents: totals.netCents, creditCents: totals.creditCents, debitCents: totals.debitCents },
      });
    }
  }
}

export async function recordStripeWebhookProcessingFailureAlert(
  db: Db,
  event: Stripe.Event,
  error: unknown,
): Promise<void> {
  const companyId = extractCompanyIdFromStripeEvent(event);
  if (!companyId) return;
  await createBillingAlert({
    db,
    companyId,
    alertType: "webhook_processing_failed",
    severity: "critical",
    message: "Stripe webhook processing failed for a billing event.",
    dedupeKey: `webhook-failed:${event.id}`,
    metadata: {
      stripeEventId: event.id,
      eventType: event.type,
      error: String(error),
    },
  });
}

function extractCompanyIdFromStripeEvent(event: Stripe.Event): string | null {
  if ("data" in event && event.data && typeof event.data === "object") {
    const object = (event.data as { object?: unknown }).object;
    if (object && typeof object === "object") {
      const metadata = (object as { metadata?: Record<string, unknown> }).metadata;
      const companyId = typeof metadata?.[COMPANY_METADATA_KEY] === "string"
        ? metadata[COMPANY_METADATA_KEY]
        : null;
      if (companyId && companyId.trim().length > 0) return companyId.trim();
      const customer = (object as { customer?: unknown }).customer;
      if (typeof customer === "string" && customer.startsWith("cus_")) {
        return null;
      }
    }
  }
  return null;
}

export async function hasWalletCreditForCheckoutSession(db: Db, companyId: string, checkoutSessionId: string): Promise<boolean> {
  const row = await db
    .select({ id: companyWalletTransactions.id })
    .from(companyWalletTransactions)
    .where(
      and(
        eq(companyWalletTransactions.companyId, companyId),
        eq(companyWalletTransactions.sourceType, "stripe_checkout"),
        eq(companyWalletTransactions.sourceId, checkoutSessionId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return Boolean(row);
}
