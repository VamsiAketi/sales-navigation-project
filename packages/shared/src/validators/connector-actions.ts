import { z } from "zod";

const gmailAddressParams = z.object({
  to: z.string().trim().min(1).max(512),
  subject: z.string().trim().min(1).max(998),
  text: z.string().min(1).max(512_000),
  cc: z.string().trim().max(2048).optional(),
  threadId: z.string().trim().max(128).optional(),
});

export const connectorExecuteActionBodySchema = z.object({
  action: z.string().trim().min(1).max(120),
  params: z.record(z.unknown()).optional().default({}),
});

export type ConnectorExecuteActionBody = z.infer<typeof connectorExecuteActionBodySchema>;

export function parseGmailSendOrDraftParams(params: unknown) {
  return gmailAddressParams.parse(params);
}
