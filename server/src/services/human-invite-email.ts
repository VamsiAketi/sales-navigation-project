import { logger } from "../middleware/logger.js";
import {
  buildHumanInviteEmailBodies,
  buildPasswordResetEmailBodies,
  humanInviteEmailSubject,
} from "./system-email-templates.js";

export {
  buildDailyDigestEmailBodies,
  buildHumanApprovalEmailBodies,
  buildHumanInviteEmailBodies,
  buildIssueNotificationEmailBodies,
  buildPasswordResetEmailBodies,
  buildSignInOtpEmailBodies,
  buildSystemAlertEmailBodies,
  humanInviteEmailSubject,
  issueCommentUrl,
} from "./system-email-templates.js";
export { issueEmailBatchWindowMs, mergeIssueEmailChanges } from "./issue-notification-email-batch.js";
export { readBrandedFromEmail, readEmailFooterLinks } from "./email-footer-config.js";

export type HumanInviteEmailInput = {
  toEmail: string;
  toName: string;
  temporaryUsername: string;
  temporaryPassword: string;
  signInUrl: string;
  inviterName?: string | null;
  companyName?: string | null;
  workspaceSlug?: string | null;
  membershipRole?: string | null;
  projectNames?: string[] | null;
  expiryHours?: number | null;
};

export type HumanInviteEmailDelivery = {
  status: "sent" | "skipped" | "failed";
  message: string;
};

export type SystemEmailInput = {
  toEmail: string;
  subject: string;
  textBody: string;
  /** When set, sent as multipart/alternative with plain text for older clients. */
  htmlBody?: string;
};

type GraphMailConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
  /** Optional Entra object id for the sender mailbox; avoids UPN path issues when set. */
  senderObjectId?: string;
};

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_TOKEN_PATH = "/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let warnedSenderLookupFallback = false;

function resolveGraphMailConfig(): GraphMailConfig | null {
  const tenantId = process.env.MS_GRAPH_TENANT_ID_EMAIL?.trim();
  const clientId = process.env.MS_GRAPH_CLIENT_ID_EMAIL?.trim();
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET_EMAIL?.trim();
  const senderEmail = process.env.MS_GRAPH_SENDER_EMAIL?.trim();
  const senderObjectId = process.env.MS_SENDER_OBJECT_ID?.trim() || undefined;

  const hasAny = Boolean(tenantId || clientId || clientSecret || senderEmail || senderObjectId);
  if (!hasAny) return null;

  if (!tenantId || !clientId || !clientSecret || !senderEmail) {
    throw new Error(
      "Microsoft Graph mail is partially configured. Set all of: MS_GRAPH_TENANT_ID_EMAIL, MS_GRAPH_CLIENT_ID_EMAIL, MS_GRAPH_CLIENT_SECRET_EMAIL, MS_GRAPH_SENDER_EMAIL",
    );
  }

  return { tenantId, clientId, clientSecret, senderEmail, senderObjectId };
}

/** Redact obvious secrets before logging raw JSON/text. */
function redactForLogs(raw: string): string {
  return raw
    .replace(/"access_token"\s*:\s*"[^"]*"/gi, '"access_token":"[redacted]"')
    .replace(/"refresh_token"\s*:\s*"[^"]*"/gi, '"refresh_token":"[redacted]"')
    .replace(/"client_secret"\s*:\s*"[^"]*"/gi, '"client_secret":"[redacted]"')
    .slice(0, 8000);
}

function logGraphJwtRolesIfDebug(accessToken: string): void {
  if (process.env.MS_GRAPH_DEBUG?.trim().toLowerCase() !== "true") return;
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      roles?: string[];
      scp?: string;
      appid?: string;
    };
    logger.info(
      {
        step: "graph_token_debug",
        appid: payload.appid,
        roles: payload.roles ?? null,
        scp: payload.scp ?? null,
      },
      "Microsoft Graph token claims (MS_GRAPH_DEBUG)",
    );
  } catch {
    logger.warn({ step: "graph_token_debug" }, "MS_GRAPH_DEBUG set but JWT payload could not be decoded");
  }
}

async function acquireGraphAccessToken(config: GraphMailConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}${GRAPH_TOKEN_PATH}`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const payloadText = payload ? JSON.stringify(payload) : "";

  if (!response.ok) {
    logger.error(
      {
        step: "graph_token",
        status: response.status,
        body: redactForLogs(payloadText || "(empty)"),
      },
      "Microsoft Graph token request failed",
    );
    const errMsg =
      payload && typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload?.error === "string"
          ? payload.error
          : `token endpoint HTTP ${response.status}`;
    throw new Error(`Graph token: ${errMsg}`);
  }

  const token = typeof payload?.access_token === "string" ? payload.access_token : null;
  if (!token) {
    logger.error({ step: "graph_token", status: response.status, body: redactForLogs(payloadText) }, "Graph token response missing access_token");
    throw new Error("Graph token response missing access_token");
  }

  logGraphJwtRolesIfDebug(token);
  return token;
}

/**
 * Prefer mailbox object id in sendMail URL (Graph recommends id | UPN; id avoids some UPN/encoding issues).
 * Requires User.Read.All or User.ReadBasic.All (application) unless lookup returns 403 — then we fall back to encoded UPN.
 */
async function resolveGraphSendMailUserSegment(config: GraphMailConfig, accessToken: string): Promise<string> {
  if (config.senderObjectId) return config.senderObjectId;

  const lookupUrl = `${GRAPH_BASE}/users/${encodeURIComponent(config.senderEmail)}?$select=id,mail,userPrincipalName`;
  const lookup = await fetch(lookupUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (lookup.status === 200) {
    const user = (await lookup.json().catch(() => null)) as { id?: string } | null;
    if (typeof user?.id === "string" && user.id.length > 0) {
      logger.info(
        { step: "graph_sender_lookup", senderEmail: config.senderEmail, userId: user.id },
        "Resolved MS_GRAPH_SENDER_EMAIL to Graph user id for sendMail",
      );
      return user.id;
    }
    throw new Error("Microsoft Graph: sender lookup returned 200 but no user id");
  }

  if (lookup.status === 404) {
    const detail = await lookup.text().catch(() => "");
    logger.error(
      { step: "graph_sender_lookup", status: 404, senderEmail: config.senderEmail, body: detail.slice(0, 1500) },
      "Microsoft Graph: sender mailbox not found in tenant",
    );
    throw new Error(
      `Microsoft Graph: no user/mailbox found for MS_GRAPH_SENDER_EMAIL (${config.senderEmail}) in this tenant. Create the mailbox or fix the address.`,
    );
  }

  if (lookup.status === 403) {
    if (!warnedSenderLookupFallback) {
      warnedSenderLookupFallback = true;
      logger.warn(
        { senderEmail: config.senderEmail },
        "Graph GET /users/{sender} returned 403. Grant Application permission User.Read.All (or User.ReadBasic.All) so the server can resolve the sender to an object id, or set MS_SENDER_OBJECT_ID. Using encoded UPN in sendMail path.",
      );
    }
    return encodeURIComponent(config.senderEmail);
  }

  const fallbackBody = await lookup.text().catch(() => "");
  if (!warnedSenderLookupFallback) {
    warnedSenderLookupFallback = true;
    logger.warn(
      {
        step: "graph_sender_lookup",
        status: lookup.status,
        senderEmail: config.senderEmail,
        body: redactForLogs(fallbackBody.slice(0, 1500)),
      },
      "Graph sender lookup unexpected status; using encoded UPN in sendMail path",
    );
  }
  return encodeURIComponent(config.senderEmail);
}

function graphCorrelationHeaders(response: Response): Record<string, string | undefined> {
  return {
    requestId: response.headers.get("request-id") ?? response.headers.get("x-ms-request-id") ?? undefined,
    clientRequestId: response.headers.get("client-request-id") ?? undefined,
  };
}

async function sendViaGraphMail(config: GraphMailConfig, input: SystemEmailInput): Promise<void> {
  const token = await acquireGraphAccessToken(config);
  const userSegment = await resolveGraphSendMailUserSegment(config, token);
  const sendUrl = `${GRAPH_BASE}/users/${userSegment}/sendMail`;

  const bodyContent = input.htmlBody
    ? { contentType: "HTML", content: input.htmlBody }
    : { contentType: "Text", content: input.textBody };

  const graphBody = {
    message: {
      subject: input.subject,
      body: bodyContent,
      toRecipients: [
        {
          emailAddress: {
            address: input.toEmail,
          },
        },
      ],
    },
    saveToSentItems: true,
  };

  const response = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(graphBody),
  });

  const rawText = await response.text();
  let logBody = rawText;
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    logBody = JSON.stringify(parsed);
  } catch {
    // keep rawText
  }

  const correlation = graphCorrelationHeaders(response);

  if (!response.ok) {
    logger.error(
      {
        step: "graph_sendMail",
        status: response.status,
        toEmail: input.toEmail,
        body: redactForLogs(logBody || "(empty)"),
        ...correlation,
      },
      "Microsoft Graph sendMail failed",
    );
    let detail = `sendMail HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(rawText) as {
        error?: { message?: string; code?: string };
      };
      if (errJson?.error?.message) {
        detail = `${errJson.error.code ?? "Error"}: ${errJson.error.message}`;
      }
    } catch {
      if (rawText) detail = `${detail}: ${rawText.slice(0, 500)}`;
    }
    throw new Error(detail);
  }

  logger.info(
    {
      step: "graph_sendMail",
      httpStatus: response.status,
      sender: config.senderEmail,
      sendAsUserSegment:
        userSegment.includes("%40") || userSegment.includes("@") ? "encoded-upn" : "object-id",
      toEmail: input.toEmail,
      subject: input.subject,
      ...correlation,
    },
    "Microsoft Graph sendMail accepted (Exchange still delivers/filters mail; use requestId with Microsoft support if needed)",
  );
}

export async function sendHumanInviteEmail(
  input: HumanInviteEmailInput,
): Promise<HumanInviteEmailDelivery> {
  const { textBody, htmlBody } = buildHumanInviteEmailBodies({
    toName: input.toName,
    temporaryUsername: input.temporaryUsername,
    temporaryPassword: input.temporaryPassword,
    signInUrl: input.signInUrl,
    inviterName: input.inviterName,
    companyName: input.companyName,
    workspaceSlug: input.workspaceSlug,
    membershipRole: input.membershipRole,
    projectNames: input.projectNames,
    expiryHours: input.expiryHours,
  });
  const delivery = await sendSystemEmail({
    toEmail: input.toEmail,
    subject: humanInviteEmailSubject(input.companyName),
    textBody,
    htmlBody,
  });
  if (delivery.status === "sent") {
    return {
      ...delivery,
      message: `Invite email sent to ${input.toEmail} (Microsoft Graph accepted the request; if it does not arrive, check Spam/Junk and the sender mailbox Sent Items)`,
    };
  }
  if (delivery.status === "failed") {
    return {
      ...delivery,
      message: delivery.message.replace("Failed to send email:", "Failed to send invite email:"),
    };
  }
  return delivery;
}

export async function sendSystemEmail(input: SystemEmailInput): Promise<HumanInviteEmailDelivery> {
  try {
    const graphConfig = resolveGraphMailConfig();
    if (!graphConfig) {
      return {
        status: "skipped",
        message:
          "Microsoft Graph mail is not configured. Set MS_GRAPH_TENANT_ID_EMAIL, MS_GRAPH_CLIENT_ID_EMAIL, MS_GRAPH_CLIENT_SECRET_EMAIL, and MS_GRAPH_SENDER_EMAIL",
      };
    }

    await sendViaGraphMail(graphConfig, input);

    return {
      status: "sent",
      message: `Email sent to ${input.toEmail} (Microsoft Graph accepted the request; if it does not arrive, check Spam/Junk and the sender mailbox Sent Items)`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Failed to send email: ${message}`,
    };
  }
}
