import { logger } from "../middleware/logger.js";

export type HumanInviteEmailInput = {
  toEmail: string;
  toName: string;
  temporaryUsername: string;
  temporaryPassword: string;
  signInUrl: string;
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
  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  const senderEmail = process.env.MS_SENDER_EMAIL?.trim();
  const senderObjectId = process.env.MS_SENDER_OBJECT_ID?.trim() || undefined;

  const hasAny = Boolean(tenantId || clientId || clientSecret || senderEmail || senderObjectId);
  if (!hasAny) return null;

  if (!tenantId || !clientId || !clientSecret || !senderEmail) {
    throw new Error(
      "Microsoft Graph mail is partially configured. Set all of: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL",
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
        "Resolved MS_SENDER_EMAIL to Graph user id for sendMail",
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
      `Microsoft Graph: no user/mailbox found for MS_SENDER_EMAIL (${config.senderEmail}) in this tenant. Create the mailbox or fix the address.`,
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

/**
 * Plain + HTML bodies for password reset. Uses table layout and inline styles for broad client support.
 */
export function buildPasswordResetEmailBodies(input: { resetUrl: string; recipientEmail: string }): {
  textBody: string;
  htmlBody: string;
} {
  const textBody = [
    "Reset your AI-Harness password",
    "",
    "We received a request to reset the password for:",
    input.recipientEmail,
    "",
    "Open this link to choose a new password (it expires after a short time):",
    input.resetUrl,
    "",
    "If you did not ask for this, you can ignore this email. Your password will stay the same.",
  ].join("\r\n");

  const safeEmail = escapeHtml(input.recipientEmail);
  const href = escapeHtmlAttr(input.resetUrl);

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;-webkit-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;">
            <p style="margin:0 0 8px 0;font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#18181b;">Reset your password</p>
            <p style="margin:0 0 20px 0;color:#52525b;font-size:14px;line-height:1.55;">We received a request to reset your AI-Harness password. Use the button below to choose a new one.</p>
            <p style="margin:0 0 20px 0;font-size:13px;color:#71717a;"><strong style="color:#3f3f46;">Account</strong><br />${safeEmail}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
              <tr>
                <td align="center" bgcolor="#4f46e5" style="border-radius:9999px;background-color:#4f46e5;">
                  <a href="${href}" style="display:inline-block;padding:12px 28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9999px;">Choose a new password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 12px 0;font-size:12px;color:#a1a1aa;line-height:1.5;">If the button does not work, copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:12px;word-break:break-all;color:#6366f1;"><a href="${href}" style="color:#6366f1;text-decoration:underline;">${href}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px 28px;border-top:1px solid #f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#a1a1aa;">
            If you did not request a password reset, you can ignore this message. Your password will not be changed.
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#a1a1aa;text-align:center;">AI-Harness &mdash; control plane for AI companies</p>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { textBody, htmlBody };
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
  const delivery = await sendSystemEmail({
    toEmail: input.toEmail,
    subject: "You have been invited to AI-Harness",
    textBody: [
      `Hello ${input.toName},`,
      "",
      "You have been granted access to AI-Harness.",
      "",
      `Sign in: ${input.signInUrl}`,
      `Email: ${input.temporaryUsername}`,
      `Temporary password: ${input.temporaryPassword}`,
      "",
      "Please sign in and change your password.",
    ].join("\n"),
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
          "Microsoft Graph mail is not configured. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_SENDER_EMAIL",
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
