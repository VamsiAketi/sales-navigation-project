import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectorConnections } from "@paperclipai/db";
import { parseGmailSendOrDraftParams, type ConnectorInboundEvent } from "@paperclipai/shared";
import type { Config } from "../config.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import { ZodError } from "zod";
import { connectorService } from "./connectors.js";
import { secretService } from "./secrets.js";
import {
  formatGmailSyncTransientNotice,
  isGmailAuthSyncFailure,
  type GmailSyncResult,
} from "./gmail-sync-errors.js";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

type GmailOAuthSecret = {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
};

type GmailConnectionConfig = {
  gmail?: {
    emailAddress?: string | null;
    oauthSecretId?: string | null;
    historyId?: string | null;
    lastSyncedAt?: string | null;
  };
};

type GmailOAuthState = {
  companyId: string;
  connectionId: string;
  exp: number;
};

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  };
};

function getPublicApiBaseUrl(config: Config): string {
  return (
    config.authPublicBaseUrl ??
    process.env.PAPERCLIP_PUBLIC_URL ??
    process.env.PAPERCLIP_API_URL ??
    `http://${config.host}:${config.port}`
  ).replace(/\/+$/, "");
}

function resolveOAuthRedirectUri(config: Config): string {
  return (
    config.gmailOAuthRedirectUri ?? `${getPublicApiBaseUrl(config)}/api/connectors/gmail/oauth/callback`
  );
}

function readGmailConfig(config: Record<string, unknown>): GmailConnectionConfig["gmail"] {
  const gmail = config.gmail;
  if (!gmail || typeof gmail !== "object" || Array.isArray(gmail)) return {};
  return gmail as GmailConnectionConfig["gmail"];
}

function signState(payload: GmailOAuthState, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state: string, secret: string): GmailOAuthState {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) throw unprocessable("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (signature !== expected) throw unprocessable("Invalid OAuth state signature");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GmailOAuthState;
  if (!payload.companyId || !payload.connectionId || !payload.exp) {
    throw unprocessable("Invalid OAuth state payload");
  }
  if (Date.now() > payload.exp) throw unprocessable("OAuth state expired");
  return payload;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  const match = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value?.trim() || null;
}

function extractBodyText(message: GmailMessage): string | null {
  const direct = message.payload?.body?.data;
  if (direct) return decodeBase64Url(direct);
  const textPart = message.payload?.parts?.find((part) => part.mimeType === "text/plain")?.body?.data;
  if (textPart) return decodeBase64Url(textPart);
  return message.snippet ?? null;
}

function encodeSubjectHeader(subject: string): string {
  if (/^[\t\x20-\x7e]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function buildGmailRawRfc822(p: ReturnType<typeof parseGmailSendOrDraftParams>): string {
  const headerLines = [
    `To: ${p.to}`,
    ...(p.cc ? [`Cc: ${p.cc}`] : []),
    `Subject: ${encodeSubjectHeader(p.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset=UTF-8',
    "Content-Transfer-Encoding: 8bit",
    "",
  ];
  const body = p.text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  const message = `${headerLines.join("\r\n")}${body}`;
  return Buffer.from(message, "utf8").toString("base64url");
}

function toConnectorEvent(message: GmailMessage): ConnectorInboundEvent {
  const headers = message.payload?.headers;
  const from = headerValue(headers, "From");
  return {
    eventType: "message.received",
    externalEventId: message.id ?? crypto.randomUUID(),
    message: {
      from,
      fromName: from,
      to: headerValue(headers, "To"),
      subject: headerValue(headers, "Subject"),
      bodyText: extractBodyText(message),
      bodyHtml: null,
      threadId: message.threadId ?? null,
      receivedAt: null,
    },
    metadata: {
      provider: "gmail",
      snippet: message.snippet ?? null,
    },
  };
}

export function gmailConnectorService(db: Db, config: Config) {
  const connectors = connectorService(db);
  const secrets = secretService(db);
  const stateSecret = config.gmailOAuthClientSecret ?? "paperclip-gmail-oauth-state";

  function assertConfigured() {
    if (!config.gmailOAuthClientId || !config.gmailOAuthClientSecret) {
      throw unprocessable(
        "Google mailbox sign-in is not enabled on this Paperclip server yet. Ask an operator to configure the Gmail OAuth app.",
      );
    }
  }

  async function readOAuthSecret(companyId: string, secretId: string): Promise<GmailOAuthSecret> {
    const raw = await secrets.resolveSecretValue(companyId, secretId, "latest");
    return JSON.parse(raw) as GmailOAuthSecret;
  }

  async function writeOAuthSecret(
    companyId: string,
    secretId: string,
    value: GmailOAuthSecret,
    actorUserId: string | null,
  ) {
    await secrets.rotate(secretId, { value: JSON.stringify(value) }, { userId: actorUserId ?? "board", agentId: null });
  }

  async function exchangeAuthorizationCode(code: string) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.gmailOAuthClientId!,
        client_secret: config.gmailOAuthClientSecret!,
        redirect_uri: resolveOAuthRedirectUri(config),
        grant_type: "authorization_code",
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw unprocessable(
        typeof body.error_description === "string"
          ? body.error_description
          : "Failed to exchange Gmail OAuth code",
      );
    }
    return body;
  }

  async function refreshAccessToken(secret: GmailOAuthSecret): Promise<GmailOAuthSecret> {
    if (!secret.refreshToken) throw unprocessable("Gmail connection is missing a refresh token");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.gmailOAuthClientId!,
        client_secret: config.gmailOAuthClientSecret!,
        refresh_token: secret.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw unprocessable(
        typeof body.error_description === "string"
          ? body.error_description
          : "Failed to refresh Gmail access token",
      );
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      refreshToken: secret.refreshToken,
      accessToken: typeof body.access_token === "string" ? body.access_token : secret.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async function getAccessToken(companyId: string, secretId: string): Promise<string> {
    const current = await readOAuthSecret(companyId, secretId);
    const expiresAt = current.accessTokenExpiresAt ? Date.parse(current.accessTokenExpiresAt) : 0;
    if (current.accessToken && expiresAt > Date.now() + 60_000) {
      return current.accessToken;
    }
    const refreshed = await refreshAccessToken(current);
    await writeOAuthSecret(companyId, secretId, refreshed, null);
    if (!refreshed.accessToken) throw unprocessable("Gmail access token is unavailable");
    return refreshed.accessToken;
  }

  async function gmailRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      const error = new Error(body.error?.message ?? `Gmail API request failed (${response.status})`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function persistGmailState(
    connection: typeof connectorConnections.$inferSelect,
    gmailConfig: NonNullable<GmailConnectionConfig["gmail"]>,
    profile: { emailAddress?: string; historyId?: string },
    input: { lastError?: string | null; status?: typeof connectorConnections.$inferSelect.status },
  ) {
    await db
      .update(connectorConnections)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        config: {
          ...(connection.config as Record<string, unknown>),
          gmail: {
            ...gmailConfig,
            emailAddress: profile.emailAddress ?? gmailConfig.emailAddress ?? null,
            historyId: profile.historyId ?? gmailConfig.historyId ?? null,
            lastSyncedAt: new Date().toISOString(),
          },
        },
        lastError: input.lastError === undefined ? connection.lastError : input.lastError,
        updatedAt: new Date(),
      })
      .where(eq(connectorConnections.id, connection.id));
  }

  async function syncConnection(connectionId: string): Promise<GmailSyncResult> {
    const connection = await db
      .select()
      .from(connectorConnections)
      .where(eq(connectorConnections.id, connectionId))
      .then((rows) => rows[0] ?? null);
    if (!connection || connection.connectorTypeKey !== "gmail") {
      return { processed: 0 };
    }
    if (connection.status !== "active" && connection.status !== "error") {
      return { processed: 0 };
    }

    const gmailConfig = readGmailConfig(connection.config as Record<string, unknown>);
    if (!gmailConfig?.oauthSecretId) return { processed: 0 };

    try {
      const accessToken = await getAccessToken(connection.companyId, gmailConfig.oauthSecretId);
      const profile = await gmailRequest<{ emailAddress?: string; historyId?: string }>(
        accessToken,
        "users/me/profile",
      );
      if (!profile.historyId) return { processed: 0 };

      if (!gmailConfig.historyId) {
        await persistGmailState(connection, gmailConfig, profile, { lastError: null, status: "active" });
        return { processed: 0 };
      }

      let processed = 0;
      let pageToken: string | undefined;
      let latestHistoryId = gmailConfig.historyId;

      try {
        do {
          const history = await gmailRequest<{
            history?: Array<{
              id?: string;
              messagesAdded?: Array<{ message?: { id?: string } }>;
            }>;
            historyId?: string;
            nextPageToken?: string;
          }>(
            accessToken,
            `users/me/history?startHistoryId=${encodeURIComponent(gmailConfig.historyId)}${
              pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
            }`,
          );

          latestHistoryId = history.historyId ?? latestHistoryId;
          for (const entry of history.history ?? []) {
            for (const added of entry.messagesAdded ?? []) {
              const messageId = added.message?.id;
              if (!messageId) continue;
              const message = await gmailRequest<GmailMessage>(
                accessToken,
                `users/me/messages/${encodeURIComponent(messageId)}?format=full`,
              );
              await connectors.dispatchConnectionEvent(connection, toConnectorEvent(message));
              processed += 1;
            }
          }
          pageToken = history.nextPageToken;
        } while (pageToken);
      } catch (error) {
        const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
        if (status === 404) {
          await persistGmailState(connection, gmailConfig, profile, { lastError: null, status: "active" });
          return { processed: 0 };
        }
        throw error;
      }

      await db
        .update(connectorConnections)
        .set({
          config: {
            ...(connection.config as Record<string, unknown>),
            gmail: {
              ...gmailConfig,
              emailAddress: profile.emailAddress ?? gmailConfig.emailAddress ?? null,
              historyId: latestHistoryId,
              lastSyncedAt: new Date().toISOString(),
            },
          },
          status: "active",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(connectorConnections.id, connection.id));

      return { processed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isGmailAuthSyncFailure(error)) {
        await db
          .update(connectorConnections)
          .set({ status: "error", lastError: message, updatedAt: new Date() })
          .where(eq(connectorConnections.id, connection.id));
        return { processed: 0, authFailure: true };
      }
      const notice = formatGmailSyncTransientNotice(error);
      await db
        .update(connectorConnections)
        .set({ status: "active", lastError: notice, updatedAt: new Date() })
        .where(eq(connectorConnections.id, connection.id));
      return { processed: 0, transientWarning: notice };
    }
  }

  async function executeAction(input: {
    companyId: string;
    connectionId: string;
    action: string;
    params: unknown;
  }) {
    const connection = await db
      .select()
      .from(connectorConnections)
      .where(
        and(eq(connectorConnections.id, input.connectionId), eq(connectorConnections.companyId, input.companyId)),
      )
      .then((rows) => rows[0] ?? null);
    if (!connection) throw notFound("Connector connection not found");
    if (connection.connectorTypeKey !== "gmail") throw unprocessable("Not a Gmail connection");
    if (connection.status !== "active") throw conflict("Connector connection is not active");
    const gmailConfig = readGmailConfig(connection.config as Record<string, unknown>);
    if (!gmailConfig?.oauthSecretId) throw unprocessable("Gmail is not connected for this connection");

    let parsed: ReturnType<typeof parseGmailSendOrDraftParams>;
    try {
      parsed = parseGmailSendOrDraftParams(input.params ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.errors[0];
        throw unprocessable(first ? `${first.path.join(".") || "params"}: ${first.message}` : "Invalid action params");
      }
      throw error;
    }

    const raw = buildGmailRawRfc822(parsed);
    const accessToken = await getAccessToken(input.companyId, gmailConfig.oauthSecretId);

    if (input.action === "gmail.message.send") {
      const body: Record<string, unknown> = { raw };
      if (parsed.threadId) body.threadId = parsed.threadId;
      const result = await gmailRequest<{ id?: string; threadId?: string }>(accessToken, "users/me/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { action: input.action, messageId: result.id ?? null, threadId: result.threadId ?? null };
    }

    if (input.action === "gmail.draft.create") {
      const message: Record<string, unknown> = { raw };
      if (parsed.threadId) message.threadId = parsed.threadId;
      const result = await gmailRequest<{ id?: string; message?: { id?: string; threadId?: string } }>(
        accessToken,
        "users/me/drafts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
      );
      return {
        action: input.action,
        draftId: result.id ?? null,
        messageId: result.message?.id ?? null,
        threadId: result.message?.threadId ?? null,
      };
    }

    throw unprocessable(`Unsupported Gmail action: ${input.action}`);
  }

  return {
    isConfigured: () => Boolean(config.gmailOAuthClientId && config.gmailOAuthClientSecret),

    getAuthorizationUrl: async (companyId: string, connectionId: string) => {
      assertConfigured();
      const connection = await db
        .select()
        .from(connectorConnections)
        .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!connection) throw notFound("Connector connection not found");
      if (connection.connectorTypeKey !== "gmail") throw unprocessable("Connection is not a Gmail connector");
      const state = signState(
        {
          companyId,
          connectionId,
          exp: Date.now() + 15 * 60 * 1000,
        },
        stateSecret,
      );
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.gmailOAuthClientId!);
      url.searchParams.set("redirect_uri", resolveOAuthRedirectUri(config));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GMAIL_SCOPES);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return { authorizationUrl: url.toString() };
    },

    completeOAuthCallback: async (input: { code: string; state: string }) => {
      assertConfigured();
      const statePayload = verifyState(input.state, stateSecret);
      const connection = await db
        .select()
        .from(connectorConnections)
        .where(
          and(
            eq(connectorConnections.id, statePayload.connectionId),
            eq(connectorConnections.companyId, statePayload.companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!connection) throw notFound("Connector connection not found");
      if (connection.connectorTypeKey !== "gmail") throw unprocessable("Connection is not a Gmail connector");

      const tokenResponse = await exchangeAuthorizationCode(input.code);
      const refreshToken =
        typeof tokenResponse.refresh_token === "string" ? tokenResponse.refresh_token : null;
      const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : null;
      if (!refreshToken) {
        throw unprocessable("Google did not return a refresh token; revoke prior access and try again");
      }

      const oauthSecret = await secrets.create(
        connection.companyId,
        {
          name: `connector-gmail-oauth-${connection.id}`,
          provider: "local_encrypted",
          value: JSON.stringify({
            refreshToken,
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          } satisfies GmailOAuthSecret),
          description: `Gmail OAuth credentials for connector ${connection.name}`,
        },
        { userId: "board", agentId: null },
      );

      const profile = await gmailRequest<{ emailAddress?: string; historyId?: string }>(
        accessToken!,
        "users/me/profile",
      );

      const nextConfig: GmailConnectionConfig = {
        ...(connection.config as Record<string, unknown>),
        gmail: {
          emailAddress: profile.emailAddress ?? null,
          oauthSecretId: oauthSecret.id,
          historyId: profile.historyId ?? null,
          lastSyncedAt: new Date().toISOString(),
        },
      };

      const [updated] = await db
        .update(connectorConnections)
        .set({
          status: "active",
          config: nextConfig,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(connectorConnections.id, connection.id))
        .returning();

      return {
        companyId: updated.companyId,
        connectionId: updated.id,
        emailAddress: profile.emailAddress ?? null,
      };
    },

    syncConnection,

    tickSync: async () => {
      if (!config.gmailSyncEnabled || !config.gmailOAuthClientId || !config.gmailOAuthClientSecret) {
        return { connections: 0, processed: 0 };
      }
      const connections = await db
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(and(eq(connectorConnections.connectorTypeKey, "gmail"), eq(connectorConnections.status, "active")));
      let processed = 0;
      for (const connection of connections) {
        const result = await syncConnection(connection.id);
        processed += result.processed;
      }
      return { connections: connections.length, processed };
    },

    executeAction,
  };
}
