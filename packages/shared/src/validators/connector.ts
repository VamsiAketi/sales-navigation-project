import { z } from "zod";
import {
  CONNECTOR_CONNECTION_STATUSES,
  CONNECTOR_EVENT_TYPES,
  CONNECTOR_TYPE_KEYS,
} from "../constants/connectors.js";

export const createConnectorConnectionSchema = z.object({
  connectorTypeKey: z.string().trim().min(1).refine((value) => CONNECTOR_TYPE_KEYS.includes(value), {
    message: "Unsupported connector type",
  }),
  name: z.string().trim().min(1).max(120),
  config: z.record(z.unknown()).optional().default({}),
});

export const updateConnectorConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(CONNECTOR_CONNECTION_STATUSES).optional(),
  config: z.record(z.unknown()).optional(),
});

export const createConnectorEventBindingSchema = z.object({
  eventType: z.enum(CONNECTOR_EVENT_TYPES),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(20_000),
  agentId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

export const updateConnectorEventBindingSchema = createConnectorEventBindingSchema.partial();

export const connectorInboundEventSchema = z.object({
  eventType: z.enum(CONNECTOR_EVENT_TYPES).optional().default("message.received"),
  externalEventId: z.string().trim().min(1).max(512),
  message: z.object({
    from: z.string().optional().nullable(),
    fromName: z.string().optional().nullable(),
    to: z.string().optional().nullable(),
    subject: z.string().optional().nullable(),
    bodyText: z.string().optional().nullable(),
    bodyHtml: z.string().optional().nullable(),
    threadId: z.string().optional().nullable(),
    receivedAt: z.string().datetime().optional().nullable(),
  }),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type CreateConnectorConnection = z.infer<typeof createConnectorConnectionSchema>;
export type UpdateConnectorConnection = z.infer<typeof updateConnectorConnectionSchema>;
export type CreateConnectorEventBinding = z.infer<typeof createConnectorEventBindingSchema>;
export type UpdateConnectorEventBinding = z.infer<typeof updateConnectorEventBindingSchema>;
export type ConnectorInboundEvent = z.infer<typeof connectorInboundEventSchema>;
