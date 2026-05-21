-- Replace nullable-unique index (PostgreSQL treats each NULL as distinct).
DROP INDEX IF EXISTS "project_view_widgets_company_view_title_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_view_widgets_company_view_title_uq" ON "project_view_widgets" ("company_id", "project_view_id", "normalized_title") WHERE "normalized_title" IS NOT NULL;
