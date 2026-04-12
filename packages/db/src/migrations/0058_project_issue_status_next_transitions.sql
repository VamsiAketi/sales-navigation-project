ALTER TABLE "project_issue_statuses" ADD COLUMN "allowed_next_status_values" jsonb DEFAULT '[]'::jsonb NOT NULL;
