import type { SalesNavContact, SalesNavGraph, SalesNavInsights, SalesNavContactStatus } from "@paperclipai/shared";
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
    </div>
  );
}
