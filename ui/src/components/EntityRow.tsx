import { type ReactNode } from "react";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";

interface EntityRowProps {
  leading?: ReactNode;
  identifier?: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  selected?: boolean;
  to?: string;
  /** Passed through to `Link` when `to` is set (e.g. issue modal overlay state). */
  state?: unknown;
  onClick?: () => void;
  className?: string;
  /** Azure portal–style resource row (typography + hover). */
  variant?: "default" | "azure";
}

export function EntityRow({
  leading,
  identifier,
  title,
  subtitle,
  trailing,
  selected,
  to,
  state,
  onClick,
  className,
  variant = "default",
}: EntityRowProps) {
  const isClickable = !!(to || onClick);
  const classes = cn(
    "flex items-center gap-3 border-b last:border-b-0 transition-colors",
    variant === "azure"
      ? "px-3 py-2.5 text-[13px] border-b-[#edebe9] dark:border-b-white/10"
      : "px-4 py-2 text-sm border-border",
    isClickable &&
      (variant === "azure"
        ? "cursor-pointer hover:bg-[#f3f2f1] dark:hover:bg-white/[0.06]"
        : "cursor-pointer hover:bg-accent/50"),
    selected && (variant === "azure" ? "bg-[#edebe9]/80 dark:bg-white/[0.08]" : "bg-accent/30"),
    className,
  );

  const content = (
    <>
      {leading && <div className="flex items-center gap-2 shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {identifier && (
            <span className="text-xs text-muted-foreground font-mono shrink-0 relative top-[1px]">
              {identifier}
            </span>
          )}
          <span
            className={cn(
              "truncate",
              variant === "azure" && "font-semibold text-[#201f1e] dark:text-foreground",
            )}
          >
            {title}
          </span>
        </div>
        {subtitle && (
          <p
            className={cn(
              "text-xs text-muted-foreground truncate mt-0.5",
              variant === "azure" && "text-[12px] text-[#605e5c] dark:text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
        )}
      </div>
      {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} state={state} className={cn(classes, "no-underline text-inherit")} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} onClick={onClick}>
      {content}
    </div>
  );
}
