/**
 * Catalog of outbound connector actions (agent- or board-invokable via HTTP API).
 * Inbound **events** are declared on {@link CONNECTOR_TYPE_DEFINITIONS} separately.
 */
export interface ConnectorActionCatalogEntry {
  /** Stable machine id, e.g. `gmail.message.send` */
  key: string;
  /** Short label for UIs */
  summary: string;
  /** One-line description for catalog / prompts */
  description: string;
}

export const CONNECTOR_ACTIONS_BY_TYPE: Record<string, ConnectorActionCatalogEntry[]> = {
  gmail: [
    {
      key: "gmail.message.send",
      summary: "Send email",
      description: "Send a plain-text email from the connected Gmail account.",
    },
    {
      key: "gmail.draft.create",
      summary: "Create draft",
      description: "Create a Gmail draft (does not send).",
    },
  ],
  outlook: [
    {
      key: "outlook.message.send",
      summary: "Send email",
      description: "Send a plain-text email from the connected Microsoft 365 / Outlook mailbox.",
    },
    {
      key: "outlook.draft.create",
      summary: "Create draft",
      description: "Create an Outlook draft (does not send).",
    },
  ],
};

export function listConnectorActionsForType(connectorTypeKey: string): ConnectorActionCatalogEntry[] {
  return CONNECTOR_ACTIONS_BY_TYPE[connectorTypeKey] ?? [];
}
