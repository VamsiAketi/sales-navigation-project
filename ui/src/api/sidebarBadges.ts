import type { SidebarBadges } from "@paperclipai/shared";
import { isVercelStaticMode, VERCEL_STATIC_SIDEBAR_BADGES } from "../lib/vercel-static/config";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (companyId: string) =>
    isVercelStaticMode
      ? Promise.resolve(VERCEL_STATIC_SIDEBAR_BADGES)
      : api.get<SidebarBadges>(`/companies/${companyId}/sidebar-badges`),
};
