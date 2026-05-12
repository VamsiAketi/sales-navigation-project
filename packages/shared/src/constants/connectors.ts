export const CONNECTOR_EVENT_TYPES = ["message.received"] as const;
export type ConnectorEventType = (typeof CONNECTOR_EVENT_TYPES)[number];

export const CONNECTOR_CONNECTION_STATUSES = ["active", "paused", "error"] as const;
export type ConnectorConnectionStatus = (typeof CONNECTOR_CONNECTION_STATUSES)[number];

export const CONNECTOR_DELIVERY_STATUSES = [
  "received",
  "dispatched",
  "skipped_duplicate",
  "skipped_no_bindings",
  "failed",
] as const;
export type ConnectorDeliveryStatus = (typeof CONNECTOR_DELIVERY_STATUSES)[number];

export interface ConnectorTypeDefinition {
  key: string;
  displayName: string;
  description: string;
  eventTypes: Array<{ key: ConnectorEventType; displayName: string; description: string }>;
}

export const CONNECTOR_TYPE_DEFINITIONS: ConnectorTypeDefinition[] = [
  {
    key: "email",
    displayName: "Email",
    description: "Accept inbound email events from your mail ingress and route them to agents.",
    eventTypes: [
      {
        key: "message.received",
        displayName: "Message received",
        description: "Fires when a new email message is ingested for this connection.",
      },
    ],
  },
  {
    key: "webhook",
    displayName: "Custom webhook",
    description: "Accept JSON events from any external system through a signed inbound URL.",
    eventTypes: [
      {
        key: "message.received",
        displayName: "Message received",
        description: "Fires when your system posts a normalized message payload to the inbound URL.",
      },
    ],
  },
];

export const CONNECTOR_TYPE_KEYS = CONNECTOR_TYPE_DEFINITIONS.map((entry) => entry.key);

export function getConnectorTypeDefinition(key: string): ConnectorTypeDefinition | null {
  return CONNECTOR_TYPE_DEFINITIONS.find((entry) => entry.key === key) ?? null;
}

export function isConnectorEventTypeForConnector(
  connectorTypeKey: string,
  eventType: string,
): eventType is ConnectorEventType {
  const definition = getConnectorTypeDefinition(connectorTypeKey);
  if (!definition) return false;
  return definition.eventTypes.some((entry) => entry.key === eventType);
}
