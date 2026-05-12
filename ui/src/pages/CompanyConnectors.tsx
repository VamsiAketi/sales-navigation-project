import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ConnectorConnectionCreated, ConnectorEventBinding, ConnectorTypeDefinition } from "@paperclipai/shared";
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function copyToClipboard(value: string, pushToast: ReturnType<typeof useToast>["pushToast"]) {
  void navigator.clipboard.writeText(value).then(() => pushToast({ title: "Copied to clipboard", tone: "success" }));
}

export function CompanyConnectors() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createTypeKey, setCreateTypeKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [bindingConnectionId, setBindingConnectionId] = useState<string | null>(null);
  const [bindingTitle, setBindingTitle] = useState("");
  const [bindingPrompt, setBindingPrompt] = useState(
    "When a message arrives from {{from}}, summarize it and create or update the lead record in the target project.",
  );
  const [bindingAgentId, setBindingAgentId] = useState("");
  const [bindingProjectId, setBindingProjectId] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Connectors" }]);
  }, [setBreadcrumbs]);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadConnectors = sidebarBadges?.canReadConnectors ?? true;
  const canManageConnectors = sidebarBadges?.canManageConnectors ?? true;
  const canManageConnectorBindings = sidebarBadges?.canManageConnectorBindings ?? true;

  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.connectors.catalog,
    queryFn: () => connectorsApi.catalog(),
  });

  const { data: connections = [], isLoading: connectionsLoading } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.connectors.list(selectedCompanyId) : ["connectors", "none"],
    queryFn: () => connectorsApi.listConnections(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && canReadConnectors,
  });

  const { data: agents = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const agentOptions = useMemo<InlineEntityOption[]>(
    () => agents.map((agent) => ({ id: agent.id, label: agent.name, searchText: agent.role })),
    [agents],
  );
  const projectOptions = useMemo<InlineEntityOption[]>(
    () => projects.map((project) => ({ id: project.id, label: project.name, searchText: project.status })),
    [projects],
  );

  const createConnection = useMutation({
    mutationFn: () =>
      connectorsApi.createConnection(selectedCompanyId!, {
        connectorTypeKey: createTypeKey,
        name: createName.trim(),
        config: {},
      }),
    onSuccess: (created: ConnectorConnectionCreated) => {
      pushToast({ title: "Connector connection created", tone: "success" });
      setCreateOpen(false);
      setCreateName("");
      if (created.inboundSecretValue) setRevealedSecret(created.inboundSecretValue);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const rotateSecret = useMutation({
    mutationFn: (connectionId: string) => connectorsApi.rotateInboundSecret(selectedCompanyId!, connectionId),
    onSuccess: (rotated) => {
      if (rotated.inboundSecretValue) setRevealedSecret(rotated.inboundSecretValue);
      pushToast({ title: "Inbound secret rotated", tone: "success" });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const deleteConnection = useMutation({
    mutationFn: (connectionId: string) => connectorsApi.deleteConnection(selectedCompanyId!, connectionId),
    onSuccess: () => {
      pushToast({ title: "Connector deleted", tone: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
    },
    onError: (error: Error) => pushToast({ title: error.message, tone: "error" }),
  });

  const createBinding = useMutation({
    mutationFn: () =>
      connectorsApi.createBinding(selectedCompanyId!, bindingConnectionId!, {
        eventType: "message.received",
        title: bindingTitle.trim(),
        prompt: bindingPrompt.trim(),
        agentId: bindingAgentId,
        projectId: bindingProjectId || null,
        enabled: true,
      }),
    onSuccess: () => {
      pushToast({ title: "Event binding created", tone: "success" });
      setBindingConnectionId(null);
      setBindingTitle("");
      setBindingAgentId("");
      setBindingProjectId("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectors.list(selectedCompanyId!) });
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Connect external channels, post normalized events to inbound URLs, and bind each event type to an agent workflow prompt.
          </p>
        </div>
        {canManageConnectors ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add connection
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalog</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {catalog.map((entry: ConnectorTypeDefinition) => (
            <div key={entry.key} className="rounded-lg border p-4">
              <div className="font-medium">{entry.displayName}</div>
              <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {entry.eventTypes.map((eventType: ConnectorTypeDefinition["eventTypes"][number]) => (
                  <Badge key={eventType.key} variant="secondary">
                    {eventType.displayName}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {connections.length === 0 ? (
        <EmptyState
          icon={Link2}
          message="Create a connection to get an inbound URL and bearer token for external systems."
          action={canManageConnectors ? "Add connection" : undefined}
          onAction={canManageConnectors ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <div className="grid gap-4">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              companyId={selectedCompanyId}
              connection={connection}
              canManageConnectors={canManageConnectors}
              canManageConnectorBindings={canManageConnectorBindings}
              onRotate={() => rotateSecret.mutate(connection.id)}
              onDelete={() => deleteConnection.mutate(connection.id)}
              onCopy={(value) => copyToClipboard(value, pushToast)}
              onAddBinding={() => {
                setBindingConnectionId(connection.id);
                setBindingTitle(`${connection.name} handler`);
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add connector connection</DialogTitle>
            <DialogDescription>Choose a connector type and name this connection for your operators.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Connector type</label>
              <Select value={createTypeKey} onValueChange={setCreateTypeKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Select connector" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Connection name</label>
              <Input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Sales inbox" />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!createTypeKey || !createName.trim() || createConnection.isPending}
              onClick={() => createConnection.mutate()}
            >
              Create connection
            </Button>
          </DialogFooter>
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

      <Dialog open={Boolean(bindingConnectionId)} onOpenChange={(open) => !open && setBindingConnectionId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add event binding</DialogTitle>
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
                createBinding.isPending
              }
              onClick={() => createBinding.mutate()}
            >
              Save binding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionCard({
  companyId,
  connection,
  canManageConnectors,
  canManageConnectorBindings,
  onRotate,
  onDelete,
  onCopy,
  onAddBinding,
}: {
  companyId: string;
  connection: {
    id: string;
    name: string;
    connectorTypeKey: string;
    status: string;
    inboundUrl: string | null;
    lastError: string | null;
  };
  canManageConnectors: boolean;
  canManageConnectorBindings: boolean;
  onRotate: () => void;
  onDelete: () => void;
  onCopy: (value: string) => void;
  onAddBinding: () => void;
}) {
  const { data: bindings = [] } = useQuery({
    queryKey: queryKeys.connectors.bindings(companyId, connection.id),
    queryFn: () => connectorsApi.listBindings(companyId, connection.id),
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: queryKeys.connectors.deliveries(companyId, connection.id),
    queryFn: () => connectorsApi.listDeliveries(companyId, connection.id, 20),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">{connection.name}</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{connection.connectorTypeKey}</Badge>
            <Badge variant={connection.status === "active" ? "default" : "secondary"}>{connection.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {canManageConnectorBindings ? (
            <Button variant="secondary" size="sm" onClick={onAddBinding}>
              <Plus className="mr-2 h-4 w-4" />
              Binding
            </Button>
          ) : null}
          {canManageConnectors ? (
            <>
              <Button variant="secondary" size="sm" onClick={onRotate}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Rotate token
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
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
        {connection.lastError ? <p className="text-sm text-destructive">{connection.lastError}</p> : null}
        <div>
          <div className="mb-2 text-sm font-medium">Bindings</div>
          {bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bindings configured.</p>
          ) : (
            <div className="grid gap-2">
              {bindings.map((binding: ConnectorEventBinding) => (
                <div key={binding.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="font-medium">{binding.title}</div>
                  <div className="mt-1 text-muted-foreground">
                    {binding.eventType} · agent {binding.agentId.slice(0, 8)}
                    {binding.projectId ? ` · project ${binding.projectId.slice(0, 8)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Recent deliveries</div>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inbound events yet.</p>
          ) : (
            <div className="grid gap-2">
              {deliveries.slice(0, 5).map((delivery) => (
                <div key={delivery.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{delivery.externalEventId}</span>
                    <Badge variant="secondary">{delivery.status}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{delivery.eventType}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
