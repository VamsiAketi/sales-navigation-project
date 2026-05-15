/**
 * Human org roles shown in Teams (directory) — same list + localStorage extras as
 * `CompanyDirectory` "Manage roles". Ownership transfer must offer the same role IDs.
 */
export const COMPANY_ROLE_STORAGE_PREFIX = "paperclip.companyRoles";

export const TEAMS_BUILTIN_HUMAN_ROLES = ["Admin", "Manager", "Contributor", "Reader"] as const;

export function normalizeTeamsHumanRoleLabel(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.toLowerCase() === "owner") return "owner";
  return normalized;
}

export function teamsHumanRoleDisplayLabel(role: string | null | undefined): string {
  const n = normalizeTeamsHumanRoleLabel(role ?? "");
  if (!n) return "";
  return n === "owner" ? "Owner" : n;
}

/** Custom human role labels persisted by the Teams page (`prefs.human`). */
export function readCompanyTeamHumanRoleExtras(companyId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${COMPANY_ROLE_STORAGE_PREFIX}:${companyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { human?: unknown };
    if (!Array.isArray(parsed.human)) return [];
    return parsed.human.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Role `membershipRole` values the owner may pick after transfer — mirrors Teams
 * `manageHumanRoleOptions` (built-ins + custom, never `owner`).
 */
export function buildTeamsHumanRoleIds(companyId: string | null | undefined): string[] {
  const base = [...TEAMS_BUILTIN_HUMAN_ROLES] as string[];
  if (!companyId) return base;
  const seen = new Set(base.map((r) => r.toLowerCase()));
  const extras: string[] = [];
  for (const raw of readCompanyTeamHumanRoleExtras(companyId)) {
    const normalized = normalizeTeamsHumanRoleLabel(raw);
    if (!normalized || normalized === "owner") continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(normalized);
  }
  return [...base, ...extras];
}
