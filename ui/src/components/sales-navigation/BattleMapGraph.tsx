import type { SalesNavContact, SalesNavGraph, SalesNavWarmPath } from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import { OptimalRouteBanner } from "./OptimalRouteBanner";
import { StrategicCompetitiveGraph } from "./StrategicCompetitiveGraph";

export function BattleMapGraph({
  graph,
  selectedAccountId,
  selectedContactId,
  recommendedContactId,
  highlightedPath,
  routeTargets,
  routeTargetId,
  onRouteTargetChange,
  onSelectAccount,
  onSelectContact,
  compact = false,
}: {
  graph: SalesNavGraph;
  selectedAccountId: string | null;
  selectedContactId: string | null;
  recommendedContactId: string | null;
  highlightedPath: SalesNavWarmPath | null;
  routeTargets: SalesNavContact[];
  routeTargetId: string | null;
  onRouteTargetChange: (contactId: string) => void;
  onSelectAccount: (accountId: string) => void;
  onSelectContact: (contactId: string) => void;
  compact?: boolean;
}) {
  const accountId = selectedAccountId ?? graph.accounts[0]?.id ?? null;
  const accountName = graph.accounts.find((a) => a.id === accountId)?.name ?? "Account";

  return (
    <div className="flex h-full min-h-0 flex-col gap-0.5 p-1 md:p-1.5">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 pb-1">
        <div
          className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-x-hidden"
          role="tablist"
          aria-label="Strategic accounts"
        >
          {graph.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              role="tab"
              aria-selected={account.id === accountId}
              data-touch-target="compact"
              onClick={() => onSelectAccount(account.id)}
              className={cn(
                "max-w-[11rem] shrink-0 truncate rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                account.id === accountId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/80 bg-muted/30 text-foreground hover:bg-accent/50",
              )}
              title={account.name}
            >
              {account.name}
            </button>
          ))}
        </div>
      </div>

      {accountId ? (
        <>
          <OptimalRouteBanner
            className="shrink-0"
            route={highlightedPath}
            targets={routeTargets}
            targetContactId={routeTargetId}
            onTargetChange={onRouteTargetChange}
          />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <StrategicCompetitiveGraph
            graph={graph}
            accountId={accountId}
            accountName={accountName}
            selectedContactId={selectedContactId}
            recommendedContactId={recommendedContactId}
            highlightedPath={highlightedPath}
            onSelectContact={onSelectContact}
            compact={compact}
          />
        </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border/70 bg-muted/10">
          <p className="text-sm text-muted-foreground">No strategic account selected.</p>
        </div>
      )}
    </div>
  );
}
