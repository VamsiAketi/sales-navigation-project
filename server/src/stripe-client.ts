import Stripe from "stripe";

export type StripeClient = Stripe;

/**
 * Returns a Stripe SDK client when a secret key is configured; otherwise `null`.
 * Prefer this over constructing `Stripe` ad hoc so API usage stays centralized.
 */
export function getStripeFromConfig(config: { stripeSecretKey: string | undefined }): Stripe | null {
  const key = config.stripeSecretKey?.trim();
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2026-04-22.dahlia",
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}
