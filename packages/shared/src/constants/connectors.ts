import type { ConnectorActionCatalogEntry } from "./connector-actions.js";
import { listConnectorActionsForType } from "./connector-actions.js";

export const CONNECTOR_EVENT_TYPES = ["message.received"] as const;
export type ConnectorEventType = (typeof CONNECTOR_EVENT_TYPES)[number];

export const CONNECTOR_CONNECTION_STATUSES = ["pending_auth", "active", "paused", "error"] as const;
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
  authMode: "inbound_webhook" | "managed_oauth";
  eventTypes: Array<{ key: ConnectorEventType; displayName: string; description: string }>;
  /** Label for the connection name field in the create dialog */
  connectionNameFieldLabel?: string;
  connectionNamePlaceholder?: string;
  /** Initial value when opening the create dialog from the catalog */
  defaultConnectionName?: string;
  /** Short operator-facing copy in the create dialog */
  createDialogHelperText?: string;
  /** Outbound actions agents may invoke via `POST .../connectors/:id/actions` */
  actions?: ConnectorActionCatalogEntry[];
}

export const CONNECTOR_TYPE_DEFINITIONS: ConnectorTypeDefinition[] = [
  {
    key: "gmail",
    displayName: "Gmail",
    description: "Authorize a Gmail inbox with Google sign-in. Paperclip stores access after consent and syncs new mail to agents.",
    authMode: "managed_oauth",
    connectionNameFieldLabel: "Inbox label",
    connectionNamePlaceholder: "e.g. Sales Gmail",
    defaultConnectionName: "Gmail",
    createDialogHelperText:
      "This label is shown on the board. After you create the connection, sign in with Google to pick the mailbox Paperclip should read.",
    eventTypes: [
      {
        key: "message.received",
        displayName: "Message received",
        description: "Fires when a new Gmail message is detected for this connection.",
      },
    ],
  },
  {
    key: "outlook",
    displayName: "Outlook (Microsoft 365)",
    description:
      "Authorize a Microsoft 365 or Outlook.com mailbox with Microsoft sign-in. Paperclip syncs new mail to agents using Microsoft Graph.",
    authMode: "managed_oauth",
    connectionNameFieldLabel: "Mailbox label",
    connectionNamePlaceholder: "e.g. Sales Outlook",
    defaultConnectionName: "Outlook",
    createDialogHelperText:
      "This label is shown on the board. After you create the connection, sign in with Microsoft to pick the mailbox Paperclip should read.",
    eventTypes: [
      {
        key: "message.received",
        displayName: "Message received",
        description: "Fires when a new message is detected in the mailbox Inbox for this connection.",
      },
    ],
  },
  {
    key: "email",
    displayName: "Email (webhook)",
    description: "Accept inbound email events from your mail ingress and route them to agents.",
    authMode: "inbound_webhook",
    connectionNameFieldLabel: "Connection name",
    connectionNamePlaceholder: "e.g. Postmark → Paperclip",
    defaultConnectionName: "Inbound email",
    createDialogHelperText:
      "Shown on the board for operators. After creation you will copy the inbound URL and bearer token into your mail provider.",
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
    authMode: "inbound_webhook",
    connectionNameFieldLabel: "Connection name",
    connectionNamePlaceholder: "e.g. CRM events",
    defaultConnectionName: "Webhook ingress",
    createDialogHelperText:
      "Use the issued bearer token in the Authorization header when your system POSTs JSON payloads to the inbound URL.",
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
  const base = CONNECTOR_TYPE_DEFINITIONS.find((entry) => entry.key === key) ?? null;
  if (!base) return null;
  return { ...base, actions: listConnectorActionsForType(base.key) };
}

export function isConnectorEventTypeForConnector(
  connectorTypeKey: string,
  eventType: string,
): eventType is ConnectorEventType {
  const definition = getConnectorTypeDefinition(connectorTypeKey);
  if (!definition) return false;
  return definition.eventTypes.some((entry) => entry.key === eventType);
}
