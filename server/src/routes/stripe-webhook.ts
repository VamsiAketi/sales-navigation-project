import { Router } from "express";
import Stripe from "stripe";
import type { Db } from "@paperclipai/db";
import { getStripeFromConfig } from "../stripe-client.js";
import { logger } from "../middleware/logger.js";
import {
  applyStripeCheckoutCreditFromEvent,
  handleStripeChargeDisputeCreatedEvent,
  handleStripeChargeRefundedEvent,
  handleStripeInvoicePaidEvent,
  handleStripeInvoicePaymentFailedEvent,
  recordStripeWebhookProcessingFailureAlert,
  stripeSecretsFromEnv,
} from "../services/stripe-billing.js";

export function stripeWebhookRoutes(db: Db) {
  const router = Router();

  router.post("/stripe/webhook", async (req, res) => {
    const signature = req.header("stripe-signature");
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const { stripeSecretKey, stripeWebhookSecret } = stripeSecretsFromEnv();
    if (!stripeSecretKey || !stripeWebhookSecret) {
      res.status(503).json({ error: "Stripe webhook is not configured" });
      return;
    }
    const stripe = getStripeFromConfig({ stripeSecretKey });
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: "Missing raw request body for Stripe signature verification" });
      return;
    }

    try {
      const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
      try {
        switch (event.type) {
          case "checkout.session.completed":
            await applyStripeCheckoutCreditFromEvent(db, event);
            break;
          case "invoice.paid":
            await handleStripeInvoicePaidEvent(db, event);
            break;
          case "invoice.payment_failed":
            await handleStripeInvoicePaymentFailedEvent(db, event);
            break;
          case "charge.refunded":
            await handleStripeChargeRefundedEvent(db, event);
            break;
          case "charge.dispute.created":
            await handleStripeChargeDisputeCreatedEvent(db, event);
            break;
          default:
            break;
        }
      } catch (error) {
        await recordStripeWebhookProcessingFailureAlert(db, event, error);
        throw error;
      }
      res.status(200).json({ received: true });
    } catch (error) {
      logger.warn({ err: error }, "stripe webhook processing failed");
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        res.status(400).json({ error: "Invalid Stripe webhook payload/signature" });
        return;
      }
      res.status(500).json({ error: "Stripe webhook processing failed" });
    }
  });

  return router;
}
