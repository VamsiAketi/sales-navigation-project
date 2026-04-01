-- Add per-project issue prefix and counter columns
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "issue_prefix" text,
  ADD COLUMN IF NOT EXISTS "issue_counter" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Unique index: a prefix must be unique within a company (NULLs are excluded automatically)
CREATE UNIQUE INDEX IF NOT EXISTS "projects_issue_prefix_company_idx"
  ON "projects" ("company_id", "issue_prefix")
  WHERE "issue_prefix" IS NOT NULL;
--> statement-breakpoint

-- Seed issue_prefix for every existing project from its name.
-- Strategy: take up to 5 uppercase letters, then deduplicate within the company
-- by appending a numeric suffix ("AIH", "AIHA", "AIH2", …).
DO $$
DECLARE
  r RECORD;
  base_prefix TEXT;
  candidate TEXT;
  suffix_n INTEGER;
BEGIN
  FOR r IN
    SELECT id, company_id, name
    FROM projects
    WHERE issue_prefix IS NULL
    ORDER BY created_at ASC
  LOOP
    -- derive a 2-5 char uppercase base from the project name
    base_prefix := UPPER(REGEXP_REPLACE(r.name, '[^A-Za-z]', '', 'g'));
    base_prefix := SUBSTRING(base_prefix FROM 1 FOR 5);
    IF base_prefix = '' THEN
      base_prefix := 'PRJ';
    END IF;

    candidate := base_prefix;
    suffix_n  := 1;

    -- keep incrementing suffix until we find one not taken in this company
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM projects
        WHERE company_id = r.company_id
          AND issue_prefix = candidate
          AND id <> r.id
      );
      suffix_n  := suffix_n + 1;
      candidate := base_prefix || suffix_n::text;
    END LOOP;

    UPDATE projects SET issue_prefix = candidate WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- Seed issue_counter per project from the maximum issueNumber already used
-- by issues in that project, so new issues continue from where they left off.
UPDATE projects p
SET issue_counter = COALESCE(
  (SELECT MAX(i.issue_number)
   FROM issues i
   WHERE i.project_id = p.id
     AND i.issue_number IS NOT NULL),
  0
);
--> statement-breakpoint

-- Back-fill identifier on existing project issues that still carry the company prefix.
-- We re-derive identifier = project.issue_prefix || '-' || issue.issue_number
-- only where the issue belongs to a project and already has an issue_number.
UPDATE issues i
SET identifier = p.issue_prefix || '-' || i.issue_number
FROM projects p
WHERE i.project_id = p.id
  AND i.issue_number IS NOT NULL
  AND p.issue_prefix IS NOT NULL;
