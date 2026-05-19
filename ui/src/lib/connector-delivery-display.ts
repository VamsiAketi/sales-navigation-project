function pickString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Human-readable title for a connector delivery row.
 * Prefers email subject / sender from the inbound event payload — not raw provider IDs.
 */
export function connectorDeliveryHeadline(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return "Inbound event";

  const message = payload.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const m = message as Record<string, unknown>;
    const subject = pickString(m.subject);
    const from = pickString(m.fromName) ?? pickString(m.from);

    if (subject && from) return `${subject} · ${from}`;
    if (subject) return subject;
    if (from) return `Message from ${from}`;
  }

  return "Inbound event";
}

/** Optional second line: short preview from body or provider snippet (e.g. Gmail). */
export function connectorDeliveryPreview(
  payload: Record<string, unknown> | null | undefined,
  maxLen = 140,
): string | null {
  if (!payload || typeof payload !== "object") return null;

  const message = payload.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const m = message as Record<string, unknown>;
    const body = pickString(m.bodyText);
    if (body) return truncate(body.replace(/\s+/g, " "), maxLen);
  }

  const metadata = payload.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const snippet = pickString((metadata as Record<string, unknown>).snippet);
    if (snippet) return truncate(snippet.replace(/\s+/g, " "), maxLen);
  }

  return null;
}

export function connectorDeliveryTechnicalTitle(externalEventId: string): string {
  return `Provider message id: ${externalEventId}`;
}
