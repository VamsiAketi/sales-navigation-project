/**
 * Persists dashboard section order in localStorage, scoped by signed-in user (or guest)
 * and company so each operator keeps their own layout per company.
 *
 * A legacy unscoped key (`dashboard:section-order`) is read once per company if no v2
 * entry exists yet, so existing layouts continue to work after this change.
 */
const LEGACY_STORAGE_KEY = "dashboard:section-order";

export const DASHBOARD_SECTION_IDS = ["goals", "projects", "tasks", "costs", "metrics", "charts"] as const;
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

function scopedKey(userId: string | null, companyId: string) {
  const uid = userId && userId.length > 0 ? userId : "guest";
  return `dashboard:section-order:v2:${uid}:${companyId}`;
}

function isValidOrder(parsed: unknown): parsed is DashboardSectionId[] {
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((id): id is DashboardSectionId => DASHBOARD_SECTION_IDS.includes(id as DashboardSectionId))
  );
}

function normalizeOrder(parsed: DashboardSectionId[]): DashboardSectionId[] {
  const missing = DASHBOARD_SECTION_IDS.filter((id) => !parsed.includes(id));
  return [...parsed, ...missing];
}

export function loadDashboardSectionOrder(userId: string | null, companyId: string): DashboardSectionId[] {
  try {
    const scoped = localStorage.getItem(scopedKey(userId, companyId));
    if (scoped) {
      const parsed: unknown = JSON.parse(scoped);
      if (isValidOrder(parsed)) return normalizeOrder(parsed);
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed: unknown = JSON.parse(legacy);
      if (isValidOrder(parsed)) {
        const order = normalizeOrder(parsed);
        saveDashboardSectionOrder(userId, companyId, order);
        return order;
      }
    }
  } catch {
    /* ignore */
  }
  return [...DASHBOARD_SECTION_IDS];
}

export function saveDashboardSectionOrder(
  userId: string | null,
  companyId: string,
  order: DashboardSectionId[],
) {
  try {
    localStorage.setItem(scopedKey(userId, companyId), JSON.stringify(order));
  } catch {
    /* quota / private mode */
  }
}
