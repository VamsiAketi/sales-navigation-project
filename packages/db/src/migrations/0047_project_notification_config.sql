ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "notification_config" jsonb;
