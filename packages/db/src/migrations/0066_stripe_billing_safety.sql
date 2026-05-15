CREATE TABLE IF NOT EXISTS "stripe_processed_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stripe_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_processed_events_event_id_unique_idx"
  ON "stripe_processed_events" USING btree ("stripe_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_processed_events_event_type_idx"
  ON "stripe_processed_events" USING btree ("event_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_wallet_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "direction" text DEFAULT 'credit' NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "stripe_event_id" text,
  "checkout_session_id" text,
  "payment_intent_id" text,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_wallet_transactions_company_created_idx"
  ON "company_wallet_transactions" USING btree ("company_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_wallet_transactions_source_unique_idx"
  ON "company_wallet_transactions" USING btree ("company_id", "source_type", "source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_wallet_transactions_stripe_event_unique_idx"
  ON "company_wallet_transactions" USING btree ("stripe_event_id");
--> statement-breakpoint

ALTER TABLE "cost_events" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_events_company_idempotency_key_unique_idx"
  ON "cost_events" USING btree ("company_id", "idempotency_key");
