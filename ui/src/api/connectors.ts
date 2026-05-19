import type {
  ConnectorConnection,
  ConnectorConnectionCreated,
  ConnectorEventBinding,
  ConnectorEventDelivery,
  ConnectorTypeDefinition,
  CreateConnectorConnection,
  CreateConnectorEventBinding,
  UpdateConnectorConnection,
  UpdateConnectorEventBinding,
} from "@paperclipai/shared";
import { api } from "./client";

export const connectorsApi = {
  catalog: () =>
    api.get<{
      catalog: ConnectorTypeDefinition[];
      gmailOAuthConfigured: boolean;
      outlookOAuthConfigured: boolean;
    }>("/connectors/catalog"),
  listConnections: (companyId: string) => api.get<ConnectorConnection[]>(`/companies/${companyId}/connectors`),
  createConnection: (companyId: string, data: CreateConnectorConnection) =>
    api.post<ConnectorConnectionCreated>(`/companies/${companyId}/connectors`, data),
  updateConnection: (companyId: string, connectionId: string, data: UpdateConnectorConnection) =>
    api.patch<ConnectorConnection>(`/companies/${companyId}/connectors/${connectionId}`, data),
  rotateInboundSecret: (companyId: string, connectionId: string) =>
    api.post<ConnectorConnectionCreated>(`/companies/${companyId}/connectors/${connectionId}/rotate-inbound-secret`, {}),
  deleteConnection: (companyId: string, connectionId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/connectors/${connectionId}`),
  listBindings: (companyId: string, connectionId: string) =>
    api.get<ConnectorEventBinding[]>(`/companies/${companyId}/connectors/${connectionId}/bindings`),
  createBinding: (companyId: string, connectionId: string, data: CreateConnectorEventBinding) =>
    api.post<ConnectorEventBinding>(`/companies/${companyId}/connectors/${connectionId}/bindings`, data),
  updateBinding: (companyId: string, connectionId: string, bindingId: string, data: UpdateConnectorEventBinding) =>
    api.patch<ConnectorEventBinding>(`/companies/${companyId}/connectors/${connectionId}/bindings/${bindingId}`, data),
  deleteBinding: (companyId: string, connectionId: string, bindingId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/connectors/${connectionId}/bindings/${bindingId}`),
  listDeliveries: (companyId: string, connectionId: string, limit = 50) =>
    api.get<ConnectorEventDelivery[]>(`/companies/${companyId}/connectors/${connectionId}/deliveries?limit=${limit}`),
  getGmailOAuthUrl: (companyId: string, connectionId: string) =>
    api.get<{ authorizationUrl: string }>(`/companies/${companyId}/connectors/${connectionId}/gmail/oauth-url`),
  syncGmail: (companyId: string, connectionId: string) =>
    api.post<{ processed: number; authFailure?: boolean; transientWarning?: string }>(
      `/companies/${companyId}/connectors/${connectionId}/gmail/sync`,
      {},
    ),
  getOutlookOAuthUrl: (companyId: string, connectionId: string) =>
    api.get<{ authorizationUrl: string }>(`/companies/${companyId}/connectors/${connectionId}/outlook/oauth-url`),
  syncOutlook: (companyId: string, connectionId: string) =>
    api.post<{ processed: number; authFailure?: boolean; transientWarning?: string }>(
      `/companies/${companyId}/connectors/${connectionId}/outlook/sync`,
      {},
    ),
};
