-- Grant billing.read to existing active human Admin and Manager members (Owner bypasses grants in access checks).
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
  'billing.read',
  NULL,
  NULL
FROM "company_memberships" m
WHERE m."principal_type" = 'user'
  AND m."status" = 'active'
  AND lower(trim(m."membership_role")) IN ('admin', 'manager')
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
--> statement-breakpoint
