import type { ConnectorConnectionStatus, ConnectorDeliveryStatus, ConnectorEventType } from "../constants/connectors.js";

export interface ConnectorConnection {
  id: string;
  companyId: string;
  connectorTypeKey: string;
  name: string;
  status: ConnectorConnectionStatus;
  config: Record<string, unknown>;
  inboundPublicId: string;
  inboundSecretId: string | null;
  inboundUrl: string | null;
  lastError: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorEventBinding {
  id: string;
  companyId: string;
  connectionId: string;
  eventType: ConnectorEventType;
  title: string;
  prompt: string;
  agentId: string;
  projectId: string | null;
  enabled: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorEventDelivery {
  id: string;
  companyId: string;
  connectionId: string;
  bindingId: string | null;
  externalEventId: string;
  eventType: ConnectorEventType;
  status: ConnectorDeliveryStatus;
  payload: Record<string, unknown> | null;
  heartbeatRunId: string | null;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorConnectionCreated extends ConnectorConnection {
  inboundSecretValue?: string | null;
}

export interface ConnectorInboundDispatchResult {
  deliveryIds: string[];
  runIds: string[];
  skippedDuplicate: boolean;
}
