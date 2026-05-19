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
  formatOutlookSyncTransientNotice,
  isOutlookAuthSyncFailure,
  type OutlookSyncResult,
} from "./outlook-sync-errors.js";

const OUTLOOK_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
].join(" ");

const INBOX_DELTA_SELECT =
  "id,conversationId,receivedDateTime,subject,from,toRecipients,bodyPreview";

type OutlookOAuthSecret = {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
};

type OutlookConnectionConfig = {
  outlook?: {
    emailAddress?: string | null;
    oauthSecretId?: string | null;
    /** Full `@odata.deltaLink` URL from Microsoft Graph (inbox messages delta). */
    mailDeltaLink?: string | null;
    lastSyncedAt?: string | null;
  };
};

type OutlookOAuthState = {
  companyId: string;
  connectionId: string;
  exp: number;
};

type GraphMessage = {
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  "@removed"?: { reason?: string };
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
    config.outlookOAuthRedirectUri ?? `${getPublicApiBaseUrl(config)}/api/connectors/outlook/oauth/callback`
  );
}

function authorityBase(config: Config): string {
  const tenant = (config.outlookOAuthTenantId ?? "common").replace(/\/+$/, "");
  return `https://login.microsoftonline.com/${tenant}`;
}

function readOutlookConfig(config: Record<string, unknown>): OutlookConnectionConfig["outlook"] {
  const outlook = config.outlook;
  if (!outlook || typeof outlook !== "object" || Array.isArray(outlook)) return {};
  return outlook as OutlookConnectionConfig["outlook"];
}

function signState(payload: OutlookOAuthState, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state: string, secret: string): OutlookOAuthState {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) throw unprocessable("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  if (signature !== expected) throw unprocessable("Invalid OAuth state signature");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OutlookOAuthState;
  if (!payload.companyId || !payload.connectionId || !payload.exp) {
    throw unprocessable("Invalid OAuth state payload");
  }
  if (Date.now() > payload.exp) throw unprocessable("OAuth state expired");
  return payload;
}

function formatRecipientList(csv: string): Array<{ emailAddress: { address: string } }> {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function graphMessageToConnectorEvent(message: GraphMessage): ConnectorInboundEvent {
  const fromAddr = message.from?.emailAddress?.address?.trim() ?? null;
  const fromName = message.from?.emailAddress?.name?.trim() ?? fromAddr;
  const to =
    message.toRecipients
      ?.map((r) => r.emailAddress?.address?.trim())
      .filter(Boolean)
      .join(", ") ?? null;
  return {
    eventType: "message.received",
    externalEventId: message.id ?? crypto.randomUUID(),
    message: {
      from: fromAddr,
      fromName: fromName ?? fromAddr,
      to,
      subject: message.subject?.trim() ?? null,
      bodyText: message.bodyPreview ?? null,
      bodyHtml: null,
      threadId: message.conversationId ?? null,
      receivedAt: null,
    },
    metadata: {
      provider: "outlook",
      snippet: message.bodyPreview ?? null,
    },
  };
}

export function outlookConnectorService(db: Db, config: Config) {
  const connectors = connectorService(db);
  const secrets = secretService(db);
  const stateSecret = config.outlookOAuthClientSecret ?? "paperclip-outlook-oauth-state";

  function assertConfigured() {
    if (!config.outlookOAuthClientId || !config.outlookOAuthClientSecret) {
      throw unprocessable(
        "Outlook / Microsoft 365 mailbox sign-in is not enabled on this Paperclip server yet. Ask an operator to configure the Outlook OAuth app.",
      );
    }
  }

  async function readOAuthSecret(companyId: string, secretId: string): Promise<OutlookOAuthSecret> {
    const raw = await secrets.resolveSecretValue(companyId, secretId, "latest");
    return JSON.parse(raw) as OutlookOAuthSecret;
  }

  async function writeOAuthSecret(
    companyId: string,
    secretId: string,
    value: OutlookOAuthSecret,
    actorUserId: string | null,
  ) {
    await secrets.rotate(secretId, { value: JSON.stringify(value) }, { userId: actorUserId ?? "board", agentId: null });
  }

  async function exchangeAuthorizationCode(code: string) {
    const response = await fetch(`${authorityBase(config)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.outlookOAuthClientId!,
        client_secret: config.outlookOAuthClientSecret!,
        code,
        redirect_uri: resolveOAuthRedirectUri(config),
        grant_type: "authorization_code",
      }),
    });
    const body = (await response.json()) as Record<string, unknown> & {
      error?: string;
      error_description?: string;
    };
    if (!response.ok) {
      throw unprocessable(
        typeof body.error_description === "string"
          ? body.error_description
          : typeof body.error === "string"
            ? body.error
            : "Failed to exchange Outlook OAuth code",
      );
    }
    return body;
  }

  async function refreshAccessToken(secret: OutlookOAuthSecret): Promise<OutlookOAuthSecret> {
    if (!secret.refreshToken) throw unprocessable("Outlook connection is missing a refresh token");
    const response = await fetch(`${authorityBase(config)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.outlookOAuthClientId!,
        client_secret: config.outlookOAuthClientSecret!,
        refresh_token: secret.refreshToken,
        grant_type: "refresh_token",
        scope: OUTLOOK_SCOPES,
      }),
    });
    const body = (await response.json()) as Record<string, unknown> & {
      error?: string;
      error_description?: string;
    };
    if (!response.ok) {
      throw unprocessable(
        typeof body.error_description === "string"
          ? body.error_description
          : typeof body.error === "string"
            ? body.error
            : "Failed to refresh Outlook access token",
      );
    }
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : secret.refreshToken,
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
    if (!refreshed.accessToken) throw unprocessable("Outlook access token is unavailable");
    return refreshed.accessToken;
  }

  async function graphRequestJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const record = body as { error?: { message?: string } };
    if (!response.ok) {
      const message = record.error?.message ?? `Graph request failed (${response.status})`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body as T;
  }

  async function graphGet<T>(accessToken: string, pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `https://graph.microsoft.com/v1.0/${pathOrUrl.replace(/^\//, "")}`;
    return graphRequestJson<T>(accessToken, url, { method: "GET" });
  }

  async function graphPost(accessToken: string, path: string, jsonBody: unknown, expectJson = true) {
    const url = `https://graph.microsoft.com/v1.0/${path.replace(/^\//, "")}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonBody),
    });
    const text = await response.text();
    if (response.status === 202) return null;
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      const record = (body ?? {}) as { error?: { message?: string } };
      const message = record.error?.message ?? `Graph request failed (${response.status})`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    if (!expectJson || !body) return null;
    return body;
  }

  type DeltaPage = {
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  };

  async function followDeltaToLink(
    accessToken: string,
    startUrl: string,
    onPage: ((page: DeltaPage) => Promise<void>) | null,
  ): Promise<string | null> {
    let url: string | null = startUrl;
    let lastDeltaLink: string | null = null;
    let pages = 0;
    while (url && pages < 80) {
      pages += 1;
      const page = await graphRequestJson<DeltaPage>(accessToken, url, { method: "GET" });
      if (onPage) await onPage(page);
      if (page["@odata.deltaLink"]) {
        lastDeltaLink = page["@odata.deltaLink"] as string;
        url = null;
      } else if (page["@odata.nextLink"]) {
        url = page["@odata.nextLink"] as string;
      } else {
        url = null;
      }
    }
    return lastDeltaLink;
  }

  async function syncConnection(connectionId: string): Promise<OutlookSyncResult> {
    const connection = await db
      .select()
      .from(connectorConnections)
      .where(eq(connectorConnections.id, connectionId))
      .then((rows) => rows[0] ?? null);
    if (!connection || connection.connectorTypeKey !== "outlook") {
      return { processed: 0 };
    }
    if (connection.status !== "active" && connection.status !== "error") {
      return { processed: 0 };
    }

    const outlookConfig = readOutlookConfig(connection.config as Record<string, unknown>);
    if (!outlookConfig?.oauthSecretId) return { processed: 0 };

    try {
      const accessToken = await getAccessToken(connection.companyId, outlookConfig.oauthSecretId);

      if (!outlookConfig.mailDeltaLink) {
        const start = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=${encodeURIComponent(INBOX_DELTA_SELECT)}`;
        const deltaLink = await followDeltaToLink(accessToken, start, null);
        if (!deltaLink) return { processed: 0 };

        await db
          .update(connectorConnections)
          .set({
            config: {
              ...(connection.config as Record<string, unknown>),
              outlook: {
                ...outlookConfig,
                mailDeltaLink: deltaLink,
                lastSyncedAt: new Date().toISOString(),
              },
            },
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(connectorConnections.id, connection.id));
        return { processed: 0 };
      }

      let processed = 0;
      let latestDeltaLink: string | null = null;

      const onPage = async (page: DeltaPage) => {
        for (const item of page.value ?? []) {
          if (!item.id || item["@removed"]) continue;
          await connectors.dispatchConnectionEvent(connection, graphMessageToConnectorEvent(item));
          processed += 1;
        }
      };

      latestDeltaLink = await followDeltaToLink(accessToken, outlookConfig.mailDeltaLink, onPage);

      if (!latestDeltaLink) {
        latestDeltaLink = outlookConfig.mailDeltaLink;
      }

      await db
        .update(connectorConnections)
        .set({
          config: {
            ...(connection.config as Record<string, unknown>),
            outlook: {
              ...outlookConfig,
              mailDeltaLink: latestDeltaLink,
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
      const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
      if (status === 410 && outlookConfig.mailDeltaLink) {
        await db
          .update(connectorConnections)
          .set({
            config: {
              ...(connection.config as Record<string, unknown>),
              outlook: {
                ...outlookConfig,
                mailDeltaLink: null,
              },
            },
            status: "active",
            lastError: "Inbox sync cursor expired; run sync again to re-establish.",
            updatedAt: new Date(),
          })
          .where(eq(connectorConnections.id, connection.id));
        return { processed: 0, transientWarning: "Inbox sync cursor expired. Run sync again to catch up." };
      }
      if (isOutlookAuthSyncFailure(error)) {
        await db
          .update(connectorConnections)
          .set({ status: "error", lastError: message, updatedAt: new Date() })
          .where(eq(connectorConnections.id, connection.id));
        return { processed: 0, authFailure: true };
      }
      const notice = formatOutlookSyncTransientNotice(error);
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
    if (connection.connectorTypeKey !== "outlook") throw unprocessable("Not an Outlook connection");
    if (connection.status !== "active") throw conflict("Connector connection is not active");
    const outlookCfg = readOutlookConfig(connection.config as Record<string, unknown>);
    if (!outlookCfg?.oauthSecretId) throw unprocessable("Outlook is not connected for this connection");

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

    const accessToken = await getAccessToken(input.companyId, outlookCfg.oauthSecretId);
    const toRecipients = formatRecipientList(parsed.to);
    const ccRecipients = parsed.cc ? formatRecipientList(parsed.cc) : [];

    const message: Record<string, unknown> = {
      subject: parsed.subject,
      body: { contentType: "Text", content: parsed.text },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
    };
    if (parsed.threadId) {
      message.conversationId = parsed.threadId;
    }

    if (input.action === "outlook.message.send") {
      await graphPost(accessToken, "me/sendMail", { message, saveToSentItems: true }, false);
      return { action: input.action, sent: true as const };
    }

    if (input.action === "outlook.draft.create") {
      const created = (await graphPost(
        accessToken,
        "me/messages",
        { ...message, isDraft: true },
        true,
      )) as { id?: string; conversationId?: string } | null;
      return {
        action: input.action,
        messageId: created?.id ?? null,
        threadId: created?.conversationId ?? null,
      };
    }

    throw unprocessable(`Unsupported Outlook action: ${input.action}`);
  }

  return {
    isConfigured: () => Boolean(config.outlookOAuthClientId && config.outlookOAuthClientSecret),

    getAuthorizationUrl: async (companyId: string, connectionId: string) => {
      assertConfigured();
      const connection = await db
        .select()
        .from(connectorConnections)
        .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!connection) throw notFound("Connector connection not found");
      if (connection.connectorTypeKey !== "outlook") throw unprocessable("Connection is not an Outlook connector");
      const state = signState(
        { companyId, connectionId, exp: Date.now() + 15 * 60 * 1000 },
        stateSecret,
      );
      const url = new URL(`${authorityBase(config)}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", config.outlookOAuthClientId!);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", resolveOAuthRedirectUri(config));
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", OUTLOOK_SCOPES);
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "consent");
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
      if (connection.connectorTypeKey !== "outlook") throw unprocessable("Connection is not an Outlook connector");

      const tokenResponse = await exchangeAuthorizationCode(input.code);
      const refreshToken =
        typeof tokenResponse.refresh_token === "string" ? tokenResponse.refresh_token : null;
      const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : null;
      if (!refreshToken) {
        throw unprocessable("Microsoft did not return a refresh token; revoke prior access and try again");
      }

      const oauthSecret = await secrets.create(
        connection.companyId,
        {
          name: `connector-outlook-oauth-${connection.id}`,
          provider: "local_encrypted",
          value: JSON.stringify({
            refreshToken,
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          } satisfies OutlookOAuthSecret),
          description: `Outlook OAuth credentials for connector ${connection.name}`,
        },
        { userId: "board", agentId: null },
      );

      const me = await graphGet<{ mail?: string; userPrincipalName?: string }>(accessToken!, "me?$select=mail,userPrincipalName");
      const emailAddress = me.mail?.trim() || me.userPrincipalName?.trim() || null;

      const nextConfig: OutlookConnectionConfig = {
        ...(connection.config as Record<string, unknown>),
        outlook: {
          emailAddress,
          oauthSecretId: oauthSecret.id,
          mailDeltaLink: null,
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
        emailAddress,
      };
    },

    syncConnection,

    tickSync: async () => {
      if (!config.outlookSyncEnabled || !config.outlookOAuthClientId || !config.outlookOAuthClientSecret) {
        return { connections: 0, processed: 0 };
      }
      const connections = await db
        .select({ id: connectorConnections.id })
        .from(connectorConnections)
        .where(and(eq(connectorConnections.connectorTypeKey, "outlook"), eq(connectorConnections.status, "active")));
      let processed = 0;
      for (const row of connections) {
        const result = await syncConnection(row.id);
        processed += result.processed;
      }
      return { connections: connections.length, processed };
    },

    executeAction,
  };
}
