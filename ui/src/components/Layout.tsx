import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronsLeft, ChevronsRight, Moon, Sun, User, Settings, Info, Plus } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "@/lib/router";
import { CompanyRail } from "./CompanyRail";
import { Sidebar } from "./Sidebar";
import { InstanceSidebar } from "./InstanceSidebar";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { PropertiesPanel } from "./PropertiesPanel";
import { CommandPalette } from "./CommandPalette";
import { NewIssueDialog } from "./NewIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewGoalDialog } from "./NewGoalDialog";
import { NewAgentDialog } from "./NewAgentDialog";
import { ToastViewport } from "./ToastViewport";
import { MobileBottomNav } from "./MobileBottomNav";
import { WorktreeBanner } from "./WorktreeBanner";
import { DevRestartBanner } from "./DevRestartBanner";
import { useDialog } from "../context/DialogContext";
import { GeneralSettingsProvider } from "../context/GeneralSettingsContext";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useTheme } from "../context/ThemeContext";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCompanyPageMemory } from "../hooks/useCompanyPageMemory";
import { healthApi } from "../api/health";
import { instanceSettingsApi } from "../api/instanceSettings";
import { projectsApi } from "../api/projects";
import { shouldSyncCompanySelectionFromRoute } from "../lib/company-selection";
import { sidebarNavItemTextClass } from "./SidebarSection";
import { azureSidebarIcon } from "../lib/sidebar-icon-tints";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRODUCT_LINK_LABEL, PRODUCT_SITE_URL } from "../lib/product-brand";
import {
  DEFAULT_INSTANCE_SETTINGS_PATH,
  normalizeRememberedInstanceSettingsPath,
} from "../lib/instance-settings";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { NotFoundPage } from "../pages/NotFound";
import { Button } from "@/components/ui/button";

const INSTANCE_SETTINGS_MEMORY_KEY = "paperclip.lastInstanceSettingsPath";
const SIDEBAR_WIDTH_STORAGE_KEY = "aiharness.sidebar.widthPx";
const SIDEBAR_EXPANDED_WIDTH_DEFAULT = 284;
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 520;

export function buildVisibleVersionLabel(version?: string | null): string | null {
  const normalized = version?.trim();
  if (!normalized) return null;
  return normalized;
}

function readRememberedInstanceSettingsPath(): string {
  if (typeof window === "undefined") return DEFAULT_INSTANCE_SETTINGS_PATH;
  try {
    return normalizeRememberedInstanceSettingsPath(window.localStorage.getItem(INSTANCE_SETTINGS_MEMORY_KEY));
  } catch {
    return DEFAULT_INSTANCE_SETTINGS_PATH;
  }
}

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
}

function readSidebarWidthFromStorage(): number {
  if (typeof window === "undefined") return SIDEBAR_EXPANDED_WIDTH_DEFAULT;
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return SIDEBAR_EXPANDED_WIDTH_DEFAULT;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return SIDEBAR_EXPANDED_WIDTH_DEFAULT;
    return clampSidebarWidth(n);
  } catch {
    return SIDEBAR_EXPANDED_WIDTH_DEFAULT;
  }
}

function persistSidebarWidth(px: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(px));
  } catch {
    /* ignore */
  }
}

function SidebarFooterBar({
  isMobile,
  sidebarOpen,
  sidebarCompact,
  sidebarRailExpanded: _sidebarRailExpanded,
  toggleSidebarRailExpanded,
  setSidebarOpen,
  theme,
  nextTheme,
  toggleTheme,
  showRailToggle,
  versionLabel,
  instanceSettingsTarget,
}: {
  isMobile: boolean;
  sidebarOpen: boolean;
  sidebarCompact: boolean;
  sidebarRailExpanded: boolean;
  toggleSidebarRailExpanded: () => void;
  setSidebarOpen: (open: boolean) => void;
  theme: string;
  nextTheme: string;
  toggleTheme: () => void;
  /** Desktop only: chevron to collapse/expand sidebar labels. */
  showRailToggle: boolean;
  versionLabel?: string | null;
  instanceSettingsTarget: string;
}) {
  const productLinkClass = cn(
    sidebarNavItemTextClass,
    "flex min-w-0 items-center gap-1 font-medium",
    isMobile
      ? "rounded-md py-2 text-sidebar-foreground/75 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
      : "rounded-sm py-2 text-sidebar-foreground/80 hover:bg-black/[0.05] hover:text-sidebar-foreground dark:hover:bg-white/[0.06]",
    sidebarCompact ? "justify-center px-0" : "flex-1 pl-2 pr-0.5",
  );

  const tail = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(azureSidebarIcon.chrome, "size-[30px] shrink-0")}
        onClick={toggleTheme}
        aria-label={`Switch to ${nextTheme} mode`}
        title={`Switch to ${nextTheme} mode`}
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </>
  );

  // const railToggleInGripColumn = showRailToggle && !sidebarCompact;
  // const railToggleStandalone = showRailToggle && sidebarCompact;

  if (!sidebarOpen) {
    return (
      <div className="flex w-full shrink-0 flex-col border-t border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center justify-center gap-0.5 px-1 py-2">
          <Button variant="ghost" size="icon-sm" className={cn(azureSidebarIcon.chrome, "size-[34px] shrink-0")} asChild>
            <a
              href={PRODUCT_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={PRODUCT_LINK_LABEL}
            >
              <BookOpen className="h-4 w-4" />
            </a>
          </Button>
          {tail}
          <Button variant="ghost" size="icon-sm" className={cn(azureSidebarIcon.chrome, "size-[34px] shrink-0")} asChild>
            <Link
              to={instanceSettingsTarget}
              aria-label="Instance settings"
              title="Instance settings"
              onClick={() => { if (isMobile) setSidebarOpen(false); }}
            >
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (sidebarCompact) {
    return (
      <div className="flex w-full shrink-0 flex-col border-t border-r border-sidebar-border bg-sidebar">
        <div className="flex flex-col items-stretch gap-0.5 px-0.5 py-1">
          <Button
            type="button"
            variant="ghost"
            className={cn(azureSidebarIcon.chrome, "min-h-10 w-full justify-center rounded-sm px-0")}
            onClick={toggleSidebarRailExpanded}
            aria-label="Expand sidebar labels"
            title="Show sidebar labels"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Expanded sidebar footer (sidebarOpen && !sidebarCompact)
  return (
    <div className="flex w-full flex-col border-t border-r border-sidebar-border bg-sidebar">
      <div className="flex min-h-0 min-w-0 flex-1 items-center gap-1 py-2 pr-2">
        {showRailToggle ? (
          <div className="flex w-5 shrink-0 items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              className={cn(azureSidebarIcon.chrome, "h-7 w-5 shrink-0 px-0")}
              onClick={toggleSidebarRailExpanded}
              aria-label="Collapse sidebar to icons only"
              title="Icon-only sidebar"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="w-5 shrink-0" aria-hidden />
        )}
        <a
          href={PRODUCT_SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={productLinkClass}
        >
          <BookOpen className={cn("h-4 w-4 shrink-0", azureSidebarIcon.book)} />
          <span className="truncate">{PRODUCT_LINK_LABEL}</span>
        </a>
        {tail}
        {versionLabel && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  azureSidebarIcon.chrome,
                  "flex size-[34px] shrink-0 items-center justify-center rounded-sm px-0 text-[20px] font-semibold",
                  "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]",
                )}
                aria-label={`Version ${versionLabel}`}
              >
                ⓘ
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-mono text-xs">
              {`Version: ${versionLabel}`}
            </TooltipContent>
          </Tooltip>
        )}
        <Button variant="ghost" size="icon-sm" className={cn(azureSidebarIcon.chrome, "size-[34px] shrink-0")} asChild>
          <Link
            to={instanceSettingsTarget}
            aria-label="Instance settings"
            title="Instance settings"
            onClick={() => { if (isMobile) setSidebarOpen(false); }}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function Layout() {
  const { sidebarOpen, setSidebarOpen, toggleSidebar, isMobile, sidebarRailExpanded, toggleSidebarRailExpanded} = useSidebar();
  const { openNewIssue, openOnboarding } = useDialog();
  const { togglePanelVisible } = usePanel();
  const {
    companies,
    loading: companiesLoading,
    selectedCompany,
    selectedCompanyId,
    selectionSource,
    setSelectedCompanyId,
  } = useCompany();
  const { breadcrumbs } = useBreadcrumbs();
  const [sidebarWidthPx, setSidebarWidthPx] = useState(readSidebarWidthFromStorage);
  const [sidebarResizeActive, setSidebarResizeActive] = useState(false);
  const sidebarResizeStartX = useRef(0);
  const sidebarWidthAtResizeStart = useRef(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
  const sidebarResizeLiveWidth = useRef(sidebarWidthPx);
  const sidebarResizeCommitPending = useRef(false);
  const { theme, toggleTheme } = useTheme();
  const { companyPrefix, projectId: routeProjectId } = useParams<{ companyPrefix: string; projectId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isInstanceSettingsRoute = location.pathname.startsWith("/instance/");
  const isCompanyBoardRoute = /^\/[^/]+\/issues\/?$/.test(location.pathname);
  const isProjectBoardRoute =
    /^\/projects\/[^/]+\/(backlog|issues)\/?$/.test(location.pathname) ||
    /^\/[^/]+\/projects\/[^/]+\/(backlog|issues)\/?$/.test(location.pathname);
  const isBoardRoute = isCompanyBoardRoute || isProjectBoardRoute;
  const onboardingTriggered = useRef(false);
  const lastMainScrollTop = useRef(0);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const [instanceSettingsTarget, setInstanceSettingsTarget] = useState<string>(() => readRememberedInstanceSettingsPath());
  const nextTheme = theme === "dark" ? "light" : "dark";
  const matchedCompany = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix) ?? null;
  }, [companies, companyPrefix]);
  const hasUnknownCompanyPrefix =
    Boolean(companyPrefix) && !companiesLoading && companies.length > 0 && !matchedCompany;
  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as { devServer?: { enabled?: boolean } } | undefined;
      return data?.devServer?.enabled ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });
  const keyboardShortcutsEnabled = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  }).data?.keyboardShortcuts === true;
  const { data: companyProjects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (health?.deploymentMode === "authenticated") return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding, health?.deploymentMode]);

  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;

    if (!matchedCompany) {
      const fallback = (selectedCompanyId ? companies.find((company) => company.id === selectedCompanyId) : null)
        ?? companies[0]
        ?? null;
      if (fallback && selectedCompanyId !== fallback.id) {
        setSelectedCompanyId(fallback.id, { source: "route_sync" });
      }
      return;
    }

    if (companyPrefix !== matchedCompany.issuePrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${matchedCompany.issuePrefix}${suffix}${location.search}`, { replace: true });
      return;
    }

    if (
      shouldSyncCompanySelectionFromRoute({
        selectionSource,
        selectedCompanyId,
        routeCompanyId: matchedCompany.id,
      })
    ) {
      setSelectedCompanyId(matchedCompany.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    matchedCompany,
    location.pathname,
    location.search,
    navigate,
    selectionSource,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  const togglePanel = togglePanelVisible;
  const versionLabel = buildVisibleVersionLabel(health?.version);
  const breadcrumbProjectRef = useMemo(() => {
    for (let idx = breadcrumbs.length - 1; idx >= 0; idx -= 1) {
      const href = breadcrumbs[idx]?.href;
      if (!href) continue;
      const match = href.match(/\/projects\/([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    }
    return null;
  }, [breadcrumbs]);
  const resolvedGlobalProjectId = useMemo(() => {
    const projectRef = breadcrumbProjectRef ?? routeProjectId ?? null;
    if (!projectRef) return "";
    const project = (companyProjects ?? []).find((entry) => entry.id === projectRef || entry.urlKey === projectRef);
    return project?.id ?? projectRef;
  }, [breadcrumbProjectRef, companyProjects, routeProjectId]);
  const openGlobalNewIssue = useCallback(() => {
    openNewIssue({ projectId: resolvedGlobalProjectId });
  }, [openNewIssue, resolvedGlobalProjectId]);

  useCompanyPageMemory();

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    onNewIssue: openGlobalNewIssue,
    onToggleSidebar: toggleSidebar,
    onTogglePanel: togglePanel,
  });

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      return;
    }
    lastMainScrollTop.current = 0;
    setMobileNavVisible(true);
  }, [isMobile]);

  // Swipe gesture to open/close sidebar on mobile
  useEffect(() => {
    if (!isMobile) return;

    const EDGE_ZONE = 30; // px from left edge to start open-swipe
    const MIN_DISTANCE = 50; // minimum horizontal swipe distance
    const MAX_VERTICAL = 75; // max vertical drift before we ignore

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dy > MAX_VERTICAL) return; // vertical scroll, ignore

      // Swipe right from left edge → open
      if (!sidebarOpen && startX < EDGE_ZONE && dx > MIN_DISTANCE) {
        setSidebarOpen(true);
        return;
      }

      // Swipe left when open → close
      if (sidebarOpen && dx < -MIN_DISTANCE) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  const updateMobileNavVisibility = useCallback((currentTop: number) => {
    const delta = currentTop - lastMainScrollTop.current;

    if (currentTop <= 24) {
      setMobileNavVisible(true);
    } else if (delta > 8) {
      setMobileNavVisible(false);
    } else if (delta < -8) {
      setMobileNavVisible(true);
    }

    lastMainScrollTop.current = currentTop;
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      lastMainScrollTop.current = 0;
      return;
    }

    const onScroll = () => {
      updateMobileNavVisibility(window.scrollY || document.documentElement.scrollTop || 0);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [isMobile, updateMobileNavVisibility]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = isMobile ? "visible" : "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile]);

  useEffect(() => {
    if (!location.pathname.startsWith("/instance/settings/")) return;

    const nextPath = normalizeRememberedInstanceSettingsPath(
      `${location.pathname}${location.search}${location.hash}`,
    );
    setInstanceSettingsTarget(nextPath);

    try {
      window.localStorage.setItem(INSTANCE_SETTINGS_MEMORY_KEY, nextPath);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, [location.hash, location.pathname, location.search]);

  const showDesktopSidebarResize =
    !isMobile && sidebarOpen && sidebarRailExpanded;

  const endSidebarResize = useCallback(() => {
    setSidebarResizeActive(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const finishSidebarResize = useCallback(() => {
    if (!sidebarResizeCommitPending.current) return;
    sidebarResizeCommitPending.current = false;
    persistSidebarWidth(sidebarResizeLiveWidth.current);
    endSidebarResize();
  }, [endSidebarResize]);

  const onSidebarResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!showDesktopSidebarResize || e.button !== 0) return;
      e.preventDefault();
      sidebarResizeCommitPending.current = true;
      sidebarResizeStartX.current = e.clientX;
      sidebarWidthAtResizeStart.current = sidebarWidthPx;
      sidebarResizeLiveWidth.current = sidebarWidthPx;
      setSidebarResizeActive(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [showDesktopSidebarResize, sidebarWidthPx],
  );

  const onSidebarResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!sidebarResizeActive) return;
      const delta = e.clientX - sidebarResizeStartX.current;
      const w = clampSidebarWidth(sidebarWidthAtResizeStart.current + delta);
      sidebarResizeLiveWidth.current = w;
      setSidebarWidthPx(w);
    },
    [sidebarResizeActive],
  );

  const onSidebarResizePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      finishSidebarResize();
    },
    [finishSidebarResize],
  );

  const onSidebarResizeLostCapture = useCallback(() => {
    finishSidebarResize();
  }, [finishSidebarResize]);

  const onSidebarResizeDoubleClick = useCallback(() => {
    setSidebarWidthPx(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
    sidebarResizeLiveWidth.current = SIDEBAR_EXPANDED_WIDTH_DEFAULT;
    persistSidebarWidth(SIDEBAR_EXPANDED_WIDTH_DEFAULT);
  }, []);

  return (
    <GeneralSettingsProvider value={{ keyboardShortcutsEnabled }}>
      <div
      className={cn(
        "bg-background text-foreground pt-[env(safe-area-inset-top)]",
        isMobile ? "min-h-dvh" : "flex h-dvh flex-col overflow-hidden",
      )}
      >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to Main Content
      </a>
      <WorktreeBanner />
      <DevRestartBanner devServer={health?.devServer} />
      <div className={cn("min-h-0 flex-1", isMobile ? "w-full" : "flex overflow-hidden")}>
        {isMobile && sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          />
        )}

        {isMobile ? (
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] transition-transform duration-100 ease-out",
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* <CompanyRail /> */}
              {isInstanceSettingsRoute ? <InstanceSidebar /> : <Sidebar />}
            </div>
            <div className="border-t border-r border-border px-3 py-2 bg-background">
              <div className="flex items-center gap-1 min-w-0">
                {versionLabel && (
                  <span
                    className="px-2 text-xs text-muted-foreground min-w-0 flex-1 truncate"
                    title={versionLabel}
                  >
                    {versionLabel}
                  </span>
                )}
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground shrink-0" asChild>
                  <Link
                    to={instanceSettingsTarget}
                    aria-label="Instance settings"
                    title="Instance settings"
                    onClick={() => {
                      if (isMobile) setSidebarOpen(false);
                    }}
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${nextTheme} mode`}
                  title={`Switch to ${nextTheme} mode`}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-100 ease-out"
            style={{
              width: !sidebarOpen ? 0 : sidebarRailExpanded ? sidebarWidthPx : 78,
            }}
          >
            <div className="flex min-h-0 flex-1 w-full">
              {/* <CompanyRail /> */}
              <div className="w-full overflow-hidden">
                {isInstanceSettingsRoute ? <InstanceSidebar /> : <Sidebar />}
              </div>
            </div>
            <SidebarFooterBar
                isMobile={false}
                sidebarOpen={sidebarOpen}
                sidebarCompact={!sidebarRailExpanded}
                sidebarRailExpanded={sidebarRailExpanded}
                toggleSidebarRailExpanded={toggleSidebarRailExpanded}
                setSidebarOpen={setSidebarOpen}
                theme={theme}
                nextTheme={nextTheme}
                toggleTheme={toggleTheme}
                showRailToggle={true}
                versionLabel={versionLabel}
                instanceSettingsTarget={instanceSettingsTarget}
                />
 
            {/*<div className="border-t border-r border-border px-3 py-2">
              <div className="flex items-center gap-1 min-w-0">

                Documentation button. Commented out instead of deleting in case I need it again.
                <a
                  href="https://docs.paperclip.ing/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors text-foreground/80 hover:bg-accent/50 hover:text-foreground flex-1 min-w-0"
                >
                  <BookOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate">Documentation</span>
                </a>
                {versionLabel && (
                  <span
                    className="px-2 text-xs text-muted-foreground min-w-0 flex-1 truncate"
                    title={versionLabel}
                  >
                    {versionLabel}
                  </span>
                )}
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground shrink-0" asChild>
                  <Link
                    to={instanceSettingsTarget}
                    aria-label="Instance settings"
                    title="Instance settings"
                    onClick={() => {
                      if (isMobile) setSidebarOpen(false);
                    }}
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground shrink-0"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${nextTheme} mode`}
                  title={`Switch to ${nextTheme} mode`}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </div>
            </div> */}
          </div>
        )}

        <div className={cn("flex min-w-0 flex-col", isMobile ? "w-full" : "h-full flex-1")}>
          <div
            className={cn(
              isMobile && "sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85",
            )}
          >
            <BreadcrumbBar />
          </div>
          <div className={cn(isMobile ? "block" : "flex flex-1 min-h-0")}>
            <main
              id="main-content"
              tabIndex={-1}
              className={cn(
                "flex-1",
                isMobile
                  ? "overflow-visible p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
                  : cn(
                    "overflow-auto md:px-6 md:pb-6",
                    isBoardRoute ? "md:pt-0" : "md:pt-4",
                  ),
              )}
            >
              {hasUnknownCompanyPrefix ? (
                <NotFoundPage
                  scope="invalid_company_prefix"
                  requestedPrefix={companyPrefix ?? selectedCompany?.issuePrefix}
                />
              ) : (
                <Outlet />
              )}
            </main>
            <PropertiesPanel />
          </div>
        </div>
      </div>
      {isMobile && <MobileBottomNav visible={mobileNavVisible} />}
      <Button
        type="button"
        size="icon"
        className={cn(
          "fixed right-4 z-30 h-12 w-12 rounded-full text-white shadow-sm transition hover:brightness-105 active:brightness-95",
          isMobile ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-6 right-6",
        )}
        style={{ backgroundColor: "#6569E1" }}
        onClick={openGlobalNewIssue}
        aria-label="Create new task"
        title="Create new task"
      >
        <Plus className="h-5 w-5" />
      </Button>
      <CommandPalette />
      <NewIssueDialog />
      <NewProjectDialog />
      <NewGoalDialog />
      <NewAgentDialog />
      <ToastViewport />
      </div>
    </GeneralSettingsProvider>
  );
}

