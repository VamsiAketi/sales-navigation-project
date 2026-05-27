import { useState } from "react";
import type { SalesNavContact, SalesNavGraph, SalesNavInsights, SalesNavContactStatus } from "@paperclipai/shared";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { SalesNavContactDetailPanel } from "./SalesNavContactDetailPanel";
import { SalesIntelligencePanel } from "./SalesIntelligencePanel";

export function SalesNavRightSidebar({
  graph,
  insights,
  selectedContact,
  canWrite,
  onClose,
  onStatusChange,
}: {
  graph: SalesNavGraph;
  insights: SalesNavInsights;
  selectedContact: SalesNavContact | null;
  canWrite: boolean;
  onClose: () => void;
  onStatusChange: (status: SalesNavContactStatus) => void;
}) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const isRecommended = Boolean(
    selectedContact && insights.recommendedContactId === selectedContact.id,
  );

  if (!selectedContact) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-semibold">Contact details</p>
          <p className="text-[11px] text-muted-foreground">Click a person on the map to view their profile.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <SalesIntelligencePanel
            graph={graph}
            insights={insights}
            selectedContact={null}
            canWrite={canWrite}
            dense
            onStatusChange={onStatusChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SalesNavContactDetailPanel
        contact={selectedContact}
        graph={graph}
        insights={insights}
        canWrite={canWrite}
        isRecommended={isRecommended}
        onClose={onClose}
        onStatusChange={onStatusChange}
      />

      <div className="shrink-0 border-t border-border bg-muted/15">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          aria-expanded={overviewOpen}
          onClick={() => setOverviewOpen((v) => !v)}
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            Battlefield overview
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", overviewOpen && "rotate-180")}
            aria-hidden
          />
        </button>
        {overviewOpen ? (
          <div className="max-h-56 overflow-y-auto border-t border-border/60 [scrollbar-width:thin]">
            <SalesIntelligencePanel
              graph={graph}
              insights={insights}
              selectedContact={null}
              canWrite={canWrite}
              dense
              hideContactSection
              onStatusChange={onStatusChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
