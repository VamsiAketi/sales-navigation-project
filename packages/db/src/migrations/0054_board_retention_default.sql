UPDATE "projects"
SET "board_closed_retention_days" = 7
WHERE "board_closed_retention_days" IS NULL;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "board_closed_retention_days" SET DEFAULT 7;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "board_closed_retention_days" SET NOT NULL;
