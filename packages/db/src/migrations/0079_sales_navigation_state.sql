CREATE TABLE IF NOT EXISTS "sales_navigation_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_file_name" text,
  "graph_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "insights_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_navigation_state_company_unique" ON "sales_navigation_state" ("company_id");
CREATE INDEX IF NOT EXISTS "sales_navigation_state_company_idx" ON "sales_navigation_state" ("company_id");
