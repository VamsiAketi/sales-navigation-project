ALTER TABLE "project_issue_statuses" ADD COLUMN "allowed_actors" text DEFAULT 'human_and_agent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses" ADD COLUMN "default_assignee_user_id" text;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses" ADD COLUMN "default_assignee_agent_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_issue_statuses_default_assignee_agent_id_agents_id_fk') THEN
  ALTER TABLE "project_issue_statuses" ADD CONSTRAINT "project_issue_statuses_default_assignee_agent_id_agents_id_fk" FOREIGN KEY ("default_assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
