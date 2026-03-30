ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "kanban_position" real;
--> statement-breakpoint
-- Seed initial positions from createdAt ordering within each (company, status) group
-- so that existing issues get a deterministic starting order.
UPDATE "issues" i
SET "kanban_position" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY company_id, status
    ORDER BY created_at ASC
  ) AS rn
  FROM "issues"
) sub
WHERE i.id = sub.id;
