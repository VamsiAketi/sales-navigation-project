import { Link, useNavigate } from "@/lib/router";
import { Bell, LogOut, Menu, Settings } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { PluginLauncherOutlet, usePluginLaunchers } from "@/plugins/launchers";
import { notificationsApi } from "../api/notifications";
import { useToast } from "../context/ToastContext";

function NotificationsBell() {
  const navigate = useNavigate();
  const { companies } = useCompany();
  const queryClient = useQueryClient();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    staleTime: 60_000,
  });
  const { data: unread } = useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!session?.user?.id,
    refetchInterval: 15_000,
  });
  const { data: notifications } = useQuery({
    queryKey: queryKeys.notifications.me(10),
    queryFn: () => notificationsApi.listMine(10),
    enabled: !!session?.user?.id,
    refetchInterval: 15_000,
  });
  if (!session?.user) return null;
  const unreadCount = unread?.count ?? 0;

  const toPreviewText = (message: string) => {
    const lines = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^hello\b/i.test(line))
      .filter((line) => !/^this email was sent\b/i.test(line));
    return lines[0] ?? "Notification update";
  };

  const buildIssueHref = (item: { companyId: string | null; issueId: string | null }) => {
    if (!item.companyId || !item.issueId) return null;
    const company = companies.find((entry) => entry.id === item.companyId);
    if (!company) return null;
    return `/${company.issuePrefix}/issues/${encodeURIComponent(item.issueId)}`;
  };

  const handleNotificationSelect = async (item: {
    id: string;
    readAt: string | null;
    companyId: string | null;
    issueId: string | null;
  }) => {
    if (!item.readAt) {
      await notificationsApi.markRead(item.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.me(10) }),
      ]);
    }
    const issueHref = buildIssueHref(item);
    if (issueHref) {
      navigate(issueHref);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
          <span>Notifications</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={async () => {
              await notificationsApi.markAllRead();
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount }),
                queryClient.invalidateQueries({ queryKey: queryKeys.notifications.me(10) }),
              ]);
            }}
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-auto">
          {(notifications ?? []).length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No notifications.</div>
          ) : (
            (notifications ?? []).map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={(event) => {
                  event.preventDefault();
                  void handleNotificationSelect(item);
                }}
                className="cursor-pointer items-start py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{toPreviewText(item.message)}</p>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    staleTime: 60_000,
  });

  const userId = session?.user?.id ?? null;
  const mustChangePassword = session?.user?.mustChangePassword === true;
  const initial = (session?.user?.name ?? session?.user?.email ?? "?")[0]?.toUpperCase() ?? "?";
  const passwordPromptSeenKey = userId ? `paperclip:password-change-prompt-seen:${userId}` : null;

  useEffect(() => {
    if (!passwordPromptSeenKey || !userId) return;
    if (!mustChangePassword) {
      try {
        window.localStorage.removeItem(passwordPromptSeenKey);
      } catch {
        // ignore localStorage write errors
      }
      return;
    }
    try {
      const seen = window.localStorage.getItem(passwordPromptSeenKey);
      if (seen === "1") return;
    } catch {
      // ignore localStorage read errors
    }

    const markSeen = () => {
      try {
        window.localStorage.setItem(passwordPromptSeenKey, "1");
      } catch {
        // ignore localStorage write errors
      }
    };

    const toastId = pushToast({
      dedupeKey: `first-login-password-prompt:${userId}`,
      title: "Change your password",
      body: "For security, please update your password after your first login.",
      tone: "warn",
      ttlMs: 20_000,
      action: {
        label: "Continue",
        href: "/account/settings",
        onClick: markSeen,
      },
      secondaryAction: {
        label: "Skip",
        onClick: markSeen,
      },
    });

    if (toastId) {
      markSeen();
    }
  }, [mustChangePassword, passwordPromptSeenKey, pushToast, userId]);

  if (!session?.user) return null;

  const handleLogoutConfirm = async () => {
    try {
      await authApi.signOut();
    } catch {
      // proceed with local cleanup even if the server call fails
    }
    queryClient.clear();
    // Force a clean auth page load and suppress immediate cached-session bounce.
    window.location.assign("/auth?logged_out=1");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="User menu"
          >
            {initial}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => navigate("/account/settings")} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Account Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowLogoutDialog(true)} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setShowLogoutDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogoutConfirm}>
              Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type GlobalToolbarContext = { companyId: string | null; companyPrefix: string | null };

function GlobalToolbarPlugins({ context }: { context: GlobalToolbarContext }) {
  const { slots } = usePluginSlots({ slotTypes: ["globalToolbarButton"], companyId: context.companyId });
  const { launchers } = usePluginLaunchers({ placementZones: ["globalToolbarButton"], companyId: context.companyId, enabled: !!context.companyId });
  if (slots.length === 0 && launchers.length === 0) return null;
  return (
    <div className="flex items-center gap-1 ml-auto shrink-0 pl-2">
      <PluginSlotOutlet slotTypes={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
      <PluginLauncherOutlet placementZones={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
    </div>
  );
}

export function BreadcrumbBar() {
  const { breadcrumbs } = useBreadcrumbs();
  const { toggleSidebar, isMobile } = useSidebar();
  const { selectedCompanyId, selectedCompany } = useCompany();

  const globalToolbarSlotContext = useMemo(
    () => ({
      companyId: selectedCompanyId ?? null,
      companyPrefix: selectedCompany?.issuePrefix ?? null,
    }),
    [selectedCompanyId, selectedCompany?.issuePrefix],
  );

  const globalToolbarSlots = <GlobalToolbarPlugins context={globalToolbarSlotContext} />;

  if (breadcrumbs.length === 0) {
    return (
      <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center justify-end">
        {globalToolbarSlots}
        <NotificationsBell />
        <UserMenu />
      </div>
    );
  }

  const menuButton = isMobile && (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mr-2 shrink-0"
      onClick={toggleSidebar}
      aria-label="Open sidebar"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );

  // Single breadcrumb = page title (uppercase)
  if (breadcrumbs.length === 1) {
    return (
      <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center">
        {menuButton}
        <div className="min-w-0 overflow-hidden flex-1">
          <h1 className="text-sm font-semibold uppercase tracking-wider truncate">
            {breadcrumbs[0].label}
          </h1>
        </div>
        {globalToolbarSlots}
        <NotificationsBell />
        <UserMenu />
      </div>
    );
  }

  // Multiple breadcrumbs = breadcrumb trail
  return (
    <div className="border-b border-border px-4 md:px-6 h-12 shrink-0 flex items-center">
      {menuButton}
      <div className="min-w-0 overflow-hidden flex-1">
        <Breadcrumb className="min-w-0 overflow-hidden">
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className={isLast ? "min-w-0" : "shrink-0"}>
                    {isLast || !crumb.href ? (
                      <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {globalToolbarSlots}
      <NotificationsBell />
      <UserMenu />
    </div>
  );
}
