import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, Link2, Plus, Search } from "lucide-react";
import type { ConnectorConnectionCreated, ConnectorTypeDefinition } from "@paperclipai/shared";
import { Link, useSearchParams } from "@/lib/router";
import { connectorsApi } from "../api/connectors";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "../components/ui/badge";
import { startGmailOAuthPopup } from "../lib/gmail-oauth-popup";
import { startOutlookOAuthPopup } from "../lib/outlook-oauth-popup";
import { formatConnectorLabel } from "../lib/connector-labels";
import { iconForConnectorCatalogKey } from "../lib/connector-catalog-icons";
import { cn } from "../lib/utils";

function copyToClipboard(value: string, pushToast: ReturnType<typeof useToast>["pushToast"]) {
  void navigator.clipboard.writeText(value).then(() => pushToast({ title: "Copied to clipboard", tone: "success" }));
}

async function refreshConnectorConnections(
  queryClient: QueryClient,
  companyId: string,
  connectionId?: string,
) {
  await queryClient.refetchQueries({ queryKey: queryKeys.connectors.list(companyId) });
  if (!connectionId) return;
  await Promise.all([
    queryClient.refetchQueries({ queryKey: queryKeys.connectors.bindings(companyId, connectionId) }),
    queryClient.refetchQueries({ queryKey: queryKeys.connectors.deliveries(companyId, connectionId) }),
  ]);
}

function startGmailOAuth(
  companyId: string,
  connectionId: string,
  queryClient: QueryClient,
  pushToast: ReturnType<typeof useToast>["pushToast"],
) {
  startGmailOAuthPopup({
    companyId,
    connectionId,
    onConnected: async (connectedConnectionId) => {
      await refreshConnectorConnections(queryClient, companyId, connectedConnectionId ?? connectionId);
      pushToast({ title: "Gmail connected", tone: "success" });
    },
    onError: (message) => pushToast({ title: message, tone: "error" }),
    onCancelled: () => pushToast({ title: "Google sign-in was closed before finishing", tone: "error" }),
  });
}

function startOutlookOAuth(
  companyId: string,
  connectionId: string,
  queryClient: QueryClient,
  pushToast: ReturnType<typeof useToast>["pushToast"],
) {
  startOutlookOAuthPopup({
    companyId,
    connectionId,
    onConnected: async (connectedConnectionId) => {
      await refreshConnectorConnections(queryClient, companyId, connectedConnectionId ?? connectionId);
      pushToast({ title: "Outlook connected", tone: "success" });
    },
    onError: (message) => pushToast({ title: message, tone: "error" }),
    onCancelled: () => pushToast({ title: "Microsoft sign-in was closed before finishing", tone: "error" }),
  });
}

export function CompanyConnectors() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [createTypeKey, setCreateTypeKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Connectors" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const outlookResult =
      searchParams.get("outlook") ??
      (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("outlook") : null);
    if (!outlookResult || !selectedCompanyId) return;

    if (outlookResult === "connected") {
      const connectionId = searchParams.get("connectionId");
      void refreshConnectorConnections(queryClient, selectedCompanyId, connectionId ?? undefined).then(() => {
        pushToast({ title: "Outlook connected", tone: "success" });
      });
    } else if (outlookResult === "error") {
      pushToast({ title: "Outlook connection failed", tone: "error" });
    }

    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("outlook")) return;
    url.searchParams.delete("outlook");
    url.searchParams.delete("connectionId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [pushToast, queryClient, searchParams, selectedCompanyId]);

  useEffect(() => {
    const gmailResult =
      searchParams.get("gmail") ??
      (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("gmail") : null);
    if (!gmailResult || !selectedCompanyId) return;

    if (gmailResult === "connected") {
      const connectionId = searchParams.get("connectionId");
      void refreshConnectorConnections(queryClient, selectedCompanyId, connectionId ?? undefined).then(() => {
        pushToast({ title: "Gmail connected", tone: "success" });
      });
    } else if (gmailResult === "error") {
      pushToast({ title: "Gmail connection failed", tone: "error" });
    }

    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("gmail")) return;
    url.searchParams.delete("gmail");
    url.searchParams.delete("connectionId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [pushToast, queryClient, searchParams, selectedCompanyId]);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadConnectors = sidebarBadges?.canReadConnectors ?? true;
  const canManageConnectors = sidebarBadges?.canManageConnectors ?? true;

  const { data: catalogResponse, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.connectors.catalog,
    queryFn: () => connectorsApi.catalog(),
  });
  const catalog = catalogResponse?.catalog ?? [];
  const connectorTypeLabelByKey = useMemo(
    () => new Map(catalog.map((entry) => [entry.key, entry.displayName])),
    [catalog],
  );
  const catalogByKey = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry])), [catalog]);
  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (entry) =>
        entry.displayName.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.key.toLowerCase().includes(q),
    );
  }, [catalog, catalogSearch]);

  const selectedCreateType = createTypeKey ? (catalogByKey.get(createTypeKey) ?? null) : null;

  const openCreateForType = (entry: ConnectorTypeDefinition) => {
    setCreateTypeKey(entry.key);
    setCreateName(entry.defaultConnectionName ?? entry.displayName);
    setCreateOpen(true);
  };

  const { data: connections = [], isLoading: connectionsLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.connectors.list(selectedCompanyId) : ["connectors", "none"],
    queryFn: () => connectorsApi.listConnections(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && canReadConnectors,
  });

  const createConnection = useMutation({
    mutationFn: () =>
      connectorsApi.createConnection(selectedCompanyId!, {
        connectorTypeKey: createTypeKey,
        name: createName.trim(),
        config: {},
      }),
    onSuccess: async (created: ConnectorConnectionCreated) => {
      pushToast({
        title:
          created.connectorTypeKey === "gmail"
            ? "Gmail connection created. Finish setup with Google sign-in."
            : created.connectorTypeKey === "outlook"
              ? "Outlook connection created. Finish setup with Microsoft sign-in."
              : "Connector connection created",
        tone: "success",
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateTypeKey("");
      if (created.inboundSecretValue) setRevealedSecret(created.inboundSecretValue);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
      if (created.connectorTypeKey === "gmail") {
        startGmailOAuth(selectedCompanyId!, created.id, queryClient, pushToast);
      } else if (created.connectorTypeKey === "outlook") {
        startOutlookOAuth(selectedCompanyId!, created.id, queryClient, pushToast);
      }
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Link2} message="Choose a company to manage connectors." />;
  }
  if (!canReadConnectors) {
    return <EmptyState icon={Link2} message="You do not have permission to view connectors." />;
  }
  if (catalogLoading || connectionsLoading) return <PageSkeleton />;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Pick an ingress type from the directory, name the connection, then open it to add bindings, copy inbound URLs,
          and review deliveries. Gmail and Outlook use cloud sign-in; email and custom webhooks use a signed inbound URL.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Directory</h2>
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search connectors…"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              aria-label="Search connectors"
            />
          </div>
        </div>
        {filteredCatalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connectors match your search.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCatalog.map((entry) => {
              const Icon = iconForConnectorCatalogKey(entry.key);
              return (
                <div
                  key={entry.key}
                  className={cn(
                    "flex flex-col rounded-xl border bg-card p-4 shadow-xs transition-colors",
                    "hover:border-primary/35 hover:bg-accent/15",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-5 w-5 text-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium leading-tight">{entry.displayName}</div>
                        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {entry.description}
                        </p>
                      </div>
                    </div>
                    {canManageConnectors ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="shrink-0 gap-1"
                        onClick={() => openCreateForType(entry)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Add
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.eventTypes.map((eventType) => (
                      <Badge key={eventType.key} variant="secondary" className="text-[10px] font-normal">
                        {eventType.displayName}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Your connections</h2>
        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/15 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No connections yet. Choose a connector in the directory above, use{" "}
              <span className="font-medium text-foreground">Add</span> to create one, then open it to finish setup and
              add bindings.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {connections.map((connection) => (
              <ConnectionListRow
                key={connection.id}
                connection={connection}
                typeLabel={
                  connectorTypeLabelByKey.get(connection.connectorTypeKey) ??
                  formatConnectorLabel(connection.connectorTypeKey)
                }
              />
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={createOpen && Boolean(createTypeKey)}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateTypeKey("");
            setCreateName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {selectedCreateType ? (
            <>
              <DialogHeader className="space-y-4 text-left sm:space-y-4 sm:text-left">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {(() => {
                      const HeaderIcon = iconForConnectorCatalogKey(selectedCreateType.key);
                      return <HeaderIcon className="h-5 w-5 text-foreground" aria-hidden />;
                    })()}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle>Add {selectedCreateType.displayName}</DialogTitle>
                    <DialogDescription className="mt-1.5 text-pretty">
                      {selectedCreateType.createDialogHelperText ?? selectedCreateType.description}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
                    <span>
                      <span className="text-muted-foreground/80">Auth</span>{" "}
                      <span className="text-foreground">
                        {selectedCreateType.authMode === "managed_oauth"
                          ? "Google OAuth (managed)"
                          : "Bearer token + HTTPS inbound URL"}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground/80">Events</span>{" "}
                      <span className="text-foreground">
                        {selectedCreateType.eventTypes.map((e) => e.displayName).join(", ")}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="connector-create-name" className="text-sm font-medium">
                    {selectedCreateType.connectionNameFieldLabel ?? "Connection name"}
                  </label>
                  <Input
                    id="connector-create-name"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder={selectedCreateType.connectionNamePlaceholder ?? "e.g. Sales inbox"}
                    autoComplete="off"
                  />
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="sm:mr-auto"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateTypeKey("");
                    setCreateName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!createName.trim() || createConnection.isPending}
                  onClick={() => createConnection.mutate()}
                >
                  {createTypeKey === "gmail"
                    ? "Continue with Google"
                    : createTypeKey === "outlook"
                      ? "Continue with Microsoft"
                      : "Create connection"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revealedSecret)} onOpenChange={(open) => !open && setRevealedSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inbound bearer token</DialogTitle>
            <DialogDescription>Copy this token now. It will not be shown again after you close this dialog.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={revealedSecret ?? ""} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => revealedSecret && copyToClipboard(revealedSecret, pushToast)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function connectionListSubtitle(connection: {
  authMode?: "inbound_webhook" | "managed_oauth";
  connectorTypeKey: string;
  connectedAccountEmail?: string | null;
  status: string;
  lastError: string | null;
}): string | null {
  if (connection.authMode === "managed_oauth") {
    if (connection.connectedAccountEmail) return connection.connectedAccountEmail;
    if (connection.status === "pending_auth") {
      return connection.connectorTypeKey === "outlook" ? "Awaiting Microsoft sign-in" : "Awaiting Google sign-in";
    }
    if (connection.status === "error" && connection.lastError) {
      const t = connection.lastError;
      return t.length > 96 ? `${t.slice(0, 93)}…` : t;
    }
    return null;
  }
  return "Inbound webhook (bearer token)";
}

function ConnectionListRow({
  connection,
  typeLabel,
}: {
  connection: {
    id: string;
    name: string;
    connectorTypeKey: string;
    status: string;
    authMode?: "inbound_webhook" | "managed_oauth";
    connectedAccountEmail?: string | null;
    lastError: string | null;
  };
  typeLabel: string;
}) {
  const Icon = iconForConnectorCatalogKey(connection.connectorTypeKey);
  const subtitle = connectionListSubtitle(connection);

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium leading-tight">{connection.name}</span>
          <Badge variant="outline" className="text-[10px] font-normal">
            {typeLabel}
          </Badge>
          <Badge variant={connection.status === "active" ? "default" : "secondary"} className="text-[10px] font-normal">
            {formatConnectorLabel(connection.status)}
          </Badge>
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 gap-0.5 text-muted-foreground" asChild>
        <Link to={`/company/connectors/${connection.id}`}>
          Open
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
