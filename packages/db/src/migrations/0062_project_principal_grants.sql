ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "project_access_mode" text NOT NULL DEFAULT 'open';

CREATE TABLE IF NOT EXISTS "project_principal_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"permission_key" text NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "project_principal_grants" ADD CONSTRAINT "project_principal_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_principal_grants" ADD CONSTRAINT "project_principal_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_principal_grants_unique_idx" ON "project_principal_grants" ("project_id","principal_type","principal_id","permission_key");
CREATE INDEX IF NOT EXISTS "project_principal_grants_project_idx" ON "project_principal_grants" ("project_id");
CREATE INDEX IF NOT EXISTS "project_principal_grants_company_principal_idx" ON "project_principal_grants" ("company_id","principal_type","principal_id");
