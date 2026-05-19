import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ConnectorEventBinding, ConnectorTypeDefinition } from "@paperclipai/shared";
import { Link, Navigate, useNavigate, useParams } from "@/lib/router";
import { connectorsApi } from "../api/connectors";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "../components/ui/badge";
import { startGmailOAuthPopup } from "../lib/gmail-oauth-popup";
import { startOutlookOAuthPopup } from "../lib/outlook-oauth-popup";
import { formatConnectorLabel } from "../lib/connector-labels";
import {
  connectorDeliveryHeadline,
  connectorDeliveryPreview,
  connectorDeliveryTechnicalTitle,
} from "../lib/connector-delivery-display";
import { displayBrandSafe } from "../lib/displayBrandSafe";
import { formatDateTime } from "../lib/utils";

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

export function CompanyConnectorDetail() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [bindingConnectionId, setBindingConnectionId] = useState<string | null>(null);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const [bindingTitle, setBindingTitle] = useState("");
  const [bindingPrompt, setBindingPrompt] = useState(
    "When a message arrives from {{from}}, summarize it and create or update the lead record in the target project.",
  );
  const [bindingAgentId, setBindingAgentId] = useState("");
  const [bindingProjectId, setBindingProjectId] = useState("");
  const [pendingDeleteConnectionId, setPendingDeleteConnectionId] = useState<string | null>(null);
  const [pendingDeleteBinding, setPendingDeleteBinding] = useState<{
    connectionId: string;
    bindingId: string;
    title: string;
  } | null>(null);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadConnectors = sidebarBadges?.canReadConnectors ?? true;
  const canManageConnectors = sidebarBadges?.canManageConnectors ?? true;
  const canManageConnectorBindings = sidebarBadges?.canManageConnectorBindings ?? true;

  const { data: catalogResponse, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.connectors.catalog,
    queryFn: () => connectorsApi.catalog(),
  });
  const catalog = catalogResponse?.catalog ?? [];
  const catalogByKey = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry])), [catalog]);
  const connectorTypeLabelByKey = useMemo(
    () => new Map(catalog.map((entry) => [entry.key, entry.displayName])),
    [catalog],
  );

  const { data: connections = [], isLoading: connectionsLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.connectors.list(selectedCompanyId) : ["connectors", "none"],
    queryFn: () => connectorsApi.listConnections(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && canReadConnectors,
  });

  const connection = useMemo(
    () => (connectionId ? (connections.find((c) => c.id === connectionId) ?? null) : null),
    [connections, connectionId],
  );

  const { data: agents = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && Boolean(connection),
  });

  const { data: projects = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && Boolean(connection),
  });

  const agentOptions = useMemo<InlineEntityOption[]>(
    () => agents.map((agent) => ({ id: agent.id, label: agent.name, searchText: agent.role })),
    [agents],
  );
  const projectOptions = useMemo<InlineEntityOption[]>(
    () => projects.map((project) => ({ id: project.id, label: project.name, searchText: project.status })),
    [projects],
  );

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  useEffect(() => {
    if (connection) {
      setBreadcrumbs([
        { label: "Connectors", href: "/company/connectors" },
        { label: connection.name },
      ]);
    } else {
      setBreadcrumbs([{ label: "Connectors", href: "/company/connectors" }, { label: "Connection" }]);
    }
  }, [connection, setBreadcrumbs]);

  const resetBindingForm = () => {
    setBindingConnectionId(null);
    setEditingBindingId(null);
    setBindingTitle("");
    setBindingAgentId("");
    setBindingProjectId("");
    setBindingPrompt(
      "When a message arrives from {{from}}, summarize it and create or update the lead record in the target project.",
    );
  };

  const openCreateBinding = () => {
    if (!connection) return;
    setEditingBindingId(null);
    setBindingConnectionId(connection.id);
    setBindingTitle(`${connection.name} handler`);
    setBindingAgentId("");
    setBindingProjectId("");
    setBindingPrompt(
      "When a message arrives from {{from}}, summarize it and create or update the lead record in the target project.",
    );
  };

  const openEditBinding = (binding: ConnectorEventBinding) => {
    setEditingBindingId(binding.id);
    setBindingConnectionId(binding.connectionId);
    setBindingTitle(binding.title);
    setBindingPrompt(binding.prompt);
    setBindingAgentId(binding.agentId);
    setBindingProjectId(binding.projectId ?? "");
  };

  const rotateSecret = useMutation({
    mutationFn: () => connectorsApi.rotateInboundSecret(selectedCompanyId!, connection!.id),
    onSuccess: (rotated) => {
      if (rotated.inboundSecretValue) setRevealedSecret(rotated.inboundSecretValue);
      pushToast({ title: "Inbound secret rotated", tone: "success" });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const deleteConnection = useMutation({
    mutationFn: () => connectorsApi.deleteConnection(selectedCompanyId!, connection!.id),
    onSuccess: () => {
      setPendingDeleteConnectionId(null);
      pushToast({ title: "Connector deleted", tone: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
      navigate("/company/connectors");
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const syncGmail = useMutation({
    mutationFn: () => connectorsApi.syncGmail(selectedCompanyId!, connection!.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.connectors.deliveries(selectedCompanyId!, connection!.id),
      });
      if (result.authFailure) {
        pushToast({ title: "Gmail authorization failed. Use Reconnect with Google to sign in again.", tone: "error" });
        return;
      }
      if (result.transientWarning) {
        pushToast({ title: result.transientWarning, tone: "warn" });
        return;
      }
      pushToast({
        title: result.processed > 0 ? `Synced ${result.processed} message(s)` : "Gmail sync completed",
        tone: "success",
      });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const syncOutlook = useMutation({
    mutationFn: () => connectorsApi.syncOutlook(selectedCompanyId!, connection!.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.connectors.deliveries(selectedCompanyId!, connection!.id),
      });
      if (result.authFailure) {
        pushToast({
          title: "Outlook authorization failed. Use Reconnect with Microsoft to sign in again.",
          tone: "error",
        });
        return;
      }
      if (result.transientWarning) {
        pushToast({ title: result.transientWarning, tone: "warn" });
        return;
      }
      pushToast({
        title: result.processed > 0 ? `Synced ${result.processed} message(s)` : "Outlook sync completed",
        tone: "success",
      });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const saveBinding = useMutation({
    mutationFn: async () => {
      if (!bindingConnectionId || !selectedCompanyId) throw new Error("No connector connection selected");
      const payload = {
        eventType: "message.received" as const,
        title: bindingTitle.trim(),
        prompt: bindingPrompt.trim(),
        agentId: bindingAgentId,
        projectId: bindingProjectId || null,
        enabled: true,
      };
      if (editingBindingId) {
        return connectorsApi.updateBinding(selectedCompanyId, bindingConnectionId, editingBindingId, payload);
      }
      return connectorsApi.createBinding(selectedCompanyId, bindingConnectionId, payload);
    },
    onSuccess: () => {
      const cid = bindingConnectionId;
      const wasEditing = Boolean(editingBindingId);
      resetBindingForm();
      pushToast({
        title: wasEditing ? "Event binding updated" : "Event binding created",
        tone: "success",
      });
      if (cid && selectedCompanyId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.connectors.bindings(selectedCompanyId, cid),
        });
      }
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const deleteBinding = useMutation({
    mutationFn: (input: { connectionId: string; bindingId: string }) =>
      connectorsApi.deleteBinding(selectedCompanyId!, input.connectionId, input.bindingId),
    onSuccess: (_result, input) => {
      setPendingDeleteBinding(null);
      pushToast({ title: "Event binding deleted", tone: "success" });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.connectors.bindings(selectedCompanyId!, input.connectionId),
      });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Link2} message="Choose a company to manage connectors." />;
  }
  if (!canReadConnectors) {
    return <EmptyState icon={Link2} message="You do not have permission to view connectors." />;
  }
  if (!connectionId) {
    return <Navigate to="/company/connectors" replace />;
  }
  if (catalogLoading || connectionsLoading) return <PageSkeleton />;
  if (!connection) {
    return <Navigate to="/company/connectors" replace />;
  }

  const connectorTypeDef = catalogByKey.get(connection.connectorTypeKey) ?? null;
  const connectorTypeLabel =
    connectorTypeLabelByKey.get(connection.connectorTypeKey) ?? formatConnectorLabel(connection.connectorTypeKey);

  const isGmailMailbox = connection.connectorTypeKey === "gmail" && connection.authMode === "managed_oauth";
  const isOutlookMailbox = connection.connectorTypeKey === "outlook" && connection.authMode === "managed_oauth";
  const mailboxSyncPending = isGmailMailbox ? syncGmail.isPending : isOutlookMailbox ? syncOutlook.isPending : false;
  const triggerMailboxSync = () => {
    if (isGmailMailbox) syncGmail.mutate();
    else if (isOutlookMailbox) syncOutlook.mutate();
  };
  const triggerMailboxReconnect = () => {
    if (isGmailMailbox) startGmailOAuth(selectedCompanyId, connection.id, queryClient, pushToast);
    else if (isOutlookMailbox) startOutlookOAuth(selectedCompanyId, connection.id, queryClient, pushToast);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2 h-8 px-2 text-muted-foreground" asChild>
            <Link to="/company/connectors">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
              All connectors
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{connection.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{connectorTypeLabel}</Badge>
            <Badge variant={connection.status === "active" ? "default" : "secondary"}>
              {formatConnectorLabel(connection.status)}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canManageConnectorBindings ? (
            <Button variant="secondary" size="sm" onClick={openCreateBinding}>
              <Plus className="mr-2 h-4 w-4" />
              Binding
            </Button>
          ) : null}
          {canManageConnectors ? (
            <>
              {connection.authMode === "managed_oauth" && connection.status === "pending_auth" ? (
                <Button variant="secondary" size="sm" onClick={triggerMailboxReconnect}>
                  {isOutlookMailbox ? "Sign in with Microsoft" : "Sign in with Google"}
                </Button>
              ) : null}
              {connection.authMode === "managed_oauth" && connection.status === "error" ? (
                <>
                  <Button variant="secondary" size="sm" onClick={triggerMailboxReconnect}>
                    {isOutlookMailbox ? "Reconnect with Microsoft" : "Reconnect with Google"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={triggerMailboxSync} disabled={mailboxSyncPending}>
                    <RefreshCw className={`mr-2 h-4 w-4${mailboxSyncPending ? " animate-spin" : ""}`} />
                    Retry sync
                  </Button>
                </>
              ) : null}
              {connection.authMode === "managed_oauth" && connection.status === "active" ? (
                <Button variant="secondary" size="sm" onClick={triggerMailboxSync} disabled={mailboxSyncPending}>
                  <RefreshCw className={`mr-2 h-4 w-4${mailboxSyncPending ? " animate-spin" : ""}`} />
                  Sync now
                </Button>
              ) : null}
              {connection.authMode !== "managed_oauth" ? (
                <Button variant="secondary" size="sm" onClick={() => rotateSecret.mutate()} disabled={rotateSecret.isPending}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Rotate token
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => setPendingDeleteConnectionId(connection.id)} aria-label="Delete connection">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <ConnectorDetailBody
        companyId={selectedCompanyId}
        connection={connection}
        connectorTypeDef={connectorTypeDef}
        canManageConnectorBindings={canManageConnectorBindings}
        agentById={agentById}
        projectById={projectById}
        onCopy={(value) => copyToClipboard(value, pushToast)}
        onEditBinding={openEditBinding}
        onRequestDeleteBinding={(binding) =>
          setPendingDeleteBinding({
            connectionId: connection.id,
            bindingId: binding.id,
            title: binding.title,
          })
        }
        bindingActionPending={saveBinding.isPending || deleteBinding.isPending}
      />

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

      <Dialog
        open={Boolean(bindingConnectionId)}
        onOpenChange={(open) => {
          if (!open) resetBindingForm();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingBindingId ? "Edit event binding" : "Add event binding"}</DialogTitle>
            <DialogDescription>Route message.received events to an agent with a prompt template.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={bindingTitle} onChange={(event) => setBindingTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Agent</label>
              <InlineEntitySelector
                options={agentOptions}
                value={bindingAgentId}
                onChange={setBindingAgentId}
                placeholder="Select agent"
                noneLabel="No agent"
                searchPlaceholder="Search agents..."
                emptyMessage="No agents found."
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Project (optional)</label>
              <InlineEntitySelector
                options={projectOptions}
                value={bindingProjectId}
                onChange={setBindingProjectId}
                placeholder="No project"
                noneLabel="No project"
                includeNoneOption
                searchPlaceholder="Search projects..."
                emptyMessage="No projects found."
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Prompt</label>
              <Textarea value={bindingPrompt} onChange={(event) => setBindingPrompt(event.target.value)} rows={8} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={
                !bindingConnectionId ||
                !bindingTitle.trim() ||
                !bindingPrompt.trim() ||
                !bindingAgentId ||
                saveBinding.isPending
              }
              onClick={() => saveBinding.mutate()}
            >
              {editingBindingId ? "Save changes" : "Save binding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteConnectionId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteConnectionId(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete connector connection?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{connection.name}</span> and its event bindings will be
              removed permanently. Inbound webhooks and delivery history for this connection will no longer be
              available. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={deleteConnection.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleteConnection.isPending}
              onClick={() => deleteConnection.mutate()}
            >
              {deleteConnection.isPending ? "Deleting…" : "Delete connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteBinding !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteBinding(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete event binding?</DialogTitle>
            <DialogDescription>
              {pendingDeleteBinding ? (
                <>
                  Remove{" "}
                  <span className="font-medium text-foreground">&ldquo;{pendingDeleteBinding.title}&rdquo;</span> from
                  this connection. New inbound events will no longer be routed using this binding. This cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={deleteBinding.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleteBinding.isPending || !pendingDeleteBinding}
              onClick={() => {
                if (!pendingDeleteBinding) return;
                deleteBinding.mutate({
                  connectionId: pendingDeleteBinding.connectionId,
                  bindingId: pendingDeleteBinding.bindingId,
                });
              }}
            >
              {deleteBinding.isPending ? "Deleting…" : "Delete binding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectorDetailBody({
  companyId,
  connection,
  connectorTypeDef,
  canManageConnectorBindings,
  agentById,
  projectById,
  onCopy,
  onEditBinding,
  onRequestDeleteBinding,
  bindingActionPending,
}: {
  companyId: string;
  connection: {
    id: string;
    name: string;
    connectorTypeKey: string;
    status: string;
    authMode?: "inbound_webhook" | "managed_oauth";
    connectedAccountEmail?: string | null;
    lastSyncedAt?: string | null;
    inboundUrl: string | null;
    lastError: string | null;
  };
  connectorTypeDef: ConnectorTypeDefinition | null;
  canManageConnectorBindings: boolean;
  agentById: Map<string, { id: string; name: string }>;
  projectById: Map<string, { id: string; name: string }>;
  onCopy: (value: string) => void;
  onEditBinding: (binding: ConnectorEventBinding) => void;
  onRequestDeleteBinding: (binding: ConnectorEventBinding) => void;
  bindingActionPending: boolean;
}) {
  const { data: bindings = [] } = useQuery({
    queryKey: queryKeys.connectors.bindings(companyId, connection.id),
    queryFn: () => connectorsApi.listBindings(companyId, connection.id),
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: queryKeys.connectors.deliveries(companyId, connection.id),
    queryFn: () => connectorsApi.listDeliveries(companyId, connection.id, 30),
  });

  const deliveryPageSize = 6;
  const [deliveriesDialogOpen, setDeliveriesDialogOpen] = useState(false);
  const [deliveriesExpanded, setDeliveriesExpanded] = useState(false);
  const visibleDeliveries = deliveriesExpanded ? deliveries : deliveries.slice(0, deliveryPageSize);
  const bindingTitleById = useMemo(() => new Map(bindings.map((b) => [b.id, b.title])), [bindings]);
  const deliveriesPanelId = `connector-deliveries-${connection.id}`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {connectorTypeDef ? (
            <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2.5 text-xs text-muted-foreground">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90">
                Connector details
              </div>
              <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
                <span>
                  <span className="text-muted-foreground">Auth:</span>{" "}
                  {connectorTypeDef.authMode === "managed_oauth"
                    ? connection.connectorTypeKey === "outlook"
                      ? "Microsoft OAuth (managed)"
                      : connection.connectorTypeKey === "gmail"
                        ? "Google OAuth (managed)"
                        : "Managed OAuth"
                    : "Inbound webhook (bearer token)"}
                </span>
                <span>
                  <span className="text-muted-foreground">Events:</span>{" "}
                  {connectorTypeDef.eventTypes.map((e) => e.displayName).join(", ")}
                </span>
              </div>
            </div>
          ) : null}
          {connection.authMode === "managed_oauth" && !connection.connectedAccountEmail ? (
            <p className="text-sm text-muted-foreground">
              {displayBrandSafe(
                connection.connectorTypeKey === "outlook"
                  ? "Sign in with Microsoft to authorize mailbox access for this connection. Paperclip stores the refresh token after consent and syncs new mail into your bindings."
                  : "Sign in with Google to authorize Gmail read access for this inbox. Paperclip stores the refresh token after consent and syncs new mail into your bindings.",
              )}
            </p>
          ) : null}
          {connection.connectedAccountEmail ? (
            <p className="text-sm text-muted-foreground">Connected as {connection.connectedAccountEmail}</p>
          ) : null}
          {connection.lastSyncedAt ? (
            <p className="text-sm text-muted-foreground">Last synced {formatDateTime(connection.lastSyncedAt)}</p>
          ) : null}
          {connection.inboundUrl ? (
            <div className="grid gap-2">
              <div className="text-sm font-medium">Inbound URL</div>
              <div className="flex gap-2">
                <Input readOnly value={connection.inboundUrl} />
                <Button variant="secondary" size="icon" onClick={() => onCopy(connection.inboundUrl!)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {connection.lastError ? (
            <p
              className={
                connection.lastError.startsWith("Temporary sync issue:")
                  ? "text-sm text-amber-700 dark:text-amber-500"
                  : "text-sm text-destructive"
              }
            >
              {connection.lastError}
            </p>
          ) : null}
          <div>
            <div className="mb-2 text-sm font-medium">Bindings</div>
            {bindings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bindings configured.</p>
            ) : (
              <div className="grid gap-2">
                {bindings.map((binding: ConnectorEventBinding) => {
                  const agentName = agentById.get(binding.agentId)?.name ?? binding.agentId;
                  const projectName = binding.projectId
                    ? projectById.get(binding.projectId)?.name ?? binding.projectId
                    : null;
                  return (
                    <div key={binding.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{binding.title}</div>
                          <div className="mt-1 text-muted-foreground">
                            {formatConnectorLabel(binding.eventType)} · agent {agentName}
                            {projectName ? ` · project ${projectName}` : ""}
                          </div>
                        </div>
                        {canManageConnectorBindings ? (
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={bindingActionPending}
                              onClick={() => onEditBinding(binding)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={bindingActionPending}
                              onClick={() => onRequestDeleteBinding(binding)}
                              aria-label={`Delete binding ${binding.title}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {deliveries.length > 0
                ? `Recent deliveries · ${deliveries.length} item${deliveries.length === 1 ? "" : "s"}`
                : "No deliveries yet"}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDeliveriesDialogOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={deliveriesDialogOpen}
              aria-controls={deliveriesDialogOpen ? deliveriesPanelId : undefined}
            >
              {deliveries.length > 0 ? `View deliveries (${deliveries.length})` : "View deliveries"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={deliveriesDialogOpen}
        onOpenChange={(open) => {
          setDeliveriesDialogOpen(open);
          if (!open) setDeliveriesExpanded(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recent deliveries — {connection.name}</DialogTitle>
            <DialogDescription>
              Newest first. Each row shows the event headline, binding route, optional preview, delivery status, and
              received time.
            </DialogDescription>
          </DialogHeader>
          <div id={deliveriesPanelId} className="max-h-[min(70vh,520px)] overflow-y-auto pr-1">
            {deliveries.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No deliveries yet.</p>
            ) : (
              <>
                {deliveries.length > deliveryPageSize ? (
                  <div className="mb-2 flex flex-wrap justify-end gap-2 text-xs text-muted-foreground tabular-nums">
                    {!deliveriesExpanded ? (
                      <span>
                        Showing {deliveryPageSize} of {deliveries.length}
                      </span>
                    ) : (
                      <span>{deliveries.length} total</span>
                    )}
                  </div>
                ) : null}
                <div
                  className="divide-y rounded-md border bg-muted/25"
                  role="list"
                  aria-label="Recent connector deliveries"
                >
                  {visibleDeliveries.map((delivery) => {
                    const payload = delivery.payload;
                    const headline = connectorDeliveryHeadline(payload);
                    const preview = connectorDeliveryPreview(payload);
                    const bindingTitle = delivery.bindingId ? bindingTitleById.get(delivery.bindingId) : undefined;
                    const metaLine = bindingTitle
                      ? `${formatConnectorLabel(delivery.eventType)} · ${bindingTitle}`
                      : formatConnectorLabel(delivery.eventType);
                    const receivedIso =
                      typeof delivery.receivedAt === "string"
                        ? delivery.receivedAt
                        : delivery.receivedAt.toISOString();
                    return (
                      <div
                        key={delivery.id}
                        role="listitem"
                        className="flex gap-3 px-3 py-2.5 text-sm"
                        title={connectorDeliveryTechnicalTitle(delivery.externalEventId)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 font-medium leading-snug text-foreground">{headline}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{metaLine}</div>
                          {preview ? (
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview}</div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                          <Badge variant="secondary" className="whitespace-nowrap text-[10px] font-normal">
                            {formatConnectorLabel(delivery.status)}
                          </Badge>
                          <time
                            className="text-[11px] leading-none text-muted-foreground tabular-nums"
                            dateTime={receivedIso}
                          >
                            {formatDateTime(delivery.receivedAt)}
                          </time>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {deliveries.length > deliveryPageSize ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setDeliveriesExpanded((open) => !open)}
                  >
                    {deliveriesExpanded ? "Show fewer" : `Show all ${deliveries.length} deliveries`}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
