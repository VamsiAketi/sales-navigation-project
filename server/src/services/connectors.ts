import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  connectorConnections,
  connectorEventBindings,
  connectorEventDeliveries,
} from "@paperclipai/db";
import {
  CONNECTOR_TYPE_DEFINITIONS,
  getConnectorTypeDefinition,
  isConnectorEventTypeForConnector,
  type ConnectorInboundEvent,
  type CreateConnectorConnection,
  type CreateConnectorEventBinding,
  type UpdateConnectorConnection,
  type UpdateConnectorEventBinding,
} from "@paperclipai/shared";
import { conflict, notFound, unauthorized, unprocessable } from "../errors.js";
import { heartbeatService } from "./heartbeat.js";
import { secretService } from "./secrets.js";

function getPublicApiBaseUrl(): string {
  return (
    process.env.PAPERCLIP_PUBLIC_URL ??
    process.env.PAPERCLIP_API_URL ??
    process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.BETTER_AUTH_BASE_URL ??
    "http://localhost:3100"
  ).replace(/\/+$/, "");
}

function renderPromptTemplate(template: string, event: ConnectorInboundEvent): string {
  const message = event.message ?? {};
  const replacements: Record<string, string> = {
    from: message.from ?? "",
    fromName: message.fromName ?? "",
    to: message.to ?? "",
    subject: message.subject ?? "",
    bodyText: message.bodyText ?? "",
    bodyHtml: message.bodyHtml ?? "",
    threadId: message.threadId ?? "",
    externalEventId: event.externalEventId,
    eventType: event.eventType,
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => replacements[key] ?? "");
}

function buildEventPrompt(bindingPrompt: string, event: ConnectorInboundEvent, projectId: string | null): string {
  const rendered = renderPromptTemplate(bindingPrompt, event);
  const payload = JSON.stringify(
    {
      eventType: event.eventType,
      externalEventId: event.externalEventId,
      message: event.message,
      metadata: event.metadata ?? {},
    },
    null,
    2,
  );
  return [
    "You were woken by a connector event. Skip the regular Paperclip heartbeat inbox procedure.",
    "Follow the connector workflow instructions below, then exit.",
    projectId ? `Target project id: ${projectId}` : "No target project id was configured for this binding.",
    "",
    "## Connector workflow instructions",
    rendered,
    "",
    "## Normalized event payload",
    payload,
  ].join("\n");
}

function mapConnection(row: typeof connectorConnections.$inferSelect) {
  const definition = getConnectorTypeDefinition(row.connectorTypeKey);
  const baseUrl = getPublicApiBaseUrl();
  const gmailConfig =
    row.config && typeof row.config === "object" && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>).gmail
      : null;
  const gmailRecord =
    gmailConfig && typeof gmailConfig === "object" && !Array.isArray(gmailConfig)
      ? (gmailConfig as Record<string, unknown>)
      : null;
  return {
    ...row,
    authMode: definition?.authMode ?? "inbound_webhook",
    connectedAccountEmail:
      typeof gmailRecord?.emailAddress === "string" ? gmailRecord.emailAddress : null,
    inboundUrl:
      definition?.authMode === "managed_oauth"
        ? null
        : `${baseUrl}/api/connector-inbound/${row.inboundPublicId}`,
  };
}

export function connectorService(db: Db) {
  const secrets = secretService(db);
  const heartbeat = heartbeatService(db);

  async function resolveInboundSecretValue(secretId: string | null, companyId: string): Promise<string | null> {
    if (!secretId) return null;
    return secrets.resolveSecretValue(companyId, secretId, "latest");
  }

  async function assertAgentInCompany(companyId: string, agentId: string) {
    const agent = await db
      .select({ id: agents.id, companyId: agents.companyId, status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
    if (!agent || agent.companyId !== companyId) throw notFound("Agent not found");
    if (agent.status === "terminated" || agent.status === "pending_approval") {
      throw unprocessable("Agent is not invokable");
    }
    return agent;
  }

  async function getConnection(companyId: string, connectionId: string) {
    const row = await db
      .select()
      .from(connectorConnections)
      .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Connector connection not found");
    return mapConnection(row);
  }

  async function dispatchConnectionEvent(
    connection: typeof connectorConnections.$inferSelect,
    event: ConnectorInboundEvent,
  ) {
    if (connection.status !== "active") {
      throw conflict("Connector connection is not active");
    }
    if (!isConnectorEventTypeForConnector(connection.connectorTypeKey, event.eventType)) {
      throw unprocessable("Event type is not supported for this connector");
    }

    const bindings = await db
      .select()
      .from(connectorEventBindings)
      .where(
        and(
          eq(connectorEventBindings.companyId, connection.companyId),
          eq(connectorEventBindings.connectionId, connection.id),
          eq(connectorEventBindings.eventType, event.eventType),
          eq(connectorEventBindings.enabled, true),
        ),
      );

    if (bindings.length === 0) {
      return { deliveryIds: [], runIds: [], skippedDuplicate: false };
    }

    const deliveryIds: string[] = [];
    const runIds: string[] = [];
    let skippedDuplicate = false;

    for (const binding of bindings) {
      let deliveryId: string;
      try {
        const [delivery] = await db
          .insert(connectorEventDeliveries)
          .values({
            companyId: connection.companyId,
            connectionId: connection.id,
            bindingId: binding.id,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            status: "received",
            payload: event as unknown as Record<string, unknown>,
          })
          .returning();
        deliveryId = delivery.id;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : null;
        if (code === "23505") {
          skippedDuplicate = true;
          continue;
        }
        throw error;
      }

      try {
        const prompt = buildEventPrompt(binding.prompt, event, binding.projectId);
        const run = await heartbeat.wakeup(binding.agentId, {
          source: "event",
          triggerDetail: "system",
          reason: "connector_event",
          payload: {
            prompt,
            connectorEvent: event,
            projectId: binding.projectId,
            connectorBindingId: binding.id,
            connectorConnectionId: connection.id,
          },
          idempotencyKey: `connector:${connection.id}:${binding.id}:${event.externalEventId}`,
          requestedByActorType: "system",
          requestedByActorId: connection.id,
          contextSnapshot: {
            wakeReason: "connector_event",
            wakeSource: "event",
            connectorConnectionId: connection.id,
            connectorBindingId: binding.id,
            connectorEventType: event.eventType,
            externalEventId: event.externalEventId,
            projectId: binding.projectId,
            eventRunMode: "one_shot",
            taskKey: `connector-event:${event.externalEventId}`,
          },
        });
        await db
          .update(connectorEventDeliveries)
          .set({
            status: run ? "dispatched" : "failed",
            heartbeatRunId: run?.id ?? null,
            processedAt: new Date(),
            error: run ? null : "Agent wakeup was skipped by heartbeat policy",
            updatedAt: new Date(),
          })
          .where(eq(connectorEventDeliveries.id, deliveryId));
        if (run) runIds.push(run.id);
        deliveryIds.push(deliveryId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(connectorEventDeliveries)
          .set({
            status: "failed",
            processedAt: new Date(),
            error: message,
            updatedAt: new Date(),
          })
          .where(eq(connectorEventDeliveries.id, deliveryId));
        await db
          .update(connectorConnections)
          .set({ status: "error", lastError: message, updatedAt: new Date() })
          .where(eq(connectorConnections.id, connection.id));
        throw error;
      }
    }

    return { deliveryIds, runIds, skippedDuplicate };
  }

  return {
    listCatalog: () => CONNECTOR_TYPE_DEFINITIONS,

    listConnections: async (companyId: string) => {
      const rows = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.companyId, companyId))
        .orderBy(desc(connectorConnections.updatedAt));
      return rows.map(mapConnection);
    },

    getConnection,

    createConnection: async (
      companyId: string,
      input: CreateConnectorConnection,
      actorUserId: string | null,
    ) => {
      const definition = getConnectorTypeDefinition(input.connectorTypeKey);
      if (!definition) {
        throw unprocessable("Unsupported connector type");
      }
      const inboundPublicId = crypto.randomBytes(12).toString("hex");
      const inboundToken = crypto.randomBytes(24).toString("hex");
      const secret = await secrets.create(
        companyId,
        {
          name: `connector-inbound-${inboundPublicId}`,
          provider: "local_encrypted",
          value: inboundToken,
          description: `Inbound auth token for connector ${input.name}`,
        },
        { userId: actorUserId ?? "board", agentId: null },
      );
      const [row] = await db
        .insert(connectorConnections)
        .values({
          companyId,
          connectorTypeKey: input.connectorTypeKey,
          name: input.name,
          status: definition.authMode === "managed_oauth" ? "pending_auth" : "active",
          config: input.config ?? {},
          inboundPublicId,
          inboundSecretId: secret.id,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        })
        .returning();
      return {
        ...mapConnection(row),
        inboundSecretValue: definition.authMode === "managed_oauth" ? null : inboundToken,
      };
    },

    updateConnection: async (
      companyId: string,
      connectionId: string,
      input: UpdateConnectorConnection,
      actorUserId: string | null,
    ) => {
      const existing = await db
        .select()
        .from(connectorConnections)
        .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Connector connection not found");
      const [row] = await db
        .update(connectorConnections)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          updatedByUserId: actorUserId,
          updatedAt: new Date(),
          ...(input.status === "active" ? { lastError: null } : {}),
        })
        .where(eq(connectorConnections.id, connectionId))
        .returning();
      return mapConnection(row);
    },

    rotateInboundSecret: async (companyId: string, connectionId: string, actorUserId: string | null) => {
      const existing = await db
        .select()
        .from(connectorConnections)
        .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Connector connection not found");
      if (!existing.inboundSecretId) throw unprocessable("Connector inbound secret is not configured");
      const inboundToken = crypto.randomBytes(24).toString("hex");
      await secrets.rotate(
        existing.inboundSecretId,
        { value: inboundToken },
        { userId: actorUserId ?? "board", agentId: null },
      );
      return {
        ...mapConnection(existing),
        inboundSecretValue: inboundToken,
      };
    },

    deleteConnection: async (companyId: string, connectionId: string) => {
      const deleted = await db
        .delete(connectorConnections)
        .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
        .returning({ id: connectorConnections.id });
      if (!deleted[0]) throw notFound("Connector connection not found");
      return { ok: true as const };
    },

    listBindings: async (companyId: string, connectionId: string) => {
      await getConnection(companyId, connectionId);
      return db
        .select()
        .from(connectorEventBindings)
        .where(
          and(
            eq(connectorEventBindings.companyId, companyId),
            eq(connectorEventBindings.connectionId, connectionId),
          ),
        )
        .orderBy(desc(connectorEventBindings.updatedAt));
    },

    createBinding: async (
      companyId: string,
      connectionId: string,
      input: CreateConnectorEventBinding,
      actorUserId: string | null,
    ) => {
      const connection = await getConnection(companyId, connectionId);
      if (!isConnectorEventTypeForConnector(connection.connectorTypeKey, input.eventType)) {
        throw unprocessable("Event type is not supported for this connector");
      }
      await assertAgentInCompany(companyId, input.agentId);
      const [row] = await db
        .insert(connectorEventBindings)
        .values({
          companyId,
          connectionId,
          eventType: input.eventType,
          title: input.title,
          prompt: input.prompt,
          agentId: input.agentId,
          projectId: input.projectId ?? null,
          enabled: input.enabled ?? true,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        })
        .returning();
      return row;
    },

    updateBinding: async (
      companyId: string,
      bindingId: string,
      input: UpdateConnectorEventBinding,
      actorUserId: string | null,
    ) => {
      const existing = await db
        .select()
        .from(connectorEventBindings)
        .where(and(eq(connectorEventBindings.id, bindingId), eq(connectorEventBindings.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Connector event binding not found");
      if (input.agentId) await assertAgentInCompany(companyId, input.agentId);
      if (input.eventType) {
        const connection = await getConnection(companyId, existing.connectionId);
        if (!isConnectorEventTypeForConnector(connection.connectorTypeKey, input.eventType)) {
          throw unprocessable("Event type is not supported for this connector");
        }
      }
      const [row] = await db
        .update(connectorEventBindings)
        .set({
          ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          updatedByUserId: actorUserId,
          updatedAt: new Date(),
        })
        .where(eq(connectorEventBindings.id, bindingId))
        .returning();
      return row;
    },

    deleteBinding: async (companyId: string, bindingId: string) => {
      const deleted = await db
        .delete(connectorEventBindings)
        .where(and(eq(connectorEventBindings.id, bindingId), eq(connectorEventBindings.companyId, companyId)))
        .returning({ id: connectorEventBindings.id });
      if (!deleted[0]) throw notFound("Connector event binding not found");
      return { ok: true as const };
    },

    listDeliveries: async (companyId: string, connectionId: string, limit = 50) => {
      await getConnection(companyId, connectionId);
      return db
        .select()
        .from(connectorEventDeliveries)
        .where(
          and(
            eq(connectorEventDeliveries.companyId, companyId),
            eq(connectorEventDeliveries.connectionId, connectionId),
          ),
        )
        .orderBy(desc(connectorEventDeliveries.receivedAt))
        .limit(Math.min(Math.max(limit, 1), 200));
    },

    dispatchConnectionEvent,

    ingestInbound: async (input: {
      publicId: string;
      authorizationHeader?: string | null;
      event: ConnectorInboundEvent;
    }) => {
      const connection = await db
        .select()
        .from(connectorConnections)
        .where(eq(connectorConnections.inboundPublicId, input.publicId))
        .then((rows) => rows[0] ?? null);
      if (!connection) throw notFound("Connector inbound endpoint not found");
      if (connection.status !== "active") throw conflict("Connector connection is not active");

      const secretValue = await resolveInboundSecretValue(connection.inboundSecretId, connection.companyId);
      const expected = secretValue ? `Bearer ${secretValue}` : null;
      const provided = input.authorizationHeader?.trim() ?? "";
      if (!expected || provided !== expected) throw unauthorized();

      if (!isConnectorEventTypeForConnector(connection.connectorTypeKey, input.event.eventType)) {
        throw unprocessable("Event type is not supported for this connector");
      }

      return dispatchConnectionEvent(connection, input.event);
    },
  };
}
