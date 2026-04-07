import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

const sizeClasses = {
  xs: "h-2.5 w-2.5",
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
} as const;

const variantClasses = {
  blue: "text-blue-600 dark:text-blue-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
} as const;

const strokeForSize = { xs: 2.25, sm: 2, md: 2 } as const;

export function LiveHeartbeatIcon({
  className,
  size = "md",
  variant = "blue",
  decorative = false,
  title = "Live run in progress",
}: {
  className?: string;
  size?: keyof typeof sizeClasses;
  variant?: keyof typeof variantClasses;
  /** When true, hide from assistive tech (adjacent text conveys state). */
  decorative?: boolean;
  /** Tooltip; also used as aria-label when not decorative. */
  title?: string;
}) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", decorative && "pointer-events-none")}
      title={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      role={decorative ? undefined : "img"}
    >
      <HeartPulse
        aria-hidden
        strokeWidth={strokeForSize[size]}
        className={cn(
          sizeClasses[size],
          "origin-center animate-live-heartbeat",
          variantClasses[variant],
          className,
        )}
      />
    </span>
  );
}
