ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_stripe_customer_id_unique_idx"
  ON "companies" USING btree ("stripe_customer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stripe_checkout_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "checkout_session_id" text NOT NULL,
  "payment_intent_id" text,
  "stripe_customer_id" text,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "webhook_event_id" text,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reconciled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_intents_session_unique_idx"
  ON "stripe_checkout_intents" USING btree ("checkout_session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_checkout_intents_payment_intent_unique_idx"
  ON "stripe_checkout_intents" USING btree ("payment_intent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_checkout_intents_company_status_created_idx"
  ON "stripe_checkout_intents" USING btree ("company_id", "status", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "severity" text DEFAULT 'warning' NOT NULL,
  "alert_type" text NOT NULL,
  "message" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "occurrence_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_alerts_company_dedupe_idx"
  ON "billing_alerts" USING btree ("company_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_alerts_company_created_idx"
  ON "billing_alerts" USING btree ("company_id", "created_at");
