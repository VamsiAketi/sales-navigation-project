ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "expose_project_secrets_on_issue_runs" boolean DEFAULT false NOT NULL;
