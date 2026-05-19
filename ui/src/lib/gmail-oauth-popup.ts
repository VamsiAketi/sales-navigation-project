import { connectorsApi } from "../api/connectors";

export const GMAIL_OAUTH_POPUP_MESSAGE_TYPE = "paperclip:gmail-oauth";

type GmailOAuthPopupMessage = {
  type: typeof GMAIL_OAUTH_POPUP_MESSAGE_TYPE;
  status: "connected" | "error";
  connectionId?: string;
};

type StartGmailOAuthPopupInput = {
  companyId: string;
  connectionId: string;
  onConnected?: (connectionId?: string) => void | Promise<void>;
  onError?: (message: string) => void;
  onCancelled?: () => void;
};

const POPUP_NAME = "paperclip-gmail-oauth";
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 720;
const POPUP_CLOSE_GRACE_MS = 1_000;

function isGmailOAuthPopupMessage(value: unknown): value is GmailOAuthPopupMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === GMAIL_OAUTH_POPUP_MESSAGE_TYPE &&
    (record.status === "connected" || record.status === "error")
  );
}

function openCenteredOAuthPopup(url: string): Window | null {
  const left = Math.max(0, window.screenX + (window.outerWidth - POPUP_WIDTH) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2);
  return window.open(
    url,
    POPUP_NAME,
    `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`,
  );
}

export function startGmailOAuthPopup(input: StartGmailOAuthPopupInput) {
  void connectorsApi
    .getGmailOAuthUrl(input.companyId, input.connectionId)
    .then(({ authorizationUrl }) => {
      let settled = false;
      let closePoll: number | undefined;
      let closeGraceTimer: number | undefined;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (closePoll !== undefined) window.clearInterval(closePoll);
        if (closeGraceTimer !== undefined) window.clearTimeout(closeGraceTimer);
        window.removeEventListener("message", onMessage);
        callback();
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (!isGmailOAuthPopupMessage(event.data)) return;
        if (event.data.status === "connected") {
          finish(() => {
            void Promise.resolve(input.onConnected?.(event.data.connectionId));
          });
          return;
        }
        finish(() => input.onError?.("Gmail connection failed"));
      };

      window.addEventListener("message", onMessage);

      const popup = openCenteredOAuthPopup(authorizationUrl);
      if (!popup) {
        window.location.assign(authorizationUrl);
        return;
      }

      try {
        popup.focus();
      } catch {
        // Ignore focus failures from browser popup policies.
      }

      closePoll = window.setInterval(() => {
        if (!popup.closed) return;
        if (closePoll !== undefined) window.clearInterval(closePoll);
        closePoll = undefined;
        closeGraceTimer = window.setTimeout(() => {
          finish(() => input.onCancelled?.());
        }, POPUP_CLOSE_GRACE_MS);
      }, 250);
    })
    .catch((error: Error) => input.onError?.(error.message));
}
