-- Add human approval step columns to project_issue_statuses
ALTER TABLE "project_issue_statuses"
  ADD COLUMN IF NOT EXISTS "is_human_approval" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approver_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
