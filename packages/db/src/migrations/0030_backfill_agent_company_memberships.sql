-- Backfill company_memberships rows for pre-existing agents so they show up
-- in Company Settings "Active agents" list (which is membership-driven).
--
-- Idempotent: only inserts rows that don't already exist.
INSERT INTO "company_memberships" (
  "company_id",
  "principal_type",
  "principal_id",
  "status",
  "membership_role",
  "created_at",
  "updated_at"
)
SELECT
  a."company_id",
  'agent' AS "principal_type",
  a."id" AS "principal_id",
  'active' AS "status",
  'agent' AS "membership_role",
  NOW() AS "created_at",
  NOW() AS "updated_at"
FROM "agents" a
LEFT JOIN "company_memberships" m
  ON m."company_id" = a."company_id"
  AND m."principal_type" = 'agent'
  AND m."principal_id" = a."id"
WHERE m."id" IS NULL
  AND a."status" <> 'terminated';

