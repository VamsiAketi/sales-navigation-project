import { AGENT_ROLES, PERMISSION_KEYS, type AgentRole, type PermissionKey } from "./constants.js";

/**
 * Baseline company permissions every operational agent receives.
 * Project-level access is separate (open mode or project_principal_grants).
 */
export const AGENT_BASE_COMPANY_PERMISSIONS = [
  "agents.read",
  "tasks.read",
  "tasks.create",
  "tasks:assign",
  "goals.read",
  "goals.write",
  "skills.read",
  "skills.edit",
  "command_center.read",
  "hybrid_org.read",
  "teams.read",
] as const satisfies readonly PermissionKey[];

/** Additional company permissions for the CEO agent role. */
export const AGENT_CEO_EXTRA_COMPANY_PERMISSIONS = [
  "agents.edit",
  "agents:create",
  "projects.create",
  "joins:approve",
  "hybrid_org.edit",
  "hybrid_org.import",
  "hybrid_org.export",
  "costs.read",
] as const satisfies readonly PermissionKey[];

export type AgentCompanyPermissionGrant = {
  permissionKey: PermissionKey;
  scope: Record<string, unknown> | null;
};

function uniquePermissionKeys(keys: readonly PermissionKey[]): PermissionKey[] {
  const seen = new Set<PermissionKey>();
  const ordered: PermissionKey[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return PERMISSION_KEYS.filter((key) => seen.has(key));
}

export function defaultCompanyPermissionsForAgentRole(role: string | null | undefined): PermissionKey[] {
  const normalizedRole = (role ?? "general").trim().toLowerCase();
  if (normalizedRole === "ceo") {
    return uniquePermissionKeys([...AGENT_BASE_COMPANY_PERMISSIONS, ...AGENT_CEO_EXTRA_COMPANY_PERMISSIONS]);
  }
  return uniquePermissionKeys(AGENT_BASE_COMPANY_PERMISSIONS);
}

/** Merge invite/join extras onto role defaults; invite wins on duplicate keys (scope preserved). */
export function mergeAgentCompanyPermissionGrants(
  inviteGrants: readonly AgentCompanyPermissionGrant[],
  role: string | null | undefined,
): AgentCompanyPermissionGrant[] {
  const byKey = new Map<PermissionKey, AgentCompanyPermissionGrant>();
  for (const permissionKey of defaultCompanyPermissionsForAgentRole(role)) {
    byKey.set(permissionKey, { permissionKey, scope: null });
  }
  for (const grant of inviteGrants) {
    byKey.set(grant.permissionKey, grant);
  }
  return PERMISSION_KEYS.filter((key) => byKey.has(key)).map((key) => byKey.get(key)!);
}

export function isAgentRole(value: string | null | undefined): value is AgentRole {
  if (!value) return false;
  return (AGENT_ROLES as readonly string[]).includes(value);
}
