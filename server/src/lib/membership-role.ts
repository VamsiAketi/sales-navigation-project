const OWNER_ROLE_CANONICAL = "owner";

export function normalizeMembershipRole(role: string | null | undefined): string | null {
  if (role == null) return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === OWNER_ROLE_CANONICAL) return OWNER_ROLE_CANONICAL;
  return trimmed;
}

export function isOwnerMembershipRole(role: string | null | undefined): boolean {
  return normalizeMembershipRole(role) === OWNER_ROLE_CANONICAL;
}

export function membershipRoleLabel(role: string | null | undefined): string | null {
  const normalized = normalizeMembershipRole(role);
  if (!normalized) return null;
  if (normalized === OWNER_ROLE_CANONICAL) return "Owner";
  return normalized;
}
