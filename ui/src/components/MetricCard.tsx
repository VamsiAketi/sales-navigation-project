import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";
import { DASHBOARD_TILE_SURFACE } from "../lib/dashboard-tile-styles";

const METRIC_ICON_TINT = {
  violet: "rounded-xl bg-violet-100 p-2 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
  sky: "rounded-xl bg-sky-100 p-2 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
  emerald: "rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  purple: "rounded-xl bg-purple-100 p-2 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300",
} as const;

export type MetricIconTint = keyof typeof METRIC_ICON_TINT;

interface MetricCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Soft icon tile (Command Center style). */
  iconTint?: MetricIconTint;
}

export function MetricCard({ icon: Icon, value, label, description, to, onClick, iconTint }: MetricCardProps) {
  const isClickable = !!(to || onClick);
  const tintCls = iconTint ? METRIC_ICON_TINT[iconTint] : null;

  const inner = (
    <div
      className={cn(
        "h-full px-4 py-4 sm:px-5 sm:py-5 transition-colors",
        isClickable && "cursor-pointer hover:bg-accent/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1">
            {label}
          </p>
          {description && (
            <div className="text-xs text-muted-foreground/70 mt-1.5 hidden sm:block">{description}</div>
          )}
        </div>
        {tintCls ? (
          <div className={cn("shrink-0", tintCls)} aria-hidden>
            <Icon className="h-5 w-5" />
          </div>
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-1.5" />
        )}
      </div>
    </div>
  );

  const surface = cn(DASHBOARD_TILE_SURFACE, "h-full min-h-0 overflow-hidden");

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          surface,
          "no-underline text-inherit outline-none transition-shadow",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        onClick={onClick}
      >
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div className={cn(surface, "cursor-pointer")} onClick={onClick}>
        {inner}
      </div>
    );
  }

  return <div className={surface}>{inner}</div>;
}
