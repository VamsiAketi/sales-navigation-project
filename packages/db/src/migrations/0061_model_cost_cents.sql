ALTER TABLE "cost_events"
  ADD COLUMN IF NOT EXISTS "model_cost_cents" integer NOT NULL DEFAULT 0;
