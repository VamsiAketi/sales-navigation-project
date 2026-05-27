/** Used in localStorage keys when session user id is not yet available or absent. */
export const SIDEBAR_ORDER_ANONYMOUS_USER_ID = "anonymous";

export const PRIMARY_SIDEBAR_NAV_ORDER_UPDATED = "aiharness:primary-sidebar-nav-order-updated";
export const COMPANY_SIDEBAR_NAV_ORDER_UPDATED = "aiharness:company-sidebar-nav-order-updated";

const PRIMARY_PREFIX = "aiharness.sidebarPrimaryNavOrder";
const COMPANY_PREFIX = "aiharness.sidebarCompanyNavOrder";

/** Default primary order (plugins render after this block). `team` follows Attention Queue (`inbox`). */
export const DEFAULT_PRIMARY_NAV_IDS = [
  "dashboard",
  "org",
  "skills",
  "costs",
  "goals",
  "sales-navigation",
  "inbox",
  "tasks",
  "team",
] as const;

export const ROUTINES_NAV_ID = "routines" as const;

export const DEFAULT_COMPANY_NAV_IDS = ["audit", "billing", "connectors", "settings"] as const;

type OrderUpdatedDetail = {
  storageKey: string;
  orderedIds: string[];
};

export function resolveSidebarOrderUserId(userId: string | null | undefined): string {
  if (!userId) return SIDEBAR_ORDER_ANONYMOUS_USER_ID;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : SIDEBAR_ORDER_ANONYMOUS_USER_ID;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function mergeNavOrder(availableIds: string[], storedIds: string[]): string[] {
  const avail = new Set(availableIds);
  const out: string[] = [];
  for (const id of storedIds) {
    if (avail.has(id)) out.push(id);
  }
  for (const id of availableIds) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const TEAM_NAV_ID = "team";
const INBOX_NAV_ID = "inbox";

/**
 * When `team` is new to the saved primary order, place it directly under Attention Queue (`inbox`).
 * Otherwise `mergeNavOrder` appends new ids at the end (e.g. after Routines).
 */
export function finalizePrimaryNavOrder(availableIds: string[], storedIds: string[], merged: string[]): string[] {
  if (
    !availableIds.includes(TEAM_NAV_ID) ||
    !availableIds.includes(INBOX_NAV_ID) ||
    !merged.includes(TEAM_NAV_ID) ||
    !merged.includes(INBOX_NAV_ID) ||
    storedIds.includes(TEAM_NAV_ID)
  ) {
    return merged;
  }
  const withoutTeam = merged.filter((id) => id !== TEAM_NAV_ID);
  const inboxIdx = withoutTeam.indexOf(INBOX_NAV_ID);
  if (inboxIdx === -1) return merged;
  return [...withoutTeam.slice(0, inboxIdx + 1), TEAM_NAV_ID, ...withoutTeam.slice(inboxIdx + 1)];
}

export function getPrimaryNavOrderStorageKey(companyId: string, userId: string | null | undefined): string {
  return `${PRIMARY_PREFIX}:${companyId}:${resolveSidebarOrderUserId(userId)}`;
}

export function getCompanyNavOrderStorageKey(companyId: string, userId: string | null | undefined): string {
  return `${COMPANY_PREFIX}:${companyId}:${resolveSidebarOrderUserId(userId)}`;
}

/**
 * Read stored primary nav order, copying from the anonymous key once when the user signs in
 * so orders saved before session load are not lost.
 */
export function readPrimaryNavOrder(companyId: string, userId: string | null | undefined): string[] {
  const key = getPrimaryNavOrderStorageKey(companyId, userId);
  let ids = readNavOrderFromStorage(key);
  if (ids.length > 0) return ids;
  if (resolveSidebarOrderUserId(userId) !== SIDEBAR_ORDER_ANONYMOUS_USER_ID) {
    const anonKey = getPrimaryNavOrderStorageKey(companyId, null);
    ids = readNavOrderFromStorage(anonKey);
    if (ids.length > 0) {
      writeNavOrderToStorage(key, ids, PRIMARY_SIDEBAR_NAV_ORDER_UPDATED);
    }
  }
  return ids;
}

export function readCompanyNavOrder(companyId: string, userId: string | null | undefined): string[] {
  const key = getCompanyNavOrderStorageKey(companyId, userId);
  let ids = readNavOrderFromStorage(key);
  if (ids.length > 0) return ids;
  if (resolveSidebarOrderUserId(userId) !== SIDEBAR_ORDER_ANONYMOUS_USER_ID) {
    const anonKey = getCompanyNavOrderStorageKey(companyId, null);
    ids = readNavOrderFromStorage(anonKey);
    if (ids.length > 0) {
      writeNavOrderToStorage(key, ids, COMPANY_SIDEBAR_NAV_ORDER_UPDATED);
    }
  }
  return ids;
}

export function readNavOrderFromStorage(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    return normalizeIdList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeNavOrderToStorage(
  storageKey: string,
  orderedIds: string[],
  eventName: string,
): void {
  const normalized = normalizeIdList(orderedIds);
  try {
    localStorage.setItem(storageKey, JSON.stringify(normalized));
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<OrderUpdatedDetail>(eventName, {
        detail: { storageKey, orderedIds: normalized },
      }),
    );
  }
}
