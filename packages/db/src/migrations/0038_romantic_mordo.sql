ALTER TABLE "agents" ADD COLUMN "org_sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "reports_to_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "env_config" jsonb;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_reports_to_membership_id_company_memberships_id_fk" FOREIGN KEY ("reports_to_membership_id") REFERENCES "public"."company_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_memberships_company_reports_to_membership_idx" ON "company_memberships" USING btree ("company_id","reports_to_membership_id");