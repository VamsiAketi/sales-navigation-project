ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "org_sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN IF NOT EXISTS "reports_to_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "env_config" jsonb;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_memberships_reports_to_membership_id_company_memberships_id_fk') THEN
  ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_reports_to_membership_id_company_memberships_id_fk" FOREIGN KEY ("reports_to_membership_id") REFERENCES "public"."company_memberships"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memberships_company_reports_to_membership_idx" ON "company_memberships" USING btree ("company_id","reports_to_membership_id");