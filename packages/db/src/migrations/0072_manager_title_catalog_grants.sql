-- Align Manager title catalog grants with the Manager preset: users who can assign titles
-- should also be able to create and manage the shared title list (teams UI).
INSERT INTO "principal_permission_grants" (
  "company_id",
  "principal_type",
  "principal_id",
  "permission_key",
  "scope",
  "granted_by_user_id"
)
SELECT
  m."company_id",
  m."principal_type",
  m."principal_id",
  p."permission_key",
  NULL,
  NULL
FROM "company_memberships" m
CROSS JOIN (
  VALUES ('teams.title_create'), ('teams.title_manage')
) AS p("permission_key")
WHERE m."principal_type" = 'user'
  AND m."status" = 'active'
  AND lower(trim(m."membership_role")) = 'manager'
  AND EXISTS (
    SELECT 1
    FROM "principal_permission_grants" g
    WHERE g."company_id" = m."company_id"
      AND g."principal_type" = m."principal_type"
      AND g."principal_id" = m."principal_id"
      AND g."permission_key" = 'teams.title_assign'
  )
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
--> statement-breakpoint
