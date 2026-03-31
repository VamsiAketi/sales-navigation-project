CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "company_id" uuid,
  "project_id" uuid,
  "issue_id" uuid,
  "event_type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "email_delivery_status" text,
  "payload" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_user_id_user_id_fk') THEN
  ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_company_id_companies_id_fk') THEN
  ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_project_id_projects_id_fk') THEN
  ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_issue_id_issues_id_fk') THEN
  ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_issue_id_issues_id_fk"
  FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx"
ON "user_notifications" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_user_read_idx"
ON "user_notifications" USING btree ("user_id","read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_company_created_idx"
ON "user_notifications" USING btree ("company_id","created_at");
