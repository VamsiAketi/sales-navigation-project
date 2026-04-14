// import { NavLink } from "@/lib/router";
// import { cn } from "../lib/utils";
// import { useSidebar } from "../context/SidebarContext";
// import type { LucideIcon } from "lucide-react";

// interface SidebarNavItemProps {
//   to: string;
//   label: string;
//   icon: LucideIcon;
//   end?: boolean;
//   className?: string;
//   badge?: number;
//   badgeTone?: "default" | "danger";
//   textBadge?: string;
//   textBadgeTone?: "default" | "amber";
//   alert?: boolean;
//   liveCount?: number;
// }

// export function SidebarNavItem({
//   to,
//   label,
//   icon: Icon,
//   end,
//   className,
//   badge,
//   badgeTone = "default",
//   textBadge,
//   textBadgeTone = "default",
//   alert = false,
//   liveCount,
// }: SidebarNavItemProps) {
//   const { isMobile, setSidebarOpen } = useSidebar();

//   return (
//     <NavLink
//       to={to}
//       end={end}
//       onClick={() => { if (isMobile) setSidebarOpen(false); }}
//       className={({ isActive }) =>
//         cn(
//           "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
//           isActive
//             ? "bg-accent text-foreground"
//             : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
//           className,
//         )
//       }
//     >
//       <span className="relative shrink-0">
//         <Icon className="h-4 w-4" />
//         {alert && (
//           <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_2px_hsl(var(--background))]" />
//         )}
//       </span>
//       <span className="flex-1 truncate">{label}</span>
//       {textBadge && (
//         <span
//           className={cn(
//             "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
//             textBadgeTone === "amber"
//               ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
//               : "bg-muted text-muted-foreground",
//           )}
//         >
//           {textBadge}
//         </span>
//       )}
//       {liveCount != null && liveCount > 0 && (
//         <span className="ml-auto flex items-center gap-1.5">
//           <span className="relative flex h-2 w-2">
//             <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
//             <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
//           </span>
//           <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">{liveCount} live</span>
//         </span>
//       )}
//       {badge != null && badge > 0 && (
//         <span
//           className={cn(
//             "ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none",
//             badgeTone === "danger"
//               ? "bg-red-600/90 text-red-50"
//               : "bg-primary text-primary-foreground",
//           )}
//         >
//           {badge}
//         </span>
//       )}
//     </NavLink>
//   );
// }

import { NavLink } from "@/lib/router";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";
import { sidebarNavItemTextClass } from "./SidebarSection";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LiveHeartbeatIcon } from "./LiveHeartbeatIcon";

interface SidebarNavItemProps {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Icon color when the row is not selected (`azureSidebarIcon` in `sidebar-icon-tints.ts`). */
  iconClassName?: string;
  end?: boolean;
  className?: string;
  textBadge?: string;
  textBadgeTone?: "default" | "amber";
  alert?: boolean;
  liveCount?: number;
}

export function SidebarNavItem({
  to,
  label,
  icon: Icon,
  iconClassName,
  end,
  className,
  textBadge,
  textBadgeTone = "default",
  alert = false,
  liveCount,
}: SidebarNavItemProps) {
  const { isMobile, setSidebarOpen, sidebarCompact } = useSidebar();

  const navClassName = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group/nav flex items-center font-normal transition-[background-color,color,border-color] duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      sidebarNavItemTextClass,
      sidebarCompact
        ? "min-h-10 w-full justify-center rounded-sm !px-0 py-2"
        : "mx-0 gap-2.5 border-l-[3px] border-transparent py-2 pl-3 pr-2.5",
      isActive
        ? sidebarCompact
          ? "bg-[var(--sidebar-active-bg)] text-foreground"
          : "border-[var(--sidebar-active-bar)] bg-[var(--sidebar-active-bg)] text-foreground"
        : sidebarCompact
          ? "text-sidebar-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
          : "text-sidebar-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
      className,
    );

  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={() => {
        if (isMobile) setSidebarOpen(false);
      }}
      className={navClassName}
    >
      {({ isActive }) => (
        <>
          <span className="relative flex shrink-0 items-center justify-center">
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                isActive ? "text-[var(--sidebar-active-bar)]" : (iconClassName ?? "text-muted-foreground"),
              )}
            />
            {alert && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
            )}
            {sidebarCompact && liveCount != null && liveCount > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-1.5 w-1.5 rounded-full bg-blue-500 ring-2 ring-sidebar" />
            )}
          </span>
          {!sidebarCompact && (
            <>
              <span className="flex-1 truncate">{label}</span>
              {textBadge && (
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                    textBadgeTone === "amber"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {textBadge}
                </span>
              )}
              {liveCount != null && liveCount > 0 && (
                <span className="ml-auto flex items-center gap-1.5">
                  <LiveHeartbeatIcon size="sm" decorative />
                  <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {liveCount} live
                  </span>
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  if (sidebarCompact) {
    const tipParts = [label];
    if (textBadge) tipParts.push(`(${textBadge})`);
    if (liveCount != null && liveCount > 0) tipParts.push(`${liveCount} live`);
    const tip = tipParts.join(" · ");

    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-[240px]">
          {tip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
