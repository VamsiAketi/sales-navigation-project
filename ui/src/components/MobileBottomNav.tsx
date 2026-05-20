import { useMemo, useMemo as useMemoHook } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  House,
  CircleDot,
  SquarePen,
  Users,
  Inbox,
} from "lucide-react";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { getInboxBadgeBreakdown } from "../lib/inbox";
import { AttentionQueueBadge } from "./AttentionQueueBadgeTooltip";
import { cn } from "../lib/utils";

interface MobileBottomNavProps {
  visible: boolean;
}

interface MobileNavLinkItem {
  type: "link";
  to: string;
  label: string;
  icon: typeof House;
}

interface MobileNavActionItem {
  type: "action";
  label: string;
  icon: typeof SquarePen;
  onClick: () => void;
}

type MobileNavItem = MobileNavLinkItem | MobileNavActionItem;

export function MobileBottomNav({ visible }: MobileBottomNavProps) {
  const location = useLocation();
  const { openNewIssue } = useDialog();
  const { selectedCompanyId } = useCompany();
  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadAgents = sidebarBadges?.canReadAgents ?? true;
  const canReadTasks = sidebarBadges?.canReadTasks ?? true;
  const canCreateTasks = sidebarBadges?.canCreateTasks ?? true;
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const inboxBadgeBreakdown = useMemo(() => getInboxBadgeBreakdown(inboxBadge), [inboxBadge]);

  const items = useMemo<MobileNavItem[]>(
    () =>
      [
        { type: "link", to: "/dashboard", label: "Home", icon: House },
        ...(canReadTasks ? ([{ type: "link", to: "/issues", label: "Tasks", icon: CircleDot }] as const) : []),
        ...(canCreateTasks ? ([{ type: "action", label: "Create", icon: SquarePen, onClick: () => openNewIssue() }] as const) : []),
        ...(canReadAgents ? ([{ type: "link", to: "/agents/all", label: "Agents", icon: Users }] as const) : []),
        { type: "link", to: "/inbox", label: "Inbox", icon: Inbox },
      ] satisfies MobileNavItem[],
    [canCreateTasks, canReadAgents, canReadTasks, openNewIssue],
  );

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 transition-transform duration-200 ease-out md:hidden pb-[env(safe-area-inset-bottom)]",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      aria-label="Mobile navigation"
    >
      <div
        className={cn(
          "grid h-16 px-1",
          items.length === 5 ? "grid-cols-5" : "grid-cols-4",
        )}
      >
        {items.map((item) => {
          if (item.type === "action") {
            const Icon = item.icon;
            const active = /\/issues\/new(?:\/|$)/.test(location.pathname);
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          }

          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => {
                const isInbox = item.to === "/inbox";
                const count = isInbox ? inboxBadge.inbox : 0;
                const danger = isInbox && inboxBadge.failedRuns > 0;
                return (
                  <>
                    <span className="relative inline-flex">
                      <Icon className={cn("h-[18px] w-[18px]", isActive && "stroke-[2.3]")} />
                      {isInbox && count > 0 ? (
                        <span className="absolute -right-2 -top-1">
                          <AttentionQueueBadge
                            count={count}
                            tone={danger ? "danger" : "default"}
                            breakdown={inboxBadgeBreakdown}
                            variant="compact"
                          />
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </>
                );
              }}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
