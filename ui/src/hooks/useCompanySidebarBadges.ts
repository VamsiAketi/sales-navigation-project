import { useQuery } from "@tanstack/react-query";
import type { SidebarBadges } from "@paperclipai/shared";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";

/**
 * Company sidebar access flags. While `accessReady` is false, treat all badge flags as
 * denied so nav/modules do not flash visible then hide after the API resolves.
 */
export function useCompanySidebarBadges(companyId: string | null | undefined) {
  const query = useQuery({
    queryKey: companyId ? queryKeys.sidebarBadges(companyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(companyId!),
    enabled: Boolean(companyId),
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
  });

  const accessReady = !companyId || !query.isPending;

  function badge<K extends keyof SidebarBadges>(key: K, fallback = false): boolean {
    if (!accessReady) return false;
    const value = query.data?.[key];
    if (typeof value === "boolean") return value;
    return fallback;
  }

  return {
    ...query,
    accessReady,
    badge,
    badges: query.data,
  };
}
