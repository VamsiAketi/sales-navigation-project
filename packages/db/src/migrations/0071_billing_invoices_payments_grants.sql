-- Grant billing.invoices.read and billing.payments.manage to existing active human Admin and Manager members.
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
  k.permission_key,
  NULL,
  NULL
FROM "company_memberships" m
CROSS JOIN (
  VALUES ('billing.invoices.read'), ('billing.payments.manage')
) AS k(permission_key)
WHERE m."principal_type" = 'user'
  AND m."status" = 'active'
  AND lower(trim(m."membership_role")) IN ('admin', 'manager')
ON CONFLICT ("company_id", "principal_type", "principal_id", "permission_key") DO NOTHING;
--> statement-breakpoint
