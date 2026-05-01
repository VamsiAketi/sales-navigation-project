import Stripe from "stripe";
import type { Db } from "@paperclipai/db";
import { instanceSettingsService } from "./instance-settings.js";
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
  stripe: Stripe,
  companyId: string,
): Promise<Stripe.Customer | null> {
  return stripe.customers
    .list({ limit: 100 })
    .then((result) =>
      result.data.find(
        (customer) => !customer.deleted && customer.metadata?.[COMPANY_METADATA_KEY] === companyId,
      ) ?? null,
    );
}

export async function getOrCreateStripeCustomerForCompany(input: {
  stripe: Stripe;
  companyId: string;
  companyName: string;
  companyDescription?: string | null;
  userEmail?: string;
}): Promise<Stripe.Customer> {
  const description = input.companyDescription?.trim()
    ? input.companyDescription.trim()
    : `Paperclip company: ${input.companyName}`;
  const existing = await findStripeCustomerByCompanyId(input.stripe, input.companyId);
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
    return existing;
  }
  return input.stripe.customers.create({
    name: input.companyName,
    description,
    email: input.userEmail,
    metadata: {
      [COMPANY_METADATA_KEY]: input.companyId,
    },
  });
}

export async function applyStripeCheckoutCreditFromEvent(db: Db, event: Stripe.CheckoutSessionCompletedEvent): Promise<void> {
  const session = event.data.object;
  const companyId = session.metadata?.[COMPANY_METADATA_KEY]?.trim();
  if (!companyId) return;
  const amountCents = session.amount_total ?? 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return;

  const instanceSettings = instanceSettingsService(db);
  const current = await instanceSettings.getGeneral();
  const nextPrepaidCents = (current.billingPrepaidCents ?? 0) + amountCents;
  await instanceSettings.updateGeneral({ billingPrepaidCents: nextPrepaidCents });

  await logActivity(db, {
    companyId,
    actorType: "system",
    actorId: "stripe-webhook",
    action: "billing.prepaid_credit.added",
    entityType: "instance_settings",
    entityId: "default",
    details: {
      stripeEventId: event.id,
      amountCents,
      currency: session.currency,
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status,
    },
  });
}
