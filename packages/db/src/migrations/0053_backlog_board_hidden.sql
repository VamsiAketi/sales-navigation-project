-- Backlog is list-only: never shown as a board column, always first in workflow order.
UPDATE "project_issue_statuses"
SET "is_active" = false, "updated_at" = NOW()
WHERE "value" = 'backlog';
--> statement-breakpoint
WITH "ranked" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id"
      ORDER BY CASE WHEN "value" = 'backlog' THEN 0 ELSE 1 END,
               "position" ASC,
               "created_at" ASC
    ) - 1 AS "new_pos"
  FROM "project_issue_statuses"
)
UPDATE "project_issue_statuses" AS "p"
SET "position" = "r"."new_pos",
    "updated_at" = NOW()
FROM "ranked" AS "r"
WHERE "p"."id" = "r"."id";
