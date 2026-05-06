-- Idempotent: fixes databases where 0063_project_secrets.sql was not applied but
-- the schema already expected project_secrets tables, or migration history drifted.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_env_config" jsonb;
