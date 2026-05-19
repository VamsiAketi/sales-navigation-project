import { HttpError } from "../errors.js";

function errorTextChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" | ");
}

function httpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const value = (error as { status?: unknown }).status;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

/**
 * Google rejected or no longer accepts stored credentials; operator must reconnect OAuth.
 */
export function isGmailAuthSyncFailure(error: unknown): boolean {
  const text = errorTextChain(error);
  const status = httpStatus(error);

  if (status === 401) return true;
  if (status === 403) {
    if (/rate|quota|usage limit|exceeded/i.test(text)) return false;
    return true;
  }

  if (error instanceof HttpError && error.status === 422) {
    if (/token|oauth|grant|credential|refresh|gmail access|mailbox sign-in/i.test(error.message)) return true;
  }

  if (/invalid_grant|invalid_client|invalid_credentials|access was revoked|token has been expired|reauth/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Non-auth failure (network, Google 5xx, rate limits, etc.). Automatic retries should continue.
 */
export function isGmailTransientSyncFailure(error: unknown): boolean {
  return !isGmailAuthSyncFailure(error);
}

export function formatGmailSyncTransientNotice(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const short = raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
  return `Temporary sync issue: ${short}. Retrying automatically.`;
}

export type GmailSyncResult = {
  processed: number;
  authFailure?: boolean;
  transientWarning?: string;
};
