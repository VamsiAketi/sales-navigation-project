import { useState } from "react";
import {
  SALES_NAV_LEVEL_LABELS,
  type SalesNavContact,
  type SalesNavGraph,
  type SalesNavInsights,
  type SalesNavContactStatus,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { SalesNavStatusSelect } from "./sales-nav-status";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  Building2,
  Copy,
  ExternalLink,
  Route,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { SalesNavContactAvatar } from "./SalesNavContactAvatar";
import { salesNavCleanWarmIntroText, salesNavDisplayName } from "@/lib/sales-navigation/linkedin-avatar";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function strengthBarClass(strength: number) {
  if (strength >= 70) return "bg-emerald-500";
  if (strength >= 45) return "bg-amber-500";
  return "bg-muted-foreground/50";
}

export function SalesNavContactDetailPanel({
  contact,
  graph,
  insights,
  canWrite,
  isRecommended,
  onClose,
  onStatusChange,
}: {
  contact: SalesNavContact;
  graph: SalesNavGraph;
  insights: SalesNavInsights;
  canWrite: boolean;
  isRecommended: boolean;
  onClose: () => void;
  onStatusChange: (status: SalesNavContactStatus) => void;
}) {
  const account = graph.accounts.find((a) => a.id === contact.accountId);
  const reportsTo = contact.reportsToContactId
    ? graph.contacts.find((c) => c.id === contact.reportsToContactId)
    : null;

  const onWarmPath = insights.strongestWarmPath?.steps.some((s) => s.contactId === contact.id) ?? false;
  const pathLabel = insights.strongestWarmPath?.steps.map((s) => salesNavDisplayName(s.contactName)).join(" → ");
  const displayName = salesNavDisplayName(contact.name, contact.linkedinUrl);
  const [copied, setCopied] = useState(false);

  const handleCopyLinkedIn = async () => {
    if (!contact.linkedinUrl) return;
    try {
      await navigator.clipboard.writeText(contact.linkedinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <SalesNavContactAvatar
            name={contact.name}
            linkedinUrl={contact.linkedinUrl}
            level={contact.level}
            size="lg"
            showLevelRing
          />
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">{displayName}</p>
            {contact.title ? (
              contact.title.trim().toLowerCase() === "mutual connection" ? (
                <span className="mt-0.5 inline-flex rounded-md border border-sky-500/35 bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:text-sky-100">
                  Mutual connection
                </span>
              ) : (
                <p className="mt-0.5 text-sm text-muted-foreground">{contact.title}</p>
              )
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {isRecommended ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary-foreground">
                  <Sparkles className="h-2.5 w-2.5" aria-hidden />
                  Next contact
                </span>
              ) : null}
              {contact.verified ? (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800 dark:text-emerald-200">
                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                  Verified
                </span>
              ) : null}
              {onWarmPath ? (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                  <Route className="h-2.5 w-2.5" aria-hidden />
                  On warm path
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="Close contact details"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-width:thin]">
        <DetailRow label="Relationship strength">
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", strengthBarClass(contact.relationshipStrength))}
                style={{ width: `${contact.relationshipStrength}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums">{contact.relationshipStrength}%</span>
          </div>
        </DetailRow>

        <DetailRow label="Buying committee role">{SALES_NAV_LEVEL_LABELS[contact.level]}</DetailRow>

        <DetailRow label="Engagement status">
          <SalesNavStatusSelect
            value={contact.status}
            disabled={!canWrite}
            onChange={onStatusChange}
          />
        </DetailRow>

        {account ? (
          <DetailRow label="Strategic account">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {account.name}
              <span className="text-muted-foreground">· score {account.priorityScore}</span>
            </span>
          </DetailRow>
        ) : null}

        {contact.company && contact.company !== account?.name ? (
          <DetailRow label="Company">{contact.company}</DetailRow>
        ) : null}

        {contact.teamOwner ? (
          <DetailRow label="Owner / source">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {contact.teamOwner}
            </span>
          </DetailRow>
        ) : null}

        {reportsTo ? (
          <DetailRow label="Reports to / intro via">
            {salesNavDisplayName(reportsTo.name, reportsTo.linkedinUrl)}
            {reportsTo.title ? (
              <span className="text-muted-foreground"> — {reportsTo.title}</span>
            ) : null}
          </DetailRow>
        ) : null}

        {contact.warmIntroPath ? (
          <DetailRow label="Warm intro path">{salesNavCleanWarmIntroText(contact.warmIntroPath)}</DetailRow>
        ) : null}

        {onWarmPath && pathLabel ? (
          <DetailRow label="Active climb path">
            <p className="text-[11px] leading-snug text-primary">{pathLabel}</p>
          </DetailRow>
        ) : null}

        {contact.linkedinUrl ? (
          <DetailRow label="LinkedIn">
            <div className="flex items-center gap-2">
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                View profile
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              <button
                type="button"
                onClick={handleCopyLinkedIn}
                className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/40"
                aria-label="Copy LinkedIn link"
                title="Copy LinkedIn link"
              >
                <Copy className="h-3 w-3" aria-hidden />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </DetailRow>
        ) : null}

        {contact.outreachNotes ? (
          <DetailRow label="Intelligence notes">
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 p-2 text-xs leading-relaxed text-muted-foreground [scrollbar-width:thin]">
              {contact.outreachNotes}
            </div>
          </DetailRow>
        ) : null}

      </div>
    </div>
  );
}
