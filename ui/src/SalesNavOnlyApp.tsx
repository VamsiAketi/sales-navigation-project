import { useCallback, useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, Info, Moon, Sun } from "lucide-react";
import { SalesNavigation } from "./pages/SalesNavigation";
import { useTheme } from "./context/ThemeContext";
import { PRODUCT_LINK_LABEL, PRODUCT_SITE_URL } from "./lib/product-brand";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SIDEBAR_EXPANDED_KEY = "sales-nav.sidebar.expanded";

function readSidebarExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SIDEBAR_EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

function SalesNavTargetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#ef4444]" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export function SalesNavOnlyApp() {
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarExpanded);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(sidebarExpanded));
    } catch {
      /* ignore */
    }
  }, [sidebarExpanded]);

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((v) => !v);
  }, []);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f4f4f5] text-[#111827]">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-[#d1d5db] bg-[#f2f1ed] transition-[width] duration-200 ease-in-out md:flex",
          sidebarExpanded ? "w-72" : "w-[78px]",
        )}
      >
        <div className={cn("p-3", !sidebarExpanded && "px-2")}>
          {sidebarExpanded ? (
            <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
              Navigation
            </div>
          ) : null}
          <Tooltip delayDuration={sidebarExpanded ? 1000 : 200}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md bg-[#eef2ff] text-sm font-medium text-[#1f2937]",
                  sidebarExpanded ? "px-3 py-2" : "justify-center px-2 py-2.5",
                )}
              >
                {sidebarExpanded ? (
                  <span className="inline-block h-4 w-1 shrink-0 rounded-full bg-[#111827]" />
                ) : null}
                <SalesNavTargetIcon />
                {sidebarExpanded ? <span className="truncate">Sales Navigation</span> : null}
              </div>
            </TooltipTrigger>
            {!sidebarExpanded ? <TooltipContent side="right">Sales Navigation</TooltipContent> : null}
          </Tooltip>
        </div>

        <div
          className={cn(
            "mt-auto border-t border-[#d1d5db] text-[#374151]",
            sidebarExpanded ? "flex items-center justify-between gap-2 px-3 py-3" : "flex flex-col items-center gap-1 px-1 py-2",
          )}
        >
          {sidebarExpanded ? (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 shrink-0 text-[#6b7280] hover:text-[#111827]"
                  onClick={toggleSidebar}
                  aria-label="Collapse sidebar"
                  title="Icon-only sidebar"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <a
                  href={PRODUCT_SITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-semibold leading-none text-[#1f3a5f] hover:underline"
                >
                  {PRODUCT_LINK_LABEL}
                </a>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-[#374151]"
                  onClick={() => setTheme(nextTheme)}
                  aria-label={`Switch to ${nextTheme} mode`}
                  title={`Switch to ${nextTheme} mode`}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-[#374151]"
                  asChild
                >
                  <a
                    href={PRODUCT_SITE_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="About AI Harness"
                    title="About AI Harness"
                  >
                    <Info className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-9 w-full text-[#6b7280] hover:text-[#111827]"
                onClick={toggleSidebar}
                aria-label="Expand sidebar"
                title="Show sidebar labels"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-9 w-full text-[#f97316]"
                    asChild
                  >
                    <a
                      href={PRODUCT_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={PRODUCT_LINK_LABEL}
                    >
                      <span className="text-base leading-none">◧</span>
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{PRODUCT_LINK_LABEL}</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-9 w-full text-[#374151]"
                onClick={() => setTheme(nextTheme)}
                aria-label={`Switch to ${nextTheme} mode`}
                title={`Switch to ${nextTheme} mode`}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="h-9 w-full text-[#374151]" asChild>
                <a
                  href={PRODUCT_SITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="About AI Harness"
                  title="About AI Harness"
                >
                  <Info className="h-4 w-4" />
                </a>
              </Button>
            </>
          )}
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-hidden bg-[#f9fafb]">
        <SalesNavigation />
      </section>
    </main>
  );
}
