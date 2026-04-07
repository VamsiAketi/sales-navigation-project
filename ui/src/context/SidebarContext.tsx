// import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from "react";

// interface SidebarContextValue {
//   sidebarOpen: boolean;
//   setSidebarOpen: (open: boolean) => void;
//   toggleSidebar: () => void;
//   isMobile: boolean;
// }

// const SidebarContext = createContext<SidebarContextValue | null>(null);

// const MOBILE_BREAKPOINT = 768;

// export function SidebarProvider({ children }: { children: ReactNode }) {
//   const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
//   const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT);

//   useEffect(() => {
//     const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
//     const onChange = (e: MediaQueryListEvent) => {
//       setIsMobile(e.matches);
//       setSidebarOpen(!e.matches);
//     };
//     mql.addEventListener("change", onChange);
//     return () => mql.removeEventListener("change", onChange);
//   }, []);

//   const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

//   return (
//     <SidebarContext.Provider value={{ sidebarOpen, setSidebarOpen, toggleSidebar, isMobile }}>
//       {children}
//     </SidebarContext.Provider>
//   );
// }

// export function useSidebar() {
//   const ctx = useContext(SidebarContext);
//   if (!ctx) {
//     throw new Error("useSidebar must be used within SidebarProvider");
//   }
//   return ctx;
// }

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
  /** Desktop: full labels (true) vs icon-only rail (false). Mobile drawer always uses full labels. */
  sidebarRailExpanded: boolean;
  setSidebarRailExpanded: (expanded: boolean) => void;
  toggleSidebarRailExpanded: () => void;
  /** True when the main sidebar should show icon-only items (desktop narrow rail). */
  sidebarCompact: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const MOBILE_BREAKPOINT = 768;
const RAIL_EXPANDED_KEY = "aiharness.sidebar.railExpanded";

function readRailExpandedFromStorage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(RAIL_EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT);
  const [sidebarRailExpanded, setSidebarRailExpandedState] = useState(readRailExpandedFromStorage);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setSidebarOpen(!e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_EXPANDED_KEY, String(sidebarRailExpanded));
    } catch {
      // ignore
    }
  }, [sidebarRailExpanded]);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  const setSidebarRailExpanded = useCallback((expanded: boolean) => {
    setSidebarRailExpandedState(expanded);
  }, []);

  const toggleSidebarRailExpanded = useCallback(() => {
    setSidebarRailExpandedState((v) => !v);
  }, []);

  const sidebarCompact = useMemo(
    () => !isMobile && sidebarOpen && !sidebarRailExpanded,
    [isMobile, sidebarOpen, sidebarRailExpanded],
  );

  const value = useMemo(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      isMobile,
      sidebarRailExpanded,
      setSidebarRailExpanded,
      toggleSidebarRailExpanded,
      sidebarCompact,
    }),
    [
      sidebarOpen,
      toggleSidebar,
      isMobile,
      sidebarRailExpanded,
      setSidebarRailExpanded,
      toggleSidebarRailExpanded,
      sidebarCompact,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return ctx;
}
