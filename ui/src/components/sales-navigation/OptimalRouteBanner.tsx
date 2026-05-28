import type { SalesNavContact, SalesNavWarmPath } from "@paperclipai/shared";
import { Sparkles } from "lucide-react";
import { salesNavDisplayName } from "@/lib/sales-navigation/linkedin-avatar";
import { cn } from "@/lib/utils";

export function OptimalRouteBanner({
  route,
  targets,
  targetContactId,
  onTargetChange,
  className,
}: {
  route: SalesNavWarmPath | null;
  targets: SalesNavContact[];
  targetContactId: string | null;
  onTargetChange: (contactId: string) => void;
  className?: string;
}) {
  if (!route && targets.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2", className)}>
        <p className="text-[11px] text-muted-foreground">
          Import relationship data to generate an optimal route to the target buyer.
        </p>
      </div>
    );
  }

  if (!route) {
    return (
      <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2", className)}>
        <p className="text-[11px] font-medium text-amber-950 dark:text-amber-100">
          No climb path found to the selected target. Add LinkedIn connection columns or edges from your
          connectors to 1st-level contacts.
        </p>
      </div>
    );
  }

  const score = route.routeScore ?? route.totalStrength;
  const stepLabel = route.steps.map((s) => salesNavDisplayName(s.contactName)).join(" → ");

  return (
    <div
      className={cn(
        "rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Optimal route to target</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{route.summary}</p>
            <p className="mt-1 truncate text-[11px] font-medium text-foreground" title={stepLabel}>
              {stepLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {targets.length > 1 ? (
            <label className="flex flex-col items-end gap-0.5">
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                Target
              </span>
              <select
                className="max-w-[12rem] truncate rounded-md border border-border/80 bg-background px-2 py-1 text-[11px]"
                value={targetContactId ?? route.targetContactId}
                onChange={(e) => onTargetChange(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {salesNavDisplayName(t.name, t.linkedinUrl)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-[10px] font-medium text-muted-foreground">
              Target: {salesNavDisplayName(route.targetContactName)}
            </span>
          )}
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
            Route score {score}/100
          </span>
        </div>
      </div>
    </div>
  );
}
