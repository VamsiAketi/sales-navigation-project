CREATE TABLE IF NOT EXISTS "company_wallet_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "heartbeat_run_id" uuid NOT NULL REFERENCES "heartbeat_runs"("id") ON DELETE CASCADE,
  "estimated_cents" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "settled_cents" integer,
  "cost_event_id" uuid REFERENCES "cost_events"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_wallet_reservations_run_unique_idx"
  ON "company_wallet_reservations" USING btree ("heartbeat_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_wallet_reservations_company_status_idx"
  ON "company_wallet_reservations" USING btree ("company_id", "status");
