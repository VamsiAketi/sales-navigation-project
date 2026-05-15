import { cn } from "@/lib/utils";

export function SidebarNavAccessSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-1 py-0.5", className)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded-md bg-muted/45"
          style={{ animationDelay: `${index * 40}ms` }}
        />
      ))}
    </div>
  );
}
