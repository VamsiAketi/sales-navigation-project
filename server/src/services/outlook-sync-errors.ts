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

/** Microsoft Graph or Entra rejected stored credentials; operator must reconnect OAuth. */
export function isOutlookAuthSyncFailure(error: unknown): boolean {
  const text = errorTextChain(error);
  const status = httpStatus(error);

  if (status === 401) return true;
  if (status === 403) {
    if (/rate|quota|throttl|too many requests/i.test(text)) return false;
    return true;
  }
  if (status === 410) return true;

  if (/invalid_grant|invalid_client|AADSTS|interaction_required|consent_required|login_required/i.test(text)) {
    return true;
  }

  return false;
}

export function formatOutlookSyncTransientNotice(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const short = raw.length > 160 ? `${raw.slice(0, 157)}…` : raw;
  return `Temporary sync issue: ${short}. Retrying automatically.`;
}

export type OutlookSyncResult = {
  processed: number;
  authFailure?: boolean;
  transientWarning?: string;
};
