import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";

/** Primary rail links (Command Center, instance settings, footer) — not nested under a section heading. */
export const sidebarNavItemTextClass =
  "text-[length:var(--sidebar-nav-font-size,14px)] leading-snug";

/** Workspace / instance title in the sidebar header. */
export const sidebarNavHeaderTextClass =
  "text-[15px] font-semibold leading-snug tracking-tight text-sidebar-foreground";

/** Section labels (e.g. Company) — parent tier; keep larger than nested list rows. */
export const sidebarNavSectionHeadingClass =
  "text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/90";

/** Collapsible group title row (Projects, Agents) — same scale as section headings, title case. */
export const sidebarNavCollapsibleGroupClass =
  "text-[13px] font-semibold leading-snug";

/** Nested lists under a section heading or collapsible (project rows, agents, Company links). */
export const sidebarNavSubItemTextClass =
  "text-[12px] leading-snug font-normal";

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
