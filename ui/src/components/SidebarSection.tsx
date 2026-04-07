import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";

/** Nav row label size (Command center, projects, agents, company links, …). */
export const sidebarNavItemTextClass =
  "text-[length:var(--sidebar-nav-font-size,15px)] leading-snug";

/** Workspace / instance title in the sidebar header. */
export const sidebarNavHeaderTextClass =
  "text-[15px] font-semibold leading-snug tracking-tight text-sidebar-foreground";

/** Azure-style section labels (Projects, Agents, Company). */
export const sidebarNavSectionHeadingClass =
  "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/90";

export function sidebarNavBlockClass(compact: boolean) {
  return cn(
    "border-sidebar-border/50",
    compact ? "mt-2 border-t pt-2" : "mt-3 border-t pt-3",
  );
}

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  const { sidebarCompact } = useSidebar();

  if (sidebarCompact) {
    return (
      <div className={sidebarNavBlockClass(true)}>
        <div className="flex flex-col gap-0.5 [&>*]:shrink-0">{children}</div>
      </div>
    );
  }

  return (
    <div className={sidebarNavBlockClass(false)}>
      <div className="px-3 pb-2 pt-0.5">
        <span className={sidebarNavSectionHeadingClass}>{label}</span>
      </div>
      <div className="flex flex-col gap-0.5 [&>*]:shrink-0">{children}</div>
    </div>
  );
}
