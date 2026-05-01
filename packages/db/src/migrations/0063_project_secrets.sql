CREATE TABLE IF NOT EXISTS "project_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"external_ref" text,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_secrets_project_name_uq" ON "project_secrets" ("project_id","name");
CREATE INDEX IF NOT EXISTS "project_secrets_project_idx" ON "project_secrets" ("project_id");
CREATE INDEX IF NOT EXISTS "project_secrets_company_project_idx" ON "project_secrets" ("company_id","project_id");
CREATE INDEX IF NOT EXISTS "project_secrets_company_provider_idx" ON "project_secrets" ("company_id","provider");

CREATE TABLE IF NOT EXISTS "project_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material" jsonb NOT NULL,
	"value_sha256" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

DO $$ BEGIN
 ALTER TABLE "project_secret_versions" ADD CONSTRAINT "project_secret_versions_secret_id_project_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."project_secrets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "project_secret_versions" ADD CONSTRAINT "project_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_secret_versions_secret_version_uq" ON "project_secret_versions" ("secret_id","version");
CREATE INDEX IF NOT EXISTS "project_secret_versions_secret_idx" ON "project_secret_versions" ("secret_id","created_at");
CREATE INDEX IF NOT EXISTS "project_secret_versions_value_sha256_idx" ON "project_secret_versions" ("value_sha256");

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_env_config" jsonb;
