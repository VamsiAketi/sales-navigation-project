import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatInboxBadgeTooltip, type InboxBadgeBreakdownLine } from "../lib/inbox";
import { cn } from "../lib/utils";

type AttentionQueueBadgeProps = {
  count: number;
  tone?: "default" | "danger";
  breakdown: InboxBadgeBreakdownLine[];
  /** Compact sidebar: smaller pill on the nav icon. */
  variant?: "inline" | "compact";
  className?: string;
};

export function AttentionQueueBadge({
  count,
  tone = "default",
  breakdown,
  variant = "inline",
  className,
}: AttentionQueueBadgeProps) {
  if (count <= 0) return null;

  const display = count > 99 ? "99+" : String(count);
  const pill = (
    <span
      className={cn(
        variant === "compact"
          ? "flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold leading-none text-white ring-2 ring-sidebar"
          : "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
        tone === "danger"
          ? variant === "compact"
            ? "bg-red-600 dark:bg-red-500"
            : "bg-red-600/90 text-white dark:bg-red-600"
          : variant === "compact"
            ? "bg-primary"
            : "bg-primary text-primary-foreground",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {display}
    </span>
  );

  const tip = formatInboxBadgeTooltip(breakdown);
  if (!tip) return pill;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent
        side={variant === "compact" ? "right" : "left"}
        sideOffset={6}
        className="max-w-[220px]"
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
