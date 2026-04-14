import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * “Next unread” — right chevron (advance) plus a solid dot matching Attention Queue unread affordance.
 * Stroke follows Lucide defaults; dot uses inbox unread blue.
 */
export const NextUnreadIcon = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  ({ className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 text-muted-foreground", className)}
      aria-hidden
      {...props}
    >
      {/* Chevron: explicit stroke so parent `fill` on the dot does not flatten the arrow */}
      <polyline
        points="9 18 15 12 9 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="18"
        cy="7"
        r="2.75"
        fill="currentColor"
        stroke="none"
        className="text-blue-600 dark:text-blue-400"
      />
    </svg>
  ),
);
NextUnreadIcon.displayName = "NextUnreadIcon";
