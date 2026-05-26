import type { EmailTicketChange } from "./system-email-templates.js";

/** Window for coalescing ticket field changes into one email (ms). 0 = disabled. */
export function issueEmailBatchWindowMs(): number {
  const raw = process.env.PAPERCLIP_EMAIL_BATCH_WINDOW_MS?.trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export type PendingIssueEmailBatch = {
  issueId: string;
  recipientUserId: string;
  eventType: "issue.status_changed";
  changes: EmailTicketChange[];
  queuedAt: number;
};

/** Merge duplicate field rows; latest `after` wins per field name. */
export function mergeIssueEmailChanges(changes: EmailTicketChange[]): EmailTicketChange[] {
  const byField = new Map<string, EmailTicketChange>();
  for (const change of changes) {
    const existing = byField.get(change.field);
    if (existing) {
      byField.set(change.field, { field: change.field, before: existing.before, after: change.after });
    } else {
      byField.set(change.field, change);
    }
  }
  return Array.from(byField.values());
}
