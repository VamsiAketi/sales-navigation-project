ALTER TABLE "stripe_checkout_intents" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_intents_company_idempotency_key_unique_idx"
  ON "stripe_checkout_intents" USING btree ("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
