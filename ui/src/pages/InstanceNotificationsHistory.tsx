import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { notificationsApi } from "@/api/notifications";
import { queryKeys } from "@/lib/queryKeys";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { formatDateTime } from "../lib/utils";
import { Badge } from "@/components/ui/badge";

export function InstanceNotificationsHistory() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "Notifications" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.instance.notificationsHistory,
    queryFn: () => notificationsApi.listInstanceHistory(300),
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading notification history...</div>;
  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load notification history."}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Notifications History</h1>
        </div>
        <p className="text-sm text-muted-foreground">Recent in-app/email notifications generated across the instance.</p>
      </div>
      <section className="rounded-xl border border-border bg-card">
        <div className="divide-y">
          {(data ?? []).length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">No notifications yet.</div>
          ) : (
            (data ?? []).map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{row.title}</p>
                  <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{row.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-medium">
                    in-app
                  </Badge>
                  <Badge
                    variant={row.emailDeliveryStatus === "sent" ? "default" : "outline"}
                    className="h-5 rounded-full px-2 text-[10px] font-medium"
                  >
                    {row.emailDeliveryStatus ? `email: ${row.emailDeliveryStatus}` : "email: n/a"}
                  </Badge>
                  <span>event: {row.eventType}</span>
                  <span>read: {row.readAt ? "yes" : "no"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
