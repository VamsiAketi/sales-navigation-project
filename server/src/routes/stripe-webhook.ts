import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { getStripeFromConfig } from "../stripe-client.js";
import { logger } from "../middleware/logger.js";
import { applyStripeCheckoutCreditFromEvent, stripeSecretsFromEnv } from "../services/stripe-billing.js";

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
      if (event.type === "checkout.session.completed") {
        await applyStripeCheckoutCreditFromEvent(db, event);
      }
      res.status(200).json({ received: true });
    } catch (error) {
      logger.warn({ err: error }, "stripe webhook processing failed");
      res.status(400).json({ error: "Invalid Stripe webhook payload/signature" });
    }
  });

  return router;
}
