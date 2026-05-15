-- Grant deactivate/delete user capabilities to existing company admins (human, active).
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
  v."permission_key",
  NULL,
  NULL
FROM "company_memberships" m
CROSS JOIN (
  VALUES
    ('users:deactivate'),
    ('users:delete')
) AS v("permission_key")
WHERE m."principal_type" = 'user'
  AND m."status" = 'active'
  AND lower(m."membership_role") = 'admin'
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
--> statement-breakpoint
