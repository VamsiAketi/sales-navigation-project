ALTER TABLE "company_memberships"
  ADD COLUMN IF NOT EXISTS "reports_to_membership_id" uuid;

DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'company_memberships_reports_to_membership_id_company_memberships_id_fk'
 ) THEN
  ALTER TABLE "company_memberships"
    ADD CONSTRAINT "company_memberships_reports_to_membership_id_company_memberships_id_fk"
    FOREIGN KEY ("reports_to_membership_id")
    REFERENCES "public"."company_memberships"("id")
    ON DELETE no action
    ON UPDATE no action;
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS "company_memberships_company_reports_to_membership_idx"
  ON "company_memberships" ("company_id", "reports_to_membership_id");

ALTER TABLE "company_memberships"
  ADD COLUMN IF NOT EXISTS "org_sort" integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY company_id, reports_to_membership_id
      ORDER BY created_at, id
    ) - 1 AS rn
  FROM company_memberships
)
UPDATE company_memberships AS m
SET org_sort = ranked.rn
FROM ranked
WHERE m.id = ranked.id;

CREATE INDEX IF NOT EXISTS "company_memberships_company_reports_to_membership_org_sort_idx"
  ON "company_memberships" ("company_id", "reports_to_membership_id", "org_sort");
