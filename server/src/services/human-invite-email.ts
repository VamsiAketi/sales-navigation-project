import net from "node:net";
import tls from "node:tls";

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

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  heloHost: string;
  auth?: {
    user: string;
    pass: string;
  };
};

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function resolveSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secureRaw = process.env.SMTP_SECURE;
  const heloHost = process.env.SMTP_HELO_HOST?.trim() || "localhost";

  const hasAnyConfig =
    Boolean(host) ||
    Boolean(portRaw) ||
    Boolean(from) ||
    Boolean(user) ||
    Boolean(pass) ||
    secureRaw !== undefined;
  if (!hasAnyConfig) return null;

  if (!host) {
    throw new Error("SMTP_HOST is required when SMTP email is configured");
  }
  if (!portRaw) {
    throw new Error("SMTP_PORT is required when SMTP email is configured");
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer (received: ${portRaw})`);
  }
  if (!from) {
    throw new Error("SMTP_FROM is required when SMTP email is configured");
  }
  if ((user && !pass) || (!user && pass)) {
    throw new Error("SMTP_USER and SMTP_PASS must be provided together");
  }

  const secureParsed = parseBoolean(secureRaw);
  if (secureRaw !== undefined && secureParsed === null) {
    throw new Error(`SMTP_SECURE must be true/false (received: ${secureRaw})`);
  }

  return {
    host,
    port,
    from,
    secure: secureParsed ?? port === 465,
    heloHost,
    auth: user && pass ? { user, pass } : undefined
  };
}

function base64(input: string) {
  return Buffer.from(input, "utf8").toString("base64");
}

function wrapBase64Body(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join("\r\n");
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

function createSocket(config: SmtpConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (config.secure) {
      const socket = tls.connect(
        { host: config.host, port: config.port, servername: config.host },
        () => resolve(socket)
      );
      socket.once("error", onError);
      return;
    }
    const socket = net.connect({ host: config.host, port: config.port }, () =>
      resolve(socket)
    );
    socket.once("error", onError);
  });
}

async function readSmtpResponse(
  socket: net.Socket | tls.TLSSocket
): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;
      const lastLine = lines[lines.length - 1]!;
      const match = /^(\d{3})([\s-])/.exec(lastLine);
      if (!match) return;
      if (match[2] === "-") return;
      cleanup();
      resolve({ code: Number.parseInt(match[1]!, 10), lines });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("SMTP connection closed before response"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

async function sendSmtpCommand(input: {
  socket: net.Socket | tls.TLSSocket;
  command: string;
  expect: number[];
}) {
  input.socket.write(`${input.command}\r\n`);
  const response = await readSmtpResponse(input.socket);
  if (!input.expect.includes(response.code)) {
    throw new Error(
      `SMTP command failed (${input.command.split(" ")[0]}): ${response.lines.join(" | ")}`
    );
  }
}

async function sendViaSmtp(input: {
  config: SmtpConfig;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}) {
  const socket = await createSocket(input.config);
  try {
    const greeting = await readSmtpResponse(socket);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed: ${greeting.lines.join(" | ")}`);
    }

    await sendSmtpCommand({
      socket,
      command: `EHLO ${input.config.heloHost}`,
      expect: [250]
    });

    if (input.config.auth) {
      await sendSmtpCommand({
        socket,
        command: "AUTH LOGIN",
        expect: [334]
      });
      await sendSmtpCommand({
        socket,
        command: base64(input.config.auth.user),
        expect: [334]
      });
      await sendSmtpCommand({
        socket,
        command: base64(input.config.auth.pass),
        expect: [235]
      });
    }

    await sendSmtpCommand({
      socket,
      command: `MAIL FROM:<${input.config.from}>`,
      expect: [250]
    });
    await sendSmtpCommand({
      socket,
      command: `RCPT TO:<${input.toEmail}>`,
      expect: [250, 251]
    });
    await sendSmtpCommand({ socket, command: "DATA", expect: [354] });

    let mimePayload: string;
    if (input.htmlBody) {
      const boundary = `pc_alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const plainB64 = wrapBase64Body(Buffer.from(input.textBody, "utf8").toString("base64"));
      const htmlB64 = wrapBase64Body(Buffer.from(input.htmlBody, "utf8").toString("base64"));
      mimePayload = [
        `From: ${input.config.from}`,
        `To: ${input.toEmail}`,
        `Subject: ${input.subject}`,
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        plainB64,
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        htmlB64,
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      mimePayload = [
        `From: ${input.config.from}`,
        `To: ${input.toEmail}`,
        `Subject: ${input.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        input.textBody.replace(/\r?\n/g, "\r\n"),
      ].join("\r\n");
    }
    const escapedBody = mimePayload.replace(/^\./gm, "..");
    socket.write(`${escapedBody}\r\n.\r\n`);
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) {
      throw new Error(`SMTP DATA failed: ${dataResponse.lines.join(" | ")}`);
    }

    await sendSmtpCommand({ socket, command: "QUIT", expect: [221, 250] });
  } finally {
    socket.destroy();
  }
}

export async function sendHumanInviteEmail(
  input: HumanInviteEmailInput
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
      "Please sign in and change your password."
    ].join("\n"),
  });
  if (delivery.status === "sent") {
    return { ...delivery, message: `Invite email sent to ${input.toEmail}` };
  }
  if (delivery.status === "failed") {
    return { ...delivery, message: delivery.message.replace("Failed to send email:", "Failed to send invite email:") };
  }
  return delivery;
}

export async function sendSystemEmail(input: SystemEmailInput): Promise<HumanInviteEmailDelivery> {
  try {
    const smtpConfig = resolveSmtpConfig();
    if (!smtpConfig) {
      return {
        status: "skipped",
        message:
          "SMTP is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_FROM to send invite emails automatically."
      };
    }

    await sendViaSmtp({
      config: smtpConfig,
      toEmail: input.toEmail,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
    });

    return {
      status: "sent",
      message: `Email sent to ${input.toEmail}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: `Failed to send email: ${message}`
    };
  }
}
