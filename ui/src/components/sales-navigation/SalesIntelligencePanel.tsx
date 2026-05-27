import {
  type SalesNavContact,
  type SalesNavGraph,
  type SalesNavInsights,
  type SalesNavContactStatus,
} from "@paperclipai/shared";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CircleDot,
  Network,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { SalesNavContactAvatar } from "./SalesNavContactAvatar";
import { SalesNavStatusSelect } from "./sales-nav-status";
import { salesNavCleanWarmIntroText, salesNavDisplayName } from "@/lib/sales-navigation/linkedin-avatar";

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  dense,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: typeof Target;
  dense?: boolean;
}) {
  return (
    <div className={cn("rounded-md border border-border/70 bg-card/80 shadow-sm", dense ? "p-2" : "p-3")}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <p className="text-[9px] font-semibold uppercase tracking-wide">{title}</p>
      </div>
      <p className={cn("font-semibold text-foreground", dense ? "mt-1 text-xs" : "mt-2 text-sm")}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">{hint}</p> : null}
    </div>
  );
}

export function SalesIntelligencePanel({
  graph,
  insights,
  selectedContact,
  canWrite,
  dense = false,
  hideContactSection = false,
  onStatusChange,
}: {
  graph: SalesNavGraph;
  insights: SalesNavInsights;
  selectedContact: SalesNavContact | null;
  canWrite: boolean;
  dense?: boolean;
  hideContactSection?: boolean;
  onStatusChange: (status: SalesNavContactStatus) => void;
}) {
  const pad = dense ? "p-2" : "p-4";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!dense && !hideContactSection ? (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold">Battlefield intelligence</p>
              <p className="text-xs text-muted-foreground">AI-ranked outreach signals</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className={cn("min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]", pad, dense ? "space-y-2" : "space-y-4")}>
        <MetricCard
          icon={Target}
          title="Next best account"
          value={insights.nextBestAccountName ?? "—"}
          hint={insights.accountRankings[0] ? `Score ${insights.accountRankings[0].score}/100` : undefined}
          dense={dense}
        />
        <MetricCard
          icon={Users}
          title="Next contact"
          value={insights.recommendedContactName ? salesNavDisplayName(insights.recommendedContactName) : "—"}
          hint={insights.recommendedReason ?? undefined}
          dense={dense}
        />

        <div className="grid grid-cols-2 gap-1.5">
          <MetricCard
            icon={TrendingUp}
            title="Strength"
            value={`${insights.averageRelationshipStrength}%`}
            dense={dense}
          />
          <MetricCard
            icon={ShieldCheck}
            title="Verified"
            value={String(insights.verifiedConnectionCount)}
            dense={dense}
          />
          <MetricCard
            icon={Network}
            title="Warm intros"
            value={String(insights.warmIntroOpportunityCount)}
            dense={dense}
          />
          <MetricCard
            icon={CircleDot}
            title="High prob."
            value={String(insights.highProbabilityDealCount)}
            dense={dense}
          />
        </div>

        {insights.strongestWarmPath ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Strongest warm path
            </p>
            <p className="mt-2 text-xs text-foreground">
              {insights.strongestWarmPath.steps.map((s) => salesNavDisplayName(s.contactName)).join(" → ")}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Toward {salesNavDisplayName(insights.strongestWarmPath.targetContactName)}
            </p>
          </div>
        ) : null}

        {insights.missingGapSummary ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-100">
            {insights.missingGapSummary}
          </div>
        ) : null}

        {!dense ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Account priority
          </p>
          <ul className="space-y-1.5">
            {insights.accountRankings.slice(0, 5).map((row) => (
              <li
                key={row.accountId}
                className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium">{row.accountName}</span>
                <span className="tabular-nums text-muted-foreground">{row.score}</span>
              </li>
            ))}
          </ul>
        </div>
        ) : null}

        {selectedContact ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Selected contact
            </p>
            <div className="mt-2 flex items-start gap-3">
              <SalesNavContactAvatar
                name={selectedContact.name}
                linkedinUrl={selectedContact.linkedinUrl}
                level={selectedContact.level}
                size="lg"
                showLevelRing
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{salesNavDisplayName(selectedContact.name, selectedContact.linkedinUrl)}</p>
                {selectedContact.title ? (
                  <p className="text-xs text-muted-foreground">{selectedContact.title}</p>
                ) : null}
              </div>
            </div>
            {selectedContact.linkedinUrl ? (
              <a
                href={selectedContact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                LinkedIn profile <ArrowRight className="h-3 w-3" />
              </a>
            ) : null}
            {selectedContact.warmIntroPath ? (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Warm intro:</span>{" "}
                {salesNavCleanWarmIntroText(selectedContact.warmIntroPath)}
              </p>
            ) : null}
            {selectedContact.outreachNotes ? (
              <p className="mt-2 text-xs text-muted-foreground">{selectedContact.outreachNotes}</p>
            ) : null}

            <div className="mt-3">
              <SalesNavStatusSelect
                value={selectedContact.status}
                disabled={!canWrite}
                onChange={onStatusChange}
              />
            </div>
          </div>
        ) : !hideContactSection ? (
          <p className="text-xs text-muted-foreground">Select a contact on the battle map to inspect intelligence.</p>
        ) : null}
      </div>
    </div>
  );
}
